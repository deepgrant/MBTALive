package mbta.snapshot

import spray.json._

final case class PredictionEntry(
  stopId: String,
  parentStopId: Option[String],
  predictedTime: Option[String],
  scheduledTime: Option[String],
  sequence: Option[Int],
)

final case class TripPrediction(tripId: String, entries: Vector[PredictionEntry])
final case class RoutePredictionSnapshot(routeId: String, generatedAt: String, trips: Vector[TripPrediction])

final case class SnapshotStatus(
  status: String = "warming",
  generatedAt: String,
  vehiclesLastSuccess: Option[String] = None,
  boardsLastSuccess: Option[String] = None,
  alertsLastSuccess: Option[String] = None,
  referencesLastSuccess: Option[String] = None,
  activeRouteCount: Int = 0,
)

object SnapshotJson extends DefaultJsonProtocol {
  implicit val routeInfoFormat: RootJsonFormat[RouteInfo] = jsonFormat6(RouteInfo.apply)
  implicit val stopInfoFormat: RootJsonFormat[StopInfo] = jsonFormat4(StopInfo.apply)
  implicit val shapeInfoFormat: RootJsonFormat[ShapeInfo] = jsonFormat5(ShapeInfo.apply)
  implicit val alertInfoFormat: RootJsonFormat[AlertInfo] = jsonFormat10(AlertInfo.apply)
  implicit val boardStopInfoFormat: RootJsonFormat[BoardStopInfo] = jsonFormat6(BoardStopInfo.apply)
  implicit val stopPredictionFormat: RootJsonFormat[StopPrediction] = jsonFormat6(StopPrediction.apply)
  implicit val trainBoardDataFormat: RootJsonFormat[TrainBoardData] = jsonFormat11(TrainBoardData.apply)
  implicit val routeBoardDataFormat: RootJsonFormat[RouteBoardData] = jsonFormat5(RouteBoardData.apply)
  implicit val predictionEntryFormat: RootJsonFormat[PredictionEntry] = jsonFormat5(PredictionEntry.apply)
  implicit val tripPredictionFormat: RootJsonFormat[TripPrediction] = jsonFormat2(TripPrediction.apply)
  implicit val routePredictionSnapshotFormat: RootJsonFormat[RoutePredictionSnapshot] =
    jsonFormat3(RoutePredictionSnapshot.apply)
  implicit val snapshotStatusFormat: RootJsonFormat[SnapshotStatus] = jsonFormat7(SnapshotStatus.apply)

  implicit val vehicleDataFormat: RootJsonFormat[VehicleData] = new RootJsonFormat[VehicleData] {
    override def write(v: VehicleData): JsValue = JsObject(
      "routeId"              -> v.routeId.toJson,
      "vehicleId"            -> v.vehicleId.toJson,
      "stopId"               -> v.stopId.toJson,
      "tripId"               -> v.tripId.toJson,
      "tripName"             -> v.tripName.toJson,
      "bearing"              -> v.bearing.toJson,
      "directionId"          -> v.directionId.toJson,
      "currentStatus"        -> v.currentStatus.toJson,
      "latitude"             -> v.latitude.toJson,
      "longitude"            -> v.longitude.toJson,
      "speed"                -> v.speed.toJson,
      "updatedAt"            -> v.updatedAt.toJson,
      "stopName"             -> v.stopName.toJson,
      "platformName"         -> v.platformName.toJson,
      "timeStamp"            -> v.timeStamp.toJson,
      "direction"            -> v.direction.toJson,
      "destination"          -> v.destination.toJson,
      "predictedArrivalTime" -> v.predictedArrivalTime.toJson,
      "scheduledArrivalTime" -> v.scheduledArrivalTime.toJson,
      "delaySeconds"         -> v.delaySeconds.toJson,
      "formattedStatus"      -> v.formattedStatus.toJson,
      "delayStatus"          -> v.delayStatus.toJson,
      "positionValid"        -> v.positionValid.toJson,
      "bearingReported"      -> v.bearingReported.toJson,
      "speedReported"        -> v.speedReported.toJson,
    )

    override def read(json: JsValue): VehicleData = {
      val f = json.asJsObject.fields
      def optString(name: String): Option[String] = f.get(name).flatMap {
        case JsString(v) => Some(v)
        case _           => None
      }
      def optInt(name: String): Option[Int] = f.get(name).flatMap {
        case JsNumber(v) => Some(v.toInt)
        case _           => None
      }
      def optDouble(name: String): Option[Double] = f.get(name).flatMap {
        case JsNumber(v) => Some(v.toDouble)
        case _           => None
      }
      def bool(name: String): Boolean = f.get(name).contains(JsBoolean(true))
      VehicleData(
        routeId              = optString("routeId").getOrElse(deserializationError("routeId required")),
        vehicleId            = optString("vehicleId"),
        stopId               = optString("stopId"),
        tripId               = optString("tripId"),
        tripName             = optString("tripName"),
        bearing              = optInt("bearing"),
        directionId          = optInt("directionId"),
        currentStatus        = optString("currentStatus"),
        latitude             = optDouble("latitude"),
        longitude            = optDouble("longitude"),
        speed                = optDouble("speed"),
        updatedAt            = optString("updatedAt"),
        stopName             = optString("stopName"),
        platformName         = optString("platformName"),
        timeStamp            = f.get("timeStamp").collect { case JsNumber(v) => v.toLong }.getOrElse(0L),
        direction            = optString("direction"),
        destination          = optString("destination"),
        predictedArrivalTime = optString("predictedArrivalTime"),
        scheduledArrivalTime = optString("scheduledArrivalTime"),
        delaySeconds         = optInt("delaySeconds"),
        formattedStatus      = optString("formattedStatus"),
        delayStatus          = optString("delayStatus"),
        positionValid        = bool("positionValid"),
        bearingReported      = bool("bearingReported"),
        speedReported        = bool("speedReported"),
      )
    }
  }

  def compact[A: JsonWriter](value: A): String = value.toJson.compactPrint
}
