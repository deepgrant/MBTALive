package mbta.actor

import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.actor.Props

import scala.concurrent.Await
import scala.concurrent.duration._

object MBTAMain extends App {
  implicit val system: ActorSystem = ActorSystem()
  system.actorOf(Props[MBTAService](), name = "mbtaService")

  sys.addShutdownHook {
    system.terminate()
    Await.result(system.whenTerminated, 30.seconds)
  }
}
