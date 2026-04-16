import { Injectable } from '@angular/core';
import * as L from 'leaflet';
import * as polyline from '@mapbox/polyline';
import { Vehicle } from '../models/vehicle.model';
import { Route, Shape } from '../models/route.model';
import { Station } from '../models/station.model';
import { VehicleCompletionDialogService } from './vehicle-completion-dialog.service';
import { CookieService } from './cookie.service';

@Injectable({
  providedIn: 'root'
})
export class MapService {
  private map: L.Map | null = null;
  private vehicleMarkers: Map<string, L.Marker> = new Map();
  private routeLayers: Map<string, L.Polyline> = new Map();
  private stationMarkers: Map<string, L.Marker> = new Map();
  private selectedVehicleMarker: L.Marker | null = null;
  private vehicleData: Map<string, Vehicle> = new Map();
  private originalIcons: Map<string, L.DivIcon> = new Map();
  private highlightOverlay: L.Marker | null = null;
  private trackedVehicleId: string | null = null;
  private trackedVehicleRouteId: string | null = null;
  private previousView: { center: L.LatLngLiteral; zoom: number } | null = null;
  private trackingInterval: ReturnType<typeof setInterval> | null = null;
  private routeBounds: L.LatLngBounds | null = null;
  private lastTrackedVehicleData: Vehicle | null = null;
  private isTrackingActive: boolean = false;
  private boundsSaveTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly BOUNDS_SAVE_DELAY = 2500; // 2.5 seconds
  private boundsRestored: boolean = false;

  constructor(
    private dialogService: VehicleCompletionDialogService,
    private cookieService: CookieService
  ) { }

  initializeMap(containerId: string): L.Map {
    if (this.map) {
      this.map.remove();
    }

    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Map container with id '${containerId}' not found`);
    }

    this.map = L.map(containerId, {
      center: [42.3601, -71.0589], // Boston coordinates
      zoom: 10,
      zoomControl: true,
      preferCanvas: false
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
      subdomains: ['a', 'b', 'c'],
      tileSize: 256,
      zoomOffset: 0
    }).addTo(this.map);

    this.restoreMapBounds();
    this.setupMapBoundsSaving();

    // Ensure proper rendering after mount
    setTimeout(() => { this.map?.invalidateSize(); }, 200);

    return this.map;
  }

  getMap(): L.Map | null {
    return this.map;
  }

  addVehicleMarker(vehicle: Vehicle): void {
    if (!this.map) return;

    const markerId = vehicle.vehicleId;
    this.vehicleData.set(markerId, vehicle);

    // Remove existing marker if it exists
    const existing = this.vehicleMarkers.get(markerId);
    if (existing) {
      this.map.removeLayer(existing);
    }

    const vehicleIcon = L.divIcon({
      className: 'vehicle-marker',
      html: this.createVehicleMarkerHtml(vehicle, false),
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    this.originalIcons.set(markerId, vehicleIcon);

    const marker = L.marker([vehicle.latitude, vehicle.longitude], {
      icon: vehicleIcon,
      zIndexOffset: 1000
    }).addTo(this.map);

    const isOutbound = vehicle.direction === 'Outbound';
    const delaySeconds = vehicle.delaySeconds ?? 0;
    const hasCriticalDelay = delaySeconds > 900;  // 15 minutes
    const hasSevereDelay = delaySeconds >= 1800;   // 30 minutes

    let tripNameClass = '';
    let tripLabelClass = '';
    if (hasSevereDelay) {
      tripNameClass = 'flash-trip-name';
      tripLabelClass = 'flash-trip-label';
    } else if (hasCriticalDelay) {
      tripNameClass = 'flash-trip-name';
    }

    const tooltipText = vehicle.tripName
      ? `<div><strong>ID:</strong> ${vehicle.vehicleId}</div><div><strong class="${tripLabelClass}">Trip:</strong> <span class="${tripNameClass}">${vehicle.tripName}</span></div>`
      : `<div><strong>ID:</strong> ${vehicle.vehicleId}</div>`;
    marker.bindTooltip(tooltipText, {
      permanent: true,
      direction: isOutbound ? 'bottom' : 'top',
      className: isOutbound ? 'vehicle-tooltip-outbound' : 'vehicle-tooltip',
      offset: isOutbound ? [0, 10] : [0, -10],
      interactive: false
    });

    this.vehicleMarkers.set(markerId, marker);
  }

  updateVehicleMarkers(vehicles: Vehicle[], currentRouteId?: string | null): void {
    if (!this.map) return;

    const previouslyHighlightedVehicle = this.selectedVehicleMarker
      ? Array.from(this.vehicleMarkers.entries()).find(([, m]) => m === this.selectedVehicleMarker)?.[0]
      : null;

    const currentlyTrackedVehicle = this.trackedVehicleId;
    const trackedVehicleInList = currentlyTrackedVehicle
      ? vehicles.find(v => v.vehicleId === currentlyTrackedVehicle)
      : null;
    const trackedVehicleStillExists = trackedVehicleInList != null;

    if (currentlyTrackedVehicle && !trackedVehicleStillExists && this.isTrackingActive) {
      if (currentRouteId && this.trackedVehicleRouteId && currentRouteId === this.trackedVehicleRouteId) {
        // Still on the same route — vehicle completed/left the route
        this.handleVehicleDisappeared(true);
      } else if (this.isTrackingActive) {
        this.handleVehicleDisappeared(true);
      }
    } else if (trackedVehicleInList && this.trackedVehicleRouteId && trackedVehicleInList.routeId !== this.trackedVehicleRouteId) {
      this.handleVehicleDisappeared(true);
    }

    // Clear highlight overlay before refreshing markers
    if (this.selectedVehicleMarker) {
      this.map.removeLayer(this.selectedVehicleMarker);
      this.selectedVehicleMarker = null;
    }

    // Replace all markers
    this.vehicleMarkers.forEach(marker => this.map!.removeLayer(marker));
    this.vehicleMarkers.clear();
    this.vehicleData.clear();
    this.originalIcons.clear();

    vehicles.forEach(vehicle => {
      this.addVehicleMarker(vehicle);
      if (this.trackedVehicleId === vehicle.vehicleId) {
        this.lastTrackedVehicleData = { ...vehicle };
      }
    });

    if (previouslyHighlightedVehicle) {
      setTimeout(() => { this.highlightVehicleMarker(previouslyHighlightedVehicle); }, 100);
    }

    if (currentlyTrackedVehicle && trackedVehicleStillExists) {
      const trackedVehicle = vehicles.find(v => v.vehicleId === currentlyTrackedVehicle);
      if (trackedVehicle) {
        this.lastTrackedVehicleData = { ...trackedVehicle };
      }
    }
  }

  addRouteLayer(route: Route, shapes: Shape[]): void {
    if (!this.map) return;

    const routeId = route.id;

    const existingLayer = this.routeLayers.get(routeId);
    if (existingLayer) {
      this.map.removeLayer(existingLayer);
    }

    shapes.forEach(shape => {
      const coordinates = this.decodePolyline(shape.polyline);
      if (coordinates.length === 0) return;

      const glowPolyline = L.polyline(coordinates, {
        color: '#ffffff',
        weight: 10,
        opacity: 0.6
      }).addTo(this.map!);

      const routePolyline = L.polyline(coordinates, {
        color: `#${route.color}`,
        weight: 6,
        opacity: 0.9
      }).addTo(this.map!);

      this.routeLayers.set(`${routeId}-${shape.id}-glow`, glowPolyline);
      this.routeLayers.set(`${routeId}-${shape.id}`, routePolyline);
    });
  }

  clearRouteLayers(): void {
    if (!this.map) return;
    this.routeLayers.forEach(p => this.map!.removeLayer(p));
    this.routeLayers.clear();
  }

  addStationMarker(station: Station): void {
    if (!this.map) return;

    const markerId = station.id;
    const existing = this.stationMarkers.get(markerId);
    if (existing) {
      this.map.removeLayer(existing);
    }

    const stationIcon = L.divIcon({
      className: 'station-marker',
      html: this.createStationMarkerHtml(station),
      iconSize: [24, 24],
      iconAnchor: [12, 24]
    });

    const marker = L.marker([station.latitude, station.longitude], {
      icon: stationIcon,
      zIndexOffset: 0
    }).addTo(this.map);

    marker.bindPopup(`
      <div>
        <strong>${station.name}</strong><br>
        Station ID: ${station.id}
      </div>
    `);

    this.stationMarkers.set(markerId, marker);
  }

  updateStationMarkers(stations: Station[]): void {
    if (!this.map) return;
    this.stationMarkers.forEach(marker => this.map!.removeLayer(marker));
    this.stationMarkers.clear();
    stations.forEach(station => { this.addStationMarker(station); });
  }

  clearStationMarkers(): void {
    if (!this.map) return;
    this.stationMarkers.forEach(marker => this.map!.removeLayer(marker));
    this.stationMarkers.clear();
  }

  fitBoundsToVehicles(vehicles: Vehicle[]): void {
    if (!this.map || vehicles.length === 0) return;
    const bounds = L.latLngBounds(vehicles.map(v => [v.latitude, v.longitude]));
    this.map.fitBounds(bounds, { padding: [20, 20] });
  }

  fitBoundsToRoute(): void {
    if (!this.map) return;

    const bounds = L.latLngBounds([]);
    let hasContent = false;

    this.routeLayers.forEach(p => {
      const layerBounds = p.getBounds();
      if (layerBounds.isValid()) { bounds.extend(layerBounds); hasContent = true; }
    });

    this.stationMarkers.forEach(marker => {
      bounds.extend(marker.getLatLng());
      hasContent = true;
    });

    if (hasContent) {
      this.routeBounds = bounds;
      this.map.fitBounds(bounds, { padding: [50, 50] });
    }
  }

  private createVehicleMarkerHtml(vehicle: Vehicle, isHighlighted: boolean = false): string {
    const rotation = vehicle.bearing ?? 0;
    const speed = vehicle.speed ?? 0;
    const isBus = vehicle.routeType === 3;
    const size = isHighlighted ? 24 : 20;
    const borderWidth = isHighlighted ? 3 : 2;
    const borderColor = isHighlighted ? '#FF5722' : '#ffffff';

    let markerBackgroundColor = '#2196F3';
    let delayIndicator = '';

    if (vehicle.delayStatus === 'minor-delay') {
      markerBackgroundColor = '#ffc107';
      delayIndicator = '<div class="delay-indicator minor-delay" title="Minor Delay"></div>';
    } else if (vehicle.delayStatus === 'major-delay') {
      markerBackgroundColor = '#dc3545';
      delayIndicator = '<div class="delay-indicator major-delay" title="Major Delay"></div>';
    }

    return `
      <div class="vehicle-marker-container" style="transform: rotate(${rotation}deg); width: ${size}px; height: ${size}px;">
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
        ${delayIndicator}
      </div>
    `;
  }

  private createStationMarkerHtml(station: Station): string {
    return `
      <div style="
        width: 24px;
        height: 24px;
        background: rgba(108, 117, 125, 0.7);
        border: 2px solid white;
        border-radius: 50%;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <div style="
          position: absolute;
          bottom: -8px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 8px;
          color: #6c757d;
          font-weight: bold;
          background: white;
          padding: 1px 2px;
          border-radius: 2px;
          white-space: nowrap;
          max-width: 60px;
          overflow: hidden;
          text-overflow: ellipsis;
        ">${station.name}</div>
      </div>
    `;
  }

  centerOnVehicle(vehicleId: string): void {
    if (!this.map) return;

    if (this.trackedVehicleId === vehicleId) {
      this.stopVehicleTracking();
      return;
    }

    if (this.trackedVehicleId !== null) {
      this.stopVehicleTracking();
    }

    this.startVehicleTracking(vehicleId);
  }

  private startVehicleTracking(vehicleId: string): void {
    if (!this.map) return;

    const marker = this.vehicleMarkers.get(vehicleId);
    if (!marker) return;

    const center = this.map.getCenter();
    this.previousView = {
      center: { lat: center.lat, lng: center.lng },
      zoom: this.map.getZoom()
    };

    const vehicle = this.vehicleData.get(vehicleId);
    if (vehicle) {
      this.lastTrackedVehicleData = { ...vehicle };
      this.trackedVehicleRouteId = vehicle.routeId;
    }

    this.trackedVehicleId = vehicleId;
    this.isTrackingActive = true;

    const latLng = marker.getLatLng();
    this.map.setView(latLng, 15);

    this.trackingInterval = setInterval(() => {
      if (!this.map || !this.trackedVehicleId || !this.isTrackingActive) return;

      const trackedMarker = this.vehicleMarkers.get(this.trackedVehicleId);
      if (trackedMarker) {
        const currentVehicle = this.vehicleData.get(this.trackedVehicleId);
        if (currentVehicle) {
          this.lastTrackedVehicleData = { ...currentVehicle };
        }
        this.map.setView(trackedMarker.getLatLng(), 15, { animate: true, duration: 1.0 });
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
      this.map.setView(this.previousView.center, this.previousView.zoom, { animate: true });
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

    if (this.routeBounds && this.map) {
      this.map.fitBounds(this.routeBounds, { padding: [50, 50] });
    } else {
      this.fitBoundsToRoute();
    }

    this.dialogService.showDialog({
      vehicleId,
      routeId,
      completedNormally: !premature,
      finalArrivalTime,
      lastUpdateTime
    });
  }

  highlightVehicleMarker(vehicleId: string): void {
    if (!this.map) return;

    if (this.highlightOverlay) {
      this.map.removeLayer(this.highlightOverlay);
      this.highlightOverlay = null;
    }

    const marker = this.vehicleMarkers.get(vehicleId);
    if (!marker || !this.getVehicleById(vehicleId)) return;

    const highlightIcon = L.divIcon({
      className: 'vehicle-highlight-overlay',
      html: '<div class="highlight-ring"></div>',
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });

    this.highlightOverlay = L.marker(marker.getLatLng(), {
      icon: highlightIcon,
      interactive: false,
      zIndexOffset: 2000
    }).addTo(this.map);

    // Auto-remove highlight after 2 seconds (fallback)
    setTimeout(() => {
      if (this.highlightOverlay && this.map) {
        this.map.removeLayer(this.highlightOverlay);
        this.highlightOverlay = null;
      }
    }, 2000);
  }

  private restoreOriginalMarker(marker: L.Marker): void {
    let vehicleId: string | null = null;
    for (const [id, m] of this.vehicleMarkers.entries()) {
      if (m === marker) { vehicleId = id; break; }
    }

    if (vehicleId) {
      const originalIcon = this.originalIcons.get(vehicleId);
      if (originalIcon) {
        marker.setIcon(originalIcon);
      }
    }

    marker.setOpacity(1);
    marker.setZIndexOffset(0);

    const element = marker.getElement();
    if (element) {
      element.style.animation = '';
    }

    this.selectedVehicleMarker = null;
  }

  private getVehicleById(vehicleId: string): Vehicle | null {
    return this.vehicleData.get(vehicleId) ?? null;
  }

  private addPulsingEffect(marker: L.Marker): void {
    const element = marker.getElement();
    if (element) {
      element.style.animation = 'vehicle-pulse 1.5s ease-in-out infinite';
    }
  }

  private decodePolyline(encoded: string): L.LatLngExpression[] {
    try {
      const coordinates = polyline.decode(encoded);
      return coordinates.map((coord: [number, number]) => [coord[0], coord[1]] as L.LatLngExpression);
    } catch (error) {
      console.error('MapService: Error decoding polyline:', error);
      return [];
    }
  }

  private setupMapBoundsSaving(): void {
    if (!this.map) return;
    this.map.on('moveend', () => { this.debouncedSaveMapBounds(); });
    this.map.on('zoomend', () => { this.debouncedSaveMapBounds(); });
  }

  private debouncedSaveMapBounds(): void {
    if (this.boundsSaveTimeout) {
      clearTimeout(this.boundsSaveTimeout);
    }
    this.boundsSaveTimeout = setTimeout(() => { this.saveMapBounds(); }, this.BOUNDS_SAVE_DELAY);
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
        setTimeout(() => { this.map?.setView([lat, lng], zoom); }, 300);
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

  wereBoundsRestored(): boolean {
    return this.boundsRestored;
  }
}
