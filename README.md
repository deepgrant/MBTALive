# MBTA Tracker

Real-time vehicle tracking for the MBTA network. Select a route in the sidebar and watch buses, trains, and commuter rail cars move on the map. Click a vehicle to see its current stop, next arrival prediction, and how far off schedule it is.

**Live:** https://mbta.critmind.com/

<img width="2992" height="1692" alt="Chrome desktop" src="https://github.com/user-attachments/assets/67fdf3b7-d9d4-4664-8dba-685748cf6b4e" />
<img width="301" height="655" alt="iPhone17 Safari" src="https://github.com/user-attachments/assets/9a4abbe6-0573-41b8-a104-2ddcd56075c0" />

## What it does

- Live vehicle positions on a dark 3D MapLibre GL map, refreshed every 10 seconds
- Route shapes driven by MBTA route patterns (`typicality=1`) for authoritative shape selection
- Stop markers with MBTA T-logo icons drawn when you select a route
- Per-vehicle arrival predictions and delay status pulled from the MBTA predictions API
- System-wide and per-route alert banners with a scrolling ticker for active disruptions
- Persists your last selected route and map position in a cookie

## Running locally

You need JDK 17+, Node.js 20+, and npm.

```bash
# Terminal 1 — backend on https://localhost:8443
./gradlew run

# Terminal 2 — frontend dev server on http://localhost:4200
cd frontend && npm start
```

The backend generates a self-signed TLS certificate at startup using Bouncy Castle — no keystore file or external `keytool` step needed. The dev proxy (`frontend/proxy.conf.json`) forwards `/api/**` to `https://localhost:8443` with certificate validation disabled (`secure: false`), so no CORS config is needed locally.

Grab a free API key from https://api-v3.mbta.com if you want the higher rate limit (1000 req/min vs 10). Set it before starting the backend:

```bash
export MBTA_API_KEY=your_key_here
```

## Stack

The backend is a Scala 3 / Apache Pekko HTTP service that proxies the MBTA v3 REST API, enriches vehicle data with stop names and arrival predictions, and serves the compiled Angular app as static files. There's no separate frontend server in production — Pekko serves everything over HTTPS with a runtime-generated certificate.

| Layer | Tech |
|---|---|
| Backend | Scala 3.3 LTS, Pekko HTTP 1.3, Spray JSON, Bouncy Castle 1.80 |
| Frontend | Angular 20, MapLibre GL JS 5, OpenFreeMap vector tiles, Angular Material, RxJS |
| Build | Gradle 9, Angular CLI |
| Infra | AWS ECS Fargate, ECR, API Gateway, ACM, Route 53 |

## Project layout

```
source/scala/       Scala backend
  MBTAService       HTTP routes + static file serving
  MBTAAccess        Throttled HTTPS client to api-v3.mbta.com
  RequestFlow       Vehicle enrichment pipeline (stops, predictions, alerts, shapes)
  TLSConfig         Runtime self-signed cert generation via Bouncy Castle
  MBTAModels        Domain types

frontend/src/app/
  services/         VehicleService (state), ApiService (HTTP), MapService (MapLibre GL)
  components/       Map, Routes sidebar, Vehicle list, Alert banner/ticker
```

## Backend API

```
GET /health
GET /api/routes?type=<0-4>
GET /api/route/:id/vehicles?sortBy=vehicleId&sortOrder=asc
GET /api/route/:id/shapes
GET /api/route/:id/stops
GET /api/route/:id/alerts
GET /api/alerts
```

Shapes are filtered server-side using the MBTA `/route_patterns` endpoint — only `typicality=1` (typical service) shapes are returned. If the route patterns call fails, all shapes are returned as a fallback.

## Linting

The build enforces Scalafix rules (OrganizeImports, RemoveUnused, DisableSyntax). The `build` task will fail if there are violations.

```bash
./gradlew checkScalafixMain   # check
./gradlew scalafixMain        # fix
```

## Deployment

See [documents/deployment-guide.md](documents/deployment-guide.md) for the full AWS deployment walkthrough. The short version for updating a running deployment:

```bash
./gradlew --no-daemon buildAndPush tofuApply
```
