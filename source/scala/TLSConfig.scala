package mbta.actor

import org.apache.pekko.http.scaladsl.ConnectionContext
import org.apache.pekko.http.scaladsl.HttpsConnectionContext

import java.io.FileInputStream
import java.security.KeyStore
import java.security.SecureRandom
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager

object TLSConfig:
  def httpsContext(): HttpsConnectionContext =
    val pass = sys.env.getOrElse("KEYSTORE_PASSWORD", "changeit").toCharArray
    val path = sys.env.getOrElse("KEYSTORE_PATH", "/app/tls/keystore.p12")
    val ks   = KeyStore.getInstance("PKCS12")
    val fis  = new FileInputStream(path)
    try ks.load(fis, pass)
    finally fis.close()
    val kmf = KeyManagerFactory.getInstance("SunX509")
    kmf.init(ks, pass)
    val ctx = SSLContext.getInstance("TLS")
    ctx.init(kmf.getKeyManagers, Array.empty[TrustManager], new SecureRandom)
    ConnectionContext.httpsServer(ctx)
