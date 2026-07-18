package mbta.snapshot

import com.typesafe.config.Config
import com.typesafe.config.ConfigFactory

import scala.concurrent.duration._

final case class SnapshotConfig(
  snapshotBucket: String,
  controlTable: String,
  apiSecretArn: String,
  activeTtl: FiniteDuration,
  providerLimit: Int,
  safeLimit: Int,
  burstCapacity: Int,
  predictionBatchSize: Int,
)

object SnapshotConfig {
  def fromEnv(): SnapshotConfig = {
    val root = ConfigFactory
      .parseString(sys.env.getOrElse("MBTA_SNAPSHOT_CONFIG", "mbta-snapshot {}"))
      .withFallback(ConfigFactory.parseString(defaults))
      .resolve()
      .getConfig("mbta-snapshot")
    fromConfig(root)
  }

  def fromConfig(c: Config): SnapshotConfig = SnapshotConfig(
    snapshotBucket    = c.getString("snapshot-bucket"),
    controlTable      = c.getString("control-table"),
    apiSecretArn      = c.getString("api-secret-arn"),
    activeTtl         = c.getDuration("active-ttl").toMillis.millis,
    providerLimit     = c.getInt("provider-limit"),
    safeLimit         = c.getInt("safe-limit"),
    burstCapacity     = c.getInt("burst-capacity"),
    predictionBatchSize = c.getInt("prediction-batch-size"),
  )

  private val defaults: String =
    """
      |mbta-snapshot {
      |  snapshot-bucket = ""
      |  control-table = ""
      |  api-secret-arn = ""
      |  active-ttl = 150 seconds
      |  provider-limit = 1000
      |  safe-limit = 800
      |  burst-capacity = 20
      |  prediction-batch-size = 10
      |}
      |""".stripMargin
}
