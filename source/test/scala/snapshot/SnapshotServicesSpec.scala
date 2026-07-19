package mbta.snapshot

import mbta.snapshot.SnapshotJson._
import org.scalatest.funsuite.AnyFunSuite
import spray.json._

import java.net.http.HttpClient
import java.time.Instant
import scala.collection.mutable
import scala.concurrent.duration._

final class SnapshotServicesSpec extends AnyFunSuite {
  private val now = Instant.parse("2026-07-15T18:40:00Z")

  test("activation validates routes and initializes only a newly active route") {
    val store = new MemorySnapshotStore(now.minusSeconds(3600))
    val control = new TestControlStore
    val routes = Vector(RouteInfo("Red", "Red Line", "", "DA291C", "FFFFFF", 1))
    store.put("api/routes", compact(routes), "")
    store.put("internal/reference/stops/Red/1", compact(Vector(
      BoardStopInfo("place-alfcl", "Alewife", 42.39, -71.14, 1, 0),
    )), "")
    store.put("internal/reference/stops/Red/0", compact(Vector.empty[BoardStopInfo]), "")

    val mbta = new RateLimitedMbtaClient(HttpClient.newHttpClient(), control, () => "", () => now)
    val services = new SnapshotServices(testConfig, store, control, mbta, () => now)
    assert(services.activate("Unknown").isLeft)
    assert(services.activate("Red").exists(_.wasInactive))
    assert(store.get("api/route/Red/vehicles").exists(_.body == "[]"))
    assert(store.get("api/route/Red/board").exists(_.body.contains("generatedAt")))

    val live = compact(Vector(VehicleData("Red", vehicleId = Some("1877"), timeStamp = now.toEpochMilli)))
    store.put("api/route/Red/vehicles", live, "")
    assert(services.activate("Red").exists(result => !result.wasInactive))
    assert(store.get("api/route/Red/vehicles").exists(_.body == live))
  }

  test("a newly active route is initialized from a fresh internal vehicle aggregate") {
    val store = new MemorySnapshotStore(now)
    val control = new TestControlStore
    store.put("api/routes", compact(Vector(RouteInfo("Red", "Red Line", "", "DA291C", "FFFFFF", 1))), "")
    val vehicle = VehicleData("Red", vehicleId = Some("1877"), timeStamp = now.toEpochMilli)
    store.put("internal/vehicles/latest", JsObject("Red" -> Vector(vehicle).toJson).compactPrint, "")

    val mbta = new RateLimitedMbtaClient(HttpClient.newHttpClient(), control, () => "", () => now)
    val services = new SnapshotServices(testConfig, store, control, mbta, () => now)

    assert(services.activate("Red").exists(_.wasInactive))
    assert(store.get("api/route/Red/vehicles").exists(_.body == compact(Vector(vehicle))))
  }

  test("activation publishes stop-scoped alerts for the selected route") {
    val store = new MemorySnapshotStore(now)
    val control = new TestControlStore
    val routeId = "CR-Fitchburg"
    store.put("api/routes", compact(Vector(RouteInfo(routeId, "Fitchburg Line", "", "80276C", "FFFFFF", 2))), "")
    store.put(s"api/route/$routeId/stops", compact(Vector(
      StopInfo("place-FR-0301", "Littleton/Route 495", 42.519236, -71.502643),
    )), "")
    store.put("api/alerts", compact(Vector(
      AlertInfo("1000003", "Littleton station access", "STATION_ISSUE", 1, "ONGOING", "",
        stopIds = Vector("place-FR-0301")),
    )), "")

    val mbta = new RateLimitedMbtaClient(HttpClient.newHttpClient(), control, () => "", () => now)
    val services = new SnapshotServices(testConfig, store, control, mbta, () => now)

    assert(services.activate(routeId).isRight)
    val alerts = store.get(s"api/route/$routeId/alerts").get.body.parseJson.convertTo[Vector[AlertInfo]]
    assert(alerts.map(_.id) == Vector("1000003"))
  }

  private val testConfig = SnapshotConfig(
    snapshotBucket = "test",
    controlTable = "test",
    apiSecretArn = "test",
    activeTtl = 150.seconds,
    providerLimit = 1000,
    safeLimit = 800,
    burstCapacity = 20,
    predictionBatchSize = 10,
  )
}

final class MemorySnapshotStore(defaultModified: Instant) extends SnapshotStore {
  private val values = mutable.Map.empty[String, StoredObject]
  override def get(key: String): Option[StoredObject] = values.get(key)
  override def put(key: String, body: String, cacheControl: String): Unit =
    values.update(key, StoredObject(body, defaultModified))
}

final class TestControlStore extends ControlStore {
  private val active = mutable.Map.empty[String, Long]
  override def activeRoutes(now: Instant): Vector[String] = active.collect {
    case (route, until) if until > now.getEpochSecond => route
  }.toVector
  override def activate(routeId: String, now: Instant, ttlSeconds: Long): ActivationResult = {
    val wasInactive = active.get(routeId).forall(_ <= now.getEpochSecond)
    val until = now.plusSeconds(ttlSeconds)
    active.update(routeId, until.getEpochSecond)
    ActivationResult(wasInactive, until)
  }
  override def acquirePermit(now: Instant): Boolean = true
  override def observeRate(limit: Option[Int], remaining: Option[Int], resetEpoch: Option[Long], throttled: Boolean): Unit = ()
  override def tryJobLock(job: String, slot: Long, now: Instant, ttlSeconds: Long): Boolean = true
  override def releaseJobLock(job: String, slot: Long): Unit = ()
  override def recordSuccess(dataset: String, at: Instant): Unit = ()
  override def status(now: Instant, activeRouteCount: Int): SnapshotStatus =
    SnapshotStatus(generatedAt = now.toString, activeRouteCount = activeRouteCount)
}
