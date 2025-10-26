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

    def parseMbtaResponse(entity: HttpEntity) : Future[Config] = {
      entity
        .withoutSizeLimit
        .dataBytes
        .runWith(Sink.fold(ByteString.empty)(_ ++ _))
        .map { s => ConfigFactory.parseString(s.utf8String) }
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
    case class VehicleIds(vehicleIds: Vector[String])
    
    implicit val routeInfoFormat: RootJsonFormat[RouteInfo] = jsonFormat6(RouteInfo.apply)
    implicit val stopInfoFormat: RootJsonFormat[StopInfo] = jsonFormat4(StopInfo.apply)
    implicit val shapeInfoFormat: RootJsonFormat[ShapeInfo] = jsonFormat2(ShapeInfo.apply)
    implicit val vehicleIdsFormat: RootJsonFormat[VehicleIds] = jsonFormat1(VehicleIds.apply)
    implicit val vehicleDataFormat: RootJsonFormat[RequestFlow.VehicleData] = jsonFormat18(RequestFlow.VehicleData.apply)
    
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
      
    // Custom unmarshaller for VehicleIds
    implicit def vehicleIdsUnmarshaller: Unmarshaller[HttpEntity, VehicleIds] = 
      Unmarshaller.stringUnmarshaller.map(_.parseJson.convertTo[VehicleIds])
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
              onSuccess(RequestFlow.fetchVehicleIdsForRoute(routeId)) { vehicleIds =>
                complete(vehicleIds)
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
          path("vehicles") {
            post {
              entity(as[VehicleIds]) { request =>
                onSuccess(RequestFlow.fetchVehicleData(request.vehicleIds)) { vehicles =>
                  complete(vehicles)
                }
              }
            }
          }
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
      rawVehicles      : Vector[Config]
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
      destination         : Option[String] = None
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
                  VehiclesPerRouteRaw(
                    route       = vr,
                    rawVehicles = resp.getObjectList("data").asScala.toVector.map { _.toConfig }
                  )
                }
              }
              case HttpResponse(code, _, entity, _) => Future.successful {
                log.error("vehiclesPerRouteFlow returned unexpected code: {}", code.toString)
                entity.discardBytes()
                VehiclesPerRouteRaw(
                  route       = vr,
                  rawVehicles = Vector.empty[Config]
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
          case VehiclesPerRouteRaw(route, rv) => {
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

    def fetchRoutes : Flow[vd, vd, NotUsed] = {
      Flow[vd]
        .mapAsync[Routes](parallelism = 1) { _ =>
          MBTAaccess.queueRequest(
            //
            // Filter on just the Commuter rail, Rapid Transit. The Bus routes push to too many substreams.
            //
            HttpRequest(uri = MBTAaccess.mbtaUri(
              path  = "/routes",
              query = MBTAaccess.mbtaQuery(Map("filter[type]" -> "0,1,2"))
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
        case None => Map("filter[type]" -> "0,1,2")
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

    def fetchVehicleIdsForRoute(routeId: String): Future[Vector[String]] = {
      Source.single(VehicleRoute(routeId, Vector.empty, Vector.empty))
        .via(vehiclesPerRouteRawFlow)
        .via(vehiclesPerRouteFlow)
        .runWith(Sink.seq)
        .map(_.toVector.collect {
          case vd: VehicleData => vd.vehicleId.getOrElse("")
        }.filter(_.nonEmpty))
    }

    def fetchVehicleData(vehicleIds: Vector[String]): Future[Vector[VehicleData]] = {
      Source(vehicleIds)
        .mapAsync(parallelism = 10) { vehicleId =>
          MBTAaccess.queueRequest(
            HttpRequest(uri = MBTAaccess.mbtaUri(
              path = "/vehicles",
              query = MBTAaccess.mbtaQuery(Map("filter[id]" -> vehicleId, "include" -> "stop"))
            ))
          ).flatMap {
            case HttpResponse(StatusCodes.OK, _, entity, _) =>
              MBTAaccess.parseMbtaResponse(entity).map { response =>
                response.getObjectList("data").asScala.toVector.headOption.map { vehicle =>
                  val v = vehicle.toConfig
                  val directionId = Try(v.getInt("attributes.direction_id")).toOption
                  val baseVehicleData = VehicleData(
                    routeId = v.getString("relationships.route.data.id"),
                    vehicleId = Try(v.getString("attributes.label")).toOption,
                    stopId = Try(v.getString("relationships.stop.data.id")).toOption,
                    tripId = Try(v.getString("relationships.trip.data.id")).toOption,
                    bearing = Try(v.getInt("attributes.bearing")).toOption,
                    directionId = directionId,
                    currentStatus = Try(v.getString("attributes.current_status")).toOption,
                    currentStopSequence = Try(v.getInt("attributes.current_stop_sequence")).toOption,
                    latitude = Try(v.getDouble("attributes.latitude")).toOption,
                    longitude = Try(v.getDouble("attributes.longitude")).toOption,
                    speed = Try(v.getDouble("attributes.speed")).toOption,
                    updatedAt = Try(v.getString("attributes.updated_at")).toOption,
                    direction = directionId.map(convertDirectionId),
                    destination = None, // Will be enriched below
                    stopName = None // Will be enriched below
                  )
                  
                  // Enrich with trip and stop data
                  enrichVehicleData(baseVehicleData)
                }
              }
            case _ => Future.successful(None)
          }
        }
        .collect { case Some(vdFuture) => vdFuture }
        .mapAsync(parallelism = 5) { vdFuture => vdFuture }
        .runWith(Sink.seq)
        .map(_.toVector)
    }

    // Helper function to convert directionId to human-readable format
    def convertDirectionId(directionId: Int): String = {
      directionId match {
        case 0 => "Outbound"
        case 1 => "Inbound"
        case _ => "Unknown"
      }
    }

    // Helper function to enrich vehicle data with trip and stop information
    def enrichVehicleData(vehicleData: VehicleData): Future[VehicleData] = {
      val tripFuture = vehicleData.tripId.map { tripId =>
        MBTAaccess.queueRequest(
          HttpRequest(uri = MBTAaccess.mbtaUri(
            path = s"/trips/${tripId}",
            query = MBTAaccess.mbtaQuery()
          ))
        ).flatMap {
          case HttpResponse(StatusCodes.OK, _, entity, _) =>
            MBTAaccess.parseMbtaResponse(entity).map { response =>
              Try(response.getString("data.attributes.headsign")).toOption
            }
          case HttpResponse(code, _, entity, _) =>
            log.error("enrichVehicleData trip lookup returned unexpected code: {} for tripId: {}", code.toString, tripId)
            entity.discardBytes()
            Future.successful(None)
        }
      }.getOrElse(Future.successful(None))

      val stopFuture = vehicleData.stopId.map { stopId =>
        MBTAaccess.queueRequest(
          HttpRequest(uri = MBTAaccess.mbtaUri(
            path = s"/stops/${stopId}",
            query = MBTAaccess.mbtaQuery()
          ))
        ).flatMap {
          case HttpResponse(StatusCodes.OK, _, entity, _) =>
            MBTAaccess.parseMbtaResponse(entity).map { response =>
              Try(response.getString("data.attributes.name")).toOption
            }
          case HttpResponse(code, _, entity, _) =>
            log.error("enrichVehicleData stop lookup returned unexpected code: {} for stopId: {}", code.toString, stopId)
            entity.discardBytes()
            Future.successful(None)
        }
      }.getOrElse(Future.successful(None))

      // Combine both futures
      for {
        destination <- tripFuture
        stopName <- stopFuture
      } yield {
        vehicleData.copy(
          destination = destination,
          stopName = stopName
        )
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
