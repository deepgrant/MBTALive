package mbta.snapshot

import com.amazonaws.services.lambda.runtime.Context
import com.amazonaws.services.lambda.runtime.RequestStreamHandler
import software.amazon.awssdk.services.dynamodb.DynamoDbClient
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient
import spray.json._

import java.io.InputStream
import java.io.OutputStream
import java.net.http.HttpClient
import java.nio.charset.StandardCharsets
import scala.util.control.NonFatal

final class MBTASnapshotLambda extends RequestStreamHandler {
  private lazy val config = SnapshotConfig.fromEnv()
  private lazy val s3 = S3Client.create()
  private lazy val dynamo = DynamoDbClient.create()
  private lazy val secrets = SecretsManagerClient.create()
  private lazy val secret = new SecretApiKey(secrets, config.apiSecretArn)
  private lazy val store = new S3SnapshotStore(s3, config.snapshotBucket)
  private lazy val control = new DynamoControlStore(
    dynamo,
    config.controlTable,
    config.safeLimit,
    config.burstCapacity,
  )
  private lazy val mbta = new RateLimitedMbtaClient(HttpClient.newHttpClient(), control, () => secret.value)
  private lazy val services = new SnapshotServices(config, store, control, mbta)

  override def handleRequest(input: InputStream, output: OutputStream, context: Context): Unit = {
    val event = String(input.readAllBytes(), StandardCharsets.UTF_8)
    val response = try route(event.parseJson.asJsObject)
    catch {
      case NonFatal(e) =>
        Metrics.emit("LambdaHandlerFailure", 1, Map("error" -> e.getClass.getSimpleName))
        proxyResponse(500, JsObject("error" -> JsString(Option(e.getMessage).getOrElse("internal error"))))
    }
    output.write(response.compactPrint.getBytes(StandardCharsets.UTF_8))
  }

  private def route(event: JsObject): JsValue = event.fields.get("action") match {
    case Some(JsString("vehicle-refresh"))   => services.vehicleRefresh()
    case Some(JsString("board-refresh"))     => services.boardRefresh()
    case Some(JsString("alert-refresh"))     => services.alertRefresh()
    case Some(JsString("reference-refresh")) => services.referenceRefresh()
    case Some(JsString("route-refresh"))     => services.routeRefresh()
    case Some(JsString("snapshot-smoke"))    => services.smoke()
    case _ if isApiGateway(event)             => routeApi(event)
    case _ => JsObject("status" -> JsString("ignored"))
  }

  private def routeApi(event: JsObject): JsValue = {
    val path = event.fields.get("rawPath").collect { case JsString(v) => v }.getOrElse("")
    val method = event.fields.get("requestContext")
      .collect { case value: JsObject => value }
      .flatMap(_.fields.get("http"))
      .collect { case value: JsObject => value }
      .flatMap(_.fields.get("method"))
      .collect { case JsString(v) => v.toUpperCase }
      .getOrElse("")
    val RouteActivity = "^/api/control/routes/([A-Za-z0-9._-]{1,128})/activity$".r
    (method, path) match {
      case ("OPTIONS", _) => proxyResponse(204, JsObject.empty)
      case ("PUT", RouteActivity(routeId)) =>
        services.activate(routeId) match {
          case Left(error) => proxyResponse(404, JsObject("error" -> JsString(error)))
          case Right(result) => proxyResponse(200, JsObject(
            "routeId" -> JsString(routeId),
            "activeUntil" -> JsString(result.activeUntil.toString),
          ))
        }
      case _ => proxyResponse(404, JsObject("error" -> JsString(s"No route for $method $path")))
    }
  }

  private def isApiGateway(event: JsObject): Boolean = event.fields.contains("requestContext")

  private def proxyResponse(status: Int, body: JsValue): JsObject = JsObject(
    "statusCode" -> JsNumber(status),
    "headers" -> JsObject(
      "content-type" -> JsString("application/json"),
      "cache-control" -> JsString("no-store"),
    ),
    "body" -> JsString(body.compactPrint),
    "isBase64Encoded" -> JsBoolean(false),
  )
}
