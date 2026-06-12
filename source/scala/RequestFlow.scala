package mbta.actor

import com.typesafe.config.Config
import mbta.actor.ModelAPIResponse._
import mbta.actor.ModelData._
import org.apache.pekko

import scala.collection.concurrent.TrieMap
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

  // ── Constants ─────────────────────────────────────────────────────────────

  private val PredictionBatchSize:  Int  = 10
  private val StopCacheTtlMillis:    Long = 60L * 60L * 1000L  // 1 hour
  private val VehicleCacheTtlMillis: Long = 8L * 1000L         // 8 s (just under client poll)
  private val AlertCacheTtlMillis:   Long = 2L * 60L * 1000L  // 2 minutes
  // Slightly over the client's 15 s board poll so consecutive polls (and
  // concurrent clients) share one upstream fetch instead of missing every time.
  private val BoardDataCacheTtlMillis: Long = 16L * 1000L

  // ── Internal types ────────────────────────────────────────────────────────

  private case class StopDetails(name: Option[String], platformName: Option[String], zone: Option[String])

  private case class PredictionResult(
    predictedArrivalTime : Option[String],
    scheduledArrivalTime : Option[String],
    delaySeconds         : Option[Int],
  )

  // ── Caches (thread-safe) ──────────────────────────────────────────────────

  private val stopCache:         TrieMap[String, (StopDetails, Long)]          = TrieMap.empty
  private val boardStopCache:    TrieMap[String, (Vector[BoardStopInfo], Long)] = TrieMap.empty
  private val boardDataCache:    TrieMap[String, (RouteBoardData, Long)]        = TrieMap.empty
  private val boardDataInflight: TrieMap[String, Future[RouteBoardData]]        = TrieMap.empty
  private val vehicleCache:      TrieMap[String, (Vector[VehicleData], Long)]   = TrieMap.empty
  private val vehicleInflight:   TrieMap[String, Future[Vector[VehicleData]]]   = TrieMap.empty
  private val alertByRouteCache: TrieMap[String, (Vector[AlertInfo], Long)]    = TrieMap.empty
  private val alertGlobalCache:  TrieMap[String, (Vector[AlertInfo], Long)]    = TrieMap.empty

  // ── Stream Flows ──────────────────────────────────────────────────────────

  private def vehiclesPerRouteRawFlow: Flow[VehicleMsg, VehicleMsg, NotUsed] =
    Flow[VehicleMsg].mapAsync(parallelism = 12) {
      case vr @ VehicleRoute(route) =>
        access.queueRequest(
          HttpRequest(uri = access.mbtaUri(
            path  = "/vehicles",
            // include route so we can extract directionNames/destinationNames
            // without a separate /routes/{id} prefetch call
            query = access.mbtaQuery(Map("include" -> "stop,trip,route", "filter[route]" -> route))
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

        // Extract directionNames/destinationNames from the included route object.
        // This replaces the previous separate /routes/{routeId} HTTP call.
        val (directionNames, destinationNames): (Vector[String], Vector[String]) =
          included
            .find(r => Try(r.getString("type")).getOrElse("") == "route")
            .fold((Vector.empty[String], Vector.empty[String])) { r =>
              val dirs  = Try(r.getStringList("attributes.direction_names").asScala.toVector).getOrElse(Vector.empty)
              val dests = Try(r.getStringList("attributes.direction_destinations").asScala.toVector).getOrElse(Vector.empty)
              (dirs, dests)
            }

        rawVehicles.map { r =>
          val directionId = Try(r.getInt("attributes.direction_id"))
          val tripId      = Try(r.getString("relationships.trip.data.id")).toOption
          val bearing     = Try(r.getInt("attributes.bearing")).toOption
          val latitude    = Try(r.getDouble("attributes.latitude")).toOption
          val longitude   = Try(r.getDouble("attributes.longitude")).toOption
          val speed       = Try(r.getDouble("attributes.speed")).toOption

          VehicleData(
            routeId         = route.route,
            vehicleId       = Try(r.getString("attributes.label")).toOption,
            stopId          = Try(r.getString("relationships.stop.data.id")).toOption,
            tripId          = tripId,
            tripName        = tripId.flatMap(tripNameMap.get),
            bearing         = bearing,
            directionId     = directionId.toOption,
            currentStatus   = Try(r.getString("attributes.current_status")).toOption,
            latitude        = latitude,
            longitude       = longitude,
            speed           = speed,
            updatedAt       = Try(r.getString("attributes.updated_at")).toOption,
            direction       = directionId.flatMap(id => Try(directionNames(id))).toOption,
            destination     = directionId.flatMap(id => Try(destinationNames(id))).toOption,
            positionValid   = latitude.isDefined && longitude.isDefined,
            bearingReported = bearing.isDefined,
            speedReported   = speed.isDefined,
          )
        }

      case unexpected =>
        log.error("vehiclesPerRouteFlow unexpected input: {}", unexpected)
        Vector.empty
    }

  // ── Stop Enrichment (batched by unique stopId, cached across requests) ────

  private def fetchStopById(stopId: String): Future[StopDetails] = {
    val now = java.time.Instant.now().toEpochMilli()

    stopCache.get(stopId) match {
      case Some((details, expiry)) if expiry > now =>
        Future.successful(details)  // cache hit

      case _ =>
        access.queueRequest(
          HttpRequest(uri = access.mbtaUri(
            path  = s"/stops/$stopId",
            query = access.mbtaQuery()
          ))
        ).flatMap {
          case HttpResponse(StatusCodes.OK, _, entity, _) =>
            access.parseMbtaResponse(entity).map { r =>
              val details = StopDetails(
                name         = Try(r.getString("data.attributes.name")).toOption,
                platformName = Try(r.getString("data.attributes.platform_name")).toOption,
                zone         = Try(r.getString("data.relationships.zone.data.id")).toOption,
              )
              stopCache.update(stopId, (details, now + StopCacheTtlMillis))
              details
            }
          case HttpResponse(code, _, entity, _) =>
            log.error("fetchStopById({}) unexpected status: {}", stopId, code)
            entity.discardBytes()
            Future.successful(StopDetails(None, None, None))  // failures are not cached; let them retry
        }
    }
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
              stopName     = stop.name,
              platformName = stop.platformName,
            )
          }
        }
      }
  }

  // ── Prediction + Schedule Enrichment (batched 10 vehicles per API call) ───

  private def fetchPredictionBatch(
    vehicles: Vector[VehicleData]
  ): Future[Map[(String, String), PredictionResult]] = {
    val tripIds = vehicles.flatMap(_.tripId).distinct.mkString(",")
    val stopIds = vehicles.flatMap(_.stopId).distinct.mkString(",")

    if (tripIds.isEmpty || stopIds.isEmpty) Future.successful(Map.empty)
    else access.queueRequest(
      HttpRequest(uri = access.mbtaUri(
        path  = "/predictions",
        query = access.mbtaQuery(Map(
          "filter[trip]" -> tripIds,
          "filter[stop]" -> stopIds,
          "include"      -> "schedule",
        ))
      ))
    ).flatMap {
      case HttpResponse(StatusCodes.OK, _, entity, _) =>
        access.parseMbtaResponse(entity).map { resp =>
          val predictions = Try(resp.getObjectList("data").asScala.toVector.map(_.toConfig)).getOrElse(Vector.empty)
          val scheduleMap = Try(resp.getObjectList("included").asScala.toVector.map(_.toConfig)).getOrElse(Vector.empty)
            .filter(r => Try(r.getString("type")).getOrElse("") == "schedule")
            .flatMap(s => Try(s.getString("id")).toOption.map(_ -> s))
            .toMap

          predictions.flatMap { pred =>
            for {
              tripId           <- Try(pred.getString("relationships.trip.data.id")).toOption
              stopId           <- Try(pred.getString("relationships.stop.data.id")).toOption
              predictedArrival  = Try(pred.getString("attributes.arrival_time")).toOption
              scheduledArrival  = Try(pred.getString("relationships.schedule.data.id")).toOption
                                    .flatMap(scheduleMap.get)
                                    .flatMap(s => Try(s.getString("attributes.arrival_time")).toOption)
              delay             = (predictedArrival, scheduledArrival) match {
                                    case (Some(p), Some(s)) =>
                                      Try(java.time.Duration.between(
                                        java.time.Instant.parse(s),
                                        java.time.Instant.parse(p)
                                      ).getSeconds.toInt).toOption
                                    case _ => None
                                  }
            } yield (tripId, stopId) -> PredictionResult(predictedArrival, scheduledArrival, delay)
          }.toMap
        }
      case HttpResponse(code, _, entity, _) =>
        log.error("fetchPredictionBatch unexpected status: {}", code)
        entity.discardBytes()
        Future.successful(Map.empty)
    }
  }

  private def enrichWithPredictions(vehicles: Vector[VehicleData]): Future[Vector[VehicleData]] = {
    val batches = vehicles.grouped(PredictionBatchSize).toVector
    Source(batches)
      .mapAsync(parallelism = 4)(fetchPredictionBatch)
      .runWith(Sink.seq)
      .map { batchResults =>
        val predMap = batchResults.flatten.toMap
        // vehicles.map preserves order; mapAsync also preserves order — zip-merge is safe
        vehicles.map { vehicle =>
          (vehicle.tripId, vehicle.stopId) match {
            case (Some(tripId), Some(stopId)) =>
              predMap.get((tripId, stopId)).fold(vehicle) { pred =>
                vehicle.copy(
                  predictedArrivalTime = pred.predictedArrivalTime,
                  scheduledArrivalTime = pred.scheduledArrivalTime,
                  delaySeconds         = pred.delaySeconds,
                )
              }
            case _ => vehicle
          }
        }
      }
  }

  // ── Merge (stop fields + prediction fields are disjoint) ─────────────────

  private def computeFormattedStatus(status: Option[String], stopName: Option[String]): Option[String] =
    status.map {
      case "IN_TRANSIT_TO"  => s"In transit to ${stopName.getOrElse("next stop")}"
      case "STOPPED_AT"     => s"Stopped at ${stopName.getOrElse("stop")}"
      case "INCOMING_AT"    => s"Incoming at ${stopName.getOrElse("next stop")}"
      case raw              => raw.replace('_', ' ').toLowerCase.capitalize
    }

  private def computeDelayStatus(delaySeconds: Option[Int]): Option[String] =
    delaySeconds.map {
      case d if d < -60  => "ahead"
      case d if d < 300  => "on-time"
      case d if d < 600  => "minor-delay"
      case _             => "major-delay"
    }

  private def mergeEnrichments(
    withStops: Vector[VehicleData],
    withPreds: Vector[VehicleData],
  ): Vector[VehicleData] =
    withStops.zip(withPreds).map { case (s, p) =>
      val delay = p.delaySeconds
      s.copy(
        predictedArrivalTime = p.predictedArrivalTime,
        scheduledArrivalTime = p.scheduledArrivalTime,
        delaySeconds         = delay,
        formattedStatus      = computeFormattedStatus(s.currentStatus, s.stopName),
        delayStatus          = computeDelayStatus(delay),
      )
    }

  // ── Sorting ───────────────────────────────────────────────────────────────

  private def sortVehicles(vehicles: Vector[VehicleData], sortBy: String, sortOrder: String): Vector[VehicleData] = {
    val sorted = sortBy.toLowerCase match {
      case "tripid" => vehicles.sortBy(v => v.tripId.getOrElse(v.vehicleId.getOrElse("")))
      case _        => vehicles.sortBy(_.vehicleId.getOrElse(""))
    }
    if (sortOrder.toLowerCase == "asc") sorted else sorted.reverse
  }

  // ── Board Data ────────────────────────────────────────────────────────────

  // None on upstream failure — distinct from a genuinely empty stop list, so
  // failures are never cached (a transient 429 must not blank the board for
  // the full StopCacheTtlMillis hour).
  private def fetchOrderedStopsFromApi(routeId: String, directionId: Int): Future[Option[Vector[BoardStopInfo]]] =
    access.queueRequest(
      HttpRequest(uri = access.mbtaUri(
        path  = "/stops",
        query = access.mbtaQuery(Map(
          "filter[route]"        -> routeId,
          "filter[direction_id]" -> directionId.toString,
        ))
      ))
    ).flatMap {
      case HttpResponse(StatusCodes.OK, _, entity, _) =>
        access.parseMbtaResponse(entity).map { response =>
          Some(response.getObjectList("data").asScala.toVector.zipWithIndex.map { case (stop, idx) =>
            val s = stop.toConfig
            BoardStopInfo(
              id          = s.getString("id"),
              name        = s.getString("attributes.name"),
              latitude    = Try(s.getDouble("attributes.latitude")).getOrElse(0.0),
              longitude   = Try(s.getDouble("attributes.longitude")).getOrElse(0.0),
              directionId = directionId,
              sequence    = idx,
            )
          })
        }
      case HttpResponse(code, _, entity, _) =>
        log.error("fetchOrderedStops({}, {}) unexpected status: {}", routeId, directionId, code)
        entity.discardBytes()
        Future.successful(None)
    }

  private def fetchOrderedStops(routeId: String, directionId: Int): Future[Vector[BoardStopInfo]] = {
    val key = s"$routeId:$directionId"
    val now = java.time.Instant.now().toEpochMilli()
    boardStopCache.get(key) match {
      case Some((stops, expiry)) if expiry > now =>
        Future.successful(stops)
      case _ =>
        fetchOrderedStopsFromApi(routeId, directionId).map {
          case Some(stops) =>
            boardStopCache.put(key, (stops, now + StopCacheTtlMillis))
            stops
          case None =>
            // Serve the empty list this once but leave the cache untouched so
            // the next board fetch retries.
            Vector.empty
        }
    }
  }

  /**
   * Raw parsed payload of a batched /predictions call covering many trips.
   * Per-train board rows are assembled from this without further HTTP calls.
   */
  private case class BoardPredictionsRaw(
    predsByTrip:   Map[String, Vector[Config]],
    childToParent: Map[String, String],
    scheduleMap:   Map[String, Config],
  ) {
    def merge(other: BoardPredictionsRaw): BoardPredictionsRaw = BoardPredictionsRaw(
      predsByTrip   = predsByTrip ++ other.predsByTrip,
      childToParent = childToParent ++ other.childToParent,
      scheduleMap   = scheduleMap ++ other.scheduleMap,
    )
  }

  // One /predictions request per PredictionBatchSize trips (mirrors
  // fetchPredictionBatch) instead of the previous one-request-per-train,
  // which alone exceeded the unkeyed 10 req/min MBTA quota on busy routes.
  // Fails the Future on a non-OK status: a failed batch must neither be
  // cached nor rendered as trains-with-no-predictions (ghost columns).
  private def fetchBoardPredictionsBatch(tripIds: Vector[String]): Future[BoardPredictionsRaw] =
    access.queueRequest(
      HttpRequest(uri = access.mbtaUri(
        path  = "/predictions",
        query = access.mbtaQuery(Map(
          "filter[trip]" -> tripIds.mkString(","),
          "include"      -> "stop,schedule",
          "sort"         -> "stop_sequence",
        ))
      ))
    ).flatMap {
      case HttpResponse(StatusCodes.OK, _, entity, _) =>
        access.parseMbtaResponse(entity).map { resp =>
          val included = Try(resp.getObjectList("included").asScala.toVector.map(_.toConfig)).getOrElse(Vector.empty)

          // Predictions reference child stop IDs (e.g. "70031"); ordered stops use parent
          // place IDs (e.g. "place-welln"). Map child → parent via included stop objects.
          val childToParent: Map[String, String] = included
            .filter(r => Try(r.getString("type")).getOrElse("") == "stop")
            .flatMap { s =>
              for {
                childId  <- Try(s.getString("id")).toOption
                parentId <- Try(s.getString("relationships.parent_station.data.id")).toOption
              } yield childId -> parentId
            }
            .toMap

          val scheduleMap = included
            .filter(r => Try(r.getString("type")).getOrElse("") == "schedule")
            .flatMap(s => Try(s.getString("id")).toOption.map(_ -> s))
            .toMap

          val predsByTrip = Try(resp.getObjectList("data").asScala.toVector.map(_.toConfig))
            .getOrElse(Vector.empty)
            .flatMap(p => Try(p.getString("relationships.trip.data.id")).toOption.map(_ -> p))
            .groupMap(_._1)(_._2)

          BoardPredictionsRaw(predsByTrip, childToParent, scheduleMap)
        }
      case HttpResponse(code, _, entity, _) =>
        log.error("fetchBoardPredictionsBatch({} trips) unexpected status: {}", tripIds.size, code)
        entity.discardBytes()
        Future.failed(new RuntimeException(s"board predictions batch failed with $code"))
    }

  private def fetchAllBoardPredictions(tripIds: Vector[String]): Future[BoardPredictionsRaw] =
    if (tripIds.isEmpty) Future.successful(BoardPredictionsRaw(Map.empty, Map.empty, Map.empty))
    else Source(tripIds.grouped(PredictionBatchSize).toVector)
      .mapAsync(parallelism = 4)(fetchBoardPredictionsBatch)
      .runWith(Sink.seq)
      .map(_.reduce(_ merge _))

  // Pure assembly: builds one train's board row from the already-fetched batch.
  private def buildTrainBoardData(
    v:           VehicleData,
    tripId:      String,
    raw:         BoardPredictionsRaw,
    stopsForDir: Vector[BoardStopInfo],
  ): TrainBoardData = {
    val stopSeqMap  = stopsForDir.map(s => s.id -> s.sequence).toMap
    val stopNameMap = stopsForDir.map(s => s.id -> s.name).toMap

    val preds = raw.predsByTrip.getOrElse(tripId, Vector.empty)
      .flatMap { pred =>
        for {
          childStopId <- Try(pred.getString("relationships.stop.data.id")).toOption
          placeId      = raw.childToParent.getOrElse(childStopId, childStopId)
          sequence    <- stopSeqMap.get(placeId)
        } yield StopPrediction(
          stopId        = placeId,
          stopName      = stopNameMap.getOrElse(placeId, placeId),
          sequence      = sequence,
          predictedTime = Try(pred.getString("attributes.arrival_time")).toOption,
          scheduledTime = Try(pred.getString("relationships.schedule.data.id")).toOption
                            .flatMap(raw.scheduleMap.get)
                            .flatMap(s => Try(s.getString("attributes.arrival_time")).toOption),
          status        = "upcoming",
        )
      }
      .sortBy(_.sequence)

    // Resolve vehicle's actual current stop via childToParent (vehicle position is
    // real-time accurate; min(predictions.sequence) can lag after a train passes a stop).
    // Fall back to min prediction sequence if the vehicle stop can't be resolved.
    val resolvedStop = v.stopId.flatMap { childId =>
      val parentId = raw.childToParent.getOrElse(childId, childId)
      stopSeqMap.get(parentId).map(seq => (parentId, seq))
    }

    val (curStopId, curSeq) = (preds, resolvedStop) match {
      case (_, Some((id, seq))) => (Some(id), seq)
      case (ps, None) if ps.nonEmpty =>
        val minSeq = ps.map(_.sequence).min
        (stopsForDir.find(_.sequence == minSeq).map(_.id), minSeq)
      case _ =>
        // No predictions and no resolvable stop: park the train past every
        // stop so the frontend's "approaching" filter (seq <= station.seq)
        // never shows it as a ghost column of empty cells.
        (None, Int.MaxValue)
    }

    TrainBoardData(
      vehicleId           = v.vehicleId.getOrElse(""),
      tripId              = v.tripId,
      tripName            = v.tripName,
      directionId         = v.directionId,
      direction           = v.direction,
      destination         = v.destination,
      currentStopId       = curStopId.filter(_.nonEmpty),
      currentStopSequence = curSeq,
      delaySeconds        = v.delaySeconds,
      delayStatus         = v.delayStatus,
      predictions         = preds,
    )
  }

  private def fetchBoardDataFromMbta(routeId: String): Future[RouteBoardData] = {
    // The three sources are independent — start them all before combining so
    // the cold path pays max(RTT) instead of three sequential round-trips.
    val vehiclesFut = fetchVehiclesForRoute(routeId)
    val inboundFut  = fetchOrderedStops(routeId, 1)
    val outboundFut = fetchOrderedStops(routeId, 0)

    val boardFut = for {
      vehicles      <- vehiclesFut
      inboundStops  <- inboundFut
      outboundStops <- outboundFut
      withTrips      = vehicles.flatMap(v => v.tripId.map(v -> _))
      raw           <- fetchAllBoardPredictions(withTrips.map(_._2).distinct)
    } yield {
      val trains = withTrips.map { case (v, tripId) =>
        val stopsForDir = if (v.directionId.getOrElse(0) == 1) inboundStops else outboundStops
        buildTrainBoardData(v, tripId, raw, stopsForDir)
      }
      RouteBoardData(routeId, inboundStops, outboundStops, trains)
    }

    boardFut
      .recoverWith { case e: Throwable =>
        log.error("fetchBoardData({}) unexpected error: {}", routeId, e)
        Future.failed(e)
      }
      // Cache BEFORE dropping the inflight entry: the reverse order left a
      // window where a concurrent request saw neither and re-fanned out.
      .map { data =>
        boardDataCache.update(routeId, (data, java.time.Instant.now().toEpochMilli() + BoardDataCacheTtlMillis))
        data
      }
      .andThen { case _ => boardDataInflight.remove(routeId) }
  }

  def fetchBoardData(routeId: String): Future[RouteBoardData] = {
    val now = java.time.Instant.now().toEpochMilli()
    boardDataCache.get(routeId) match {
      case Some((data, expiry)) if expiry > now =>
        Future.successful(data)
      case _ =>
        boardDataInflight.getOrElseUpdate(routeId, fetchBoardDataFromMbta(routeId))
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  private def fetchFromMbta(routeId: String): Future[Vector[VehicleData]] = {
    val now = java.time.Instant.now().toEpochMilli()
    Source.single[VehicleMsg](VehicleRoute(routeId))
      .via(vehiclesPerRouteRawFlow)
      .via(vehiclesPerRouteFlow)
      .collect { case v: VehicleData => v }
      .runWith(Sink.seq)
      .map(_.toVector)
      .flatMap { vehicles =>
        // Stop and prediction enrichment touch independent fields — run in parallel.
        val stopsFut = enrichWithStops(vehicles)
        val predsFut = enrichWithPredictions(vehicles)
        stopsFut.zip(predsFut).map { case (withStops, withPreds) =>
          mergeEnrichments(withStops, withPreds)
        }
      }
      // Cache BEFORE dropping the inflight entry: the reverse order left a
      // window where a concurrent request saw neither and re-fanned out.
      .map { vehicles =>
        vehicleCache.update(routeId, (vehicles, now + VehicleCacheTtlMillis))
        vehicles
      }
      .andThen { case _ =>
        vehicleInflight.remove(routeId)
      }
  }

  def fetchVehiclesForRoute(routeId: String, sortBy: String = "vehicleId", sortOrder: String = "asc"): Future[Vector[VehicleData]] = {
    val now = java.time.Instant.now().toEpochMilli()
    val base: Future[Vector[VehicleData]] =
      vehicleCache.get(routeId) match {
        case Some((vehicles, expiry)) if expiry > now =>
          Future.successful(vehicles)
        case _ =>
          vehicleInflight.getOrElseUpdate(routeId, fetchFromMbta(routeId))
      }
    base.map(sortVehicles(_, sortBy, sortOrder))
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

  private def fetchRawShapes(routeId: String): Future[Vector[ShapeInfo]] =
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
            ShapeInfo(
              id          = s.getString("id"),
              polyline    = s.getString("attributes.polyline"),
              priority    = Try(s.getInt("attributes.priority")).getOrElse(0),
              directionId = Try(s.getInt("attributes.direction_id")).getOrElse(0),
            )
          }
        }
      case HttpResponse(code, _, entity, _) =>
        log.error("fetchRawShapes({}) unexpected status: {}", routeId, code)
        entity.discardBytes()
        Future.successful(Vector.empty)
    }

  private def fetchShapeTypicality(routeId: String): Future[Map[String, Int]] =
    access.queueRequest(
      HttpRequest(uri = access.mbtaUri(
        path  = "/route_patterns",
        query = access.mbtaQuery(Map("filter[route]" -> routeId, "include" -> "representative_trip"))
      ))
    ).flatMap {
      case HttpResponse(StatusCodes.OK, _, entity, _) =>
        access.parseMbtaResponse(entity).map { resp =>
          val included = Try(resp.getObjectList("included").asScala.toVector.map(_.toConfig)).getOrElse(Vector.empty)
          val tripToShape: Map[String, String] = included
            .filter(t => Try(t.getString("type")).getOrElse("") == "trip")
            .flatMap { t =>
              for {
                tripId  <- Try(t.getString("id")).toOption
                shapeId <- Try(t.getString("relationships.shape.data.id")).toOption
              } yield tripId -> shapeId
            }
            .toMap
          val patterns = Try(resp.getObjectList("data").asScala.toVector.map(_.toConfig)).getOrElse(Vector.empty)
          patterns.flatMap { p =>
            for {
              typicality <- Try(p.getInt("attributes.typicality")).toOption
              tripId     <- Try(p.getString("relationships.representative_trip.data.id")).toOption
              shapeId    <- tripToShape.get(tripId)
            } yield shapeId -> typicality
          }.groupBy(_._1).view.mapValues(_.map(_._2).min).toMap
        }
      case HttpResponse(code, _, entity, _) =>
        log.error("fetchShapeTypicality({}) unexpected status: {}", routeId, code)
        entity.discardBytes()
        Future.successful(Map.empty)
    }

  def fetchShapes(routeId: String): Future[Vector[ShapeInfo]] =
    Source.future(fetchRawShapes(routeId))
      .zipWith(Source.future(fetchShapeTypicality(routeId))) { (shapes, typicalityMap) =>
        if (typicalityMap.nonEmpty)
          shapes
            .filter(s => typicalityMap.get(s.id).forall(_ <= 3))
            .map(s => s.copy(typicality = typicalityMap.get(s.id).getOrElse(1)))
        else
          shapes
      }
      .runWith(Sink.head)

  def fetchAlertsForRoute(routeId: String): Future[Vector[AlertInfo]] = {
    val now = System.currentTimeMillis()
    alertByRouteCache.get(routeId) match {
      case Some((alerts, expiry)) if expiry > now => Future.successful(alerts)
      case _ =>
        val nowIso = java.time.Instant.now().toString
        access.queueRequest(
          HttpRequest(uri = access.mbtaUri(
            path  = "/alerts",
            query = access.mbtaQuery(Map(
              "filter[route]"    -> routeId,
              "filter[activity]" -> "BOARD,EXIT,RIDE",
              "filter[datetime]" -> nowIso,
            ))
          ))
        ).flatMap {
          case HttpResponse(StatusCodes.OK, _, entity, _) =>
            access.parseMbtaResponse(entity).map { response =>
              val alerts = response.getObjectList("data").asScala.toVector.map { item =>
                parseAlertInfo(item.toConfig, includeRoutes = false)
              }
              alertByRouteCache.put(routeId, (alerts, now + AlertCacheTtlMillis))
              alerts
            }
          case HttpResponse(code, _, entity, _) =>
            log.error("fetchAlertsForRoute({}) unexpected status: {}", routeId, code)
            entity.discardBytes()
            Future.successful(Vector.empty)
        }
    }
  }

  def fetchAlertsGlobal(): Future[Vector[AlertInfo]] = {
    val now = System.currentTimeMillis()
    alertGlobalCache.get("global") match {
      case Some((alerts, expiry)) if expiry > now => Future.successful(alerts)
      case _ =>
        val nowIso = java.time.Instant.now().toString
        access.queueRequest(
          HttpRequest(uri = access.mbtaUri(
            path  = "/alerts",
            query = access.mbtaQuery(Map(
              "filter[activity]" -> "BOARD,EXIT,RIDE",
              "filter[datetime]" -> nowIso,
            ))
          ))
        ).flatMap {
          case HttpResponse(StatusCodes.OK, _, entity, _) =>
            access.parseMbtaResponse(entity).map { response =>
              val alerts = response.getObjectList("data").asScala.toVector.map { item =>
                parseAlertInfo(item.toConfig, includeRoutes = true)
              }
              alertGlobalCache.put("global", (alerts, now + AlertCacheTtlMillis))
              alerts
            }
          case HttpResponse(code, _, entity, _) =>
            log.error("fetchAlertsGlobal unexpected status: {}", code)
            entity.discardBytes()
            Future.successful(Vector.empty)
        }
    }
  }

  private def parseAlertInfo(r: com.typesafe.config.Config, includeRoutes: Boolean): AlertInfo = {
    val routeIds: Vector[String] =
      if (!includeRoutes) Vector.empty
      else
        Try(r.getObjectList("relationships.routes.data").asScala.toVector)
          .getOrElse(Vector.empty)
          .flatMap(obj => Try(obj.toConfig.getString("id")).toOption)
    val stopIds: Vector[String] =
      Try(r.getObjectList("attributes.informed_entity").asScala.toVector)
        .getOrElse(Vector.empty)
        .flatMap(obj => Try(obj.toConfig.getString("stop")).toOption)
        .filter(_.nonEmpty)
        .distinct
    AlertInfo(
      id          = r.getString("id"),
      header      = Try(r.getString("attributes.header")).getOrElse(""),
      effect      = Try(r.getString("attributes.effect")).getOrElse("UNKNOWN"),
      severity    = Try(r.getInt("attributes.severity")).getOrElse(1),
      lifecycle   = Try(r.getString("attributes.lifecycle")).getOrElse("ONGOING"),
      updatedAt   = Try(r.getString("attributes.updated_at")).getOrElse(""),
      description = Try(r.getString("attributes.description")).toOption,
      cause       = Try(r.getString("attributes.cause")).toOption,
      routeIds    = routeIds,
      stopIds     = stopIds,
    )
  }
}
