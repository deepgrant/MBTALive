package mbta.actor

import com.typesafe.config.Config
import com.typesafe.config.ConfigFactory
import org.apache.commons.io.IOUtils
import org.apache.pekko
import spray.json._

import scala.concurrent.Future
import scala.concurrent.Promise
import scala.concurrent.duration.FiniteDuration
import scala.concurrent.duration._
import scala.jdk.CollectionConverters._
import scala.util.Failure
import scala.util.Success
import scala.util.Try

import pekko.actor._
import pekko.Done
import pekko.event.Logging
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
  Keep,
  Flow,
  Sink,
  Source,
  SourceQueueWithComplete
}
import pekko.http.scaladsl.settings.ConnectionPoolSettings
import org.apache.pekko.event.LoggingAdapter

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

  // In-memory cache for API data
  private var cachedRoutes: Vector[Config] = Vector.empty
  private var cachedVehicles: Vector[RequestFlow.VehicleData] = Vector.empty

  object Config {
    lazy val config: Try[Config] = Try {
      ConfigFactory.parseString(
        sys.env.get("MBTA_CONFIG").getOrElse {
          val resource = getClass.getClassLoader.getResourceAsStream("MBTA.conf")
          val source   = IOUtils.toString(resource, java.nio.charset.Charset.forName("UTF8"))
          resource.close
          source
        }
      )
    }.recover {
      case e: Throwable =>
        log.warning("MBTAService.Config.config -- was not processed successfully -- {}", e)
        ConfigFactory.empty
    }

    def ApiKey : Try[String] = {
      config.flatMap {
        config => {
          Try {
            config.getString("mbta.api")
          }.recoverWith {
            case _ => Try {
              sys.env("MBTA_API_KEY")
            }
          }
        }
      }
    }

    def maxRequestsPerPeriod : Int = {
      ApiKey.map { _ => 1000 }.getOrElse(10)
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
    Config.config.map { config =>
      log.info(MBTAService.pp(config))
    }
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

  def createApiRoutes(): Route = {
    val corsHeaders = List(
      `Access-Control-Allow-Origin`.*,
      `Access-Control-Allow-Methods`(HttpMethods.GET, HttpMethods.OPTIONS),
      `Access-Control-Allow-Headers`("Content-Type", "Authorization")
    )

    concat(
      options {
        complete(HttpResponse(200).withHeaders(corsHeaders))
      },
      path("api" / "routes") {
        get {
          val routeData = cachedRoutes.map(route => 
            s"""{"id":"${route.getString("id")}","long_name":"${route.getString("attributes.long_name")}","short_name":"${route.getString("attributes.short_name")}","color":"${route.getString("attributes.color")}","text_color":"${route.getString("attributes.text_color")}"}"""
          )
          val jsonString = s"[${routeData.mkString(",")}]"
          complete(HttpResponse(entity = HttpEntity(ContentTypes.`application/json`, jsonString)))
        }
      },
      path("api" / "vehicles") {
        get {
          val vehicleData = cachedVehicles.map(vehicle => 
            s"""{"routeId":"${vehicle.routeId}","vehicleId":"${vehicle.vehicleId.getOrElse("")}","latitude":${vehicle.latitude.getOrElse(0.0)},"longitude":${vehicle.longitude.getOrElse(0.0)},"bearing":${vehicle.bearing.getOrElse(0)},"speed":${vehicle.speed.getOrElse(0.0)},"direction":"${vehicle.direction.getOrElse("")}","destination":"${vehicle.destination.getOrElse("")}","currentStatus":"${vehicle.currentStatus.getOrElse("")}","updatedAt":"${vehicle.updatedAt.getOrElse("")}"}"""
          )
          val jsonString = s"[${vehicleData.mkString(",")}]"
          complete(HttpResponse(entity = HttpEntity(ContentTypes.`application/json`, jsonString)))
        }
      },
      path("api" / "vehicles" / Segment) { routeId =>
        get {
          val routeVehicles = cachedVehicles.filter(_.routeId == routeId)
          val vehicleData = routeVehicles.map(vehicle => 
            s"""{"routeId":"${vehicle.routeId}","vehicleId":"${vehicle.vehicleId.getOrElse("")}","latitude":${vehicle.latitude.getOrElse(0.0)},"longitude":${vehicle.longitude.getOrElse(0.0)},"bearing":${vehicle.bearing.getOrElse(0)},"speed":${vehicle.speed.getOrElse(0.0)},"direction":"${vehicle.direction.getOrElse("")}","destination":"${vehicle.destination.getOrElse("")}","currentStatus":"${vehicle.currentStatus.getOrElse("")}","updatedAt":"${vehicle.updatedAt.getOrElse("")}"}"""
          )
          val jsonString = s"[${vehicleData.mkString(",")}]"
          complete(HttpResponse(entity = HttpEntity(ContentTypes.`application/json`, jsonString)))
        }
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

    def updateCache : Flow[vd, vd, NotUsed] = {
      Flow[vd]
        .map {
          case v: VehicleData =>
            // Update cached vehicles
            cachedVehicles = cachedVehicles.filterNot(_.vehicleId == v.vehicleId) :+ v
            v
          case _ => VehicleDataNull()
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
                cachedRoutes = routes
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

    def runFetchFlows : Future[Done] = {
      Source
        .single(FetchRoutes())
        .via(fetchRoutes)
        .groupBy(maxSubstreams = 128, f = { case rid => rid })
        .via(vehiclesPerRouteRawFlow)
        .via(vehiclesPerRouteFlow)
        .via(stopIdLookupFlow)
        .via(updateCache)
        .mergeSubstreams
        .toMat(Sink.foreach {
          case v: VehicleData => log.debug(s"Updated vehicle: ${v.vehicleId.getOrElse("unknown")}")
          case _ =>
        })(Keep.right)
        .run()
    }

    def runRF: Future[Done] = {
      Source
        .tick(initialDelay = FiniteDuration(1, "seconds"), interval = Config.updatePeriod, tick = TickRoutes)
        .buffer(size = 1, overflowStrategy = OverflowStrategy.dropHead)
        .mapAsync[Done](parallelism = 1) { _ =>
          runFetchFlows
        }
        .toMat(Sink.ignore)(Keep.right)
        .run()
    }
  }

  RequestFlow.runRF

  def receive: PartialFunction[Any,Unit] = {
    case event =>
      log.error("Unexpected event={}", event.toString)
  }
}

object MBTAService {
  def pp(x: Any): String = pprint.PPrinter.Color.tokenize(x, width = 512, height = 1000).mkString

  object Request {
    sealed trait T
  }

  object Response {
    sealed trait T
  }
}