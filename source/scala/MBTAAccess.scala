package mbta.actor

import com.typesafe.config.Config
import com.typesafe.config.ConfigFactory
import org.apache.pekko

import scala.concurrent.ExecutionContext
import scala.concurrent.Future
import scala.concurrent.Promise
import scala.concurrent.duration._
import scala.util.Failure
import scala.util.Success
import scala.util.Try

import pekko.actor.ActorSystem
import pekko.event.LoggingAdapter
import pekko.http.scaladsl.Http
import pekko.http.scaladsl.model._
import pekko.http.scaladsl.settings.ConnectionPoolSettings
import pekko.stream.{Materializer, SystemMaterializer}
import pekko.stream.OverflowStrategy
import pekko.stream.scaladsl.{Sink, Source, SourceQueueWithComplete}

class MBTAAccess(implicit system: ActorSystem, log: LoggingAdapter) {
  private implicit val ec:  ExecutionContext = system.dispatcher
  private implicit val mat: Materializer    = SystemMaterializer(system).materializer

  private val transportSettings: ConnectionPoolSettings = ConnectionPoolSettings(system)
    .withMaxConnections(4)
    .withMaxOpenRequests(256)
    .withPipeliningLimit(64)

  private var queue: Option[SourceQueueWithComplete[(HttpRequest, Promise[HttpResponse])]] = None

  def runQ: Future[pekko.Done] = {
    val (q, source) = Source
      .queue[(HttpRequest, Promise[HttpResponse])](bufferSize = 256, overflowStrategy = OverflowStrategy.backpressure)
      .preMaterialize()

    queue = Some(q)
    log.info("MBTA request queue started: {} req/{}", MBTAConfig.maxRequestsPerPeriod, MBTAConfig.maxRequestsWindow)

    source
      .throttle(MBTAConfig.maxRequestsPerPeriod, MBTAConfig.maxRequestsWindow)
      .via(
        Http().newHostConnectionPoolHttps[Promise[HttpResponse]](
          host     = "api-v3.mbta.com",
          port     = 443,
          settings = transportSettings,
          log      = log)
      )
      .map { case (tryResponse, promise) =>
        promise.completeWith {
          tryResponse.map { response =>
            response.entity
              .withoutSizeLimit()
              .toStrict(60.seconds)
              .map(response.withEntity(_))
          }.recover { case t =>
            log.error("queue recover: {}", t)
            Future.failed(t)
          }.getOrElse {
            Future.failed(new IllegalStateException("Empty response from MBTA host pool"))
          }
        }
      }
      .runWith(Sink.ignore)
      .andThen {
        case Success(_) => log.error("MBTAAccess.runQ stopped with unexpected normal termination.")
        case Failure(t) => log.error(t, "MBTAAccess.runQ stopped")
      }
      .transformWith { _ =>
        log.warning("MBTAAccess.runQ restarting")
        runQ
      }
  }

  def mbtaQuery(query: Map[String, String] = Map.empty): Option[String] =
    MBTAConfig.apiKey
      .map(key => Uri.Query(query + ("api_key" -> key)).toString)
      .orElse(Try(Uri.Query(query).toString))
      .toOption

  def mbtaUri(path: String, query: Option[String] = None): Uri = Uri(
    scheme      = "https",
    path        = Uri.Path(path),
    queryString = query,
    fragment    = None
  )

  def queueRequest(request: HttpRequest): Future[HttpResponse] = {
    val promise = Promise[HttpResponse]()
    queue.map { q =>
      q.offer((request, promise))
        .flatMap(_ => promise.future)
        .recover { case e: Exception =>
          log.error(e, "MBTAAccess.queueRequest failed")
          HttpResponse(StatusCodes.InternalServerError)
        }
        .andThen {
          case Success(response) => log.debug("[RESPONSE] queueRequest({}) -> {}", request, response)
          case Failure(t)        => log.error("[RESPONSE] queueRequest({}) -> {}", request, t)
        }
    }.getOrElse {
      Future.failed(new Exception("MBTAAccess.queueRequest: no queue available"))
    }
  }

  def parseMbtaResponse(entity: HttpEntity): Future[Config] =
    entity
      .withoutSizeLimit
      .toStrict(60.seconds)
      .map(strict => ConfigFactory.parseString(strict.data.utf8String))
      .recover { case e =>
        log.error("parseMbtaResponse failed: {}", e)
        ConfigFactory.empty
      }
}
