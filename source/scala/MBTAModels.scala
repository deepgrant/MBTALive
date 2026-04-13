package mbta.actor

// ── Stream message hierarchy ──────────────────────────────────────────────────

sealed trait VehicleMsg

case class VehicleRoute(route: String) extends VehicleMsg

case class VehiclesPerRouteRaw(
  route       : VehicleRoute,
  rawVehicles : Vector[com.typesafe.config.Config],
  rawIncluded : Vector[com.typesafe.config.Config] = Vector.empty,
) extends VehicleMsg

case class VehicleData(
  routeId              : String,
  vehicleId            : Option[String] = None,
  stopId               : Option[String] = None,
  tripId               : Option[String] = None,
  tripName             : Option[String] = None,
  bearing              : Option[Int]    = None,
  directionId          : Option[Int]    = None,
  currentStatus        : Option[String] = None,
  currentStopSequence  : Option[Int]    = None,
  latitude             : Option[Double] = None,
  longitude            : Option[Double] = None,
  speed                : Option[Double] = None,
  updatedAt            : Option[String] = None,
  stopName             : Option[String] = None,
  stopPlatformName     : Option[String] = None,
  stopZone             : Option[String] = None,
  timeStamp            : Long           = java.time.Instant.now().toEpochMilli(),
  direction            : Option[String] = None,
  destination          : Option[String] = None,
  predictedArrivalTime : Option[String] = None,
  scheduledArrivalTime : Option[String] = None,
  delaySeconds         : Option[Int]    = None,
) extends VehicleMsg

// ── API response models ───────────────────────────────────────────────────────

case class RouteInfo(id: String, long_name: String, short_name: String, color: String, text_color: String, route_type: Int)
case class StopInfo(id: String, name: String, latitude: Double, longitude: Double)
case class ShapeInfo(id: String, polyline: String)
