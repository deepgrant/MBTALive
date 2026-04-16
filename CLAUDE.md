# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Full-stack real-time MBTA vehicle tracking app. The Scala/Pekko backend proxies the MBTA REST API and the Angular frontend displays live vehicle positions on a Leaflet map.

## Commands

### Backend (Scala/Gradle — run from repo root)
```bash
./gradlew run              # Start backend on http://localhost:8080
./gradlew build            # Compile, test, and run Scalafix checks
./gradlew test             # Run tests only
./gradlew checkScalafixMain  # Lint check (fails if fixes needed)
./gradlew applyScalafixMain  # Auto-apply Scalafix fixes
./gradlew docker           # Build Docker image mbtalive:2.0
```

### Frontend (Angular — run from `frontend/`)
```bash
npm start       # Dev server on http://localhost:4200 (proxies /api/** → localhost:8080)
npm run build   # Production build → frontend/dist/mbta-tracker-frontend
npm run watch   # Build in watch mode
npm test        # Run Karma/Jasmine tests
```

To run a single Karma test: `ng test --include='**/path/to/foo.spec.ts' --watch=false`

### Environment
- `MBTA_API_KEY` env var (optional): enables 1000 req/min vs 10 req/min against api-v3.mbta.com

## Architecture

### Stack
- **Backend:** Scala 3.3, Apache Pekko 1.4, Pekko HTTP 1.3, Spray JSON
- **Frontend:** Angular 20 (standalone components), RxJS 7.8, Leaflet 1.9, Angular Material

### Backend (`source/`)
Thin proxy over the MBTA v3 REST API with data enrichment. All logic lives in `source/scala/`:

- **`MBTAServer`** — entry point, wires routes
- **`MBTARoutes`** — HTTP route definitions exposing `/api/routes`, `/api/route/{id}/vehicles`, `/api/route/{id}/shapes`, `/api/route/{id}/stops`
- **`MBTAService`** — business logic: fetches vehicles, enriches with stop names, scheduled arrivals, and delay predictions from the MBTA API, then sorts
- **`MBTAClient`** — low-level HTTP client for api-v3.mbta.com
- **`JsonFormats`** — Spray JSON (de)serializers

### Frontend (`frontend/src/app/`)

**Standalone component tree:**
```
AppComponent
├── RoutesComponent       — sidebar route list
├── MapComponent          — Leaflet map (main view)
├── VehicleListComponent  — selected vehicle details panel
└── VehicleCompletionDialogComponent
```

**Services (state management via RxJS BehaviorSubjects):**
- **`VehicleService`** — owns all global state (`vehicles$`, `routes$`, `selectedRoute$`, `selectedVehicle$`); drives polling (vehicles every 10 s, routes every 30 s) via `switchMap`
- **`ApiService`** — HTTP wrapper; all calls go to `/api/**` which the dev proxy forwards to the backend
- **`MapService`** — Leaflet integration; manages markers, polylines, stop markers, and vehicle tracking
- **`CookieService`** — persists `AppSettings` (selected route, map center/zoom, panel visibility) to a 30-day cookie

**Data flow:**
```
selectedRoute$ change
  → switchMap → getRealTimeVehiclesByRoute (polls every 10 s)
  → combineLatest with routes$ to attach route type
  → filteredVehicles$ emits → components re-render
```

### Proxy / Dev Setup
`frontend/proxy.conf.json` forwards `/api/**` to `http://localhost:8080`. Both backend and frontend must be running for the app to work locally.

### Key Config Files
- `source/resources/MBTA.conf` — optional API key
- `source/resources/application.conf` — Pekko HTTP tuning (timeouts, max connections)
- `frontend/angular.json` — build budgets (500 kb initial warning, 1 mb error), CommonJS allowlist for Leaflet/polyline-encoded
- `frontend/src/styles.scss` — MBTA brand colors: navy `#003DA5`, orange `#ED8B00`, purple `#80276C`

### Scalafix Rules
`checkScalafixMain` enforces: `OrganizeImports`, `RemoveUnused`, `DisableSyntax`, `RedundantSyntax`. The build will fail if these are violated — run `applyScalafixMain` to auto-fix before committing Scala changes.
