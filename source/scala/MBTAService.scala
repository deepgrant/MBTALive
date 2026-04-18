package mbta.actor

import mbta.actor.ModelAPIResponse._
import mbta.actor.ModelData._
import org.apache.pekko
import spray.json._

import scala.concurrent.duration._
import scala.util.Failure
import scala.util.Success

import pekko.actor.{Actor, ActorLogging, ActorSystem}
import pekko.event.LoggingAdapter
import pekko.http.scaladsl.Http
import pekko.http.scaladsl.marshalling.Marshaller
import pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpMethods, StatusCodes}
import pekko.http.scaladsl.model.headers._
import pekko.http.scaladsl.server.Directives._
import pekko.http.scaladsl.server.Route
import pekko.util.Timeout

class MBTAService extends Actor with ActorLogging {
  import context.dispatcher

  implicit val system:  ActorSystem    = context.system  // use context.system — never create a second ActorSystem
  implicit val logger:  LoggingAdapter = log
  implicit val timeout: Timeout        = 30.seconds

  private val access = new MBTAAccess()
  private val flow   = new RequestFlow(access)

  // ── JSON serialization ────────────────────────────────────────────────────

  object JsonProtocol extends DefaultJsonProtocol {
    implicit val routeInfoFormat:   RootJsonFormat[RouteInfo]   = jsonFormat6(RouteInfo.apply)
    implicit val stopInfoFormat:    RootJsonFormat[StopInfo]    = jsonFormat4(StopInfo.apply)
    implicit val shapeInfoFormat:   RootJsonFormat[ShapeInfo]   = jsonFormat4(ShapeInfo.apply)
    implicit val vehicleDataFormat: RootJsonFormat[VehicleData] = new RootJsonFormat[VehicleData] {
      def write(v: VehicleData): JsValue = JsObject(
        "routeId"              -> v.routeId.toJson,
        "vehicleId"            -> v.vehicleId.toJson,
        "stopId"               -> v.stopId.toJson,
        "tripId"               -> v.tripId.toJson,
        "tripName"             -> v.tripName.toJson,
        "bearing"              -> v.bearing.toJson,
        "directionId"          -> v.directionId.toJson,
        "currentStatus"        -> v.currentStatus.toJson,
        "currentStopSequence"  -> v.currentStopSequence.toJson,
        "latitude"             -> v.latitude.toJson,
        "longitude"            -> v.longitude.toJson,
        "speed"                -> v.speed.toJson,
        "updatedAt"            -> v.updatedAt.toJson,
        "stopName"             -> v.stopName.toJson,
        "stopPlatformName"     -> v.stopPlatformName.toJson,
        "stopZone"             -> v.stopZone.toJson,
        "timeStamp"            -> v.timeStamp.toJson,
        "direction"            -> v.direction.toJson,
        "destination"          -> v.destination.toJson,
        "predictedArrivalTime" -> v.predictedArrivalTime.toJson,
        "scheduledArrivalTime" -> v.scheduledArrivalTime.toJson,
        "delaySeconds"         -> v.delaySeconds.toJson,
        "formattedStatus"      -> v.formattedStatus.toJson,
        "delayStatus"          -> v.delayStatus.toJson,
      )
      def read(json: JsValue): VehicleData = deserializationError("VehicleData read not supported")
    }

    private def jsonMarshaller[A: JsonFormat]: Marshaller[Vector[A], HttpEntity.Strict] =
      Marshaller.withFixedContentType(ContentTypes.`application/json`) { xs =>
        HttpEntity(ContentTypes.`application/json`, xs.toJson.compactPrint)
      }

    implicit val alertInfoFormat: RootJsonFormat[AlertInfo] = jsonFormat9(AlertInfo.apply)

    implicit val routeInfoListMarshaller:   Marshaller[Vector[RouteInfo],   HttpEntity.Strict] = jsonMarshaller[RouteInfo]
    implicit val stopInfoListMarshaller:    Marshaller[Vector[StopInfo],    HttpEntity.Strict] = jsonMarshaller[StopInfo]
    implicit val shapeInfoListMarshaller:   Marshaller[Vector[ShapeInfo],   HttpEntity.Strict] = jsonMarshaller[ShapeInfo]
    implicit val stringListMarshaller:      Marshaller[Vector[String],      HttpEntity.Strict] = jsonMarshaller[String]
    implicit val vehicleDataListMarshaller: Marshaller[Vector[VehicleData], HttpEntity.Strict] = jsonMarshaller[VehicleData]
    implicit val alertInfoListMarshaller:   Marshaller[Vector[AlertInfo],   HttpEntity.Strict] = jsonMarshaller[AlertInfo]
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  override def preStart(): Unit = {
    access.runQ
    startHttpServer()
  }

  private def startHttpServer(): Unit =
    Http().newServerAt("0.0.0.0", 8080).bind(createApiRoutes()).onComplete {
      case Success(_)         => log.info("Server online at http://0.0.0.0:8080/")
      case Failure(exception) => log.error("Failed to bind HTTP server: {}", exception)
    }

  // ── HTTP routes ───────────────────────────────────────────────────────────

  private def createApiRoutes(): Route = {
    import JsonProtocol._

    val corsHeaders = List(
      `Access-Control-Allow-Origin`.*,
      `Access-Control-Allow-Methods`(HttpMethods.GET, HttpMethods.POST, HttpMethods.OPTIONS),
      `Access-Control-Allow-Headers`("Content-Type", "Authorization"),
    )

    respondWithHeaders(corsHeaders) {
      concat(
        options { complete(StatusCodes.OK) },
        pathPrefix("api") {
          concat(
            path("routes") {
              get {
                parameter("type".optional) { typeFilter =>
                  onSuccess(flow.fetchRoutesOnDemand(typeFilter)) { complete(_) }
                }
              }
            },
            path("route" / Segment / "stops") { routeId =>
              get {
                onSuccess(flow.fetchStops(routeId)) { complete(_) }
              }
            },
            path("route" / Segment / "vehicles") { routeId =>
              get {
                parameter("sortBy".optional, "sortOrder".optional) { (sortByOpt, sortOrderOpt) =>
                  val sortBy    = sortByOpt.getOrElse("vehicleId")
                  val sortOrder = sortOrderOpt.getOrElse("asc")
                  onSuccess(flow.fetchVehiclesForRoute(routeId, sortBy, sortOrder)) { complete(_) }
                }
              }
            },
            path("route" / Segment / "shapes") { routeId =>
              get {
                onSuccess(flow.fetchShapes(routeId)) { complete(_) }
              }
            },
            path("route" / Segment / "alerts") { routeId =>
              get {
                onSuccess(flow.fetchAlertsForRoute(routeId)) { complete(_) }
              }
            },
            path("alerts") {
              get {
                onSuccess(flow.fetchAlertsGlobal()) { complete(_) }
              }
            },
          )
        }
      )
    }
  }

  def receive: PartialFunction[Any, Unit] = {
    case event => log.error("Unexpected event: {}", event)
  }
}
