package mbta.actor

import scala.concurrent.duration._
import scala.util.Try

object MBTAConfig {
  lazy val apiKey: Try[String]             = Try(sys.env("MBTA_API_KEY"))
  lazy val maxRequestsPerPeriod: Int       = apiKey.map(_ => 1000).getOrElse(10)
  val   maxRequestsWindow: FiniteDuration  = 1.minute
  lazy val updatePeriod: FiniteDuration    = apiKey.map(_ => 15.seconds).getOrElse(10.minutes)
}
