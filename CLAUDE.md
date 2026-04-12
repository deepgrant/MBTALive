# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

MBTA Tracker is a real-time transit tracking app for Boston's commuter rail. The frontend polls the Scala backend every 10 seconds; the backend fetches, enriches, and returns vehicle data from the MBTA v3 API.

## Commands

### Backend (Scala 3 / Gradle)
```bash
./gradlew run                  # Run backend on port 8080
./gradlew build                # Compile, test, and lint
./gradlew checkScalafixMain    # Check linting issues
./gradlew applyScalafixMain    # Auto-fix linting issues
./gradlew docker               # Build Docker image (mbtalive:2.0)
```

### Frontend (Angular 20 / npm)
```bash
cd frontend
npm start                      # Dev server on port 4200 (proxies /api/* to localhost:8080)
npm run build                  # Production build
npm test                       # Run Karma/Jasmine tests
npm run watch                  # Watch mode
```

### Full Development Setup
Run backend and frontend in two separate terminals:
1. `./gradlew run`
2. `cd frontend && npm start`

Then open http://localhost:4200.

## Architecture

### Request Flow
```
Browser → Angular (4200) → [proxy] → Scala backend (8080) → MBTA API (api-v3.mbta.com:443)
```

The Angular dev proxy (`frontend/proxy.conf.json`) forwards `/api/**` to the backend. In production, this is handled by the Docker container.

### Backend (`source/scala/mbta.scala`)
Single-file Scala 3 backend built on Pekko Actors + Pekko HTTP + Pekko Streams.

Key components:
- **`MBTAMain`** — entry point; creates the ActorSystem and `MBTAService`
- **`MBTAService`** — Pekko actor that owns the MBTA HTTPS connection pool, the request queue, and the HTTP server
- **`RequestFlow`** — sealed trait state machine driving the enrichment pipeline

API endpoints served:
- `GET /api/routes`
- `GET /api/route/:id/vehicles`
- `GET /api/route/:id/stops`
- `GET /api/route/:id/shapes`

**Enrichment pipeline** (Pekko Streams, runs per vehicle request):
```
vehiclesPerRouteRawFlow → vehiclesPerRouteFlow → stopIdLookupFlow → scheduleLookupFlow → predictionLookupFlow
```
Each stage enriches the vehicle data (stop name/platform, scheduled time, prediction, calculated delay).

**MBTA API key**: set via `MBTA_API_KEY` environment variable. Without it: 10 req/min limit, 10-minute polling interval. With it: 1000 req/min, 15-second interval.

### Frontend (`frontend/src/app/`)

**State management** — RxJS BehaviorSubjects in services, no NgRx:
- `VehicleService` — central state: `vehicles$`, `routes$`, `selectedRoute$`, `selectedVehicle$`, `filteredVehicles$`, `selectedRouteStations$`, `selectedRouteShapes$`
- `ApiService` — HTTP client; uses `interval()` + `switchMap()` for polling
- `CookieService` — persists `mbta_app_settings` (selected route, panel visibility, map bounds) for 30 days
- `MapService` — Leaflet map instance management

**Key components**:
- `MapComponent` — Leaflet map with vehicle markers, route polylines, station markers
- `RoutesComponent` — sidebar route list and selection
- `VehicleListComponent` / `VehicleInfoComponent` — vehicle details panel

**Models** (`app/models/`): `VehicleData`, `Route`, `Station`, `AppSettings` — these must stay in sync with the Scala case classes and JSON marshallers.

## Important Conventions

- **Strict TypeScript** is enabled — no implicit `any`, no unused locals.
- **Scalafix** enforces `OrganizeImports`, `RemoveUnused`, `DisableSyntax`, `RedundantSyntax`. Always run `./gradlew applyScalafixMain` before committing Scala changes.
- **MBTA brand colors** used throughout the UI: Navy `#003DA5`, Orange `#ED8B00`, Purple `#80276C` (defined in `frontend/src/styles.scss`).
- The backend is intentionally a single file (`mbta.scala`). Keep new logic within that file unless there is a strong reason to split it.
- Frontend components unsubscribe from observables in `ngOnDestroy()` — maintain this pattern to avoid memory leaks.
