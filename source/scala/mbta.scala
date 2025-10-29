package mbta.actor

import com.typesafe.config.Config
import com.typesafe.config.ConfigFactory
import org.apache.pekko
import spray.json._
import pekko.http.scaladsl.marshalling.Marshaller
import pekko.http.scaladsl.unmarshalling.Unmarshaller

import scala.concurrent.Future
import scala.concurrent.Promise
import scala.concurrent.duration._
import scala.jdk.CollectionConverters._
import scala.util.Failure
import scala.util.Success
import scala.util.Try

import pekko.actor._
import pekko.Done
import pekko.http.scaladsl.Http
import pekko.http.scaladsl.model.{
  HttpRequest,
  HttpResponse,
  HttpEntity,
  StatusCodes,
  ContentTypes
}
import pekko.http.scaladsl.model.Uri
import pekko.http.scaladsl.server.Directives._
import pekko.http.scaladsl.server.Route
import pekko.http.scaladsl.model.headers._
import pekko.http.scaladsl.model.HttpMethods
import pekko.NotUsed
import pekko.util.{
  ByteString,
  Timeout
}
import pekko.stream.OverflowStrategy
import pekko.stream.scaladsl.{
  Flow,
  Sink,
  Source,
  SourceQueueWithComplete
}
import pekko.http.scaladsl.settings.ConnectionPoolSettings

object MBTAMain extends App {

  implicit val timeout : pekko.util.Timeout                                 = 10.seconds
  implicit val system  : pekko.actor.ActorSystem                            = ActorSystem()
  implicit val executionContext : scala.concurrent.ExecutionContextExecutor = system.dispatcher
  implicit val scheduler : pekko.actor.Scheduler                            = system.scheduler

  val mbtaService: ActorRef = system.actorOf(Props[MBTAService](), name="mbtaService")
}

class MBTAService extends Actor with ActorLogging {
  import context.dispatcher

  implicit val system  : pekko.actor.ActorSystem    = ActorSystem()
  implicit val logger  : pekko.event.LoggingAdapter = log
  implicit val timeout : Timeout                    = 30.seconds


  object Config {
    def ApiKey : Try[String] = {
      Try {
        sys.env("MBTA_API_KEY")
      }
    }

    def maxRequestsPerPeriod : Int = {
      ApiKey
        .map { _ => 1000 }
        .getOrElse { 
          log.warning("Config.maxRequestsPerPeriod -- MBTA_API_KEY not found in environment variables -- using default of 10")
          10 
        }
    }

    def maxRequestsWindow : FiniteDuration = 1.minute

    def updatePeriod : FiniteDuration = {
      ApiKey.map { _ => 15.seconds }.getOrElse(10.minutes)
    }
  }

  object MBTAaccess {
    def transportSettings: ConnectionPoolSettings = ConnectionPoolSettings(system)
      .withMaxConnections(4)
      .withMaxOpenRequests(256)
      .withPipeliningLimit(64)

    var queue : Option[SourceQueueWithComplete[(HttpRequest, Promise[HttpResponse])]] = None

    def runQ : Future[pekko.Done] = {
      val (queue, source) = Source
        .queue[(HttpRequest,Promise[HttpResponse])](bufferSize = 256, overflowStrategy = OverflowStrategy.backpressure)
        .preMaterialize()

      MBTAaccess.queue = Some(queue)

      source
        .throttle(Config.maxRequestsPerPeriod, Config.maxRequestsWindow)
        .via(
          Http().newHostConnectionPoolHttps[Promise[HttpResponse]](
            host     = "api-v3.mbta.com",
            port     = 443,
            settings = transportSettings,
            log      = log)
        )
        .map { case (res, p) =>
          p.completeWith {
            res.map { case res =>
              res.entity
                .withoutSizeLimit()
                .toStrict(60.seconds)
                .map(res.withEntity(_))
            }.recover { case t =>
              log.error(s"queue recover ${t}")
              Future.failed(t)
            }.getOrElse {
              Future.failed(new IllegalStateException)
            }
          }
        }
        .runWith(Sink.ignore)
        .andThen {
          case Success(_) =>
            log.error("MBTAaccess.runQ stopped with an unexpected but normal termination.")
          case Failure(t) =>
            log.error(t, "MBTAaccess.runQ stopped")
        }
        .transformWith {
          case _ =>
            log.warning("MBTAaccess.runQ restarting")
            runQ
        }
    }

    def mbtaQuery(query: Map[String, String] = Map.empty[String, String]) : Option[String] = {
      Config.ApiKey.map { api_key =>
        Uri.Query(query + ("api_key" -> api_key)).toString
      }.orElse {
        Try(Uri.Query(query).toString)
      }.toOption
    }

    def mbtaUri(path: String, query: Option[String] = None): Uri = Uri(
      scheme      = "https",
      path        = Uri.Path(path),
      queryString = query,
      fragment    = None
    )

    def queueRequest(request: HttpRequest) : Future[HttpResponse] = {
      val retVal : Promise[HttpResponse] = Promise()

      MBTAaccess.queue.map { queue =>
        log.info("MBTAaccess.queueRequest.request: {}", request.toString)

        queue.offer((request,retVal)).flatMap(_ => retVal.future).recover {
          case e: Exception => {
            log.error(e, s"MBTAaccess.queueRequest -> ${e}")
            HttpResponse(StatusCodes.InternalServerError)
          }
        }.andThen {
          case Success(response) => log.debug(s"[RESPONSE] MBTAaccess.queueRequest(${request}) -> ${response}")
          case Failure(t) => log.error(s"[RESPONSE] MBTAaccess.queueRequest(${request}) -> ${t}")
        }
      }.getOrElse {
        Future.failed(new Exception("MBTAaccess.queueRequest could not Queue up the request. No Queue found."))
      }
    }

    def parseMbtaResponseAsFlow(entity: HttpEntity) : Source[Config, NotUsed] = {
      entity
        .withoutSizeLimit
        .dataBytes
        .fold(ByteString.empty)(_ ++ _)
        .map { s => ConfigFactory.parseString(s.utf8String) }
        .mapMaterializedValue(_ => NotUsed)
    }

    def parseMbtaResponse(entity: HttpEntity) : Future[Config] = {
      parseMbtaResponseAsFlow(entity)
        .runWith(Sink.head)
        .recover {
          case e: Throwable =>
            log.error("MBTAaccess.parseMbtaResponse -- recover -- {}", e)
            ConfigFactory.empty
        }
    }
  }

  override def preStart() : Unit = {
    MBTAaccess.runQ
    startHttpServer()
  }

  def startHttpServer(): Unit = {
    val route = createApiRoutes()
    val binding = Http().newServerAt("0.0.0.0", 8080).bind(route)
    binding.onComplete {
      case Success(binding) => log.info(s"Server online at http://0.0.0.0:8080/")
      case Failure(exception) => log.error(s"Failed to bind HTTP server: ${exception}")
    }
  }

  object JsonProtocol extends DefaultJsonProtocol {
    case class RouteInfo(id: String, long_name: String, short_name: String, color: String, text_color: String, route_type: Int)
    case class StopInfo(id: String, name: String, latitude: Double, longitude: Double)
    case class ShapeInfo(id: String, polyline: String)
    
    implicit val routeInfoFormat: RootJsonFormat[RouteInfo] = jsonFormat6(RouteInfo.apply)
    implicit val stopInfoFormat: RootJsonFormat[StopInfo] = jsonFormat4(StopInfo.apply)
    implicit val shapeInfoFormat: RootJsonFormat[ShapeInfo] = jsonFormat2(ShapeInfo.apply)
    implicit val vehicleDataFormat: RootJsonFormat[RequestFlow.VehicleData] = jsonFormat21(RequestFlow.VehicleData.apply)
    
    // Custom marshallers for HTTP responses
    implicit def routeInfoListMarshaller: Marshaller[Vector[RouteInfo], HttpEntity.Strict] = 
      Marshaller.withFixedContentType(ContentTypes.`application/json`) { routeInfos =>
        HttpEntity(ContentTypes.`application/json`, routeInfos.toJson.compactPrint)
      }
      
    implicit def stopInfoListMarshaller: Marshaller[Vector[StopInfo], HttpEntity.Strict] = 
      Marshaller.withFixedContentType(ContentTypes.`application/json`) { stopInfos =>
        HttpEntity(ContentTypes.`application/json`, stopInfos.toJson.compactPrint)
      }
      
    implicit def stringListMarshaller: Marshaller[Vector[String], HttpEntity.Strict] = 
      Marshaller.withFixedContentType(ContentTypes.`application/json`) { strings =>
        HttpEntity(ContentTypes.`application/json`, strings.toJson.compactPrint)
      }
      
    implicit def vehicleDataListMarshaller: Marshaller[Vector[RequestFlow.VehicleData], HttpEntity.Strict] = 
      Marshaller.withFixedContentType(ContentTypes.`application/json`) { vehicleDatas =>
        HttpEntity(ContentTypes.`application/json`, vehicleDatas.toJson.compactPrint)
      }
      
    implicit def shapeInfoListMarshaller: Marshaller[Vector[ShapeInfo], HttpEntity.Strict] = 
      Marshaller.withFixedContentType(ContentTypes.`application/json`) { shapeInfos =>
        HttpEntity(ContentTypes.`application/json`, shapeInfos.toJson.compactPrint)
      }
  }

  def createApiRoutes(): Route = {
    import JsonProtocol._

    val corsHeaders = List(
      `Access-Control-Allow-Origin`.*,
      `Access-Control-Allow-Methods`(HttpMethods.GET, HttpMethods.POST, HttpMethods.OPTIONS),
      `Access-Control-Allow-Headers`("Content-Type", "Authorization")
    )

    concat(
      options {
        complete(HttpResponse(200).withHeaders(corsHeaders))
      },
      pathPrefix("api") {
        concat(
          path("routes") {
            get {
              parameter("type".optional) { typeFilter =>
                onSuccess(RequestFlow.fetchRoutesOnDemand(typeFilter)) { routes =>
                  complete(routes)
                }
              }
            }
          },
          path("route" / Segment / "stops") { routeId =>
            get {
              onSuccess(RequestFlow.fetchStops(routeId)) { stops =>
                complete(stops)
              }
            }
          },
          path("route" / Segment / "vehicles") { routeId =>
            get {
              onSuccess(RequestFlow.fetchVehiclesForRoute(routeId)) { vehicles =>
                complete(vehicles)
              }
            }
          },
          path("route" / Segment / "shapes") { routeId =>
            get {
              onSuccess(RequestFlow.fetchShapes(routeId)) { shapes =>
                complete(shapes)
              }
            }
          },
        )
      }
    )
  }

  object RequestFlow {
    sealed trait rd
    case class TickRoutes() extends rd
    case class Routes(routes: Vector[Config]) extends rd

    sealed trait vd
    case class FetchRoutes() extends vd
    case class VehicleRoute(
      route            : String,
      directionNames   : Vector[String],
      destinationNames : Vector[String],
    ) extends vd
    case class VehiclesPerRouteRaw(
      route            : VehicleRoute,
      rawVehicles      : Vector[Config],
      rawPredictions   : Vector[Config] = Vector.empty[Config]
    ) extends vd
    case class VehicleData(
      routeId             : String,
      vehicleId           : Option[String] = None,
      stopId              : Option[String] = None,
      tripId              : Option[String] = None,
      bearing             : Option[Int]    = None,
      directionId         : Option[Int]    = None,
      currentStatus       : Option[String] = None,
      currentStopSequence : Option[Int]    = None,
      latitude            : Option[Double] = None,
      longitude           : Option[Double] = None,
      speed               : Option[Double] = None,
      updatedAt           : Option[String] = None,
      stopName            : Option[String] = None,
      stopPlatformName    : Option[String] = None,
      stopZone            : Option[String] = None,
      timeStamp           : Long           = java.time.Instant.now().toEpochMilli(),
      direction           : Option[String] = None,
      destination         : Option[String] = None,
      predictedArrivalTime : Option[String] = None,
      scheduledArrivalTime : Option[String] = None,
      delaySeconds        : Option[Int]    = None
    ) extends vd
    case class VehicleDataNull() extends vd

    def vehiclesPerRouteRawFlow : Flow[vd, vd, NotUsed] = {
      Flow[vd]
        .mapAsync(parallelism = 12) {
          case vr @ VehicleRoute(route, _, _) => {
            MBTAaccess.queueRequest(
              HttpRequest(uri = MBTAaccess.mbtaUri(
                path  = "/vehicles",
                query = MBTAaccess.mbtaQuery(Map("include" -> "stop", "filter[route]" -> route))
              ))
            ).flatMap {
              case HttpResponse(StatusCodes.OK, _, entity, _) => {
                MBTAaccess.parseMbtaResponse(entity).map { resp =>
                  log.info("vehiclesPerRouteRawFlow({}) returned: OK", route)
                  val vehicles = resp.getObjectList("data").asScala.toVector.map { _.toConfig }
                  
                  VehiclesPerRouteRaw(
                    route           = vr,
                    rawVehicles     = vehicles,
                    rawPredictions  = Vector.empty[Config] // Predictions will be fetched separately
                  )
                }
              }
              case HttpResponse(code, _, entity, _) => Future.successful {
                log.error("vehiclesPerRouteFlow returned unexpected code: {}", code.toString)
                entity.discardBytes()
                VehiclesPerRouteRaw(
                  route           = vr,
                  rawVehicles     = Vector.empty[Config],
                  rawPredictions  = Vector.empty[Config]
                )
              }
            }
          }
          case unExpected => Future.failed {
            log.error("vehiclesPerRouteRawFlow unexpected input: {}", unExpected.toString)
            new Exception("vehiclesPerRouteRawFlow unexpected input")
          }
        }
    }

    def vehiclesPerRouteFlow : Flow[vd, vd, NotUsed] = {
      Flow[vd]
        .mapConcat {
          case VehiclesPerRouteRaw(route, rv, _) => {
            rv.map { r =>
              val directionId : Try[Int] = Try(r.getInt("attributes.direction_id"))

              VehicleData(
                routeId             = route.route,
                vehicleId           = Try(r.getString("attributes.label")).toOption,
                stopId              = Try(r.getString("relationships.stop.data.id")).toOption,
                tripId              = Try(r.getString("relationships.trip.data.id")).toOption,
                bearing             = Try(r.getInt("attributes.bearing")).toOption,
                directionId         = directionId.toOption,
                currentStatus       = Try(r.getString("attributes.current_status")).toOption,
                currentStopSequence = Try(r.getInt("attributes.current_stop_sequence")).toOption,
                latitude            = Try(r.getDouble("attributes.latitude")).toOption,
                longitude           = Try(r.getDouble("attributes.longitude")).toOption,
                speed               = Try(r.getDouble("attributes.speed")).toOption,
                updatedAt           = Try(r.getString("attributes.updated_at")).toOption,
                direction           = directionId.flatMap { id => Try(route.directionNames(id)) }.toOption,
                destination         = directionId.flatMap { id => Try(route.destinationNames(id)) }.toOption
              )
            }
          }
          case unExpected => {
            log.error("vehiclesPerRouteFlow unexpected input: {}", unExpected.toString)
            Vector(VehicleDataNull())
          }
        }
    }

    def stopIdLookupFlow : Flow[vd, vd, NotUsed] = {
      Flow[vd]
        .mapAsync(parallelism = 16) {
          case vd : VehicleData => {
            vd.stopId.map { stopId =>
              val uri = MBTAaccess.mbtaUri(
                path  = s"/stops/${stopId}",
                query = MBTAaccess.mbtaQuery()
              )

              MBTAaccess.queueRequest(
                HttpRequest(uri = uri)
              ).flatMap {
                case HttpResponse(StatusCodes.OK, _, entity, _) => {
                  MBTAaccess.parseMbtaResponse(entity).map { r =>
                    vd.copy(
                      stopName         = Try(r.getString("data.attributes.name")).toOption,
                      stopPlatformName = Try(r.getString("data.attributes.platform_name")).toOption,
                      stopZone         = Try(r.getString("data.relationships.zone.data.id")).toOption
                    )
                  }
                }
                case HttpResponse(code, _, entity, _) => Future.successful {
                  log.error("stopIdLookupFlow returned unexpected code: {} with uri: {}", code.toString, uri.toString)
                  entity.discardBytes()
                  vd
                }
              }
            }.getOrElse {
              Future.successful(vd)
            }
          }

          case unExpected => Future.successful {
            log.error("stopIdLookupFlow unexpected input: {}", unExpected.toString)
            VehicleDataNull()
          }
        }
    }

    def scheduleLookupFlow : Flow[vd, vd, NotUsed] = {
      Flow[vd]
        .mapAsync(parallelism = 8) {
          case vd : VehicleData => {
            (vd.tripId, vd.stopId) match {
              case (Some(tripId), Some(stopId)) =>
                val uri = MBTAaccess.mbtaUri(
                  path  = "/schedules",
                  query = MBTAaccess.mbtaQuery(Map("filter[trip]" -> tripId, "filter[stop]" -> stopId))
                )

                log.info("scheduleLookupFlow: Fetching schedules for vehicle {} with tripId: {} and stopId: {}", vd.vehicleId.getOrElse("unknown"), tripId, stopId)

                MBTAaccess.queueRequest(
                  HttpRequest(uri = uri)
                ).flatMap {
                  case HttpResponse(StatusCodes.OK, _, entity, _) => {
                    MBTAaccess.parseMbtaResponse(entity).map { resp =>
                      val schedules = resp.getObjectList("data").asScala.toVector.map { _.toConfig }
                      
                      log.info("scheduleLookupFlow: Received {} schedules for tripId: {} and stopId: {}", schedules.length, tripId, stopId)
                      
                      if (schedules.nonEmpty) {
                        log.info("scheduleLookupFlow: First schedule data: {}", schedules.head.toString)
                      } else {
                        log.warning("scheduleLookupFlow: No schedules found for tripId: {} and stopId: {}", tripId, stopId)
                      }
                      
                      schedules.headOption match {
                        case Some(schedule) =>
                          val scheduledArrival = Try(schedule.getString("attributes.arrival_time")).toOption
                          val scheduledDeparture = Try(schedule.getString("attributes.departure_time")).toOption
                          
                          log.info("scheduleLookupFlow: Parsed scheduled times - arrival: {}, departure: {}", 
                            scheduledArrival.getOrElse("None"), scheduledDeparture.getOrElse("None"))
                          
                          vd.copy(
                            scheduledArrivalTime = scheduledArrival.orElse(scheduledDeparture)
                          )
                        case None => vd
                      }
                    }
                  }
                  case HttpResponse(code, _, entity, _) => Future.successful {
                    log.error("scheduleLookupFlow returned unexpected code: {} with uri: {}", code.toString, uri.toString)
                    entity.discardBytes()
                    vd
                  }
                }
              case _ => Future.successful(vd)
            }
          }

          case unExpected => Future.successful {
            log.error("scheduleLookupFlow unexpected input: {}", unExpected.toString)
            VehicleDataNull()
          }
        }
    }

    def predictionLookupFlow : Flow[vd, vd, NotUsed] = {
      Flow[vd]
        .mapAsync(parallelism = 8) {
          case vd : VehicleData => {
            vd.tripId match {
              case Some(tripId) =>
                val uri = MBTAaccess.mbtaUri(
                  path  = "/predictions",
                  query = MBTAaccess.mbtaQuery(Map("filter[trip]" -> tripId))
                )

                log.info("predictionLookupFlow: Fetching predictions for vehicle {} with tripId: {} and stopId: {}", vd.vehicleId.getOrElse("unknown"), tripId, vd.stopId.getOrElse("unknown"))

                MBTAaccess.queueRequest(
                  HttpRequest(uri = uri)
                ).flatMap {
                  case HttpResponse(StatusCodes.OK, _, entity, _) => {
                    MBTAaccess.parseMbtaResponse(entity).map { resp =>
                      val predictions = resp.getObjectList("data").asScala.toVector.map { _.toConfig }
                      
                      log.info("predictionLookupFlow: Received {} predictions for tripId: {}", predictions.length, tripId)
                      
                      if (predictions.nonEmpty) {
                        log.info("predictionLookupFlow: First prediction data: {}", predictions.head.toString)
                      } else {
                        log.warning("predictionLookupFlow: No predictions found for tripId: {}", tripId)
                      }
                      
                      // Find prediction for the current stop or use the first available
                      val relevantPrediction = predictions.find { pred =>
                        val predStopId = Try(pred.getString("relationships.stop.data.id")).toOption
                        predStopId == vd.stopId
                      }.orElse(predictions.headOption)
                      
                      relevantPrediction match {
                        case Some(pred) =>
                          val predicted = Try(pred.getString("attributes.arrival_time")).toOption
                          val scheduleRelationship = Try(pred.getString("attributes.schedule_relationship")).toOption
                          
                          log.info("predictionLookupFlow: Parsed predicted time: {}, schedule_relationship: {}", 
                            predicted.getOrElse("None"), scheduleRelationship.getOrElse("None"))
                          
                          // Calculate delay using scheduled time from previous flow
                          val delaySeconds = (predicted, vd.scheduledArrivalTime) match {
                            case (Some(predTime), Some(schedTime)) =>
                              try {
                                val predInstant = java.time.Instant.parse(predTime)
                                val schedInstant = java.time.Instant.parse(schedTime)
                                val delay = java.time.Duration.between(schedInstant, predInstant).getSeconds.toInt
                                log.info("predictionLookupFlow: Calculated delay: {} seconds ({} minutes) for vehicle {}", delay, delay / 60, vd.vehicleId.getOrElse("unknown"))
                                Some(delay)
                              } catch {
                                case e: Exception => 
                                  log.error("predictionLookupFlow: Error parsing times - predTime: {}, schedTime: {}, error: {}", predTime, schedTime, e.getMessage)
                                  None
                              }
                            case _ => 
                              log.warning("predictionLookupFlow: Missing time data - predicted: {}, scheduled: {}", predicted.isDefined, vd.scheduledArrivalTime.isDefined)
                              None
                          }
                          
                          val updatedVehicle = vd.copy(
                            predictedArrivalTime = predicted,
                            delaySeconds = delaySeconds
                          )
                          
                          log.info("predictionLookupFlow: Updated vehicle {} with delay data - delaySeconds: {}", vd.vehicleId.getOrElse("unknown"), delaySeconds.getOrElse("None"))
                          updatedVehicle
                        case None => 
                          log.warning("predictionLookupFlow: No predictions available for vehicle {} with tripId: {}", vd.vehicleId.getOrElse("unknown"), tripId)
                          vd
                      }
                    }
                  }
                  case HttpResponse(code, _, entity, _) => Future.successful {
                    log.error("predictionLookupFlow returned unexpected code: {} with uri: {}", code.toString, uri.toString)
                    entity.discardBytes()
                    vd
                  }
                }
              case None => 
                log.warning("predictionLookupFlow: No tripId available for vehicle {}", vd.vehicleId.getOrElse("unknown"))
                Future.successful(vd)
            }
          }

          case unExpected => Future.successful {
            log.error("predictionLookupFlow unexpected input: {}", unExpected.toString)
            VehicleDataNull()
          }
        }
    }

    def fetchRoutes : Flow[vd, vd, NotUsed] = {
      Flow[vd]
        .mapAsync[Routes](parallelism = 1) { _ =>
          MBTAaccess.queueRequest(
            //
            // Filter on just the Commuter rail, Rapid Transit. The Bus routes push to too many substreams.
            //
            HttpRequest(uri = MBTAaccess.mbtaUri(
              path  = "/routes",
              query = MBTAaccess.mbtaQuery(Map("filter[type]" -> "0,1,2,3"))
            ))
          )
          .flatMap {
            case HttpResponse(StatusCodes.OK, _, entity, _) => {
              MBTAaccess.parseMbtaResponse(entity).map { response =>
                val routes = response.getObjectList("data").asScala.toVector.map { _.toConfig }
                Routes(routes = routes)
              }
            }

            case HttpResponse(code, _, entity, _) => Future.successful {
              log.error("RequestFlow.RoutesFlow.HttpResponse({})", code.toString)
              entity.discardBytes()
              Routes(routes = Vector.empty[Config])
            }
          }
        }
        .recover {
          case e: Throwable =>
            log.error("RequestFlow.RoutesFlow.recover -- {}", e)
            Routes(routes = Vector.empty[Config])
        }
        .mapConcat { case Routes(routes) =>
          routes.map { r =>
            VehicleRoute(
              route            = r.getString("id"),
              directionNames   = Try(r.getStringList("attributes.direction_names").asScala.toVector).getOrElse(Vector.empty[String]),
              destinationNames = Try(r.getStringList("attributes.direction_destinations").asScala.toVector).getOrElse(Vector.empty[String])
            )
          }
        }
    }

    def fetchStops(routeId: String): Future[Vector[JsonProtocol.StopInfo]] = {
      MBTAaccess.queueRequest(
        HttpRequest(uri = MBTAaccess.mbtaUri(
          path = "/stops",
          query = MBTAaccess.mbtaQuery(Map("filter[route]" -> routeId))
        ))
      ).flatMap {
        case HttpResponse(StatusCodes.OK, _, entity, _) =>
          MBTAaccess.parseMbtaResponse(entity).map { response =>
            response.getObjectList("data").asScala.toVector.map { stop =>
              val s = stop.toConfig
              JsonProtocol.StopInfo(
                id = s.getString("id"),
                name = s.getString("attributes.name"),
                latitude = s.getDouble("attributes.latitude"),
                longitude = s.getDouble("attributes.longitude")
              )
            }
          }
        case HttpResponse(code, _, entity, _) =>
          entity.discardBytes()
          Future.successful(Vector.empty)
      }
    }

    def fetchRoutesOnDemand(typeFilter: Option[String]): Future[Vector[JsonProtocol.RouteInfo]] = {
      val queryParams = typeFilter match {
        case Some(types) => Map("filter[type]" -> types)
        case None => Map("filter[type]" -> "0,1,2,3")
      }
      
      MBTAaccess.queueRequest(
        HttpRequest(uri = MBTAaccess.mbtaUri(
          path = "/routes",
          query = MBTAaccess.mbtaQuery(queryParams)
        ))
      ).flatMap {
        case HttpResponse(StatusCodes.OK, _, entity, _) =>
          MBTAaccess.parseMbtaResponse(entity).map { response =>
            response.getObjectList("data").asScala.toVector.map { route =>
              val r = route.toConfig
              JsonProtocol.RouteInfo(
                id = r.getString("id"),
                long_name = r.getString("attributes.long_name"),
                short_name = r.getString("attributes.short_name"),
                color = r.getString("attributes.color"),
                text_color = r.getString("attributes.text_color"),
                route_type = r.getInt("attributes.type")
              )
            }
          }
        case HttpResponse(code, _, entity, _) =>
          entity.discardBytes()
          Future.successful(Vector.empty)
      }
    }

    def fetchVehiclesForRoute(routeId: String): Future[Vector[VehicleData]] = {
      // First fetch the route to get direction names and destination names
      MBTAaccess.queueRequest(
        HttpRequest(uri = MBTAaccess.mbtaUri(
          path = s"/routes/${routeId}",
          query = MBTAaccess.mbtaQuery()
        ))
      ).flatMap {
        case HttpResponse(StatusCodes.OK, _, entity, _) =>
          MBTAaccess.parseMbtaResponse(entity).map { response =>
            val route = response.getConfig("data")
            val directionNames = Try(route.getStringList("attributes.direction_names").asScala.toVector).getOrElse(Vector.empty[String])
            val destinationNames = Try(route.getStringList("attributes.direction_destinations").asScala.toVector).getOrElse(Vector.empty[String])
            
            // Now fetch vehicles with proper route information
            Source.single(VehicleRoute(routeId, directionNames, destinationNames))
              .via(vehiclesPerRouteRawFlow)
              .via(vehiclesPerRouteFlow)
              .via(stopIdLookupFlow)
              .via(scheduleLookupFlow)
              .via(predictionLookupFlow)
              .runWith(Sink.seq)
              .map(_.toVector.collect {
                case vd: VehicleData => vd
              })
          }.flatten
        case HttpResponse(code, _, entity, _) =>
          log.error("fetchVehiclesForRoute route lookup returned unexpected code: {} for routeId: {}", code.toString, routeId)
          entity.discardBytes()
          Future.successful(Vector.empty[VehicleData])
      }
    }

    // Helper function to convert directionId to human-readable format
    def convertDirectionId(directionId: Int): String = {
      directionId match {
        case 0 => "Outbound"
        case 1 => "Inbound"
        case _ => "Unknown"
      }
    }

    def fetchShapes(routeId: String): Future[Vector[JsonProtocol.ShapeInfo]] = {
      MBTAaccess.queueRequest(
        HttpRequest(uri = MBTAaccess.mbtaUri(
          path = "/shapes",
          query = MBTAaccess.mbtaQuery(Map("filter[route]" -> routeId))
        ))
      ).flatMap {
        case HttpResponse(StatusCodes.OK, _, entity, _) =>
          MBTAaccess.parseMbtaResponse(entity).map { response =>
            response.getObjectList("data").asScala.toVector.map { shape =>
              val s = shape.toConfig
              JsonProtocol.ShapeInfo(
                id = s.getString("id"),
                polyline = s.getString("attributes.polyline")
              )
            }
          }
        case HttpResponse(code, _, entity, _) =>
          entity.discardBytes()
          Future.successful(Vector.empty)
      }
    }
  }

  def receive: PartialFunction[Any,Unit] = {
    case event =>
      log.error("Unexpected event={}", event.toString)
  }
}
