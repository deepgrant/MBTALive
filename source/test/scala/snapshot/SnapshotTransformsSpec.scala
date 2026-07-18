package mbta.snapshot

import org.scalatest.funsuite.AnyFunSuite
import spray.json._

import java.time.Instant

final class SnapshotTransformsSpec extends AnyFunSuite {
  private val now = Instant.parse("2026-07-15T18:40:00Z")

  test("vehicles are enriched from included route, trip, and stop resources") {
    val root =
      """
        |{
        |  "data": [{
        |    "id": "v1", "type": "vehicle",
        |    "attributes": {"label":"1877","latitude":42.3,"longitude":-71.1,"bearing":90,"speed":12.5,"updated_at":"2026-07-15T18:39:59Z","direction_id":1,"current_status":"STOPPED_AT"},
        |    "relationships": {"route":{"data":{"id":"Red"}},"trip":{"data":{"id":"t1"}},"stop":{"data":{"id":"s1"}}}
        |  }],
        |  "included": [
        |    {"id":"Red","type":"route","attributes":{"direction_names":["Southbound","Northbound"],"direction_destinations":["Ashmont","Alewife"]}},
        |    {"id":"t1","type":"trip","attributes":{"name":"123"}},
        |    {"id":"s1","type":"stop","attributes":{"name":"Central","platform_name":"Alewife platform"}}
        |  ]
        |}
        |""".stripMargin.parseJson

    val vehicle = SnapshotTransforms.vehicles(root, now).head
    assert(vehicle.routeId == "Red")
    assert(vehicle.vehicleId.contains("1877"))
    assert(vehicle.tripName.contains("123"))
    assert(vehicle.stopName.contains("Central"))
    assert(vehicle.direction.contains("Northbound"))
    assert(vehicle.destination.contains("Alewife"))
    assert(vehicle.timeStamp == now.toEpochMilli)
    assert(vehicle.positionValid)
  }

  test("predictions map child stops to parent board stops and preserve schedules") {
    val root =
      """
        |{
        |  "data": [{
        |    "id":"p1","type":"prediction",
        |    "attributes":{"arrival_time":"2026-07-15T18:45:00Z","stop_sequence":4},
        |    "relationships":{"route":{"data":{"id":"Red"}},"trip":{"data":{"id":"t1"}},"stop":{"data":{"id":"child"}},"schedule":{"data":{"id":"sch1"}}}
        |  }],
        |  "included": [
        |    {"id":"child","type":"stop","relationships":{"parent_station":{"data":{"id":"place-central"}}}},
        |    {"id":"sch1","type":"schedule","attributes":{"arrival_time":"2026-07-15T18:43:00Z"}}
        |  ]
        |}
        |""".stripMargin.parseJson

    val predictions = SnapshotTransforms.predictions(root, now)("Red")
    val entry = predictions.trips.head.entries.head
    assert(entry.parentStopId.contains("place-central"))
    assert(entry.scheduledTime.contains("2026-07-15T18:43:00Z"))

    val vehicleRoot =
      """{"data":[{"id":"v1","attributes":{"label":"1877","direction_id":1},"relationships":{"route":{"data":{"id":"Red"}},"trip":{"data":{"id":"t1"}},"stop":{"data":{"id":"child"}}}}],"included":[]}""".parseJson
    val vehicle = SnapshotTransforms.vehicles(vehicleRoot, now).head
    val stops = Vector(BoardStopInfo("place-central", "Central", 42.3, -71.1, 1, 4))
    val board = SnapshotTransforms.board("Red", Vector(vehicle), stops, Vector.empty, predictions)
    assert(board.trains.head.currentStopId.contains("place-central"))
    assert(board.trains.head.predictions.head.stopName == "Central")
    assert(board.trains.head.delaySeconds.contains(120))
    assert(board.generatedAt.contains(now.toString))
  }
}
