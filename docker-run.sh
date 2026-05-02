#!/bin/bash
set -e

KEYSTORE_PASS=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32)
export KEYSTORE_PASSWORD="$KEYSTORE_PASS"
mkdir -p /app/tls
keytool -genkeypair -alias mbta \
  -keyalg RSA -keysize 2048 -validity 365 \
  -dname "CN=mbta-internal" \
  -storetype PKCS12 \
  -keystore /app/tls/keystore.p12 \
  -storepass "$KEYSTORE_PASS" \
  -keypass "$KEYSTORE_PASS" \
  -noprompt

CLASSPATH=$(find /app/lib/ -name '*.jar' | tr '\n' ':' | sed 's/:$//')
exec java -cp "$CLASSPATH" mbta.actor.MBTAMain
