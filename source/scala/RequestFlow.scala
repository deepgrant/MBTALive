package mbta.actor

import org.apache.pekko

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

  // ── Stream Flows ──────────────────────────────────────────────────────────

  private def vehiclesPerRouteRawFlow: Flow[VehicleMsg, VehicleMsg, NotUsed] =
    Flow[VehicleMsg].mapAsync(parallelism = 12) {
      case vr @ VehicleRoute(route, _, _) =>
        access.queueRequest(
          HttpRequest(uri = access.mbtaUri(
            path  = "/vehicles",
            query = access.mbtaQuery(Map("include" -> "stop,trip", "filter[route]" -> route))
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
            direction           = directionId.flatMap(id => Try(route.directionNames(id))).toOption,
            destination         = directionId.flatMap(id => Try(route.destinationNames(id))).toOption,
          )
        }

      case unexpected =>
        log.error("vehiclesPerRouteFlow unexpected input: {}", unexpected)
        Vector.empty
    }

  // ── Stop Enrichment (batched by unique stopId) ────────────────────────────

  private case class StopDetails(name: Option[String], platformName: Option[String], zone: Option[String])

  private def fetchStopById(stopId: String): Future[StopDetails] =
    access.queueRequest(
      HttpRequest(uri = access.mbtaUri(
        path  = s"/stops/$stopId",
        query = access.mbtaQuery()
      ))
    ).flatMap {
      case HttpResponse(StatusCodes.OK, _, entity, _) =>
        access.parseMbtaResponse(entity).map { r =>
          StopDetails(
            name         = Try(r.getString("data.attributes.name")).toOption,
            platformName = Try(r.getString("data.attributes.platform_name")).toOption,
            zone         = Try(r.getString("data.relationships.zone.data.id")).toOption,
          )
        }
      case HttpResponse(code, _, entity, _) =>
        log.error("fetchStopById({}) unexpected status: {}", stopId, code)
        entity.discardBytes()
        Future.successful(StopDetails(None, None, None))
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

  // ── Prediction + Schedule Enrichment (single API call per vehicle) ────────

  private def fetchPredictionAndSchedule(vehicle: VehicleData): Future[VehicleData] =
    (vehicle.tripId, vehicle.stopId) match {
      case (Some(tripId), Some(stopId)) =>
        access.queueRequest(
          HttpRequest(uri = access.mbtaUri(
            path  = "/predictions",
            query = access.mbtaQuery(Map(
              "filter[trip]" -> tripId,
              "filter[stop]" -> stopId,
              "include"      -> "schedule",
            ))
          ))
        ).flatMap {
          case HttpResponse(StatusCodes.OK, _, entity, _) =>
            access.parseMbtaResponse(entity).map { resp =>
              val predictions = Try(resp.getObjectList("data").asScala.toVector.map(_.toConfig)).getOrElse(Vector.empty)
              val schedules   = Try(resp.getObjectList("included").asScala.toVector.map(_.toConfig)).getOrElse(Vector.empty)
                .filter(r => Try(r.getString("type")).getOrElse("") == "schedule")

              predictions.headOption match {
                case None => vehicle
                case Some(pred) =>
                  val predictedArrival = Try(pred.getString("attributes.arrival_time")).toOption

                  val scheduledArrival = Try(pred.getString("relationships.schedule.data.id")).toOption
                    .flatMap { sid =>
                      schedules
                        .find(s => Try(s.getString("id")).toOption.contains(sid))
                        .flatMap(s => Try(s.getString("attributes.arrival_time")).toOption)
                    }

                  val delay = (predictedArrival, scheduledArrival) match {
                    case (Some(predTime), Some(schedTime)) =>
                      Try(
                        java.time.Duration.between(
                          java.time.Instant.parse(schedTime),
                          java.time.Instant.parse(predTime)
                        ).getSeconds.toInt
                      ).toOption
                    case _ => None
                  }

                  vehicle.copy(
                    predictedArrivalTime = predictedArrival,
                    scheduledArrivalTime = scheduledArrival,
                    delaySeconds         = delay,
                  )
              }
            }
          case HttpResponse(code, _, entity, _) =>
            log.error("fetchPredictionAndSchedule({}) unexpected status: {}", vehicle.vehicleId.getOrElse("?"), code)
            entity.discardBytes()
            Future.successful(vehicle)
        }

      case _ => Future.successful(vehicle)
    }

  private def enrichWithPredictions(vehicles: Vector[VehicleData]): Future[Vector[VehicleData]] =
    Source(vehicles)
      .mapAsync(parallelism = 8)(fetchPredictionAndSchedule)
      .runWith(Sink.seq)
      .map(_.toVector)

  // ── Sorting ───────────────────────────────────────────────────────────────

  private def sortVehicles(vehicles: Vector[VehicleData], sortBy: String, sortOrder: String): Vector[VehicleData] = {
    val sorted = sortBy.toLowerCase match {
      case "tripid" => vehicles.sortBy(v => v.tripId.getOrElse(v.vehicleId.getOrElse("")))
      case _        => vehicles.sortBy(_.vehicleId.getOrElse(""))
    }
    if (sortOrder.toLowerCase == "asc") sorted else sorted.reverse
  }

  // ── Public API ────────────────────────────────────────────────────────────

  def fetchVehiclesForRoute(routeId: String, sortBy: String = "vehicleId", sortOrder: String = "asc"): Future[Vector[VehicleData]] =
    access.queueRequest(
      HttpRequest(uri = access.mbtaUri(
        path  = s"/routes/$routeId",
        query = access.mbtaQuery()
      ))
    ).flatMap {
      case HttpResponse(StatusCodes.OK, _, entity, _) =>
        access.parseMbtaResponse(entity).flatMap { response =>
          val route            = response.getConfig("data")
          val directionNames   = Try(route.getStringList("attributes.direction_names").asScala.toVector).getOrElse(Vector.empty)
          val destinationNames = Try(route.getStringList("attributes.direction_destinations").asScala.toVector).getOrElse(Vector.empty)

          Source.single[VehicleMsg](VehicleRoute(routeId, directionNames, destinationNames))
            .via(vehiclesPerRouteRawFlow)
            .via(vehiclesPerRouteFlow)
            .collect { case v: VehicleData => v }
            .runWith(Sink.seq)
            .map(_.toVector)
            .flatMap(enrichWithStops)
            .flatMap(enrichWithPredictions)
            .map(sortVehicles(_, sortBy, sortOrder))
        }
      case HttpResponse(code, _, entity, _) =>
        log.error("fetchVehiclesForRoute({}) route lookup unexpected status: {}", routeId, code)
        entity.discardBytes()
        Future.successful(Vector.empty)
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
            ShapeInfo(id = s.getString("id"), polyline = s.getString("attributes.polyline"))
          }
        }
      case HttpResponse(code, _, entity, _) =>
        log.error("fetchShapes({}) unexpected status: {}", routeId, code)
        entity.discardBytes()
        Future.successful(Vector.empty)
    }
}
