import { Injectable } from '@angular/core';
import maplibregl, { Map as MaplibreMap, GeoJSONSource, Marker } from 'maplibre-gl';
import * as polyline from '@mapbox/polyline';
import { Vehicle } from '../models/vehicle.model';
import { Route, Shape } from '../models/route.model';
import { Station } from '../models/station.model';
import { CookieService } from './cookie.service';
import { ROUTE_TYPE } from './vehicle-format.service';

interface SimpleBounds {
  minLat: number; maxLat: number;
  minLng: number; maxLng: number;
}

interface TypicalityLineStyle {
  opacity: number;
  width: number;
  dasharray?: number[];
}

interface TypicalityStyle {
  id: number;
  filter: unknown[];
  casing: TypicalityLineStyle & { color: string };
  line: TypicalityLineStyle;
}

@Injectable({ providedIn: 'root' })
export class MapService {
  private map: MaplibreMap | null = null;
  private mapLoaded = false;
  private vehicleMarkers: Map<string, Marker> = new Map();
  private vehicleMarkerHtml: Map<string, string> = new Map();
  private stationMarkers: Map<string, Marker> = new Map();
  private stationMarkerHtml: Map<string, string> = new Map();
  private currentStations: Station[] = [];
  private alertedStationIds: Set<string> = new Set();
  private delayedStationIds: Set<string> = new Set();
  private routeBounds: SimpleBounds | null = null;
  private stationBounds: SimpleBounds | null = null;
  private boundsSaveTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly BOUNDS_SAVE_DELAY = 2500;
  // Tooltip flash thresholds — deliberately looser than the board's 5-minute
  // "late" threshold (shared/delay.utils.ts): markers only flash for extreme delays.
  /** Flash the trip name once a vehicle is more than 15 minutes late. */
  private readonly MARKER_FLASH_CRITICAL_SECONDS = 900;
  /** Also flash the "Trip:" label once a vehicle is 30+ minutes late. */
  private readonly MARKER_FLASH_SEVERE_SECONDS = 1800;
  private boundsRestored = false;
  private sessionInitialized = false;
  private pendingShapes: { shapes: Shape[]; route: Route } | null = null;

  private readonly SOURCE_ROUTE = 'route-source';

  private readonly typicalityStyles: TypicalityStyle[] = [
    {
      id: 1,
      filter: ['==', ['get', 'typicality'], 1],
      casing: { color: '#ffffff', opacity: 0.35, width: 10 },
      line:   { opacity: 0.9,  width: 6 },
    },
    {
      id: 2,
      filter: ['==', ['get', 'typicality'], 2],
      casing: { color: '#ffffff', opacity: 0.35, width: 8, dasharray: [4, 3] },
      line:   { opacity: 0.5,  width: 4, dasharray: [4, 3] },
    },
    {
      id: 3,
      filter: ['==', ['get', 'typicality'], 3],
      casing: { color: '#808080', opacity: 0.3,  width: 8, dasharray: [4, 3] },
      line:   { opacity: 0.3,  width: 4, dasharray: [4, 3] },
    },
    {
      id: 4,
      filter: ['>=', ['get', 'typicality'], 4],
      casing: { color: '#bfbfbf', opacity: 0.15, width: 8, dasharray: [4, 3] },
      line:   { opacity: 0.15, width: 4 },
    },
  ];

  constructor(private cookieService: CookieService) {}

  initializeMap(containerId: string): void {
    if (this.map) {
      // remove() destroys all marker DOM along with the map, so the cached
      // Marker objects are dead — drop them or the next sync would "update"
      // markers that no longer exist on screen (mobile board↔map toggle).
      this.map.remove();
      this.mapLoaded = false;
      this.boundsRestored = false;
      this.vehicleMarkers.clear();
      this.vehicleMarkerHtml.clear();
      this.stationMarkers.clear();
      this.stationMarkerHtml.clear();
    }

    this.map = new maplibregl.Map({
      container: containerId,
      style: 'assets/map-styles/dark-map.json',
      center: [-71.0589, 42.3601],
      zoom: 10,
      pitch: 45,
      attributionControl: false
    });

    this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    this.restoreMapBounds();
    this.setupMapBoundsSaving();

    this.map.on('load', () => {
      this.map!.addSource(this.SOURCE_ROUTE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      // Add layers bottom-to-top: typicality 4 first, 1 last (most important on top).
      // Casing and line are interleaved per level so each line sits above its own casing.
      for (const style of [...this.typicalityStyles].sort((a, b) => b.id - a.id)) {
        const cap = style.casing.dasharray ? 'butt' : 'round';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const casingPaint: Record<string, any> = {
          'line-color': style.casing.color,
          'line-width': style.casing.width,
          'line-opacity': style.casing.opacity,
        };
        if (style.casing.dasharray) casingPaint['line-dasharray'] = style.casing.dasharray;
        this.map!.addLayer({
          id: `route-casing-${style.id}`,
          type: 'line',
          source: this.SOURCE_ROUTE,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          filter: style.filter as any,
          layout: { 'line-join': 'round', 'line-cap': cap },
          paint: casingPaint,
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const linePaint: Record<string, any> = {
          'line-color': ['get', 'routeColor'],
          'line-width': style.line.width,
          'line-opacity': style.line.opacity,
        };
        if (style.line.dasharray) linePaint['line-dasharray'] = style.line.dasharray;
        this.map!.addLayer({
          id: `route-line-${style.id}`,
          type: 'line',
          source: this.SOURCE_ROUTE,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          filter: style.filter as any,
          layout: { 'line-join': 'round', 'line-cap': cap },
          paint: linePaint,
        });
      }
      this.mapLoaded = true;
      if (this.pendingShapes) {
        this.applyRouteShapes(this.pendingShapes.shapes, this.pendingShapes.route);
        this.pendingShapes = null;
      }
    });
  }

  updateVehicleMarkers(vehicles: Vehicle[]): void {
    this.syncMarkers(this.vehicleMarkers, this.vehicleMarkerHtml, vehicles, {
      id: v => v.vehicleId ?? '',
      lngLat: v => [v.longitude, v.latitude],
      html: v => this.createVehicleMarkerHtml(v),
      zIndex: '2',
    });
  }

  /**
   * Diffs markers against `items` instead of recreating them: existing markers
   * are moved with setLngLat (so they glide rather than blink on each poll) and
   * their HTML is only rewritten when the rendered string actually changed;
   * markers whose id is absent from `items` are removed.
   */
  private syncMarkers<T>(
    markers: Map<string, Marker>,
    htmlCache: Map<string, string>,
    items: T[],
    opts: {
      id: (item: T) => string;
      lngLat: (item: T) => [number, number];
      html: (item: T) => string;
      zIndex: string;
    }
  ): void {
    const map = this.map;
    if (!map) return;

    const seen = new Set<string>();
    for (const item of items) {
      const id = opts.id(item);
      if (!id) continue;
      seen.add(id);

      const html = opts.html(item);
      const existing = markers.get(id);
      if (existing) {
        existing.setLngLat(opts.lngLat(item));
        if (htmlCache.get(id) !== html) {
          existing.getElement().innerHTML = html;
          htmlCache.set(id, html);
        }
      } else {
        const el = document.createElement('div');
        el.style.zIndex = opts.zIndex;
        el.innerHTML = html;
        markers.set(id, new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat(opts.lngLat(item))
          .addTo(map));
        htmlCache.set(id, html);
      }
    }

    for (const [id, marker] of markers) {
      if (!seen.has(id)) {
        marker.remove();
        markers.delete(id);
        htmlCache.delete(id);
      }
    }
  }

  addRouteLayer(route: Route, shapes: Shape[]): void {
    if (!this.mapLoaded) {
      this.pendingShapes = { shapes, route };
      return;
    }
    this.applyRouteShapes(shapes, route);
  }

  private applyRouteShapes(shapes: Shape[], route: Route): void {
    const candidates = shapes.filter(s => s.priority >= 0);

    const maxPriority = new Map<number, number>();
    for (const shape of candidates) {
      const current = maxPriority.get(shape.directionId) ?? -Infinity;
      if (shape.priority > current) maxPriority.set(shape.directionId, shape.priority);
    }
    const shapesToDraw = candidates.filter(
      s => s.priority === maxPriority.get(s.directionId)
    );

    const bounds: SimpleBounds = {
      minLat: Infinity, maxLat: -Infinity,
      minLng: Infinity, maxLng: -Infinity
    };

    const features = shapesToDraw.flatMap(shape => {
      const coords = this.decodePolylineToLngLat(shape.polyline);
      if (coords.length === 0) return [];
      coords.forEach(([lng, lat]) => {
        if (lat < bounds.minLat) bounds.minLat = lat;
        if (lat > bounds.maxLat) bounds.maxLat = lat;
        if (lng < bounds.minLng) bounds.minLng = lng;
        if (lng > bounds.maxLng) bounds.maxLng = lng;
      });
      return [{
        type: 'Feature' as const,
        properties: { routeColor: `#${route.color}`, typicality: shape.typicality ?? 1 },
        geometry: { type: 'LineString' as const, coordinates: coords }
      }];
    });

    this.routeBounds = bounds.minLat !== Infinity ? bounds : null;
    (this.map!.getSource(this.SOURCE_ROUTE) as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features
    });
  }

  clearRouteLayers(): void {
    this.pendingShapes = null;
    this.routeBounds = null;
    if (!this.map || !this.mapLoaded) return;
    (this.map.getSource(this.SOURCE_ROUTE) as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: []
    });
  }

  updateStationAlerts(alertedStopIds: Set<string>, delayedStopIds: Set<string> = new Set()): void {
    this.alertedStationIds = alertedStopIds;
    this.delayedStationIds = delayedStopIds;
    if (this.currentStations.length === 0) return;
    // The HTML diff in syncMarkers re-renders only stations whose
    // alerted/delayed membership actually changed.
    this.syncStationMarkers(this.currentStations);
  }

  updateStationMarkers(stations: Station[]): void {
    this.currentStations = stations;
    this.syncStationMarkers(stations);

    const bounds: SimpleBounds = {
      minLat: Infinity, maxLat: -Infinity,
      minLng: Infinity, maxLng: -Infinity
    };

    stations.forEach(station => {
      if (station.latitude < bounds.minLat) bounds.minLat = station.latitude;
      if (station.latitude > bounds.maxLat) bounds.maxLat = station.latitude;
      if (station.longitude < bounds.minLng) bounds.minLng = station.longitude;
      if (station.longitude > bounds.maxLng) bounds.maxLng = station.longitude;
    });

    this.stationBounds = stations.length > 0 ? bounds : null;
  }

  private syncStationMarkers(stations: Station[]): void {
    this.syncMarkers(this.stationMarkers, this.stationMarkerHtml, stations, {
      id: s => s.id,
      lngLat: s => [s.longitude, s.latitude],
      html: s => this.createStationMarkerHtml(
        s, this.alertedStationIds.has(s.id), this.delayedStationIds.has(s.id)),
      zIndex: '1',
    });
  }

  clearStationMarkers(): void {
    this.currentStations = [];
    this.alertedStationIds = new Set();
    this.delayedStationIds = new Set();
    this.stationBounds = null;
    if (!this.map) return;
    this.stationMarkers.forEach(m => m.remove());
    this.stationMarkers.clear();
    this.stationMarkerHtml.clear();
  }

  fitBoundsToRoute(): void {
    if (!this.map) return;

    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;
    let hasContent = false;

    const merge = (b: SimpleBounds) => {
      if (b.minLat < minLat) minLat = b.minLat;
      if (b.maxLat > maxLat) maxLat = b.maxLat;
      if (b.minLng < minLng) minLng = b.minLng;
      if (b.maxLng > maxLng) maxLng = b.maxLng;
      hasContent = true;
    };

    if (this.routeBounds) merge(this.routeBounds);
    if (this.stationBounds) merge(this.stationBounds);

    if (hasContent) {
      this.map.fitBounds(
        [[minLng, minLat], [maxLng, maxLat]],
        { padding: { top: 80, bottom: 80, left: 60, right: 60 }, pitch: 45 }
      );
    }
  }

  wereBoundsRestored(): boolean {
    return this.boundsRestored;
  }

  isSessionInitialized(): boolean {
    return this.sessionInitialized;
  }

  markSessionInitialized(): void {
    this.sessionInitialized = true;
  }

  private createVehicleMarkerHtml(vehicle: Vehicle): string {
    const rotation = vehicle.bearing ?? 0;
    const opacity = vehicle.positionStale ? '0.55' : '1';
    const isOutbound = vehicle.direction === 'Outbound'
      || vehicle.direction === 'South'
      || vehicle.direction === 'West';

    const arrowClass = (!vehicle.bearingReported && !vehicle.positionStale)
      ? 'vehicle-marker-direction vehicle-marker-direction-unknown'
      : 'vehicle-marker-direction';

    const tooltipClass = isOutbound ? 'vehicle-tooltip-outbound' : 'vehicle-tooltip';
    const labelPos = isOutbound
      ? `top: calc(100% + 4px); left: 50%; transform: translateX(-50%);`
      : `bottom: calc(100% + 4px); left: 50%; transform: translateX(-50%);`;

    return `
      <div style="position: relative; width: 20px; height: 20px;">
        <div class="vehicle-marker-container" style="transform: rotate(${rotation}deg); width: 20px; height: 20px; opacity: ${opacity};">
          <div class="vehicle-marker-circle" style="
            width: 20px;
            height: 20px;
            background-color: ${this.vehicleMarkerColor(vehicle)};
            border: 2px solid #ffffff;
          ">
            ${this.vehicleCircleInner(vehicle)}
          </div>
          <div class="${arrowClass}"></div>
        </div>
        <div class="${tooltipClass}" style="position: absolute; ${labelPos} pointer-events: none;">${this.vehicleTooltipHtml(vehicle)}</div>
      </div>
    `;
  }

  private vehicleMarkerColor(vehicle: Vehicle): string {
    if (vehicle.positionStale) return '#9e9e9e';
    if (vehicle.delayStatus === 'minor-delay') return '#ffc107';
    if (vehicle.delayStatus === 'major-delay') return '#dc3545';
    return '#2196F3';
  }

  // Circle inner content — priority: stale > speed unreported > speed number (rail only)
  private vehicleCircleInner(vehicle: Vehicle): string {
    if (vehicle.positionStale) return '<div class="vehicle-marker-icon">🚂</div>';
    if (!vehicle.speedReported) return '<div class="vehicle-marker-icon">🎱</div>';
    if (vehicle.routeType !== ROUTE_TYPE.BUS) {
      return `<div class="vehicle-marker-speed">${(vehicle.speed ?? 0).toFixed(0)}</div>`;
    }
    return '';
  }

  private vehicleTooltipHtml(vehicle: Vehicle): string {
    const speed = vehicle.speed ?? 0;
    const delaySeconds = vehicle.delaySeconds ?? 0;
    const tripNameClass = delaySeconds > this.MARKER_FLASH_CRITICAL_SECONDS ? 'flash-trip-name' : '';
    const tripLabelClass = delaySeconds >= this.MARKER_FLASH_SEVERE_SECONDS ? 'flash-trip-label' : '';

    let staleHtml = '';
    if (vehicle.positionStale && vehicle.updatedAt) {
      const ageMs = Date.now() - new Date(vehicle.updatedAt).getTime();
      const ageMin = Math.round(ageMs / 60000);
      const movingText = speed > 0 ? `moving at ${speed.toFixed(0)} mph` : 'stopped';
      staleHtml = `<div style="color:#e65100;margin-top:4px;">&#9888; Position not reported<br>Last seen ${ageMin} min ago &mdash; ${movingText}</div>`;
    }

    const pirateFlag = vehicle.positionStale ? ' 🏴‍☠️' : '';
    return vehicle.tripName
      ? `<div><strong>ID:</strong> ${vehicle.vehicleId}${pirateFlag}</div><div><strong class="${tripLabelClass}">Trip:</strong> <span class="${tripNameClass}">${vehicle.tripName}</span></div>${staleHtml}`
      : `<div><strong>ID:</strong> ${vehicle.vehicleId}${pirateFlag}</div>${staleHtml}`;
  }

  private createStationMarkerHtml(station: Station, alerted: boolean, delayed: boolean = false): string {
    const alertRing = alerted ? `<div class="station-alert-ring"></div>` : '';
    const delaySquare = delayed ? `<div class="station-delay-square"></div>` : '';
    return `
      <div style="position: relative; width: 24px; height: 24px;">
        ${delaySquare}${alertRing}
        <img src="assets/favicon.png"
             style="width: 24px; height: 24px; display: block;"
             alt="${station.name}">
        <div style="
          position: absolute;
          top: 28px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 8px;
          color: #ccc;
          font-weight: bold;
          background: rgba(20,30,40,0.85);
          padding: 1px 3px;
          border-radius: 2px;
          white-space: nowrap;
          max-width: 70px;
          overflow: hidden;
          text-overflow: ellipsis;
          box-shadow: 0 1px 2px rgba(0,0,0,0.5);
        ">${station.name}</div>
      </div>
    `;
  }

  private decodePolylineToLngLat(encoded: string): [number, number][] {
    try {
      const decoded = polyline.decode(encoded);
      return decoded.map(([lat, lng]: [number, number]) => [lng, lat]);
    } catch (error) {
      console.error('MapService: Error decoding polyline:', error);
      return [];
    }
  }

  private setupMapBoundsSaving(): void {
    if (!this.map) return;
    this.map.on('moveend', () => this.debouncedSaveMapBounds());
    this.map.on('zoomend', () => this.debouncedSaveMapBounds());
  }

  private debouncedSaveMapBounds(): void {
    if (this.boundsSaveTimeout) clearTimeout(this.boundsSaveTimeout);
    this.boundsSaveTimeout = setTimeout(() => this.saveMapBounds(), this.BOUNDS_SAVE_DELAY);
  }

  private saveMapBounds(): void {
    if (!this.map) return;
    const center = this.map.getCenter();
    this.cookieService.updateSettings({
      mapCenter: { lat: center.lat, lng: center.lng },
      mapZoom: this.map.getZoom()
    });
  }

  private restoreMapBounds(): void {
    if (!this.map) return;
    const settings = this.cookieService.getSettingsCookie();
    const mapCenter = settings?.mapCenter;
    const mapZoom = settings?.mapZoom;

    if (mapCenter && mapZoom !== undefined) {
      const { lat, lng } = mapCenter;
      const zoom = mapZoom;
      if (
        !isNaN(lat) && !isNaN(lng) && !isNaN(zoom) &&
        lat >= -90 && lat <= 90 &&
        lng >= -180 && lng <= 180 &&
        zoom >= 0 && zoom <= 19
      ) {
        this.boundsRestored = true;
        this.map.jumpTo({ center: [lng, lat], zoom });
      } else {
        this.clearMapBoundsCookies();
      }
    }
  }

  private clearMapBoundsCookies(): void {
    this.cookieService.updateSettings({ mapCenter: undefined, mapZoom: undefined });
  }
}
