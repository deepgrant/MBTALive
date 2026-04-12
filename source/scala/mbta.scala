package mbta.actor

import com.typesafe.config.Config
import com.typesafe.config.ConfigFactory
import org.apache.pekko
import spray.json._

import scala.concurrent.Future
import scala.concurrent.Promise
import scala.concurrent.duration._
import scala.jdk.CollectionConverters._
import scala.util.Failure
import scala.util.Success
import scala.util.Try

import pekko.http.scaladsl.marshalling.Marshaller
import pekko.actor._
import pekko.http.scaladsl.Http
import pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpRequest, HttpResponse, StatusCodes}
import pekko.http.scaladsl.model.Uri
import pekko.http.scaladsl.server.Directives._
import pekko.http.scaladsl.server.Route
import pekko.http.scaladsl.model.headers._
import pekko.http.scaladsl.model.HttpMethods
import pekko.NotUsed
import pekko.util.{ByteString, Timeout}
import pekko.stream.OverflowStrategy
import pekko.stream.scaladsl.{Flow, Sink, Source, SourceQueueWithComplete}
import pekko.http.scaladsl.settings.ConnectionPoolSettings

object MBTAMain extends App {
  implicit val timeout          : pekko.util.Timeout                                = 10.seconds
  implicit val system           : pekko.actor.ActorSystem                            = ActorSystem()
  implicit val executionContext : scala.concurrent.ExecutionContextExecutor          = system.dispatcher
  implicit val scheduler        : pekko.actor.Scheduler                              = system.scheduler

  val mbtaService: ActorRef = system.actorOf(Props[MBTAService](), name = "mbtaService")
}

class MBTAService extends Actor with ActorLogging {
  import context.dispatcher

  implicit val system  : pekko.actor.ActorSystem = context.system
  implicit val timeout : Timeout                 = 30.seconds

  object Config {
    // Evaluated once at startup; drives rate-limiting and query signing throughout.
    val apiKey: Option[String] = sys.env.get("MBTA_API_KEY")

    val maxRequestsPerPeriod: Int = apiKey match {
      case Some(_) => 1000
      case None    =>
        log.warning("MBTA_API_KEY not found in environment -- rate limiting to 10 req/min")
        10
    }

    val maxRequestsWindow: FiniteDuration = 1.minute
  }

  object MBTAaccess {
    def transportSettings: ConnectionPoolSettings = ConnectionPoolSettings(system)
      .withMaxConnections(4)
      .withMaxOpenRequests(256)
      .withPipeliningLimit(64)

    var queue: Option[SourceQueueWithComplete[(HttpRequest, Promise[HttpResponse])]] = None

    def runQ: Future[pekko.Done] = {
      val (q, source) = Source
        .queue[(HttpRequest, Promise[HttpResponse])](bufferSize = 256, overflowStrategy = OverflowStrategy.backpressure)
        .preMaterialize()

      queue = Some(q)

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
          p.completeWith(
            res.map { r =>
              r.entity.withoutSizeLimit().toStrict(60.seconds).map(r.withEntity(_))
            }.recover { case t =>
              log.error(t, "runQ: connection pool error")
              Future.failed(t)
            }.getOrElse(Future.failed(new IllegalStateException("runQ: empty Try from pool")))
          )
        }
        .runWith(Sink.ignore)
        .andThen {
          case Success(_) => log.error("runQ stopped unexpectedly (normal termination).")
          case Failure(t) => log.error(t, "runQ stopped with error")
        }
        .transformWith { _ =>
          log.warning("runQ restarting")
          runQ
        }
    }

    /** Builds a query string, appending the API key when available. */
    def mbtaQuery(params: Map[String, String] = Map.empty): Option[String] =
      Some(Uri.Query(Config.apiKey.fold(params)(key => params + ("api_key" -> key))).toString)

    def mbtaUri(path: String, query: Option[String] = None): Uri = Uri(
      scheme      = "https",
      path        = Uri.Path(path),
      queryString = query,
      fragment    = None
    )

    def queueRequest(request: HttpRequest): Future[HttpResponse] =
      queue.fold[Future[HttpResponse]](
        Future.failed(new Exception("queueRequest: no queue available"))
      ) { q =>
        log.debug("queueRequest: {}", request.uri)
        val p = Promise[HttpResponse]()
        q.offer((request, p)).flatMap(_ => p.future).recover {
          case e: Exception =>
            log.error(e, "queueRequest failed for: {}", request.uri)
            HttpResponse(StatusCodes.InternalServerError)
        }
      }

    def parseMbtaResponse(entity: HttpEntity): Future[Config] =
      entity
        .withoutSizeLimit
        .dataBytes
        .fold(ByteString.empty)(_ ++ _)
        .map(bytes => ConfigFactory.parseString(bytes.utf8String))
        .mapMaterializedValue(_ => NotUsed)
        .runWith(Sink.head)
        .recover {
          case e: Throwable =>
            log.error("parseMbtaResponse failed: {}", e.getMessage)
            ConfigFactory.empty
        }
  }

  override def preStart(): Unit = {
    MBTAaccess.runQ
    startHttpServer()
  }

  def startHttpServer(): Unit =
    Http().newServerAt("0.0.0.0", 8080).bind(createApiRoutes()).onComplete {
      case Success(b) => log.info("Server online at {}", b.localAddress)
      case Failure(e) => log.error("Failed to bind HTTP server: {}", e.getMessage)
    }

  object JsonProtocol extends DefaultJsonProtocol {
    case class RouteInfo(id: String, long_name: String, short_name: String, color: String, text_color: String, route_type: Int)
    case class StopInfo(id: String, name: String, latitude: Double, longitude: Double)
    case class ShapeInfo(id: String, polyline: String)

    implicit val routeInfoFormat   : RootJsonFormat[RouteInfo]                  = jsonFormat6(RouteInfo.apply)
    implicit val stopInfoFormat    : RootJsonFormat[StopInfo]                   = jsonFormat4(StopInfo.apply)
    implicit val shapeInfoFormat   : RootJsonFormat[ShapeInfo]                  = jsonFormat2(ShapeInfo.apply)
    implicit val vehicleDataFormat : RootJsonFormat[RequestFlow.VehicleData]    = jsonFormat22(RequestFlow.VehicleData.apply)

    private def jsonResponse[A: JsonWriter](items: A): HttpEntity.Strict =
      HttpEntity(ContentTypes.`application/json`, items.toJson.compactPrint)

    implicit def routeInfoListMarshaller: Marshaller[Vector[RouteInfo], HttpEntity.Strict] =
      Marshaller.withFixedContentType(ContentTypes.`application/json`)(jsonResponse(_))

    implicit def stopInfoListMarshaller: Marshaller[Vector[StopInfo], HttpEntity.Strict] =
      Marshaller.withFixedContentType(ContentTypes.`application/json`)(jsonResponse(_))

    implicit def vehicleDataListMarshaller: Marshaller[Vector[RequestFlow.VehicleData], HttpEntity.Strict] =
      Marshaller.withFixedContentType(ContentTypes.`application/json`)(jsonResponse(_))

    implicit def shapeInfoListMarshaller: Marshaller[Vector[ShapeInfo], HttpEntity.Strict] =
      Marshaller.withFixedContentType(ContentTypes.`application/json`)(jsonResponse(_))
  }

  def createApiRoutes(): Route = {
    import JsonProtocol._

    val corsHeaders = List(
      `Access-Control-Allow-Origin`.*,
      `Access-Control-Allow-Methods`(HttpMethods.GET, HttpMethods.POST, HttpMethods.OPTIONS),
      `Access-Control-Allow-Headers`("Content-Type", "Authorization")
    )

    // CORS headers applied to every response, including actual GET responses.
    respondWithHeaders(corsHeaders) {
      concat(
        options {
          complete(HttpResponse(200))
        },
        pathPrefix("api") {
          concat(
            path("routes") {
              get {
                parameter("type".optional) { typeFilter =>
                  onSuccess(RequestFlow.fetchRoutesOnDemand(typeFilter))(complete(_))
                }
              }
            },
            path("route" / Segment / "stops") { routeId =>
              get {
                onSuccess(RequestFlow.fetchStops(routeId))(complete(_))
              }
            },
            path("route" / Segment / "vehicles") { routeId =>
              get {
                parameter("sortBy".optional, "sortOrder".optional) { (sortByOpt, sortOrderOpt) =>
                  val sortBy    = sortByOpt.getOrElse("vehicleId")
                  val sortOrder = sortOrderOpt.getOrElse("asc")
                  onSuccess(RequestFlow.fetchVehiclesForRoute(routeId, sortBy, sortOrder))(complete(_))
                }
              }
            },
            path("route" / Segment / "shapes") { routeId =>
              get {
                onSuccess(RequestFlow.fetchShapes(routeId))(complete(_))
              }
            }
          )
        }
      )
    }
  }

  object RequestFlow {
    sealed trait vd
    case class VehicleRoute(
      route            : String,
      directionNames   : Vector[String],
      destinationNames : Vector[String]
    ) extends vd
    case class VehiclesPerRouteRaw(
      route       : VehicleRoute,
      rawVehicles : Vector[Config],
      rawIncluded : Vector[Config] = Vector.empty
    ) extends vd
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
      delaySeconds         : Option[Int]    = None
    ) extends vd

    def vehiclesPerRouteRawFlow: Flow[vd, vd, NotUsed] =
      Flow[vd].mapAsync(parallelism = 12) {
        case vr @ VehicleRoute(route, _, _) =>
          MBTAaccess.queueRequest(
            HttpRequest(uri = MBTAaccess.mbtaUri(
              path  = "/vehicles",
              query = MBTAaccess.mbtaQuery(Map("include" -> "stop,trip", "filter[route]" -> route))
            ))
          ).flatMap {
            case HttpResponse(StatusCodes.OK, _, entity, _) =>
              MBTAaccess.parseMbtaResponse(entity).map { resp =>
                log.info("vehiclesPerRouteRawFlow({}) OK", route)
                VehiclesPerRouteRaw(
                  route       = vr,
                  rawVehicles = resp.getObjectList("data").asScala.toVector.map(_.toConfig),
                  rawIncluded = Try(resp.getObjectList("included").asScala.toVector.map(_.toConfig)).getOrElse(Vector.empty)
                )
              }
            case HttpResponse(code, _, entity, _) =>
              log.error("vehiclesPerRouteRawFlow unexpected status: {}", code)
              entity.discardBytes()
              Future.successful(VehiclesPerRouteRaw(route = vr, rawVehicles = Vector.empty))
          }
        case unexpected =>
          log.error("vehiclesPerRouteRawFlow unexpected input: {}", unexpected)
          Future.failed(new Exception(s"vehiclesPerRouteRawFlow unexpected input: $unexpected"))
      }

    def vehiclesPerRouteFlow: Flow[vd, vd, NotUsed] =
      Flow[vd].mapConcat {
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
              destination         = directionId.flatMap(id => Try(route.destinationNames(id))).toOption
            )
          }
        case unexpected =>
          log.error("vehiclesPerRouteFlow unexpected input: {}", unexpected)
          Vector.empty
      }

    def stopIdLookupFlow: Flow[vd, vd, NotUsed] =
      Flow[vd].mapAsync(parallelism = 16) {
        case vd: VehicleData =>
          vd.stopId.fold(Future.successful[vd](vd)) { stopId =>
            MBTAaccess.queueRequest(
              HttpRequest(uri = MBTAaccess.mbtaUri(s"/stops/$stopId", MBTAaccess.mbtaQuery()))
            ).flatMap {
              case HttpResponse(StatusCodes.OK, _, entity, _) =>
                MBTAaccess.parseMbtaResponse(entity).map { r =>
                  vd.copy(
                    stopName         = Try(r.getString("data.attributes.name")).toOption,
                    stopPlatformName = Try(r.getString("data.attributes.platform_name")).toOption,
                    stopZone         = Try(r.getString("data.relationships.zone.data.id")).toOption
                  )
                }
              case HttpResponse(code, _, entity, _) =>
                log.error("stopIdLookupFlow unexpected status: {} for stopId: {}", code, stopId)
                entity.discardBytes()
                Future.successful(vd)
            }
          }
        case unexpected =>
          log.error("stopIdLookupFlow unexpected input: {}", unexpected)
          Future.successful(unexpected)
      }

    def scheduleLookupFlow: Flow[vd, vd, NotUsed] =
      Flow[vd].mapAsync(parallelism = 8) {
        case vd: VehicleData =>
          (vd.tripId, vd.stopId) match {
            case (Some(tripId), Some(stopId)) =>
              MBTAaccess.queueRequest(
                HttpRequest(uri = MBTAaccess.mbtaUri(
                  path  = "/schedules",
                  query = MBTAaccess.mbtaQuery(Map("filter[trip]" -> tripId, "filter[stop]" -> stopId))
                ))
              ).flatMap {
                case HttpResponse(StatusCodes.OK, _, entity, _) =>
                  MBTAaccess.parseMbtaResponse(entity).map { resp =>
                    val schedules = resp.getObjectList("data").asScala.toVector.map(_.toConfig)
                    schedules.headOption match {
                      case Some(schedule) =>
                        val arrival   = Try(schedule.getString("attributes.arrival_time")).toOption
                        val departure = Try(schedule.getString("attributes.departure_time")).toOption
                        vd.copy(scheduledArrivalTime = arrival.orElse(departure))
                      case None =>
                        log.debug("scheduleLookupFlow: no schedules for tripId={} stopId={}", tripId, stopId)
                        vd
                    }
                  }
                case HttpResponse(code, _, entity, _) =>
                  log.error("scheduleLookupFlow unexpected status: {}", code)
                  entity.discardBytes()
                  Future.successful(vd)
              }
            case _ => Future.successful(vd)
          }
        case unexpected =>
          log.error("scheduleLookupFlow unexpected input: {}", unexpected)
          Future.successful(unexpected)
      }

    def predictionLookupFlow: Flow[vd, vd, NotUsed] =
      Flow[vd].mapAsync(parallelism = 8) {
        case vd: VehicleData =>
          vd.tripId.fold(Future.successful[vd](vd)) { tripId =>
            MBTAaccess.queueRequest(
              HttpRequest(uri = MBTAaccess.mbtaUri(
                path  = "/predictions",
                query = MBTAaccess.mbtaQuery(Map("filter[trip]" -> tripId))
              ))
            ).flatMap {
              case HttpResponse(StatusCodes.OK, _, entity, _) =>
                MBTAaccess.parseMbtaResponse(entity).map { resp =>
                  val predictions = resp.getObjectList("data").asScala.toVector.map(_.toConfig)

                  val prediction = predictions
                    .find(p => Try(p.getString("relationships.stop.data.id")).toOption == vd.stopId)
                    .orElse(predictions.headOption)

                  prediction match {
                    case Some(pred) =>
                      val predicted = Try(pred.getString("attributes.arrival_time")).toOption
                      val delay = for {
                        predTime  <- predicted
                        schedTime <- vd.scheduledArrivalTime
                        secs      <- Try(java.time.Duration.between(
                                       java.time.Instant.parse(schedTime),
                                       java.time.Instant.parse(predTime)
                                     ).getSeconds.toInt).toOption
                      } yield secs
                      vd.copy(predictedArrivalTime = predicted, delaySeconds = delay)
                    case None =>
                      log.debug("predictionLookupFlow: no predictions for tripId={}", tripId)
                      vd
                  }
                }
              case HttpResponse(code, _, entity, _) =>
                log.error("predictionLookupFlow unexpected status: {}", code)
                entity.discardBytes()
                Future.successful(vd)
            }
          }
        case unexpected =>
          log.error("predictionLookupFlow unexpected input: {}", unexpected)
          Future.successful(unexpected)
      }

    private def toRouteInfo(r: Config): JsonProtocol.RouteInfo =
      JsonProtocol.RouteInfo(
        id         = r.getString("id"),
        long_name  = r.getString("attributes.long_name"),
        short_name = r.getString("attributes.short_name"),
        color      = r.getString("attributes.color"),
        text_color = r.getString("attributes.text_color"),
        route_type = r.getInt("attributes.type")
      )

    def fetchRoutesOnDemand(typeFilter: Option[String]): Future[Vector[JsonProtocol.RouteInfo]] =
      MBTAaccess.queueRequest(
        HttpRequest(uri = MBTAaccess.mbtaUri(
          path  = "/routes",
          query = MBTAaccess.mbtaQuery(Map("filter[type]" -> typeFilter.getOrElse("0,1,2,3")))
        ))
      ).flatMap {
        case HttpResponse(StatusCodes.OK, _, entity, _) =>
          MBTAaccess.parseMbtaResponse(entity).map {
            _.getObjectList("data").asScala.toVector.map(r => toRouteInfo(r.toConfig))
          }
        case HttpResponse(code, _, entity, _) =>
          log.error("fetchRoutesOnDemand unexpected status: {}", code)
          entity.discardBytes()
          Future.successful(Vector.empty)
      }

    def fetchStops(routeId: String): Future[Vector[JsonProtocol.StopInfo]] =
      MBTAaccess.queueRequest(
        HttpRequest(uri = MBTAaccess.mbtaUri(
          path  = "/stops",
          query = MBTAaccess.mbtaQuery(Map("filter[route]" -> routeId))
        ))
      ).flatMap {
        case HttpResponse(StatusCodes.OK, _, entity, _) =>
          MBTAaccess.parseMbtaResponse(entity).map { response =>
            response.getObjectList("data").asScala.toVector.map { stop =>
              val s = stop.toConfig
              JsonProtocol.StopInfo(
                id        = s.getString("id"),
                name      = s.getString("attributes.name"),
                latitude  = s.getDouble("attributes.latitude"),
                longitude = s.getDouble("attributes.longitude")
              )
            }
          }
        case HttpResponse(code, _, entity, _) =>
          log.error("fetchStops unexpected status: {} for routeId: {}", code, routeId)
          entity.discardBytes()
          Future.successful(Vector.empty)
      }

    def fetchVehiclesForRoute(routeId: String, sortBy: String = "vehicleId", sortOrder: String = "asc"): Future[Vector[VehicleData]] =
      MBTAaccess.queueRequest(
        HttpRequest(uri = MBTAaccess.mbtaUri(
          path  = s"/routes/$routeId",
          query = MBTAaccess.mbtaQuery()
        ))
      ).flatMap {
        case HttpResponse(StatusCodes.OK, _, entity, _) =>
          MBTAaccess.parseMbtaResponse(entity).flatMap { response =>
            val route            = response.getConfig("data")
            val directionNames   = Try(route.getStringList("attributes.direction_names").asScala.toVector).getOrElse(Vector.empty)
            val destinationNames = Try(route.getStringList("attributes.direction_destinations").asScala.toVector).getOrElse(Vector.empty)

            Source.single(VehicleRoute(routeId, directionNames, destinationNames))
              .via(vehiclesPerRouteRawFlow)
              .via(vehiclesPerRouteFlow)
              .via(stopIdLookupFlow)
              .via(scheduleLookupFlow)
              .via(predictionLookupFlow)
              .runWith(Sink.seq)
              .map(_.toVector.collect { case vd: VehicleData => vd })
              .map(sortVehicles(_, sortBy, sortOrder))
          }
        case HttpResponse(code, _, entity, _) =>
          log.error("fetchVehiclesForRoute unexpected status: {} for routeId: {}", code, routeId)
          entity.discardBytes()
          Future.successful(Vector.empty)
      }

    def fetchShapes(routeId: String): Future[Vector[JsonProtocol.ShapeInfo]] =
      MBTAaccess.queueRequest(
        HttpRequest(uri = MBTAaccess.mbtaUri(
          path  = "/shapes",
          query = MBTAaccess.mbtaQuery(Map("filter[route]" -> routeId))
        ))
      ).flatMap {
        case HttpResponse(StatusCodes.OK, _, entity, _) =>
          MBTAaccess.parseMbtaResponse(entity).map { response =>
            response.getObjectList("data").asScala.toVector.map { shape =>
              val s = shape.toConfig
              JsonProtocol.ShapeInfo(id = s.getString("id"), polyline = s.getString("attributes.polyline"))
            }
          }
        case HttpResponse(code, _, entity, _) =>
          log.error("fetchShapes unexpected status: {} for routeId: {}", code, routeId)
          entity.discardBytes()
          Future.successful(Vector.empty)
      }

    private def sortVehicles(vehicles: Vector[VehicleData], sortBy: String, sortOrder: String): Vector[VehicleData] = {
      val ascending = sortOrder.toLowerCase == "asc"
      sortBy.toLowerCase match {
        case "tripid" =>
          vehicles.sortWith { (a, b) =>
            val av = a.tripId.getOrElse(a.vehicleId.getOrElse(""))
            val bv = b.tripId.getOrElse(b.vehicleId.getOrElse(""))
            if (ascending) av < bv else av > bv
          }
        case _ =>
          vehicles.sortWith { (a, b) =>
            val av = a.vehicleId.getOrElse("")
            val bv = b.vehicleId.getOrElse("")
            if (ascending) av < bv else av > bv
          }
      }
    }
  }

  def receive: PartialFunction[Any, Unit] = {
    case event => log.error("Unexpected event: {}", event)
  }
}
