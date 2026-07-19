package mbta.snapshot

import spray.json._

import java.time.Duration
import java.time.Instant
import scala.util.Try

object SnapshotTransforms {
  private def obj(value: JsValue): JsObject = value.asJsObject
  private def field(value: JsValue, path: String*): Option[JsValue] =
    path.foldLeft(Option(value))((current, key) => current.flatMap(v => Try(obj(v).fields(key)).toOption))
  private def string(value: JsValue, path: String*): Option[String] = field(value, path: _*).collect {
    case JsString(v) => v
  }
  private def number(value: JsValue, path: String*): Option[BigDecimal] = field(value, path: _*).collect {
    case JsNumber(v) => v
  }
  private def int(value: JsValue, path: String*): Option[Int] = number(value, path: _*).map(_.toInt)
  private def double(value: JsValue, path: String*): Option[Double] = number(value, path: _*).map(_.toDouble)
  private def values(value: JsValue, path: String*): Vector[JsValue] = field(value, path: _*).collect {
    case JsArray(vs) => vs
  }.getOrElse(Vector.empty)
  private def strings(value: JsValue, path: String*): Vector[String] = values(value, path: _*).collect {
    case JsString(v) => v
  }

  private def resources(root: JsValue, name: String): Vector[JsValue] = values(root, name)
  private def resourceMap(root: JsValue, resourceType: String): Map[String, JsValue] =
    resources(root, "included")
      .filter(string(_, "type").contains(resourceType))
      .flatMap(v => string(v, "id").map(_ -> v))
      .toMap

  def routes(root: JsValue): Vector[RouteInfo] = resources(root, "data").flatMap { route =>
    string(route, "id").map(id => RouteInfo(
      id         = id,
      long_name  = string(route, "attributes", "long_name").getOrElse(""),
      short_name = string(route, "attributes", "short_name").getOrElse(""),
      color      = string(route, "attributes", "color").getOrElse(""),
      text_color = string(route, "attributes", "text_color").getOrElse(""),
      route_type = int(route, "attributes", "type").getOrElse(3),
    ))
  }.sortBy(_.id)

  def vehicles(root: JsValue, generatedAt: Instant): Vector[VehicleData] = {
    val stops  = resourceMap(root, "stop")
    val trips  = resourceMap(root, "trip")
    val routes = resourceMap(root, "route")

    resources(root, "data").flatMap { vehicle =>
      string(vehicle, "relationships", "route", "data", "id").map { routeId =>
        val stopId      = string(vehicle, "relationships", "stop", "data", "id")
        val tripId      = string(vehicle, "relationships", "trip", "data", "id")
        val directionId = int(vehicle, "attributes", "direction_id")
        val route       = routes.get(routeId)
        val stop        = stopId.flatMap(stops.get)
        val trip        = tripId.flatMap(trips.get)
        val directions  = route.toVector.flatMap(strings(_, "attributes", "direction_names"))
        val destinations = route.toVector.flatMap(strings(_, "attributes", "direction_destinations"))
        val latitude    = double(vehicle, "attributes", "latitude")
        val longitude   = double(vehicle, "attributes", "longitude")
        val bearing     = int(vehicle, "attributes", "bearing")
        val speed       = double(vehicle, "attributes", "speed")
        val stopName    = stop.flatMap(string(_, "attributes", "name"))
        val status      = string(vehicle, "attributes", "current_status")

        VehicleData(
          routeId         = routeId,
          vehicleId       = string(vehicle, "attributes", "label").orElse(string(vehicle, "id")),
          stopId          = stopId,
          tripId          = tripId,
          tripName        = trip.flatMap(string(_, "attributes", "name")),
          bearing         = bearing,
          directionId     = directionId,
          currentStatus   = status,
          latitude        = latitude,
          longitude       = longitude,
          speed           = speed,
          updatedAt       = string(vehicle, "attributes", "updated_at"),
          stopName        = stopName,
          platformName    = stop.flatMap(string(_, "attributes", "platform_name")),
          timeStamp       = generatedAt.toEpochMilli,
          direction       = directionId.flatMap(directions.lift),
          destination     = directionId.flatMap(destinations.lift),
          formattedStatus = Some(formattedStatus(status, stopName)),
          positionValid   = latitude.isDefined && longitude.isDefined,
          bearingReported = bearing.isDefined,
          speedReported   = speed.isDefined,
        )
      }
    }.sortBy(_.vehicleId.getOrElse(""))
  }

  def predictions(root: JsValue, generatedAt: Instant): Map[String, RoutePredictionSnapshot] = {
    val schedules = resourceMap(root, "schedule")
    val stops     = resourceMap(root, "stop")
    val entries = resources(root, "data").flatMap { prediction =>
      for {
        routeId <- string(prediction, "relationships", "route", "data", "id")
        tripId  <- string(prediction, "relationships", "trip", "data", "id")
        stopId  <- string(prediction, "relationships", "stop", "data", "id")
      } yield {
        val schedule = string(prediction, "relationships", "schedule", "data", "id").flatMap(schedules.get)
        val parent = stops.get(stopId).flatMap(string(_, "relationships", "parent_station", "data", "id"))
        routeId -> (tripId -> PredictionEntry(
          stopId        = stopId,
          parentStopId  = parent,
          predictedTime = string(prediction, "attributes", "arrival_time")
            .orElse(string(prediction, "attributes", "departure_time")),
          scheduledTime = schedule.flatMap(string(_, "attributes", "arrival_time"))
            .orElse(schedule.flatMap(string(_, "attributes", "departure_time"))),
          sequence      = int(prediction, "attributes", "stop_sequence"),
        ))
      }
    }

    entries.groupMap(_._1)(_._2).map { case (routeId, routeEntries) =>
      val trips = routeEntries.groupMap(_._1)(_._2).toVector
        .sortBy(_._1)
        .map { case (tripId, ps) => TripPrediction(tripId, ps.sortBy(_.sequence.getOrElse(Int.MaxValue))) }
      routeId -> RoutePredictionSnapshot(routeId, generatedAt.toString, trips)
    }
  }

  def enrichVehicles(
    vehicles: Vector[VehicleData],
    predictions: Option[RoutePredictionSnapshot],
  ): Vector[VehicleData] = {
    val byTrip = predictions.toVector.flatMap(_.trips).map(p => p.tripId -> p.entries).toMap
    vehicles.map { vehicle =>
      val matchAtStop = for {
        tripId <- vehicle.tripId
        stopId <- vehicle.stopId
        entries <- byTrip.get(tripId)
        entry <- entries.find(p => p.stopId == stopId || p.parentStopId.contains(stopId))
      } yield entry
      val delay = matchAtStop.flatMap(p => delaySeconds(p.predictedTime, p.scheduledTime))
      vehicle.copy(
        predictedArrivalTime = matchAtStop.flatMap(_.predictedTime),
        scheduledArrivalTime = matchAtStop.flatMap(_.scheduledTime),
        delaySeconds         = delay,
        delayStatus          = Some(delayStatus(delay)),
      )
    }
  }

  def orderedStops(root: JsValue, directionId: Int): Vector[BoardStopInfo] =
    resources(root, "data").zipWithIndex.flatMap { case (stop, index) =>
      string(stop, "id").map(id => BoardStopInfo(
        id          = id,
        name        = string(stop, "attributes", "name").getOrElse(id),
        latitude    = double(stop, "attributes", "latitude").getOrElse(0d),
        longitude   = double(stop, "attributes", "longitude").getOrElse(0d),
        directionId = directionId,
        sequence    = index,
      ))
    }

  def publicStops(root: JsValue): Vector[StopInfo] = resources(root, "data").flatMap { stop =>
    string(stop, "id").map(id => StopInfo(
      id        = id,
      name      = string(stop, "attributes", "name").getOrElse(id),
      latitude  = double(stop, "attributes", "latitude").getOrElse(0d),
      longitude = double(stop, "attributes", "longitude").getOrElse(0d),
    ))
  }.distinctBy(_.id)

  def shapes(shapeRoot: JsValue, patternsRoot: JsValue): Vector[ShapeInfo] = {
    val includedTrips = resourceMap(patternsRoot, "trip")
    val typicalityByShape = resources(patternsRoot, "data").flatMap { pattern =>
      for {
        typicality <- int(pattern, "attributes", "typicality")
        tripId <- string(pattern, "relationships", "representative_trip", "data", "id")
        trip <- includedTrips.get(tripId)
        shapeId <- string(trip, "relationships", "shape", "data", "id")
      } yield shapeId -> typicality
    }.groupMap(_._1)(_._2).view.mapValues(_.min).toMap

    resources(shapeRoot, "data").flatMap { shape =>
      string(shape, "id").map { id =>
        ShapeInfo(
          id          = id,
          polyline    = string(shape, "attributes", "polyline").getOrElse(""),
          priority    = int(shape, "attributes", "priority").getOrElse(0),
          directionId = int(shape, "attributes", "direction_id").getOrElse(0),
          typicality  = typicalityByShape.getOrElse(id, 1),
        )
      }
    }.filter(s => typicalityByShape.get(s.id).forall(_ <= 3))
  }

  def alerts(root: JsValue): Vector[AlertInfo] = resources(root, "data").flatMap { alert =>
    string(alert, "id").map { id =>
      val routeIds = values(alert, "relationships", "routes", "data").flatMap(string(_, "id")).distinct
      val stopIds = values(alert, "attributes", "informed_entity")
        .flatMap(string(_, "stop")).filter(_.nonEmpty).distinct
      AlertInfo(
        id          = id,
        header      = string(alert, "attributes", "header").getOrElse(""),
        effect      = string(alert, "attributes", "effect").getOrElse("UNKNOWN"),
        severity    = int(alert, "attributes", "severity").getOrElse(1),
        lifecycle   = string(alert, "attributes", "lifecycle").getOrElse("ONGOING"),
        updatedAt   = string(alert, "attributes", "updated_at").getOrElse(""),
        description = string(alert, "attributes", "description"),
        cause       = string(alert, "attributes", "cause"),
        routeIds    = routeIds,
        stopIds     = stopIds,
      )
    }
  }

  def alertsForRoute(alerts: Vector[AlertInfo], routeId: String, routeStopIds: Set[String]): Vector[AlertInfo] =
    alerts.filter { alert =>
      val parentStops = alert.stopIds.filter(_.startsWith("place-"))
      val scopedStops = if (parentStops.nonEmpty) parentStops else alert.stopIds
      alert.routeIds.contains(routeId) ||
        (scopedStops.nonEmpty && scopedStops.forall(routeStopIds.contains))
    }

  def board(
    routeId: String,
    vehicles: Vector[VehicleData],
    inbound: Vector[BoardStopInfo],
    outbound: Vector[BoardStopInfo],
    predictionSnapshot: RoutePredictionSnapshot,
  ): RouteBoardData = {
    val byTrip = predictionSnapshot.trips.map(p => p.tripId -> p.entries).toMap
    val trains = vehicles.flatMap { vehicle =>
      vehicle.tripId.map { tripId =>
        val stops = if (vehicle.directionId.contains(1)) inbound else outbound
        val stopSequence = stops.map(s => s.id -> s.sequence).toMap
        val stopNames = stops.map(s => s.id -> s.name).toMap
        val predictions = byTrip.getOrElse(tripId, Vector.empty).flatMap { entry =>
          val publicStopId = entry.parentStopId.getOrElse(entry.stopId)
          stopSequence.get(publicStopId).map(sequence => StopPrediction(
            stopId        = publicStopId,
            stopName      = stopNames.getOrElse(publicStopId, publicStopId),
            sequence      = sequence,
            predictedTime = entry.predictedTime,
            scheduledTime = entry.scheduledTime,
            status        = "upcoming",
          ))
        }.sortBy(_.sequence)
        val resolved = vehicle.stopId.flatMap { vehicleStop =>
          val parent = byTrip.getOrElse(tripId, Vector.empty)
            .find(_.stopId == vehicleStop).flatMap(_.parentStopId).getOrElse(vehicleStop)
          stopSequence.get(parent).map(parent -> _)
        }
        val (currentStop, currentSequence) = resolved match {
          case Some((id, sequence)) => Some(id) -> sequence
          case None if predictions.nonEmpty =>
            val sequence = predictions.map(_.sequence).min
            stops.find(_.sequence == sequence).map(_.id) -> sequence
          case _ => None -> Int.MaxValue
        }
        val delay = predictions.headOption.flatMap(p => delaySeconds(p.predictedTime, p.scheduledTime))
        TrainBoardData(
          vehicleId           = vehicle.vehicleId.getOrElse(""),
          tripId              = vehicle.tripId,
          tripName            = vehicle.tripName,
          directionId         = vehicle.directionId,
          direction           = vehicle.direction,
          destination         = vehicle.destination,
          currentStopId       = currentStop,
          currentStopSequence = currentSequence,
          delaySeconds        = delay,
          delayStatus         = Some(delayStatus(delay)),
          predictions         = predictions,
        )
      }
    }
    RouteBoardData(routeId, inbound, outbound, trains, Some(predictionSnapshot.generatedAt))
  }

  private def delaySeconds(predicted: Option[String], scheduled: Option[String]): Option[Int] =
    for {
      p <- predicted.flatMap(v => Try(Instant.parse(v)).toOption)
      s <- scheduled.flatMap(v => Try(Instant.parse(v)).toOption)
    } yield Duration.between(s, p).getSeconds.toInt

  private def delayStatus(delay: Option[Int]): String = delay match {
    case Some(seconds) if seconds < 0    => "ahead"
    case Some(seconds) if seconds < 300  => "on-time"
    case Some(seconds) if seconds < 900  => "minor-delay"
    case Some(_)                         => "major-delay"
    case None                            => "on-time"
  }

  private def formattedStatus(status: Option[String], stopName: Option[String]): String = status match {
    case Some("STOPPED_AT")  => s"Stopped at ${stopName.getOrElse("station")}" 
    case Some("IN_TRANSIT_TO") => s"In transit to ${stopName.getOrElse("next stop")}" 
    case Some("INCOMING_AT") => s"Arriving at ${stopName.getOrElse("station")}" 
    case Some(value)          => value.toLowerCase.replace('_', ' ').capitalize
    case None                 => "Unknown"
  }
}
