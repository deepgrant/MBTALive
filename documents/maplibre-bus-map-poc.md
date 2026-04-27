# MapLibre GL JS Bus Map — Proof of Concept

**Date:** 2026-04-27
**Branch:** master
**Scope:** Bus routes only (route_type === 3)

---

## Background

The existing MBTA Tracker frontend uses [Leaflet](https://leafletjs.com/) with raster tiles for all route types. While functional, Leaflet renders a flat 2D map and does not support vector tiles or WebGL-based effects.

This PoC was motivated by [tmap.live](https://tmap.live), a similar MBTA live-vehicle tracker that uses MapLibre GL JS with MapTiler vector tiles. Its 3D-pitched dark map and smooth vector rendering were identified as a significant visual improvement worth exploring.

The goal: swap in MapLibre GL JS for bus routes — keeping Leaflet untouched for rapid transit — using [OpenFreeMap](https://openfreemap.org) as a free, no-API-key tile provider.

---

## Technology Comparison

| | **This project (pre-PoC)** | **tmap.live** | **This project (post-PoC, buses)** |
|---|---|---|---|
| Map library | Leaflet 1.9 | MapLibre GL JS | MapLibre GL JS 5.x |
| Tile type | Raster (OSM) | Vector (MapTiler .pbf) | Vector (OpenFreeMap .pbf) |
| Tile provider | OpenStreetMap | MapTiler | OpenFreeMap |
| API key required | No | Yes (MapTiler) | No |
| 3D pitch | No | Yes (~45°) | Yes (45°) |
| 3D buildings | No | Yes | Yes |
| Framework | Angular 20 | Next.js / React | Angular 20 (unchanged) |
| Mapping wrapper | MapService (Leaflet) | react-map-gl | BusMapService (MapLibre) |

---

## What Was Built

### New Files

| File | Purpose |
|---|---|
| `frontend/src/assets/map-styles/dark-bus.json` | Custom MapLibre style JSON — dark navy palette, 3D buildings, OpenFreeMap vector source |
| `frontend/src/app/services/bus-map.service.ts` | MapLibre map lifecycle, GeoJSON conversion, source/layer management |
| `frontend/src/app/components/bus-map/bus-map.component.ts` | Angular component — subscribes to VehicleService observables, drives BusMapService |
| `frontend/src/app/components/bus-map/bus-map.component.html` | Template — map container + alert ticker overlay |
| `frontend/src/app/components/bus-map/bus-map.component.scss` | Full-height container, ticker positioning |

### Modified Files

| File | Change |
|---|---|
| `frontend/package.json` | Added `maplibre-gl ^5.0.0` |
| `frontend/angular.json` | Added `maplibre-gl` to `allowedCommonJsDependencies`; raised bundle budget (maplibre-gl is ~700 KB) |
| `frontend/src/styles.scss` | Added `@import 'maplibre-gl/dist/maplibre-gl.css'` |
| `frontend/src/app/app.component.ts` | Added `isBusRoute` flag derived from `combineLatest([selectedRoute$, routes$])`; imported `BusMapComponent` |
| `frontend/src/app/app.component.html` | Conditionally renders `<app-bus-map>` (buses) or `<app-map>` (all other routes) |

---

## Architecture

### Map Swap Logic

`AppComponent` uses `combineLatest` over `selectedRoute$` and `routes$` to reactively derive `isBusRoute`:

```typescript
combineLatest([this.vehicleService.selectedRoute$, this.vehicleService.routes$]).subscribe(
  ([routeId, routes]) => {
    const route = routes.find(r => r.id === routeId);
    this.isBusRoute = route?.route_type === 3;
  }
)
```

The template swaps components via Angular 20 control flow:

```html
@if (isBusRoute) {
  <app-bus-map></app-bus-map>
} @else {
  <app-map></app-map>
}
```

When `BusMapComponent` is destroyed (user selects a rail route), `ngOnDestroy` calls `busMapService.destroyMap()` which calls MapLibre's `map.remove()` — releasing the WebGL context cleanly.

### Data Flow

No changes to the backend or `VehicleService`. `BusMapComponent` subscribes to the same observables already used by `MapComponent`:

```
selectedRoute$ change
  → BusMapComponent clears map, resolves Route object
  → selectedRouteShapes$ → BusMapService.updateRouteShapes() → GeoJSON LineString source
  → selectedRouteStations$ → BusMapService.updateStops() → GeoJSON Point source
  → filteredVehicles$ (polls every 10s) → BusMapService.updateVehicles() → GeoJSON Point source
```

### GeoJSON Conversion

`BusMapService` applies the same shape-filtering logic as `MapService.addRouteLayer`:
- Drop shapes with `priority < 0`
- Prefer `canonical-` prefixed shapes when available
- Keep all shapes at the maximum priority per `directionId` (preserves branch routes)

**Critical coordinate flip:** `@mapbox/polyline` decodes encoded polylines as `[lat, lng]` pairs. MapLibre GL (and GeoJSON) require `[lng, lat]`. Every decoded coordinate is flipped: `[coord[1], coord[0]]`.

### Pending Update Queue

There is a race condition between Angular's `ngAfterViewInit` (which initializes the map with a 300ms delay) and `ngOnInit` subscriptions (which can receive data immediately). `BusMapService` stores pending shape/stop/vehicle updates and flushes them in the MapLibre `load` event callback.

### Map Style

`dark-bus.json` is a hand-authored MapLibre style that references OpenFreeMap's planet vector tiles:

```json
"sources": {
  "openmaptiles": {
    "type": "vector",
    "url": "https://tiles.openfreemap.org/planet"
  }
}
```

Layers rendered (OpenMapTiles schema source-layers): `landcover`, `landuse`, `water`, `waterway`, `building` (fill + fill-extrusion for 3D), `transportation`, `transportation_name`, `place`, `boundary`.

Palette: background `#12181f`, water `#0d1e2e`, buildings `#1e2d3d`, roads dark slate, labels `#8eaabf`.

The route line, stops, and vehicle circles are added as runtime GeoJSON layers on top of the basemap — not part of the style JSON.

---

## Known Limitations / Post-PoC Work

| Item | Notes |
|---|---|
| Vehicle bearing | MapLibre `circle` layers do not rotate. Bearing is stored in GeoJSON properties but not yet visualised. A `symbol` layer with a rotated icon would be needed. |
| Vehicle selection | Clicking a vehicle on the MapLibre map does not select it in `VehicleService`. Event handlers (`map.on('click', layerId, ...)`) need wiring. |
| Vehicle tracking | The "track vehicle" feature (follows a selected vehicle) is not implemented for the bus map. |
| Cookie-restored bus route | `restoreRouteFromCookie()` is called from `MapComponent.ngAfterViewInit`. When a bus route is restored, Leaflet mounts briefly before being swapped out. Harmless for PoC; fix by moving the restore call to `AppComponent`. |
| Dark style completeness | The custom style omits some landuse classes, POI labels, and transit rail styling present in the liberty style. Sufficient for PoC. |
| Bundle size | Adding maplibre-gl increases the initial bundle by ~700 KB (gzipped). Lazy-loading `BusMapComponent` via Angular's deferred loading would eliminate this for users who never select a bus route. |
| Commuter Rail | route_type 2 still uses Leaflet. Could be extended to MapLibre with the same pattern. |

---

## How to Run

```bash
# Backend (repo root)
./gradlew run

# Frontend (frontend/ directory)
npm start
# or
ng serve --proxy-config proxy.conf.json --host=0.0.0.0
```

Navigate to **http://localhost:4200**, select any bus route from the sidebar (e.g. Route 1, 39, 66, SL1). The dark 3D MapLibre map will render. Selecting a rail route returns to the Leaflet map.
