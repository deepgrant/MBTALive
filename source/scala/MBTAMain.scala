package mbta.actor

import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.actor.Props

object MBTAMain extends App {
  implicit val system: ActorSystem = ActorSystem()
  system.actorOf(Props[MBTAService](), name = "mbtaService")
}
