package mbta.actor

import mbta.actor.ModelAPIResponse._
import mbta.actor.ModelData._
import org.apache.pekko

import scala.collection.concurrent.TrieMap
import scala.concurrent.ExecutionContext
import scala.concurrent.Future
import scala.jdk.CollectionConverters._
import scala.util.Try

import pekko.actor.ActorSystem
import pekko.event.LoggingAdapter
import pekko.http.scaladsl.model._
import pekko.NotUsed
import pekko.stream.{Materializer, SystemMaterializer}
import pekko.stream.scaladsl.{Flow, Sink, Source}

class RequestFlow(access: MBTAAccess)(implicit system: ActorSystem, log: LoggingAdapter) {
  private implicit val ec:  ExecutionContext = system.dispatcher
  private implicit val mat: Materializer    = SystemMaterializer(system).materializer

  // ── Constants ─────────────────────────────────────────────────────────────

  private val PredictionBatchSize:  Int  = 10
  private val StopCacheTtlMillis:    Long = 60L * 60L * 1000L  // 1 hour
  private val VehicleCacheTtlMillis: Long = 8L * 1000L         // 8 s (just under client poll)
  private val AlertCacheTtlMillis:   Long = 2L * 60L * 1000L  // 2 minutes

  // ── Internal types ────────────────────────────────────────────────────────

  private case class StopDetails(name: Option[String], platformName: Option[String], zone: Option[String])

  private case class PredictionResult(
    predictedArrivalTime : Option[String],
    scheduledArrivalTime : Option[String],
    delaySeconds         : Option[Int],
  )

  // ── Caches (thread-safe) ──────────────────────────────────────────────────

  private val stopCache:         TrieMap[String, (StopDetails, Long)]          = TrieMap.empty
  private val vehicleCache:     TrieMap[String, (Vector[VehicleData], Long)]   = TrieMap.empty
  private val vehicleInflight:  TrieMap[String, Future[Vector[VehicleData]]]   = TrieMap.empty
  private val alertByRouteCache: TrieMap[String, (Vector[AlertInfo], Long)]    = TrieMap.empty
  private val alertGlobalCache:  TrieMap[String, (Vector[AlertInfo], Long)]    = TrieMap.empty

  // ── Stream Flows ──────────────────────────────────────────────────────────

  private def vehiclesPerRouteRawFlow: Flow[VehicleMsg, VehicleMsg, NotUsed] =
    Flow[VehicleMsg].mapAsync(parallelism = 12) {
      case vr @ VehicleRoute(route) =>
        access.queueRequest(
          HttpRequest(uri = access.mbtaUri(
            path  = "/vehicles",
            // include route so we can extract directionNames/destinationNames
            // without a separate /routes/{id} prefetch call
            query = access.mbtaQuery(Map("include" -> "stop,trip,route", "filter[route]" -> route))
          ))
        ).flatMap {
          case HttpResponse(StatusCodes.OK, _, entity, _) =>
            access.parseMbtaResponse(entity).map { resp =>
              log.info("vehiclesPerRouteRawFlow({}): OK", route)
              val vehicles = resp.getObjectList("data").asScala.toVector.map(_.toConfig)
              val included = Try(resp.getObjectList("included").asScala.toVector.map(_.toConfig)).getOrElse(Vector.empty)
              VehiclesPerRouteRaw(route = vr, rawVehicles = vehicles, rawIncluded = included)
            }
          case HttpResponse(code, _, entity, _) =>
            log.error("vehiclesPerRouteRawFlow({}) unexpected status: {}", route, code)
            entity.discardBytes()
            Future.successful(VehiclesPerRouteRaw(route = vr, rawVehicles = Vector.empty))
        }

      case unexpected =>
        Future.failed(new Exception(s"vehiclesPerRouteRawFlow unexpected input: $unexpected"))
    }

  private def vehiclesPerRouteFlow: Flow[VehicleMsg, VehicleMsg, NotUsed] =
    Flow[VehicleMsg].mapConcat {
      case VehiclesPerRouteRaw(route, rawVehicles, included) =>

        val tripNameMap: Map[String, String] = included
          .filter(r => Try(r.getString("type")).getOrElse("") == "trip")
          .flatMap { trip =>
            for {
              id   <- Try(trip.getString("id")).toOption
              name <- Try(trip.getString("attributes.name")).toOption
            } yield id -> name
          }
          .toMap

        // Extract directionNames/destinationNames from the included route object.
        // This replaces the previous separate /routes/{routeId} HTTP call.
        val (directionNames, destinationNames): (Vector[String], Vector[String]) =
          included
            .find(r => Try(r.getString("type")).getOrElse("") == "route")
            .fold((Vector.empty[String], Vector.empty[String])) { r =>
              val dirs  = Try(r.getStringList("attributes.direction_names").asScala.toVector).getOrElse(Vector.empty)
              val dests = Try(r.getStringList("attributes.direction_destinations").asScala.toVector).getOrElse(Vector.empty)
              (dirs, dests)
            }

        rawVehicles.map { r =>
          val directionId = Try(r.getInt("attributes.direction_id"))
          val tripId      = Try(r.getString("relationships.trip.data.id")).toOption

          VehicleData(
            routeId             = route.route,
            vehicleId           = Try(r.getString("attributes.label")).toOption,
            stopId              = Try(r.getString("relationships.stop.data.id")).toOption,
            tripId              = tripId,
            tripName            = tripId.flatMap(tripNameMap.get),
            bearing             = Try(r.getInt("attributes.bearing")).toOption,
            directionId         = directionId.toOption,
            currentStatus       = Try(r.getString("attributes.current_status")).toOption,
            currentStopSequence = Try(r.getInt("attributes.current_stop_sequence")).toOption,
            latitude            = Try(r.getDouble("attributes.latitude")).toOption,
            longitude           = Try(r.getDouble("attributes.longitude")).toOption,
            speed               = Try(r.getDouble("attributes.speed")).toOption,
            updatedAt           = Try(r.getString("attributes.updated_at")).toOption,
            direction           = directionId.flatMap(id => Try(directionNames(id))).toOption,
            destination         = directionId.flatMap(id => Try(destinationNames(id))).toOption,
          )
        }

      case unexpected =>
        log.error("vehiclesPerRouteFlow unexpected input: {}", unexpected)
        Vector.empty
    }

  // ── Stop Enrichment (batched by unique stopId, cached across requests) ────

  private def fetchStopById(stopId: String): Future[StopDetails] = {
    val now = java.time.Instant.now().toEpochMilli()

    stopCache.get(stopId) match {
      case Some((details, expiry)) if expiry > now =>
        Future.successful(details)  // cache hit

      case _ =>
        access.queueRequest(
          HttpRequest(uri = access.mbtaUri(
            path  = s"/stops/$stopId",
            query = access.mbtaQuery()
          ))
        ).flatMap {
          case HttpResponse(StatusCodes.OK, _, entity, _) =>
            access.parseMbtaResponse(entity).map { r =>
              val details = StopDetails(
                name         = Try(r.getString("data.attributes.name")).toOption,
                platformName = Try(r.getString("data.attributes.platform_name")).toOption,
                zone         = Try(r.getString("data.relationships.zone.data.id")).toOption,
              )
              stopCache.update(stopId, (details, now + StopCacheTtlMillis))
              details
            }
          case HttpResponse(code, _, entity, _) =>
            log.error("fetchStopById({}) unexpected status: {}", stopId, code)
            entity.discardBytes()
            Future.successful(StopDetails(None, None, None))  // failures are not cached; let them retry
        }
    }
  }

  private def enrichWithStops(vehicles: Vector[VehicleData]): Future[Vector[VehicleData]] = {
    val uniqueStopIds = vehicles.flatMap(_.stopId).distinct
    Source(uniqueStopIds)
      .mapAsync(parallelism = 16)(id => fetchStopById(id).map(id -> _))
      .runWith(Sink.seq)
      .map { entries =>
        val stopMap = entries.toMap
        vehicles.map { vehicle =>
          vehicle.stopId.flatMap(stopMap.get).fold(vehicle) { stop =>
            vehicle.copy(
              stopName         = stop.name,
              stopPlatformName = stop.platformName,
              stopZone         = stop.zone,
            )
          }
        }
      }
  }

  // ── Prediction + Schedule Enrichment (batched 10 vehicles per API call) ───

  private def fetchPredictionBatch(
    vehicles: Vector[VehicleData]
  ): Future[Map[(String, String), PredictionResult]] = {
    val tripIds = vehicles.flatMap(_.tripId).distinct.mkString(",")
    val stopIds = vehicles.flatMap(_.stopId).distinct.mkString(",")

    if (tripIds.isEmpty || stopIds.isEmpty) Future.successful(Map.empty)
    else access.queueRequest(
      HttpRequest(uri = access.mbtaUri(
        path  = "/predictions",
        query = access.mbtaQuery(Map(
          "filter[trip]" -> tripIds,
          "filter[stop]" -> stopIds,
          "include"      -> "schedule",
        ))
      ))
    ).flatMap {
      case HttpResponse(StatusCodes.OK, _, entity, _) =>
        access.parseMbtaResponse(entity).map { resp =>
          val predictions = Try(resp.getObjectList("data").asScala.toVector.map(_.toConfig)).getOrElse(Vector.empty)
          val scheduleMap = Try(resp.getObjectList("included").asScala.toVector.map(_.toConfig)).getOrElse(Vector.empty)
            .filter(r => Try(r.getString("type")).getOrElse("") == "schedule")
            .flatMap(s => Try(s.getString("id")).toOption.map(_ -> s))
            .toMap

          predictions.flatMap { pred =>
            for {
              tripId           <- Try(pred.getString("relationships.trip.data.id")).toOption
              stopId           <- Try(pred.getString("relationships.stop.data.id")).toOption
              predictedArrival  = Try(pred.getString("attributes.arrival_time")).toOption
              scheduledArrival  = Try(pred.getString("relationships.schedule.data.id")).toOption
                                    .flatMap(scheduleMap.get)
                                    .flatMap(s => Try(s.getString("attributes.arrival_time")).toOption)
              delay             = (predictedArrival, scheduledArrival) match {
                                    case (Some(p), Some(s)) =>
                                      Try(java.time.Duration.between(
                                        java.time.Instant.parse(s),
                                        java.time.Instant.parse(p)
                                      ).getSeconds.toInt).toOption
                                    case _ => None
                                  }
            } yield (tripId, stopId) -> PredictionResult(predictedArrival, scheduledArrival, delay)
          }.toMap
        }
      case HttpResponse(code, _, entity, _) =>
        log.error("fetchPredictionBatch unexpected status: {}", code)
        entity.discardBytes()
        Future.successful(Map.empty)
    }
  }

  private def enrichWithPredictions(vehicles: Vector[VehicleData]): Future[Vector[VehicleData]] = {
    val batches = vehicles.grouped(PredictionBatchSize).toVector
    Source(batches)
      .mapAsync(parallelism = 4)(fetchPredictionBatch)
      .runWith(Sink.seq)
      .map { batchResults =>
        val predMap = batchResults.flatten.toMap
        // vehicles.map preserves order; mapAsync also preserves order — zip-merge is safe
        vehicles.map { vehicle =>
          (vehicle.tripId, vehicle.stopId) match {
            case (Some(tripId), Some(stopId)) =>
              predMap.get((tripId, stopId)).fold(vehicle) { pred =>
                vehicle.copy(
                  predictedArrivalTime = pred.predictedArrivalTime,
                  scheduledArrivalTime = pred.scheduledArrivalTime,
                  delaySeconds         = pred.delaySeconds,
                )
              }
            case _ => vehicle
          }
        }
      }
  }

  // ── Merge (stop fields + prediction fields are disjoint) ─────────────────

  private def computeFormattedStatus(status: Option[String], stopName: Option[String]): Option[String] =
    status.map {
      case "IN_TRANSIT_TO"  => s"In transit to ${stopName.getOrElse("next stop")}"
      case "STOPPED_AT"     => s"Stopped at ${stopName.getOrElse("stop")}"
      case "INCOMING_AT"    => s"Incoming at ${stopName.getOrElse("next stop")}"
      case raw              => raw.replace('_', ' ').toLowerCase.capitalize
    }

  private def computeDelayStatus(delaySeconds: Option[Int]): Option[String] =
    delaySeconds.map {
      case d if d < -60  => "ahead"
      case d if d < 300  => "on-time"
      case d if d < 600  => "minor-delay"
      case _             => "major-delay"
    }

  private def mergeEnrichments(
    withStops: Vector[VehicleData],
    withPreds: Vector[VehicleData],
  ): Vector[VehicleData] =
    withStops.zip(withPreds).map { case (s, p) =>
      val delay = p.delaySeconds
      s.copy(
        predictedArrivalTime = p.predictedArrivalTime,
        scheduledArrivalTime = p.scheduledArrivalTime,
        delaySeconds         = delay,
        formattedStatus      = computeFormattedStatus(s.currentStatus, s.stopName),
        delayStatus          = computeDelayStatus(delay),
      )
    }

  // ── Sorting ───────────────────────────────────────────────────────────────

  private def sortVehicles(vehicles: Vector[VehicleData], sortBy: String, sortOrder: String): Vector[VehicleData] = {
    val sorted = sortBy.toLowerCase match {
      case "tripid" => vehicles.sortBy(v => v.tripId.getOrElse(v.vehicleId.getOrElse("")))
      case _        => vehicles.sortBy(_.vehicleId.getOrElse(""))
    }
    if (sortOrder.toLowerCase == "asc") sorted else sorted.reverse
  }

  // ── Public API ────────────────────────────────────────────────────────────

  private def fetchFromMbta(routeId: String): Future[Vector[VehicleData]] = {
    val now = java.time.Instant.now().toEpochMilli()
    Source.single[VehicleMsg](VehicleRoute(routeId))
      .via(vehiclesPerRouteRawFlow)
      .via(vehiclesPerRouteFlow)
      .collect { case v: VehicleData => v }
      .runWith(Sink.seq)
      .map(_.toVector)
      .flatMap { vehicles =>
        // Stop and prediction enrichment touch independent fields — run in parallel.
        val stopsFut = enrichWithStops(vehicles)
        val predsFut = enrichWithPredictions(vehicles)
        stopsFut.zip(predsFut).map { case (withStops, withPreds) =>
          mergeEnrichments(withStops, withPreds)
        }
      }
      .andThen { case _ =>
        vehicleInflight.remove(routeId)
      }
      .map { vehicles =>
        vehicleCache.update(routeId, (vehicles, now + VehicleCacheTtlMillis))
        vehicles
      }
  }

  def fetchVehiclesForRoute(routeId: String, sortBy: String = "vehicleId", sortOrder: String = "asc"): Future[Vector[VehicleData]] = {
    val now = java.time.Instant.now().toEpochMilli()
    val base: Future[Vector[VehicleData]] =
      vehicleCache.get(routeId) match {
        case Some((vehicles, expiry)) if expiry > now =>
          Future.successful(vehicles)
        case _ =>
          vehicleInflight.getOrElseUpdate(routeId, fetchFromMbta(routeId))
      }
    base.map(sortVehicles(_, sortBy, sortOrder))
  }

  def fetchStops(routeId: String): Future[Vector[StopInfo]] =
    access.queueRequest(
      HttpRequest(uri = access.mbtaUri(
        path  = "/stops",
        query = access.mbtaQuery(Map("filter[route]" -> routeId))
      ))
    ).flatMap {
      case HttpResponse(StatusCodes.OK, _, entity, _) =>
        access.parseMbtaResponse(entity).map { response =>
          response.getObjectList("data").asScala.toVector.map { stop =>
            val s = stop.toConfig
            StopInfo(
              id        = s.getString("id"),
              name      = s.getString("attributes.name"),
              latitude  = s.getDouble("attributes.latitude"),
              longitude = s.getDouble("attributes.longitude"),
            )
          }
        }
      case HttpResponse(code, _, entity, _) =>
        log.error("fetchStops({}) unexpected status: {}", routeId, code)
        entity.discardBytes()
        Future.successful(Vector.empty)
    }

  def fetchRoutesOnDemand(typeFilter: Option[String]): Future[Vector[RouteInfo]] = {
    val filterType = typeFilter.getOrElse("0,1,2,3")
    access.queueRequest(
      HttpRequest(uri = access.mbtaUri(
        path  = "/routes",
        query = access.mbtaQuery(Map("filter[type]" -> filterType))
      ))
    ).flatMap {
      case HttpResponse(StatusCodes.OK, _, entity, _) =>
        access.parseMbtaResponse(entity).map { response =>
          response.getObjectList("data").asScala.toVector.map { route =>
            val r = route.toConfig
            RouteInfo(
              id         = r.getString("id"),
              long_name  = r.getString("attributes.long_name"),
              short_name = r.getString("attributes.short_name"),
              color      = r.getString("attributes.color"),
              text_color = r.getString("attributes.text_color"),
              route_type = r.getInt("attributes.type"),
            )
          }
        }
      case HttpResponse(code, _, entity, _) =>
        log.error("fetchRoutesOnDemand unexpected status: {}", code)
        entity.discardBytes()
        Future.successful(Vector.empty)
    }
  }

  def fetchShapes(routeId: String): Future[Vector[ShapeInfo]] =
    access.queueRequest(
      HttpRequest(uri = access.mbtaUri(
        path  = "/shapes",
        query = access.mbtaQuery(Map("filter[route]" -> routeId))
      ))
    ).flatMap {
      case HttpResponse(StatusCodes.OK, _, entity, _) =>
        access.parseMbtaResponse(entity).map { response =>
          response.getObjectList("data").asScala.toVector.map { shape =>
            val s = shape.toConfig
            ShapeInfo(
              id          = s.getString("id"),
              polyline    = s.getString("attributes.polyline"),
              priority    = Try(s.getInt("attributes.priority")).getOrElse(0),
              directionId = Try(s.getInt("attributes.direction_id")).getOrElse(0),
            )
          }
        }
      case HttpResponse(code, _, entity, _) =>
        log.error("fetchShapes({}) unexpected status: {}", routeId, code)
        entity.discardBytes()
        Future.successful(Vector.empty)
    }

  def fetchAlertsForRoute(routeId: String): Future[Vector[AlertInfo]] = {
    val now = System.currentTimeMillis()
    alertByRouteCache.get(routeId) match {
      case Some((alerts, expiry)) if expiry > now => Future.successful(alerts)
      case _ =>
        val nowIso = java.time.Instant.now().toString
        access.queueRequest(
          HttpRequest(uri = access.mbtaUri(
            path  = "/alerts",
            query = access.mbtaQuery(Map(
              "filter[route]"    -> routeId,
              "filter[activity]" -> "BOARD,EXIT,RIDE",
              "filter[datetime]" -> nowIso,
            ))
          ))
        ).flatMap {
          case HttpResponse(StatusCodes.OK, _, entity, _) =>
            access.parseMbtaResponse(entity).map { response =>
              val alerts = response.getObjectList("data").asScala.toVector.map { item =>
                parseAlertInfo(item.toConfig, includeRoutes = false)
              }
              alertByRouteCache.put(routeId, (alerts, now + AlertCacheTtlMillis))
              alerts
            }
          case HttpResponse(code, _, entity, _) =>
            log.error("fetchAlertsForRoute({}) unexpected status: {}", routeId, code)
            entity.discardBytes()
            Future.successful(Vector.empty)
        }
    }
  }

  def fetchAlertsGlobal(): Future[Vector[AlertInfo]] = {
    val now = System.currentTimeMillis()
    alertGlobalCache.get("global") match {
      case Some((alerts, expiry)) if expiry > now => Future.successful(alerts)
      case _ =>
        val nowIso = java.time.Instant.now().toString
        access.queueRequest(
          HttpRequest(uri = access.mbtaUri(
            path  = "/alerts",
            query = access.mbtaQuery(Map(
              "filter[activity]" -> "BOARD,EXIT,RIDE",
              "filter[datetime]" -> nowIso,
            ))
          ))
        ).flatMap {
          case HttpResponse(StatusCodes.OK, _, entity, _) =>
            access.parseMbtaResponse(entity).map { response =>
              val alerts = response.getObjectList("data").asScala.toVector.map { item =>
                parseAlertInfo(item.toConfig, includeRoutes = true)
              }
              alertGlobalCache.put("global", (alerts, now + AlertCacheTtlMillis))
              alerts
            }
          case HttpResponse(code, _, entity, _) =>
            log.error("fetchAlertsGlobal unexpected status: {}", code)
            entity.discardBytes()
            Future.successful(Vector.empty)
        }
    }
  }

  private def parseAlertInfo(r: com.typesafe.config.Config, includeRoutes: Boolean): AlertInfo = {
    val routeIds: Vector[String] =
      if (!includeRoutes) Vector.empty
      else
        Try(r.getObjectList("relationships.routes.data").asScala.toVector)
          .getOrElse(Vector.empty)
          .flatMap(obj => Try(obj.toConfig.getString("id")).toOption)
    AlertInfo(
      id          = r.getString("id"),
      header      = Try(r.getString("attributes.header")).getOrElse(""),
      effect      = Try(r.getString("attributes.effect")).getOrElse("UNKNOWN"),
      severity    = Try(r.getInt("attributes.severity")).getOrElse(1),
      lifecycle   = Try(r.getString("attributes.lifecycle")).getOrElse("ONGOING"),
      updatedAt   = Try(r.getString("attributes.updated_at")).getOrElse(""),
      description = Try(r.getString("attributes.description")).toOption,
      cause       = Try(r.getString("attributes.cause")).toOption,
      routeIds    = routeIds,
    )
  }
}
