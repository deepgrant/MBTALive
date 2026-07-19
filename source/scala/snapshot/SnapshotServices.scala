package mbta.snapshot

import mbta.snapshot.SnapshotJson._
import spray.json._

import java.time.Instant
import java.util.concurrent.Executors
import scala.concurrent.Await
import scala.concurrent.ExecutionContext
import scala.concurrent.Future
import scala.concurrent.duration._
import scala.util.control.NonFatal

object SnapshotCacheControl {
  val Vehicles: String = "public,max-age=5,s-maxage=10,stale-if-error=300"
  val Boards: String = "public,max-age=10,s-maxage=30,stale-if-error=600"
  val Alerts: String = "public,max-age=60,s-maxage=120,stale-if-error=1800"
  val Routes: String = "public,max-age=3600,s-maxage=21600,stale-if-error=86400"
  val Reference: String = "public,max-age=21600,s-maxage=86400,stale-if-error=604800"
  val Status: String = "public,max-age=10,s-maxage=10,stale-if-error=60"
  val Internal: String = "private,no-store"
}

final class SnapshotServices(
  config: SnapshotConfig,
  snapshots: SnapshotStore,
  control: ControlStore,
  mbta: RateLimitedMbtaClient,
  clock: () => Instant = () => Instant.now(),
) {
  private val VehicleSlotSeconds = 10L
  private val BoardSlotSeconds = 30L

  def vehicleRefresh(): JsValue = withJobLock("vehicle", VehicleSlotSeconds) {
    val now = clock()
    val active = control.activeRoutes(now)
    if (active.isEmpty) JsObject("status" -> JsString("idle"), "activeRoutes" -> JsNumber(0))
    else mbta.get("/vehicles", Map(
      "filter[route]" -> active.mkString(","),
      "include" -> "stop,trip,route",
    )) match {
      case Left(error) => failure("vehicles", error)
      case Right(root) =>
        val raw = SnapshotTransforms.vehicles(root, now).groupBy(_.routeId).view.mapValues(_.toVector).toMap
        val published = active.map { routeId =>
          val prediction = read[RoutePredictionSnapshot](s"internal/predictions/$routeId")
            .filter(p => Instant.parse(p.generatedAt).isAfter(now.minusSeconds(120)))
          val vehicles = SnapshotTransforms.enrichVehicles(raw.getOrElse(routeId, Vector.empty), prediction)
            .sortBy(_.vehicleId.getOrElse(""))
          publish(s"api/route/$routeId/vehicles", compact(vehicles), SnapshotCacheControl.Vehicles)
          routeId -> vehicles
        }.toMap
        val internal = JsObject(published.view.mapValues(_.toJson).toMap)
        publish("internal/vehicles/latest", internal.compactPrint, SnapshotCacheControl.Internal)
        recordAndPublishStatus("vehicles", now, active.size)
        JsObject("status" -> JsString("ok"), "activeRoutes" -> JsNumber(active.size),
          "vehicles" -> JsNumber(published.values.map(_.size).sum))
    }
  }

  def boardRefresh(): JsValue = withJobLock("board", BoardSlotSeconds) {
    val now = clock()
    val active = control.activeRoutes(now)
    if (active.isEmpty) JsObject("status" -> JsString("idle"), "activeRoutes" -> JsNumber(0))
    else {
      var published = 0
      var failedBatches = 0
      active.grouped(config.predictionBatchSize).foreach { batch =>
        mbta.get("/predictions", Map(
          "filter[route]" -> batch.mkString(","),
          "include" -> "stop,schedule",
          "sort" -> "stop_sequence",
        )) match {
          case Left(error) =>
            failedBatches += 1
            Metrics.emit("BoardBatchFailure", 1, Map("routes" -> batch.mkString(","), "error" -> error.take(120)))
          case Right(root) =>
            val parsed = SnapshotTransforms.predictions(root, now)
            batch.foreach { routeId =>
              val prediction = parsed.getOrElse(routeId, RoutePredictionSnapshot(routeId, now.toString, Vector.empty))
              for {
                vehicles <- read[Vector[VehicleData]](s"api/route/$routeId/vehicles")
                inbound <- read[Vector[BoardStopInfo]](s"internal/reference/stops/$routeId/1")
                outbound <- read[Vector[BoardStopInfo]](s"internal/reference/stops/$routeId/0")
              } {
                publish(s"internal/predictions/$routeId", compact(prediction), SnapshotCacheControl.Internal)
                val board = SnapshotTransforms.board(routeId, vehicles, inbound, outbound, prediction)
                publish(s"api/route/$routeId/board", compact(board), SnapshotCacheControl.Boards)
                published += 1
              }
            }
        }
      }
      if (published > 0 && failedBatches == 0) recordAndPublishStatus("boards", now, active.size)
      JsObject(
        "status" -> JsString(if (failedBatches == 0) "ok" else "partial"),
        "activeRoutes" -> JsNumber(active.size),
        "published" -> JsNumber(published),
        "failedBatches" -> JsNumber(failedBatches),
      )
    }
  }

  def alertRefresh(): JsValue = withJobLock("alerts", 60L) {
    val now = clock()
    val active = control.activeRoutes(now)
    mbta.get("/alerts", Map(
      "filter[activity]" -> "BOARD,EXIT,RIDE",
      "filter[datetime]" -> now.toString,
    )) match {
      case Left(error) => failure("alerts", error)
      case Right(root) =>
        val alerts = SnapshotTransforms.alerts(root)
        publish("api/alerts", compact(alerts), SnapshotCacheControl.Alerts)
        active.foreach { routeId =>
          publish(
            s"api/route/$routeId/alerts",
            compact(alertsForRoute(routeId, alerts)),
            SnapshotCacheControl.Alerts,
          )
        }
        recordAndPublishStatus("alerts", now, active.size)
        JsObject("status" -> JsString("ok"), "alerts" -> JsNumber(alerts.size))
    }
  }

  def referenceRefresh(): JsValue = withJobLock("references", 3600L) {
    val now = clock()
    mbta.get("/routes", Map("filter[type]" -> "0,1,2,3"), waitForPermit = true) match {
      case Left(error) => failure("references", error)
      case Right(root) =>
        val routes = SnapshotTransforms.routes(root)
        publish("api/routes", compact(routes), SnapshotCacheControl.Routes)
        publish("internal/reference/routes", compact(routes), SnapshotCacheControl.Internal)
        val executor = Executors.newFixedThreadPool(8)
        implicit val ec: ExecutionContext = ExecutionContext.fromExecutorService(executor)
        try {
          val results = Await.result(Future.traverse(routes)(route => Future(refreshRouteReference(route.id))), 14.minutes)
          val successes = results.count(identity)
          if (successes == routes.size) recordAndPublishStatus("references", now, control.activeRoutes(now).size)
          JsObject(
            "status" -> JsString(if (successes == routes.size) "ok" else "partial"),
            "routes" -> JsNumber(routes.size),
            "referenceRoutes" -> JsNumber(successes),
          )
        } finally executor.shutdown()
    }
  }

  def routeRefresh(): JsValue = withJobLock("routes", 300L) {
    val now = clock()
    mbta.get("/routes", Map("filter[type]" -> "0,1,2,3"), waitForPermit = true) match {
      case Left(error) => failure("routes", error)
      case Right(root) =>
        val routes = SnapshotTransforms.routes(root)
        publish("api/routes", compact(routes), SnapshotCacheControl.Routes)
        publish("internal/reference/routes", compact(routes), SnapshotCacheControl.Internal)
        recordAndPublishStatus("routes", now, control.activeRoutes(now).size)
        JsObject("status" -> JsString("ok"), "routes" -> JsNumber(routes.size))
    }
  }

  def activate(routeId: String): Either[String, ActivationResult] = {
    val now = clock()
    val valid = read[Vector[RouteInfo]]("api/routes").exists(_.exists(_.id == routeId))
    if (!valid) Left(s"unknown route '$routeId'")
    else {
      val result = control.activate(routeId, now, config.activeTtl.toSeconds)
      if (result.wasInactive) initializeRoute(routeId, now)
      Right(result)
    }
  }

  def smoke(): JsValue = {
    val now = clock()
    val active = control.activeRoutes(now)
    val routes = read[Vector[RouteInfo]]("api/routes").map(_.size).getOrElse(0)
    JsObject(
      "status" -> JsString(if (routes > 0) "ok" else "warming"),
      "routes" -> JsNumber(routes),
      "activeRoutes" -> JsNumber(active.size),
      "timestamp" -> JsString(now.toString),
    )
  }

  private def refreshRouteReference(routeId: String): Boolean = try {
    val publicStops = mbta.get("/stops", Map("filter[route]" -> routeId), waitForPermit = true)
    val inbound = mbta.get("/stops", Map("filter[route]" -> routeId, "filter[direction_id]" -> "1"), waitForPermit = true)
    val outbound = mbta.get("/stops", Map("filter[route]" -> routeId, "filter[direction_id]" -> "0"), waitForPermit = true)
    val shapes = mbta.get("/shapes", Map("filter[route]" -> routeId), waitForPermit = true)
    val patterns = mbta.get("/route_patterns", Map(
      "filter[route]" -> routeId,
      "include" -> "representative_trip",
    ), waitForPermit = true)
    (publicStops, inbound, outbound, shapes, patterns) match {
      case (Right(publicRoot), Right(inRoot), Right(outRoot), Right(shapeRoot), Right(patternRoot)) =>
        val public = SnapshotTransforms.publicStops(publicRoot)
        val in = SnapshotTransforms.orderedStops(inRoot, 1)
        val out = SnapshotTransforms.orderedStops(outRoot, 0)
        val routeShapes = SnapshotTransforms.shapes(shapeRoot, patternRoot)
        publish(s"api/route/$routeId/stops", compact(public), SnapshotCacheControl.Reference)
        publish(s"api/route/$routeId/shapes", compact(routeShapes), SnapshotCacheControl.Reference)
        publish(s"internal/reference/stops/$routeId/1", compact(in), SnapshotCacheControl.Internal)
        publish(s"internal/reference/stops/$routeId/0", compact(out), SnapshotCacheControl.Internal)
        publish(s"internal/reference/shapes/$routeId", compact(routeShapes), SnapshotCacheControl.Internal)
        true
      case _ => false
    }
  } catch {
    case NonFatal(e) =>
      Metrics.emit("ReferenceRouteFailure", 1, Map("route" -> routeId, "error" -> e.getClass.getSimpleName))
      false
  }

  private def initializeRoute(routeId: String, now: Instant): Unit = {
    val currentVehicles = snapshots.get(s"api/route/$routeId/vehicles")
    if (currentVehicles.forall(_.lastModified.isBefore(now.minusSeconds(30)))) {
      val aggregateVehicles = snapshots.get("internal/vehicles/latest")
        .filter(_.lastModified.isAfter(now.minusSeconds(30)))
        .flatMap { stored =>
          try stored.body.parseJson.asJsObject.fields.get(routeId).map(_.convertTo[Vector[VehicleData]])
          catch { case NonFatal(_) => None }
        }
        .getOrElse(Vector.empty)
      publish(s"api/route/$routeId/vehicles", compact(aggregateVehicles), SnapshotCacheControl.Vehicles)
    }

    val currentBoard = snapshots.get(s"api/route/$routeId/board")
    if (currentBoard.forall(_.lastModified.isBefore(now.minusSeconds(90)))) {
      val inbound = read[Vector[BoardStopInfo]](s"internal/reference/stops/$routeId/1").getOrElse(Vector.empty)
      val outbound = read[Vector[BoardStopInfo]](s"internal/reference/stops/$routeId/0").getOrElse(Vector.empty)
      val empty = RouteBoardData(routeId, inbound, outbound, Vector.empty, Some(now.toString))
      publish(s"api/route/$routeId/board", compact(empty), SnapshotCacheControl.Boards)
    }
    read[Vector[AlertInfo]]("api/alerts").foreach { alerts =>
      publish(s"api/route/$routeId/alerts", compact(alertsForRoute(routeId, alerts)), SnapshotCacheControl.Alerts)
    }
  }

  private def alertsForRoute(routeId: String, alerts: Vector[AlertInfo]): Vector[AlertInfo] = {
    val routeStopIds = read[Vector[StopInfo]](s"api/route/$routeId/stops")
      .getOrElse(Vector.empty)
      .map(_.id)
      .toSet
    SnapshotTransforms.alertsForRoute(alerts, routeId, routeStopIds)
  }

  private def withJobLock(job: String, slotSeconds: Long)(f: => JsValue): JsValue = {
    val now = clock()
    val slot = now.getEpochSecond / slotSeconds
    if (!control.tryJobLock(job, slot, now, math.max(120L, slotSeconds * 4L)))
      JsObject("status" -> JsString("duplicate"), "job" -> JsString(job), "slot" -> JsNumber(slot))
    else {
      val started = System.nanoTime()
      emitHealthMetrics(now)
      try {
        val result = f
        val status = result.asJsObject.fields.get("status").collect { case JsString(value) => value }
        if (Set("references", "routes").contains(job) && status.exists(Set("failed", "partial").contains))
          control.releaseJobLock(job, slot)
        result
      }
      catch {
        case NonFatal(error) =>
          if (Set("references", "routes").contains(job)) control.releaseJobLock(job, slot)
          scala.util.Failure[JsValue](error).get
      }
      finally Metrics.emit("RefreshDurationMs", (System.nanoTime() - started) / 1000000L, Map("dataset" -> job))
    }
  }

  private def recordAndPublishStatus(dataset: String, at: Instant, activeCount: Int): Unit = {
    control.recordSuccess(dataset, at)
    publish("api/status", compact(control.status(at, activeCount)), SnapshotCacheControl.Status)
  }

  private def emitHealthMetrics(now: Instant): Unit = {
    val activeCount = control.activeRoutes(now).size
    val status = control.status(now, activeCount)
    Metrics.emit("ActiveRouteCount", activeCount)
    val timestamps = Vector(
      "vehicles" -> status.vehiclesLastSuccess,
      "boards" -> status.boardsLastSuccess,
      "alerts" -> status.alertsLastSuccess,
      "references" -> status.referencesLastSuccess,
    )
    timestamps.foreach { case (dataset, value) =>
      if ((dataset != "vehicles" && dataset != "boards") || activeCount > 0)
        value.foreach { timestamp =>
          val age = math.max(0L, now.getEpochSecond - Instant.parse(timestamp).getEpochSecond)
          Metrics.emit("SnapshotAgeSeconds", age, Map("dataset" -> dataset))
        }
    }
  }

  private def publish(key: String, body: String, cacheControl: String): Unit =
    try snapshots.put(key, body, cacheControl)
    catch {
      case NonFatal(e) =>
        Metrics.emit("S3PublicationFailure", 1, Map("key" -> key, "error" -> e.getClass.getSimpleName))
        scala.util.Failure[Unit](e).get
    }

  private def failure(dataset: String, error: String): JsValue = {
    Metrics.emit("SnapshotRefreshFailure", 1, Map("dataset" -> dataset, "error" -> error.take(120)))
    JsObject("status" -> JsString("failed"), "dataset" -> JsString(dataset), "error" -> JsString(error))
  }

  private def read[A: JsonReader](key: String): Option[A] = snapshots.get(key).flatMap { stored =>
    try Some(stored.body.parseJson.convertTo[A])
    catch {
      case NonFatal(e) =>
        Metrics.emit("SnapshotReadFailure", 1, Map("key" -> key, "error" -> e.getClass.getSimpleName))
        None
    }
  }
}
