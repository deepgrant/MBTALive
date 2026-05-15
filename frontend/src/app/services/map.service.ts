import { Injectable } from '@angular/core';
import maplibregl, { Map as MaplibreMap, GeoJSONSource, Marker } from 'maplibre-gl';
import * as polyline from '@mapbox/polyline';
import { Vehicle } from '../models/vehicle.model';
import { Route, Shape } from '../models/route.model';
import { Station } from '../models/station.model';
import { VehicleCompletionDialogService } from './vehicle-completion-dialog.service';
import { CookieService } from './cookie.service';
import { VehicleService } from './vehicle.service';
import { ROUTE_TYPE } from './vehicle-format.service';

interface SimpleBounds {
  minLat: number; maxLat: number;
  minLng: number; maxLng: number;
}

@Injectable({ providedIn: 'root' })
export class MapService {
  private map: MaplibreMap | null = null;
  private mapLoaded = false;
  private vehicleMarkers: Map<string, Marker> = new Map();
  private stationMarkers: Map<string, Marker> = new Map();
  private currentStations: Station[] = [];
  private alertedStationIds: Set<string> = new Set();
  private highlightOverlay: Marker | null = null;
  private vehicleData: Map<string, Vehicle> = new Map();
  private trackedVehicleId: string | null = null;
  private trackedVehicleRouteId: string | null = null;
  private previousView: { lng: number; lat: number; zoom: number } | null = null;
  private trackingInterval: ReturnType<typeof setInterval> | null = null;
  private routeBounds: SimpleBounds | null = null;
  private stationBounds: SimpleBounds | null = null;
  private lastTrackedVehicleData: Vehicle | null = null;
  private isTrackingActive = false;
  private boundsSaveTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly BOUNDS_SAVE_DELAY = 2500;
  private boundsRestored = false;
  private pendingShapes: { shapes: Shape[]; route: Route } | null = null;

  private readonly SOURCE_ROUTE = 'route-source';

  private readonly typicalityStyles = [
    {
      id: 1,
      filter: ['==', ['get', 'typicality'], 1],
      casing: { color: '#ffffff', opacity: 0.35, width: 10, dasharray: undefined as number[] | undefined },
      line:   { opacity: 0.9,  width: 6, dasharray: undefined as number[] | undefined },
    },
    {
      id: 2,
      filter: ['==', ['get', 'typicality'], 2],
      casing: { color: '#ffffff', opacity: 0.35, width: 8,  dasharray: [4, 3] as number[] | undefined },
      line:   { opacity: 0.5,  width: 4, dasharray: [4, 3] as number[] | undefined },
    },
    {
      id: 3,
      filter: ['==', ['get', 'typicality'], 3],
      casing: { color: '#808080', opacity: 0.3, width: 8,  dasharray: [4, 3] as number[] | undefined },
      line:   { opacity: 0.3,  width: 4, dasharray: [4, 3] as number[] | undefined },
    },
    {
      id: 4,
      filter: ['>=', ['get', 'typicality'], 4],
      casing: { color: '#bfbfbf', opacity: 0.15, width: 8, dasharray: [4, 3] as number[] | undefined },
      line:   { opacity: 0.15, width: 4, dasharray: undefined as number[] | undefined },
    },
  ];

  constructor(
    private dialogService: VehicleCompletionDialogService,
    private cookieService: CookieService,
    private vehicleService: VehicleService
  ) {}

  initializeMap(containerId: string): void {
    if (this.map) {
      this.map.remove();
      this.mapLoaded = false;
      this.boundsRestored = false;
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

  getMap(): MaplibreMap | null {
    return this.map;
  }

  addVehicleMarker(vehicle: Vehicle): void {
    if (!this.map) return;
    const markerId = vehicle.vehicleId ?? '';
    if (!markerId) return;

    this.vehicleData.set(markerId, vehicle);

    const existing = this.vehicleMarkers.get(markerId);
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.innerHTML = this.createVehicleMarkerHtml(vehicle, false);
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      this.vehicleService.selectVehicle(markerId);
      this.centerOnVehicle(markerId);
    });

    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([vehicle.longitude, vehicle.latitude])
      .addTo(this.map);

    this.vehicleMarkers.set(markerId, marker);
  }

  updateVehicleMarkers(vehicles: Vehicle[], currentRouteId?: string | null): void {
    if (!this.map) return;

    const currentlyTrackedVehicle = this.trackedVehicleId;
    const trackedVehicleInList = currentlyTrackedVehicle
      ? vehicles.find(v => v.vehicleId === currentlyTrackedVehicle)
      : null;
    const trackedVehicleStillExists = trackedVehicleInList != null;

    if (currentlyTrackedVehicle && !trackedVehicleStillExists && this.isTrackingActive) {
      if (currentRouteId && this.trackedVehicleRouteId && currentRouteId === this.trackedVehicleRouteId) {
        this.handleVehicleDisappeared(true);
      } else if (this.isTrackingActive) {
        this.handleVehicleDisappeared(true);
      }
    } else if (trackedVehicleInList && this.trackedVehicleRouteId && trackedVehicleInList.routeId !== this.trackedVehicleRouteId) {
      this.handleVehicleDisappeared(true);
    }

    this.vehicleMarkers.forEach(m => m.remove());
    this.vehicleMarkers.clear();
    this.vehicleData.clear();

    vehicles.forEach(vehicle => {
      this.addVehicleMarker(vehicle);
      if (this.trackedVehicleId === vehicle.vehicleId) {
        this.lastTrackedVehicleData = { ...vehicle };
      }
    });

    if (currentlyTrackedVehicle && trackedVehicleStillExists) {
      const trackedVehicle = vehicles.find(v => v.vehicleId === currentlyTrackedVehicle);
      if (trackedVehicle) this.lastTrackedVehicleData = { ...trackedVehicle };
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

  addStationMarker(station: Station): void {
    if (!this.map) return;
    const markerId = station.id;
    const existing = this.stationMarkers.get(markerId);
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.innerHTML = this.createStationMarkerHtml(station, this.alertedStationIds.has(station.id));

    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([station.longitude, station.latitude])
      .addTo(this.map);

    this.stationMarkers.set(markerId, marker);
  }

  updateStationAlerts(alertedStopIds: Set<string>): void {
    this.alertedStationIds = alertedStopIds;
    if (!this.map || this.currentStations.length === 0) return;
    this.stationMarkers.forEach(m => m.remove());
    this.stationMarkers.clear();
    this.currentStations.forEach(station => this.addStationMarker(station));
  }

  updateStationMarkers(stations: Station[]): void {
    this.currentStations = stations;
    if (!this.map) return;
    this.stationMarkers.forEach(m => m.remove());
    this.stationMarkers.clear();

    const bounds: SimpleBounds = {
      minLat: Infinity, maxLat: -Infinity,
      minLng: Infinity, maxLng: -Infinity
    };

    stations.forEach(station => {
      this.addStationMarker(station);
      if (station.latitude < bounds.minLat) bounds.minLat = station.latitude;
      if (station.latitude > bounds.maxLat) bounds.maxLat = station.latitude;
      if (station.longitude < bounds.minLng) bounds.minLng = station.longitude;
      if (station.longitude > bounds.maxLng) bounds.maxLng = station.longitude;
    });

    this.stationBounds = stations.length > 0 ? bounds : null;
  }

  clearStationMarkers(): void {
    this.currentStations = [];
    this.alertedStationIds = new Set();
    if (!this.map) return;
    this.stationMarkers.forEach(m => m.remove());
    this.stationMarkers.clear();
    this.stationBounds = null;
  }

  fitBoundsToVehicles(vehicles: Vehicle[]): void {
    if (!this.map || vehicles.length === 0) return;
    const lats = vehicles.map(v => v.latitude);
    const lngs = vehicles.map(v => v.longitude);
    this.map.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 20, pitch: 45 }
    );
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

  centerOnVehicle(vehicleId: string): void {
    if (!this.map) return;
    if (this.trackedVehicleId === vehicleId) {
      this.stopVehicleTracking();
      return;
    }
    if (this.trackedVehicleId !== null) this.stopVehicleTracking();
    this.startVehicleTracking(vehicleId);
  }

  private startVehicleTracking(vehicleId: string): void {
    if (!this.map) return;
    const marker = this.vehicleMarkers.get(vehicleId);
    if (!marker) return;

    const center = this.map.getCenter();
    this.previousView = { lng: center.lng, lat: center.lat, zoom: this.map.getZoom() };

    const vehicle = this.vehicleData.get(vehicleId);
    if (vehicle) {
      this.lastTrackedVehicleData = { ...vehicle };
      this.trackedVehicleRouteId = vehicle.routeId;
    }

    this.trackedVehicleId = vehicleId;
    this.isTrackingActive = true;

    const pos = marker.getLngLat();
    this.map.easeTo({ center: [pos.lng, pos.lat], zoom: 15, pitch: 45 });

    this.trackingInterval = setInterval(() => {
      if (!this.map || !this.trackedVehicleId || !this.isTrackingActive) return;
      const trackedMarker = this.vehicleMarkers.get(this.trackedVehicleId);
      if (trackedMarker) {
        const currentVehicle = this.vehicleData.get(this.trackedVehicleId);
        if (currentVehicle) this.lastTrackedVehicleData = { ...currentVehicle };
        const p = trackedMarker.getLngLat();
        this.map.easeTo({ center: [p.lng, p.lat], zoom: 15, pitch: 45, duration: 1000 });
      } else {
        this.handleVehicleDisappeared(false);
      }
    }, 2000);
  }

  private stopVehicleTracking(): void {
    this.isTrackingActive = false;
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = null;
    }
    if (this.map && this.previousView) {
      this.map.easeTo({
        center: [this.previousView.lng, this.previousView.lat],
        zoom: this.previousView.zoom,
        pitch: 45
      });
    }
    this.trackedVehicleId = null;
    this.trackedVehicleRouteId = null;
    this.previousView = null;
    this.lastTrackedVehicleData = null;
  }

  stopVehicleTrackingSilently(): void {
    this.isTrackingActive = false;
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = null;
    }
    this.trackedVehicleId = null;
    this.trackedVehicleRouteId = null;
    this.lastTrackedVehicleData = null;
  }

  private handleVehicleDisappeared(premature: boolean): void {
    if (!this.isTrackingActive || !this.trackedVehicleId || !this.lastTrackedVehicleData) return;
    const trackedData = { ...this.lastTrackedVehicleData };
    const vehicleId = this.trackedVehicleId;
    const routeId = trackedData.routeId;
    const lastUpdateTime = trackedData.updatedAt || new Date().toISOString();
    const finalArrivalTime = trackedData.predictedArrivalTime ?? trackedData.scheduledArrivalTime;
    this.stopVehicleTracking();
    this.fitBoundsToRoute();
    this.dialogService.showDialog({
      vehicleId, routeId, completedNormally: !premature, finalArrivalTime, lastUpdateTime
    });
  }

  highlightVehicleMarker(vehicleId: string): void {
    if (!this.map) return;
    if (this.highlightOverlay) {
      this.highlightOverlay.remove();
      this.highlightOverlay = null;
    }
    const marker = this.vehicleMarkers.get(vehicleId);
    if (!marker || !this.vehicleData.get(vehicleId)) return;

    const el = document.createElement('div');
    el.innerHTML = '<div class="highlight-ring"></div>';

    this.highlightOverlay = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat(marker.getLngLat())
      .addTo(this.map);

    setTimeout(() => {
      if (this.highlightOverlay) {
        this.highlightOverlay.remove();
        this.highlightOverlay = null;
      }
    }, 2000);
  }

  wereBoundsRestored(): boolean {
    return this.boundsRestored;
  }

  private createVehicleMarkerHtml(vehicle: Vehicle, isHighlighted: boolean = false): string {
    const rotation = vehicle.bearing ?? 0;
    const speed = vehicle.speed ?? 0;
    const isBus = vehicle.routeType === ROUTE_TYPE.BUS;
    const size = isHighlighted ? 24 : 20;
    const borderWidth = isHighlighted ? 3 : 2;
    const borderColor = isHighlighted ? '#FF5722' : '#ffffff';
    const opacity = vehicle.positionStale ? '0.55' : '1';
    const isOutbound = vehicle.direction === 'Outbound'
      || vehicle.direction === 'South'
      || vehicle.direction === 'West';

    let markerBackgroundColor = vehicle.positionStale ? '#9e9e9e' : '#2196F3';
    if (!vehicle.positionStale) {
      if (vehicle.delayStatus === 'minor-delay') markerBackgroundColor = '#ffc107';
      else if (vehicle.delayStatus === 'major-delay') markerBackgroundColor = '#dc3545';
    }

    const delaySeconds = vehicle.delaySeconds ?? 0;
    const hasCriticalDelay = delaySeconds > 900;
    const hasSevereDelay = delaySeconds >= 1800;
    let tripNameClass = '';
    let tripLabelClass = '';
    if (hasSevereDelay) {
      tripNameClass = 'flash-trip-name';
      tripLabelClass = 'flash-trip-label';
    } else if (hasCriticalDelay) {
      tripNameClass = 'flash-trip-name';
    }

    let staleHtml = '';
    if (vehicle.positionStale && vehicle.updatedAt) {
      const ageMs = Date.now() - new Date(vehicle.updatedAt).getTime();
      const ageMin = Math.round(ageMs / 60000);
      const movingText = speed > 0 ? `moving at ${speed.toFixed(0)} mph` : 'stopped';
      staleHtml = `<div style="color:#e65100;margin-top:4px;">&#9888; Position not reported<br>Last seen ${ageMin} min ago &mdash; ${movingText}</div>`;
    }

    const labelContent = vehicle.tripName
      ? `<div><strong>ID:</strong> ${vehicle.vehicleId}</div><div><strong class="${tripLabelClass}">Trip:</strong> <span class="${tripNameClass}">${vehicle.tripName}</span></div>${staleHtml}`
      : `<div><strong>ID:</strong> ${vehicle.vehicleId}</div>${staleHtml}`;

    const tooltipClass = isOutbound ? 'vehicle-tooltip-outbound' : 'vehicle-tooltip';
    const labelPos = isOutbound
      ? `top: calc(100% + 4px); left: 50%; transform: translateX(-50%);`
      : `bottom: calc(100% + 4px); left: 50%; transform: translateX(-50%);`;

    return `
      <div style="position: relative; width: ${size}px; height: ${size}px;">
        <div class="vehicle-marker-container" style="transform: rotate(${rotation}deg); width: ${size}px; height: ${size}px; opacity: ${opacity};">
          <div class="vehicle-marker-circle" style="
            width: ${size}px;
            height: ${size}px;
            background-color: ${markerBackgroundColor};
            border: ${borderWidth}px solid ${borderColor};
            ${isHighlighted ? 'box-shadow: 0 0 10px rgba(255, 87, 34, 0.8);' : ''}
          ">
            ${isBus ? '' : `<div class="vehicle-marker-speed">${speed.toFixed(0)}</div>`}
          </div>
          <div class="vehicle-marker-direction"></div>
          ${isHighlighted ? '<div class="vehicle-marker-highlight-ring"></div>' : ''}
        </div>
        <div class="${tooltipClass}" style="position: absolute; ${labelPos} pointer-events: none;">${labelContent}</div>
      </div>
    `;
  }

  private createStationMarkerHtml(station: Station, alerted: boolean): string {
    const alertRing = alerted
      ? `<div class="station-alert-ring"></div>`
      : '';
    return `
      <div style="position: relative; width: 24px; height: 24px;">
        ${alertRing}
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
    const zoom = this.map.getZoom();
    const currentSettings = this.cookieService.getSettingsCookie() ?? {};
    currentSettings.mapCenter = { lat: center.lat, lng: center.lng };
    currentSettings.mapZoom = zoom;
    this.cookieService.setSettingsCookie(currentSettings);
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
    const currentSettings = this.cookieService.getSettingsCookie() ?? {};
    delete currentSettings.mapCenter;
    delete currentSettings.mapZoom;
    this.cookieService.setSettingsCookie(currentSettings);
  }
}
