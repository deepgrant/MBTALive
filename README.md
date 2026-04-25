# MBTA Tracker

Real-time vehicle tracking for the MBTA network. Select a route in the sidebar and watch buses, trains, and commuter rail cars move on the map. Click a vehicle to see its current stop, next arrival prediction, and how far off schedule it is.

**Live:** https://critmind.com/MBTA/

<img width="2945" height="1338" alt="Screenshot 2026-04-25 at 7 11 39 PM" src="https://github.com/user-attachments/assets/66f9d5f2-6fdd-406e-b6ab-8840c292fc46" />
<img width="5890" height="2676" alt="Screenshot 2026-04-25 at 7 15 20 PM" src="https://github.com/user-attachments/assets/d8a93fac-6182-4ae6-a970-3ebc19715b32" />

## What it does

- Live vehicle positions on a Leaflet map, refreshed every 10 seconds
- Route shapes and stop markers drawn when you select a route
- Per-vehicle arrival predictions and delay status pulled from the MBTA predictions API
- System-wide and per-route alert banners with a scrolling ticker for active disruptions
- Persists your last selected route and map position in a cookie

## Running locally

You need JDK 17+, Node.js 20+, and npm.

```bash
# Terminal 1 — backend on http://localhost:8080
./gradlew run

# Terminal 2 — frontend dev server on http://localhost:4200
cd frontend && npm start
```

The dev proxy (`frontend/proxy.conf.json`) forwards `/api/**` to the backend, so no CORS config is needed locally.

Grab a free API key from https://api-v3.mbta.com if you want the higher rate limit (1000 req/min vs 10). Set it before starting the backend:

```bash
export MBTA_API_KEY=your_key_here
```

## Stack

The backend is a Scala 3 / Apache Pekko HTTP service that proxies the MBTA v3 REST API, enriches vehicle data with stop names and arrival predictions, and serves the compiled Angular app as static files. There's no separate frontend server in production — Pekko serves everything.

| Layer | Tech |
|---|---|
| Backend | Scala 3.3 LTS, Pekko HTTP 1.3, Spray JSON |
| Frontend | Angular 20, Leaflet 1.9, Angular Material, RxJS |
| Build | Gradle 9, Angular CLI |
| Infra | AWS ECS Fargate, ECR, API Gateway, ACM, Route 53 |

## Project layout

```
source/scala/       Scala backend
  MBTAService       HTTP routes + static file serving
  MBTAAccess        Throttled HTTPS client to api-v3.mbta.com
  RequestFlow       Vehicle enrichment pipeline (stops, predictions, alerts)
  MBTAModels        Domain types

frontend/src/app/
  services/         VehicleService (state), ApiService (HTTP), MapService (Leaflet)
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

## Linting

The build enforces Scalafix rules (OrganizeImports, RemoveUnused, DisableSyntax). The `build` task will fail if there are violations.

```bash
./gradlew checkScalafixMain   # check
./gradlew applyScalafixMain   # fix
```

## Deployment

See [documents/deployment-guide.md](documents/deployment-guide.md) for the full AWS deployment walkthrough. The short version for updating a running deployment:

```bash
./gradlew --no-daemon buildAndPush tofuApply
```
