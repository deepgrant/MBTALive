package mbta.snapshot

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpHandler
import com.sun.net.httpserver.HttpServer
import spray.json._

import java.net.InetSocketAddress
import java.net.http.HttpClient
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import scala.jdk.CollectionConverters._

final class FileSnapshotStore(root: Path) extends SnapshotStore {
  override def get(key: String): Option[StoredObject] = {
    val path = safePath(key)
    Option.when(Files.isRegularFile(path)) {
      StoredObject(Files.readString(path), Files.getLastModifiedTime(path).toInstant)
    }
  }

  override def put(key: String, body: String, cacheControl: String): Unit = {
    val path = safePath(key)
    Files.createDirectories(path.getParent)
    val temp = Files.createTempFile(path.getParent, ".snapshot-", ".tmp")
    Files.writeString(temp, body, StandardCharsets.UTF_8)
    Files.move(temp, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
  }

  private def safePath(key: String): Path = {
    val path = root.resolve(key).normalize()
    require(path.startsWith(root.normalize()), "snapshot key escaped root")
    path
  }
}

final class InMemoryControlStore(safeLimit: Int, burst: Int) extends ControlStore {
  private val active = new ConcurrentHashMap[String, Long]().asScala
  private val locks = new ConcurrentHashMap[String, Long]().asScala
  private val successes = new ConcurrentHashMap[String, String]().asScala
  private var bucket = TokenBucketState(TokenBucketPolicy(safeLimit, burst).capacityMilli, 0L, 0L)
  private var observedLimit: Option[Int] = None

  override def activeRoutes(now: Instant): Vector[String] = active.collect {
    case (route, until) if until > now.getEpochSecond => route
  }.toVector.sorted

  override def activate(routeId: String, now: Instant, ttlSeconds: Long): ActivationResult = {
    val previous = active.put(routeId, now.plusSeconds(ttlSeconds).getEpochSecond)
    ActivationResult(previous.forall(_ <= now.getEpochSecond), now.plusSeconds(ttlSeconds))
  }

  override def acquirePermit(now: Instant): Boolean = synchronized {
    val effective = observedLimit.map(v => math.min(safeLimit, math.floor(v * 0.8).toInt)).getOrElse(safeLimit)
    TokenBucket.acquire(bucket, TokenBucketPolicy(effective, burst), now.toEpochMilli, now.getEpochSecond) match {
      case Some(next) => bucket = next; true
      case None => false
    }
  }

  override def observeRate(
    limit: Option[Int],
    remaining: Option[Int],
    resetEpoch: Option[Long],
    throttled: Boolean,
  ): Unit = synchronized {
    observedLimit = limit.orElse(observedLimit)
    if (throttled) bucket = bucket.copy(blockedUntilEpoch = resetEpoch.getOrElse(Instant.now().plusSeconds(60).getEpochSecond))
  }

  override def tryJobLock(job: String, slot: Long, now: Instant, ttlSeconds: Long): Boolean = {
    locks.filterInPlace((_, expires) => expires > now.getEpochSecond)
    locks.putIfAbsent(s"$job#$slot", now.plusSeconds(ttlSeconds).getEpochSecond).isEmpty
  }

  override def releaseJobLock(job: String, slot: Long): Unit = locks.remove(s"$job#$slot")

  override def recordSuccess(dataset: String, at: Instant): Unit = successes.put(s"${dataset}LastSuccess", at.toString)

  override def status(now: Instant, activeRouteCount: Int): SnapshotStatus = SnapshotStatus(
    status                = if (successes.contains("vehiclesLastSuccess")) "ok" else "warming",
    generatedAt           = now.toString,
    vehiclesLastSuccess   = successes.get("vehiclesLastSuccess"),
    boardsLastSuccess     = successes.get("boardsLastSuccess"),
    alertsLastSuccess     = successes.get("alertsLastSuccess"),
    referencesLastSuccess = successes.get("referencesLastSuccess"),
    activeRouteCount      = activeRouteCount,
  )
}

object SnapshotDevMain extends App {
  private val root = Path.of("build", "local-snapshots").toAbsolutePath
  private val store = new FileSnapshotStore(root)
  private val control = new InMemoryControlStore(800, 20)
  private val config = SnapshotConfig(
    snapshotBucket = "local",
    controlTable = "local",
    apiSecretArn = "local",
    activeTtl = scala.concurrent.duration.DurationInt(150).seconds,
    providerLimit = 1000,
    safeLimit = 800,
    burstCapacity = 20,
    predictionBatchSize = 10,
  )
  private val mbta = new RateLimitedMbtaClient(
    HttpClient.newHttpClient(),
    control,
    () => sys.env.getOrElse("MBTA_API_KEY", ""),
  )
  private val services = new SnapshotServices(config, store, control, mbta)
  private val scheduler = Executors.newScheduledThreadPool(3)
  private val server = HttpServer.create(new InetSocketAddress("127.0.0.1", 8080), 0)

  server.createContext("/api/control/routes", exchangeHandler { exchange =>
    val Activity = "^/api/control/routes/([A-Za-z0-9._-]{1,128})/activity$".r
    (exchange.getRequestMethod, exchange.getRequestURI.getPath) match {
      case ("PUT", Activity(routeId)) => services.activate(routeId) match {
        case Right(result) => respond(exchange, 200, JsObject(
          "routeId" -> JsString(routeId), "activeUntil" -> JsString(result.activeUntil.toString)).compactPrint)
        case Left(error) => respond(exchange, 404, JsObject("error" -> JsString(error)).compactPrint)
      }
      case ("OPTIONS", _) => respond(exchange, 204, "")
      case _ => respond(exchange, 404, "{\"error\":\"not found\"}")
    }
  })
  server.createContext("/api", exchangeHandler { exchange =>
    if (exchange.getRequestMethod != "GET") respond(exchange, 405, "{\"error\":\"method not allowed\"}")
    else store.get(exchange.getRequestURI.getPath.stripPrefix("/")) match {
      case Some(value) => respond(exchange, 200, value.body)
      case None => respond(exchange, 404, "{\"error\":\"snapshot warming\"}")
    }
  })
  server.setExecutor(Executors.newCachedThreadPool())
  server.start()

  if (store.get("api/routes").isEmpty) scheduler.execute(() => services.referenceRefresh())
  scheduler.scheduleAtFixedRate(() => services.vehicleRefresh(), 0, 10, TimeUnit.SECONDS)
  scheduler.scheduleAtFixedRate(() => services.boardRefresh(), 5, 30, TimeUnit.SECONDS)
  scheduler.scheduleAtFixedRate(() => services.alertRefresh(), 0, 2, TimeUnit.MINUTES)
  System.out.println(s"Snapshot dev server listening at http://127.0.0.1:8080 using $root")

  sys.addShutdownHook {
    scheduler.shutdownNow()
    server.stop(0)
  }

  private def exchangeHandler(f: HttpExchange => Unit): HttpHandler = new HttpHandler {
    override def handle(exchange: HttpExchange): Unit = f(exchange)
  }

  private def respond(exchange: HttpExchange, status: Int, body: String): Unit = {
    val bytes = body.getBytes(StandardCharsets.UTF_8)
    exchange.getResponseHeaders.add("Content-Type", "application/json")
    exchange.getResponseHeaders.add("Cache-Control", "no-store")
    exchange.sendResponseHeaders(status, if (status == 204) -1 else bytes.length.toLong)
    if (status != 204) exchange.getResponseBody.write(bytes)
    exchange.close()
  }
}
