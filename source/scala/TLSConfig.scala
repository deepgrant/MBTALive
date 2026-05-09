package mbta.actor

import org.apache.pekko.http.scaladsl.ConnectionContext
import org.apache.pekko.http.scaladsl.HttpsConnectionContext
import org.bouncycastle.asn1.x500.X500Name
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder

import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.SecureRandom
import java.security.Security
import java.util.Date
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager

object TLSConfig {
  def httpsContext(): HttpsConnectionContext =
    Security.addProvider(new BouncyCastleProvider())

    val kpg = KeyPairGenerator.getInstance("RSA", "BC")
    kpg.initialize(4096, new SecureRandom())
    val keyPair = kpg.generateKeyPair()

    val now       = java.time.Instant.now()
    val notBefore = Date.from(now)
    val notAfter  = Date.from(now.plus(java.time.Duration.ofDays(3650)))
    val subject   = new X500Name("CN=mbtalive,O=MBTA,C=US")
    val serial    = BigInteger.valueOf(System.currentTimeMillis())

    val certBuilder = new JcaX509v3CertificateBuilder(
      subject, serial, notBefore, notAfter, subject, keyPair.getPublic
    )
    val signer = new JcaContentSignerBuilder("SHA256withRSA")
      .setProvider("BC")
      .build(keyPair.getPrivate)
    val cert = new JcaX509CertificateConverter()
      .setProvider("BC")
      .getCertificate(certBuilder.build(signer))

    val ks = KeyStore.getInstance("PKCS12")
    // scalafix:off DisableSyntax.null
    ks.load(null, null)
    // scalafix:on DisableSyntax.null
    ks.setKeyEntry("mbtalive", keyPair.getPrivate, Array.empty[Char], Array(cert))

    val kmf = KeyManagerFactory.getInstance("SunX509")
    kmf.init(ks, Array.empty[Char])

    val ctx = SSLContext.getInstance("TLS")
    ctx.init(kmf.getKeyManagers, Array.empty[TrustManager], new SecureRandom)
    ConnectionContext.httpsServer(ctx)
}
