package mbta.snapshot

import software.amazon.awssdk.core.sync.RequestBody
import software.amazon.awssdk.services.dynamodb.DynamoDbClient
import software.amazon.awssdk.services.dynamodb.model._
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.model.GetObjectRequest
import software.amazon.awssdk.services.s3.model.NoSuchKeyException
import software.amazon.awssdk.services.s3.model.PutObjectRequest
import software.amazon.awssdk.services.s3.model.S3Exception
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient
import software.amazon.awssdk.services.secretsmanager.model.GetSecretValueRequest
import spray.json._

import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.time.Instant
import scala.jdk.CollectionConverters._
import scala.util.control.NonFatal

final case class StoredObject(body: String, lastModified: Instant)

trait SnapshotStore {
  def get(key: String): Option[StoredObject]
  def put(key: String, body: String, cacheControl: String): Unit
}

final class S3SnapshotStore(client: S3Client, bucket: String) extends SnapshotStore {
  override def get(key: String): Option[StoredObject] =
    try {
      val response = client.getObject(GetObjectRequest.builder().bucket(bucket).key(key).build())
      Some(StoredObject(String(response.readAllBytes(), StandardCharsets.UTF_8), response.response().lastModified()))
    } catch {
      case _: NoSuchKeyException => None
      case e: S3Exception if e.statusCode() == 404 => None
    }

  override def put(key: String, body: String, cacheControl: String): Unit = {
    val request = PutObjectRequest.builder()
      .bucket(bucket)
      .key(key)
      .contentType("application/json")
      .cacheControl(cacheControl)
      .build()
    client.putObject(request, RequestBody.fromString(body, StandardCharsets.UTF_8))
  }
}

final case class ActivationResult(wasInactive: Boolean, activeUntil: Instant)

trait ControlStore {
  def activeRoutes(now: Instant): Vector[String]
  def activate(routeId: String, now: Instant, ttlSeconds: Long): ActivationResult
  def acquirePermit(now: Instant): Boolean
  def observeRate(limit: Option[Int], remaining: Option[Int], resetEpoch: Option[Long], throttled: Boolean): Unit
  def tryJobLock(job: String, slot: Long, now: Instant, ttlSeconds: Long): Boolean
  def releaseJobLock(job: String, slot: Long): Unit
  def recordSuccess(dataset: String, at: Instant): Unit
  def status(now: Instant, activeRouteCount: Int): SnapshotStatus
}

final class DynamoControlStore(
  client: DynamoDbClient,
  table: String,
  configuredSafeLimit: Int,
  configuredBurst: Int,
) extends ControlStore {
  private val Pk = "pk"

  override def activeRoutes(now: Instant): Vector[String] = {
    val response = client.scan(ScanRequest.builder()
      .tableName(table)
      .filterExpression("begins_with(#pk, :prefix) AND activeUntil > :now")
      .expressionAttributeNames(Map("#pk" -> Pk).asJava)
      .expressionAttributeValues(Map(
        ":prefix" -> AttributeValue.builder().s("ACTIVE#").build(),
        ":now" -> n(now.getEpochSecond),
      ).asJava)
      .projectionExpression("#pk")
      .build())
    response.items().asScala.toVector.flatMap { item =>
      Option(item.get(Pk)).map(_.s()).filter(_.startsWith("ACTIVE#")).map(_.stripPrefix("ACTIVE#"))
    }.sorted
  }

  override def activate(routeId: String, now: Instant, ttlSeconds: Long): ActivationResult = {
    val until = now.plusSeconds(ttlSeconds)
    val response = client.updateItem(UpdateItemRequest.builder()
      .tableName(table)
      .key(key(s"ACTIVE#$routeId"))
      .updateExpression("SET activeUntil = :until, expiresAt = :expires")
      .expressionAttributeValues(Map(
        ":until" -> n(until.getEpochSecond),
        ":expires" -> n(until.plusSeconds(300).getEpochSecond),
      ).asJava)
      .returnValues(ReturnValue.ALL_OLD)
      .build())
    val oldUntil = Option(response.attributes().get("activeUntil")).flatMap(v => Option(v.n())).flatMap(_.toLongOption)
    ActivationResult(oldUntil.forall(_ <= now.getEpochSecond), until)
  }

  override def acquirePermit(now: Instant): Boolean = {
    val nowMs = now.toEpochMilli
    (0 until 4).exists { attempt =>
      try {
        val response = client.getItem(GetItemRequest.builder()
          .tableName(table).key(key("RATE#MBTA")).consistentRead(true).build())
        val item = response.item()
        val version = attrLong(item, "version").getOrElse(0L)
        val lastMs = attrLong(item, "lastRefillMs").getOrElse(nowMs)
        val oldTokens = attrLong(item, "tokensMilli").getOrElse(configuredBurst.toLong * 1000L)
        val blockedUntil = attrLong(item, "blockedUntil").getOrElse(0L)
        val observedLimit = attrLong(item, "observedLimit").map(_.toInt)
        val effectiveLimit = observedLimit.map(v => math.min(configuredSafeLimit, math.floor(v * 0.8).toInt))
          .getOrElse(configuredSafeLimit)
        val policy = TokenBucketPolicy(effectiveLimit, configuredBurst)
        val current = TokenBucketState(oldTokens, lastMs, blockedUntil)

        TokenBucket.acquire(current, policy, nowMs, now.getEpochSecond) match {
          case None => false
          case Some(nextState) =>
            val names = Map("#version" -> "version").asJava
            val baseValues = Map(
              ":tokens" -> n(nextState.tokensMilli),
              ":now" -> n(nowMs),
              ":next" -> n(version + 1L),
            )
            val values = (if (item.isEmpty) baseValues else baseValues + (":expected" -> n(version))).asJava
            val condition = if (item.isEmpty) "attribute_not_exists(#version)" else "#version = :expected"
            client.updateItem(UpdateItemRequest.builder()
              .tableName(table)
              .key(key("RATE#MBTA"))
              .updateExpression("SET tokensMilli = :tokens, lastRefillMs = :now, #version = :next")
              .conditionExpression(condition)
              .expressionAttributeNames(names)
              .expressionAttributeValues(values)
              .build())
            Metrics.emit("MbtaPermitGranted", 1, Map("attempt" -> attempt.toString))
            true
        }
      } catch {
        case _: ConditionalCheckFailedException => false
        case NonFatal(e) =>
          Metrics.emit("MbtaPermitStoreFailure", 1, Map(
            "error" -> e.getClass.getSimpleName,
            "message" -> Option(e.getMessage).getOrElse("").take(240),
          ))
          false
      }
    }
  }

  override def observeRate(
    limit: Option[Int],
    remaining: Option[Int],
    resetEpoch: Option[Long],
    throttled: Boolean,
  ): Unit = try {
    val sets = Vector(
      limit.map(_ => "observedLimit = :limit"),
      remaining.map(_ => "observedRemaining = :remaining"),
      resetEpoch.map(_ => "observedReset = :reset"),
      Option.when(throttled)("blockedUntil = :blocked"),
    ).flatten
    if (sets.nonEmpty) {
      val values = Map.newBuilder[String, AttributeValue]
      limit.foreach(v => values += ":limit" -> n(v))
      remaining.foreach(v => values += ":remaining" -> n(v))
      resetEpoch.foreach(v => values += ":reset" -> n(v))
      if (throttled) values += ":blocked" -> n(resetEpoch.getOrElse(Instant.now().plusSeconds(60).getEpochSecond))
      client.updateItem(UpdateItemRequest.builder()
        .tableName(table).key(key("RATE#MBTA"))
        .updateExpression(s"SET ${sets.mkString(", ")}")
        .expressionAttributeValues(values.result().asJava)
        .build())
    }
  } catch {
    case NonFatal(e) => Metrics.emit("MbtaRateObservationFailure", 1, Map("error" -> e.getClass.getSimpleName))
  }

  override def tryJobLock(job: String, slot: Long, now: Instant, ttlSeconds: Long): Boolean =
    try {
      client.putItem(PutItemRequest.builder()
        .tableName(table)
        .item(Map(
          Pk -> AttributeValue.builder().s(s"LOCK#$job#$slot").build(),
          "expiresAt" -> n(now.plusSeconds(ttlSeconds).getEpochSecond),
        ).asJava)
        .conditionExpression("attribute_not_exists(#pk) OR #expiresAt < :now")
        .expressionAttributeNames(Map("#pk" -> Pk, "#expiresAt" -> "expiresAt").asJava)
        .expressionAttributeValues(Map(":now" -> n(now.getEpochSecond)).asJava)
        .build())
      true
    } catch {
      case _: ConditionalCheckFailedException => false
      case NonFatal(e) =>
        Metrics.emit("JobLockFailure", 1, Map("job" -> job, "error" -> e.getClass.getSimpleName))
        false
    }

  override def releaseJobLock(job: String, slot: Long): Unit =
    client.deleteItem(DeleteItemRequest.builder()
      .tableName(table)
      .key(key(s"LOCK#$job#$slot"))
      .build())

  override def recordSuccess(dataset: String, at: Instant): Unit =
    client.updateItem(UpdateItemRequest.builder()
      .tableName(table).key(key("STATUS"))
      .updateExpression("SET #field = :at")
      .expressionAttributeNames(Map("#field" -> s"${dataset}LastSuccess").asJava)
      .expressionAttributeValues(Map(":at" -> AttributeValue.builder().s(at.toString).build()).asJava)
      .build())

  override def status(now: Instant, activeRouteCount: Int): SnapshotStatus = {
    val item = client.getItem(GetItemRequest.builder().tableName(table).key(key("STATUS")).consistentRead(true).build()).item()
    def at(name: String): Option[String] = Option(item.get(name)).flatMap(v => Option(v.s()))
    val vehicles = at("vehiclesLastSuccess")
    SnapshotStatus(
      status                = if (vehicles.isDefined) "ok" else "warming",
      generatedAt           = now.toString,
      vehiclesLastSuccess   = vehicles,
      boardsLastSuccess     = at("boardsLastSuccess"),
      alertsLastSuccess     = at("alertsLastSuccess"),
      referencesLastSuccess = at("referencesLastSuccess"),
      activeRouteCount      = activeRouteCount,
    )
  }

  private def key(value: String): java.util.Map[String, AttributeValue] =
    Map(Pk -> AttributeValue.builder().s(value).build()).asJava
  private def n(value: Long): AttributeValue = AttributeValue.builder().n(value.toString).build()
  private def attrLong(item: java.util.Map[String, AttributeValue], name: String): Option[Long] =
    Option(item).flatMap(m => Option(m.get(name))).flatMap(v => Option(v.n())).flatMap(_.toLongOption)
}

final case class MbtaHttpResponse(status: Int, body: String, headers: Map[String, String])

final class RateLimitedMbtaClient(
  http: HttpClient,
  control: ControlStore,
  apiKey: () => String,
  clock: () => Instant = () => Instant.now(),
) {
  def get(path: String, query: Map[String, String], waitForPermit: Boolean = false): Either[String, JsValue] = {
    val now = clock()
    val permitted = control.acquirePermit(now) || (waitForPermit && waitForPermitUntil(clock().plusSeconds(90)))
    if (!permitted) {
      Metrics.emit("MbtaPermitDenied", 1)
      Left("MBTA rate permit unavailable")
    } else {
      val encoded = query.toVector.sortBy(_._1).map { case (key, value) =>
        s"${urlEncode(key)}=${urlEncode(value)}"
      }.mkString("&")
      val uri = URI.create(s"https://api-v3.mbta.com$path${if (encoded.nonEmpty) s"?$encoded" else ""}")
      val builder = HttpRequest.newBuilder(uri)
        .timeout(Duration.ofSeconds(25))
        .header("Accept", "application/vnd.api+json")
        .header("User-Agent", "mbta-snapshot-publisher/1.0")
      Option(apiKey()).map(_.trim).filter(_.nonEmpty).foreach(key => builder.header("x-api-key", key))
      val request = builder.GET().build()
      val started = System.nanoTime()
      try {
        val response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
        val headers = response.headers().map().asScala.view.mapValues(_.asScala.headOption.getOrElse("")).toMap
        val limit = headerInt(headers, "x-ratelimit-limit")
        val remaining = headerInt(headers, "x-ratelimit-remaining")
        val reset = headerLong(headers, "x-ratelimit-reset")
        control.observeRate(limit, remaining, reset, response.statusCode() == 429)
        remaining.foreach(value => Metrics.emit("MbtaRemaining", value, Map("path" -> path)))
        Metrics.emit("MbtaRequest", 1, Map(
          "path" -> path,
          "status" -> response.statusCode().toString,
          "durationMs" -> ((System.nanoTime() - started) / 1000000L).toString,
        ))
        Metrics.emit("MbtaLatencyMs", (System.nanoTime() - started) / 1000000L, Map("path" -> path))
        if (response.statusCode() == 200) TryJson.parse(response.body())
        else Left(s"MBTA $path returned ${response.statusCode()}")
      } catch {
        case NonFatal(e) =>
          Metrics.emit("MbtaRequestFailure", 1, Map("path" -> path, "error" -> e.getClass.getSimpleName))
          Left(s"MBTA $path failed: ${e.getMessage}")
      }
    }
  }

  private def waitForPermitUntil(deadline: Instant): Boolean = {
    var acquired = false
    while (!acquired && clock().isBefore(deadline)) {
      Thread.sleep(100L)
      acquired = control.acquirePermit(clock())
    }
    acquired
  }

  private def urlEncode(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20")
  private def headerInt(headers: Map[String, String], name: String): Option[Int] =
    headers.collectFirst { case (key, value) if key.equalsIgnoreCase(name) => value }.flatMap(_.toIntOption)
  private def headerLong(headers: Map[String, String], name: String): Option[Long] =
    headers.collectFirst { case (key, value) if key.equalsIgnoreCase(name) => value }.flatMap(_.toLongOption)
}

object TryJson {
  def parse(body: String): Either[String, JsValue] =
    try Right(body.parseJson)
    catch { case NonFatal(e) => Left(s"invalid MBTA JSON: ${e.getMessage}") }
}

final class SecretApiKey(client: SecretsManagerClient, arn: String) {
  lazy val value: String = client.getSecretValue(GetSecretValueRequest.builder().secretId(arn).build()).secretString()
}

object Metrics {
  def emit(name: String, value: Long, dimensions: Map[String, String] = Map.empty): Unit = {
    val metricDimensions = dimensions.filter { case (key, _) => Set("dataset", "job", "status").contains(key) }
    val metricDefinition = JsObject(
      "Namespace" -> JsString("MBTA/Snapshots"),
      "Dimensions" -> JsArray(JsArray(metricDimensions.keys.toVector.sorted.map(JsString.apply))),
      "Metrics" -> JsArray(JsObject("Name" -> JsString(name), "Unit" -> JsString("None"))),
    )
    val fields = Map[String, JsValue](
      "metric" -> JsString(name),
      "value" -> JsNumber(value),
      "timestamp" -> JsString(Instant.now().toString),
      name -> JsNumber(value),
      "_aws" -> JsObject(
        "Timestamp" -> JsNumber(Instant.now().toEpochMilli),
        "CloudWatchMetrics" -> JsArray(metricDefinition),
      ),
    ) ++ dimensions.view.mapValues(JsString.apply)
    System.out.println(JsObject(fields).compactPrint)
  }
}
