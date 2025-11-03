import { Injectable } from '@angular/core';
import * as L from 'leaflet';
import * as polyline from '@mapbox/polyline';
import { Vehicle } from '../models/vehicle.model';
import { Route, Shape } from '../models/route.model';
import { Station } from '../models/station.model';
import { VehicleCompletionDialogService } from './vehicle-completion-dialog.service';

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
  private originalIcons: Map<string, any> = new Map();
  private highlightOverlay: L.Marker | null = null;
  private trackedVehicleId: string | null = null;
  private previousBounds: L.LatLngBounds | null = null;
  private trackingInterval: any = null;
  private routeBounds: L.LatLngBounds | null = null;
  private lastTrackedVehicleData: Vehicle | null = null;

  constructor(private dialogService: VehicleCompletionDialogService) { }

  initializeMap(containerId: string): L.Map {
    console.log('MapService: Initializing map with container:', containerId);

    // Clear any existing map
    if (this.map) {
      console.log('MapService: Removing existing map');
      this.map.remove();
    }

    // Check if container exists
    const container = document.getElementById(containerId);
    if (!container) {
      console.error('MapService: Container not found:', containerId);
      throw new Error(`Map container with id '${containerId}' not found`);
    }

    console.log('MapService: Creating new map instance');
    this.map = L.map(containerId, {
      center: [42.3601, -71.0589], // Boston coordinates
      zoom: 10,
      zoomControl: true,
      preferCanvas: false
    });

    console.log('MapService: Adding tile layer');
    // Add OpenStreetMap tiles with proper configuration
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
      subdomains: ['a', 'b', 'c'],
      tileSize: 256,
      zoomOffset: 0
    }).addTo(this.map);

    console.log('MapService: Map initialized successfully');

    // Force a resize after a short delay to ensure proper rendering
    setTimeout(() => {
      if (this.map) {
        console.log('MapService: Invalidating map size');
        this.map.invalidateSize();
      }
    }, 200);

    return this.map;
  }

  getMap(): L.Map | null {
    return this.map;
  }

  addVehicleMarker(vehicle: Vehicle): void {
    if (!this.map) {
      console.log('MapService: Cannot add vehicle marker - map not initialized');
      return;
    }

    console.log('MapService: Adding vehicle marker for vehicle:', vehicle.vehicleId, 'at', vehicle.latitude, vehicle.longitude);
    const markerId = vehicle.vehicleId;

    // Store vehicle data for highlighting
    this.vehicleData.set(markerId, vehicle);

    // Remove existing marker if it exists
    if (this.vehicleMarkers.has(markerId)) {
      console.log('MapService: Removing existing marker for vehicle:', markerId);
      this.map.removeLayer(this.vehicleMarkers.get(markerId)!);
    }

    // Create custom icon for vehicle with direction
    const vehicleIcon = L.divIcon({
      className: 'vehicle-marker',
      html: this.createVehicleMarkerHtml(vehicle, false),
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    // Store original icon for restoration
    this.originalIcons.set(markerId, vehicleIcon);

    console.log('MapService: Creating marker at coordinates:', [vehicle.latitude, vehicle.longitude]);
    const marker = L.marker([vehicle.latitude, vehicle.longitude], {
      icon: vehicleIcon,
      zIndexOffset: 1000
    }).addTo(this.map);

    console.log('MapService: Marker added to map successfully');

    // Check if marker is within current map bounds
    if (this.map) {
      const bounds = this.map.getBounds();
      const markerLatLng = L.latLng(vehicle.latitude, vehicle.longitude);
      const isInBounds = bounds.contains(markerLatLng);
      console.log('MapService: Marker is within current map bounds:', isInBounds);
      console.log('MapService: Current map bounds:', bounds);
      console.log('MapService: Marker position:', markerLatLng);

      // If marker is not in bounds, log a warning
      if (!isInBounds) {
        console.warn('MapService: Vehicle marker is OUTSIDE current map bounds!');
        console.warn('MapService: Vehicle coordinates:', vehicle.latitude, vehicle.longitude);
        console.warn('MapService: Map center:', this.map.getCenter());
        console.warn('MapService: Map zoom:', this.map.getZoom());
      }
    }

    // Add permanent tooltip with vehicle number and trip name
    // Set tooltip style based on direction
    const isOutbound = vehicle.direction === 'Outbound';
    const delaySeconds = vehicle.delaySeconds || 0;
    const hasCriticalDelay = delaySeconds > 900; // 15 minutes
    const hasSevereDelay = delaySeconds >= 1800; // >= 30 minutes
    
    let tripNameClass = '';
    let tripLabelClass = '';
    if (hasSevereDelay) {
      // Flash both trip name and label for severe delays (>30 min)
      tripNameClass = 'flash-trip-name';
      tripLabelClass = 'flash-trip-label';
    } else if (hasCriticalDelay) {
      // Flash trip name only for critical delays (>15 min)
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
    console.log('MapService: Vehicle marker stored in markers map');
  }

  updateVehicleMarkers(vehicles: Vehicle[]): void {
    if (!this.map) {
      console.log('MapService: Cannot update vehicle markers - map not initialized');
      return;
    }

    console.log('MapService: Updating vehicle markers with', vehicles.length, 'vehicles');
    console.log('MapService: Vehicle data:', vehicles);

    // Store which vehicle was highlighted before clearing
    const previouslyHighlightedVehicle = this.selectedVehicleMarker ?
      Array.from(this.vehicleMarkers.entries()).find(([id, marker]) => marker === this.selectedVehicleMarker)?.[0] : null;

    // Store tracked vehicle ID to check if it still exists
    const currentlyTrackedVehicle = this.trackedVehicleId;
    const trackedVehicleStillExists = currentlyTrackedVehicle && 
      vehicles.some(v => v.vehicleId === currentlyTrackedVehicle);

    // Check if tracked vehicle disappeared
    if (currentlyTrackedVehicle && !trackedVehicleStillExists) {
      console.log('MapService: Tracked vehicle no longer exists in update:', currentlyTrackedVehicle);
      this.handleVehicleDisappeared(true);
    }

    // Clear existing highlight overlay
    if (this.selectedVehicleMarker) {
      console.log('MapService: Clearing highlight overlay due to polling update');
      this.map.removeLayer(this.selectedVehicleMarker);
      this.selectedVehicleMarker = null;
    }

    // Clear existing markers
    console.log('MapService: Clearing', this.vehicleMarkers.size, 'existing markers');
    this.vehicleMarkers.forEach(marker => this.map!.removeLayer(marker));
    this.vehicleMarkers.clear();
    this.vehicleData.clear();
    this.originalIcons.clear();

    // Add new markers
    vehicles.forEach((vehicle, index) => {
      console.log(`MapService: Processing vehicle ${index + 1}/${vehicles.length}:`, vehicle);
      this.addVehicleMarker(vehicle);
      
      // Update last tracked vehicle data if this is the tracked vehicle
      if (this.trackedVehicleId === vehicle.vehicleId) {
        this.lastTrackedVehicleData = { ...vehicle };
      }
    });

    // Re-apply highlighting if there was a previously highlighted vehicle
    if (previouslyHighlightedVehicle) {
      console.log('MapService: Re-applying highlight to vehicle after update:', previouslyHighlightedVehicle);
      setTimeout(() => {
        this.highlightVehicleMarker(previouslyHighlightedVehicle);
      }, 100);
    }

    // Continue tracking if vehicle still exists (marker will be updated in tracking interval)
    if (currentlyTrackedVehicle && trackedVehicleStillExists) {
      console.log('MapService: Tracking continues for vehicle:', currentlyTrackedVehicle);
      // Update vehicle data for tracking
      const trackedVehicle = vehicles.find(v => v.vehicleId === currentlyTrackedVehicle);
      if (trackedVehicle) {
        this.lastTrackedVehicleData = { ...trackedVehicle };
      }
    }

    console.log('MapService: Vehicle markers update complete');
  }

  addRouteLayer(route: Route, shapes: Shape[]): void {
    if (!this.map) {
      console.error('MapService: Cannot add route layer - map not initialized');
      return;
    }

    console.log('MapService: Adding route layer for route:', route.id, 'with', shapes.length, 'shapes');
    const routeId = route.id;

    // Remove existing route if it exists
    if (this.routeLayers.has(routeId)) {
      console.log('MapService: Removing existing route layer');
      this.map.removeLayer(this.routeLayers.get(routeId)!);
    }

    // Decode polylines and create route layer
    shapes.forEach((shape, index) => {
      console.log(`MapService: Processing shape ${index + 1}/${shapes.length}:`, shape.id);
      const coordinates = this.decodePolyline(shape.polyline);
      console.log('MapService: Decoded coordinates:', coordinates.length, 'points');

      if (coordinates.length > 0) {
        // Create enhanced styling for all route types
        console.log('MapService: Creating enhanced route styling for route type:', route.route_type);

        // Bottom layer: white glow effect
        const glowPolyline = L.polyline(coordinates, {
          color: '#ffffff',
          weight: 10,
          opacity: 0.6
        }).addTo(this.map!);

        // Top layer: colored route line with increased weight
        const routePolyline = L.polyline(coordinates, {
          color: `#${route.color}`,
          weight: 6,
          opacity: 0.9
        }).addTo(this.map!);

        // Store both layers
        this.routeLayers.set(`${routeId}-${shape.id}-glow`, glowPolyline);
        this.routeLayers.set(`${routeId}-${shape.id}`, routePolyline);

        console.log('MapService: Added polyline to map');
      } else {
        console.warn('MapService: No coordinates decoded for shape:', shape.id);
      }
    });

    console.log('MapService: Route layer added successfully');
  }

  clearRouteLayers(): void {
    if (!this.map) return;

    // Remove all route layers including glow layers
    this.routeLayers.forEach(polyline => this.map!.removeLayer(polyline));
    this.routeLayers.clear();
  }

  addStationMarker(station: Station): void {
    if (!this.map) return;

    const markerId = station.id;

    // Remove existing marker if it exists
    if (this.stationMarkers.has(markerId)) {
      this.map.removeLayer(this.stationMarkers.get(markerId)!);
    }

    // Create custom icon for station with label
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

    // Add popup with station information
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

    // Clear existing markers
    this.stationMarkers.forEach(marker => this.map!.removeLayer(marker));
    this.stationMarkers.clear();

    // Add new markers
    stations.forEach(station => {
      this.addStationMarker(station);
    });
  }

  clearStationMarkers(): void {
    if (!this.map) return;

    this.stationMarkers.forEach(marker => this.map!.removeLayer(marker));
    this.stationMarkers.clear();
  }

  fitBoundsToVehicles(vehicles: Vehicle[]): void {
    if (!this.map || vehicles.length === 0) return;

    const bounds = L.latLngBounds(
      vehicles.map(vehicle => [vehicle.latitude, vehicle.longitude])
    );

    this.map.fitBounds(bounds, { padding: [20, 20] });
  }

  fitBoundsToRoute(): void {
    if (!this.map) return;

    const bounds = L.latLngBounds([]);
    let hasContent = false;

    // Add all route polyline points to bounds
    this.routeLayers.forEach(polyline => {
      const layerBounds = polyline.getBounds();
      if (layerBounds.isValid()) {
        bounds.extend(layerBounds);
        hasContent = true;
      }
    });

    // Add all station markers to bounds
    this.stationMarkers.forEach(marker => {
      bounds.extend(marker.getLatLng());
      hasContent = true;
    });

    // Fit map to calculated bounds and store for tracking
    if (hasContent) {
      this.routeBounds = bounds;
      this.map.fitBounds(bounds, { padding: [50, 50] });
    }
  }

  private createVehicleMarkerHtml(vehicle: Vehicle, isHighlighted: boolean = false): string {
    const rotation = vehicle.bearing || 0;
    const speed = vehicle.speed || 0;
    const isBus = vehicle.routeType === 3;
    const size = isHighlighted ? 24 : 20;
    const borderWidth = isHighlighted ? 3 : 2;
    const borderColor = isHighlighted ? '#FF5722' : '#ffffff';

    // Get delay status
    const delayStatus = this.getDelayStatus(vehicle.delaySeconds);

    // Determine marker styling based on delay
    let markerBackgroundColor = '#2196F3'; // Default blue
    let delayIndicator = '';

    if (delayStatus.severity === 'minor-delay') {
      markerBackgroundColor = '#ffc107'; // Yellow/Orange
      delayIndicator = '<div class="delay-indicator minor-delay" title="Minor Delay"></div>';
    } else if (delayStatus.severity === 'major-delay') {
      markerBackgroundColor = '#dc3545'; // Red
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

  private formatVehicleStatus(status: string, stopName?: string): string {
    if (!status) return 'Unknown';

    const stop = stopName && stopName !== 'Unknown' ? stopName : 'next stop';

    switch (status.toUpperCase()) {
      case 'IN_TRANSIT_TO':
        return `In transit to ${stop}`;
      case 'STOPPED_AT':
        return `Stopped at ${stop}`;
      case 'INCOMING_AT':
        return `Incoming at ${stop}`;
      default:
        // Convert underscores to spaces and title case
        return status.replace(/_/g, ' ')
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');
    }
  }

  centerOnVehicle(vehicleId: string): void {
    if (!this.map) {
      console.log('MapService: Cannot center on vehicle - map not initialized');
      return;
    }

    // If clicking the same vehicle that's being tracked, stop tracking
    if (this.trackedVehicleId === vehicleId) {
      console.log('MapService: Stopping tracking for vehicle:', vehicleId);
      this.stopVehicleTracking();
      return;
    }

    // If tracking a different vehicle, stop tracking that one first
    if (this.trackedVehicleId !== null) {
      console.log('MapService: Stopping tracking for previous vehicle:', this.trackedVehicleId);
      this.stopVehicleTracking();
    }

    // Start tracking the new vehicle
    console.log('MapService: Starting tracking for vehicle:', vehicleId);
    this.startVehicleTracking(vehicleId);
  }

  private startVehicleTracking(vehicleId: string): void {
    if (!this.map) {
      console.log('MapService: Cannot start tracking - map not initialized');
      return;
    }

    const marker = this.vehicleMarkers.get(vehicleId);
    if (!marker) {
      console.warn('MapService: Cannot start tracking - vehicle marker not found:', vehicleId);
      return;
    }

    // Save current map bounds
    this.previousBounds = this.map.getBounds();

    // Get vehicle data and store for tracking
    const vehicle = this.vehicleData.get(vehicleId);
    if (vehicle) {
      this.lastTrackedVehicleData = { ...vehicle };
    }

    // Set tracked vehicle ID
    this.trackedVehicleId = vehicleId;

    // Zoom in on vehicle
    const latLng = marker.getLatLng();
    this.map.setView(latLng, 15);
    console.log('MapService: Started tracking vehicle:', vehicleId);

    // Start continuous tracking interval (update every 2 seconds)
    this.trackingInterval = setInterval(() => {
      if (!this.map || !this.trackedVehicleId) {
        return;
      }

      const trackedMarker = this.vehicleMarkers.get(this.trackedVehicleId);
      if (trackedMarker) {
        const position = trackedMarker.getLatLng();
        // Update vehicle data if available
        const currentVehicle = this.vehicleData.get(this.trackedVehicleId);
        if (currentVehicle) {
          this.lastTrackedVehicleData = { ...currentVehicle };
        }
        // Smoothly pan to vehicle position
        this.map.setView(position, 15, { animate: true, duration: 1.0 });
      } else {
        // Vehicle disappeared, stop tracking and show dialog
        console.log('MapService: Tracked vehicle disappeared:', this.trackedVehicleId);
        this.handleVehicleDisappeared(false);
      }
    }, 2000);
  }

  private stopVehicleTracking(): void {
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = null;
    }

    if (this.map && this.previousBounds) {
      // Restore previous map bounds
      this.map.fitBounds(this.previousBounds, { padding: [50, 50] });
    }

    this.trackedVehicleId = null;
    this.previousBounds = null;
    this.lastTrackedVehicleData = null;
    console.log('MapService: Stopped vehicle tracking');
  }

  private handleVehicleDisappeared(premature: boolean): void {
    if (!this.trackedVehicleId || !this.lastTrackedVehicleData) {
      return;
    }

    const vehicleId = this.trackedVehicleId;
    const routeId = this.lastTrackedVehicleData.routeId;
    const lastUpdateTime = this.lastTrackedVehicleData.updatedAt || new Date().toISOString();
    const finalArrivalTime = this.lastTrackedVehicleData.predictedArrivalTime || 
                            this.lastTrackedVehicleData.scheduledArrivalTime;

    // Stop tracking
    this.stopVehicleTracking();

    // Zoom back to route-wide view
    if (this.routeBounds && this.map) {
      this.map.fitBounds(this.routeBounds, { padding: [50, 50] });
    } else {
      this.fitBoundsToRoute();
    }

    // Show completion dialog
    this.showVehicleCompletionDialog(vehicleId, routeId, premature, finalArrivalTime, lastUpdateTime);
  }

  private showVehicleCompletionDialog(
    vehicleId: string,
    routeId: string,
    premature: boolean,
    finalArrivalTime: string | undefined,
    lastUpdateTime: string
  ): void {
    this.dialogService.showDialog({
      vehicleId,
      routeId,
      completedNormally: !premature,
      finalArrivalTime,
      lastUpdateTime
    });
  }

  highlightVehicleMarker(vehicleId: string): void {
    if (!this.map) {
      console.log('MapService: Cannot highlight - map not initialized');
      return;
    }

    console.log('MapService: Attempting to highlight vehicle:', vehicleId);
    console.log('MapService: Available vehicle markers:', Array.from(this.vehicleMarkers.keys()));
    console.log('MapService: Available vehicle data:', Array.from(this.vehicleData.keys()));

    // Remove previous highlight
    if (this.highlightOverlay) {
      console.log('MapService: Removing previous highlight overlay');
      this.map.removeLayer(this.highlightOverlay);
      this.highlightOverlay = null;
    }

    const marker = this.vehicleMarkers.get(vehicleId);
    if (marker) {
      console.log('MapService: Marker found for vehicle:', vehicleId);

      // Get vehicle data for highlighting
      const vehicle = this.getVehicleById(vehicleId);
      if (vehicle) {
        console.log('MapService: Creating highlight overlay');

        // Create a separate highlight overlay at the same position
        const highlightIcon = L.divIcon({
          className: 'vehicle-highlight-overlay',
          html: '<div class="highlight-ring"></div>',
          iconSize: [40, 40],
          iconAnchor: [20, 20]
        });

        const latLng = marker.getLatLng();
        this.highlightOverlay = L.marker(latLng, {
          icon: highlightIcon,
          interactive: false,
          zIndexOffset: 2000
        }).addTo(this.map);

        console.log('MapService: Highlight overlay created at:', latLng);

        // Auto-remove highlight after 2 seconds (fallback)
        setTimeout(() => {
          if (this.highlightOverlay) {
            console.log('MapService: Auto-removing highlight overlay after 2 seconds');
            this.map!.removeLayer(this.highlightOverlay);
            this.highlightOverlay = null;
          }
        }, 2000);

        console.log('MapService: Highlight will also be removed on next polling update');
      } else {
        console.warn('MapService: Vehicle data not found for highlighting:', vehicleId);
      }
    } else {
      console.warn('MapService: Marker not found for vehicle:', vehicleId);
      console.warn('MapService: Available markers:', this.vehicleMarkers);
    }
  }

  private restoreOriginalMarker(marker: L.Marker): void {
    // Find the vehicle ID for this marker
    let vehicleId: string | null = null;
    for (const [id, m] of this.vehicleMarkers.entries()) {
      if (m === marker) {
        vehicleId = id;
        break;
      }
    }

    if (vehicleId) {
      const originalIcon = this.originalIcons.get(vehicleId);
      if (originalIcon) {
        marker.setIcon(originalIcon);
      }
    }

    marker.setOpacity(1);
    marker.setZIndexOffset(0);

    // Remove pulsing animation
    const element = marker.getElement();
    if (element) {
      element.style.animation = '';
    }

    this.selectedVehicleMarker = null;
  }

  private getVehicleById(vehicleId: string): Vehicle | null {
    return this.vehicleData.get(vehicleId) || null;
  }

  private addPulsingEffect(marker: L.Marker): void {
    const element = marker.getElement();
    if (element) {
      element.style.animation = 'vehicle-pulse 1.5s ease-in-out infinite';
    }
  }

  // Simple test method to verify highlighting works
  testHighlighting(): void {
    console.log('MapService: Testing highlighting...');
    console.log('MapService: Available markers:', Array.from(this.vehicleMarkers.keys()));

    if (this.vehicleMarkers.size > 0) {
      const firstVehicleId = Array.from(this.vehicleMarkers.keys())[0];
      console.log('MapService: Testing with first vehicle:', firstVehicleId);

      // SIMPLE TEST: Just make the marker very obvious
      const marker = this.vehicleMarkers.get(firstVehicleId);
      if (marker) {
        console.log('MapService: Found marker, applying SIMPLE highlight');

        // Make it very obvious
        marker.setOpacity(0.3); // Very transparent
        marker.setZIndexOffset(9999); // On top

        // Try to get the element and make it huge and red
        setTimeout(() => {
          const element = marker.getElement();
          if (element) {
            console.log('MapService: Element found, making it HUGE and RED');
            element.style.width = '50px';
            element.style.height = '50px';
            element.style.backgroundColor = 'red';
            element.style.border = '5px solid yellow';
            element.style.borderRadius = '50%';
            element.style.position = 'relative';
            element.style.zIndex = '9999';
            console.log('MapService: Applied HUGE RED styling');
          } else {
            console.log('MapService: Element not found');
          }
        }, 100);

        // Reset after 3 seconds
        setTimeout(() => {
          console.log('MapService: Resetting test highlight');
          marker.setOpacity(1);
          marker.setZIndexOffset(0);
          const element = marker.getElement();
          if (element) {
            element.style.width = '';
            element.style.height = '';
            element.style.backgroundColor = '';
            element.style.border = '';
            element.style.borderRadius = '';
            element.style.position = '';
            element.style.zIndex = '';
          }
        }, 3000);
      } else {
        console.log('MapService: Marker not found for testing');
      }
    } else {
      console.log('MapService: No markers available for testing');
    }
  }

  private decodePolyline(encoded: string): L.LatLngExpression[] {
    try {
      console.log('MapService: Decoding polyline, length:', encoded.length);
      const coordinates = polyline.decode(encoded);
      console.log('MapService: Decoded', coordinates.length, 'coordinates');
      const result = coordinates.map((coord: [number, number]) => [coord[0], coord[1]] as L.LatLngExpression);
      console.log('MapService: First few coordinates:', result.slice(0, 3));
      return result;
    } catch (error) {
      console.error('MapService: Error decoding polyline:', error);
      return [];
    }
  }

  /**
   * Get delay status for a vehicle based on delay seconds
   * @param delaySeconds - Delay in seconds (positive = late, negative = early)
   * @returns Object with color, label, and severity information
   */
  getDelayStatus(delaySeconds?: number): { color: string; label: string; severity: 'on-time' | 'minor-delay' | 'major-delay' } {
    if (!delaySeconds || delaySeconds < 300) { // Less than 5 minutes
      return {
        color: '#28a745', // Green
        label: 'On Time',
        severity: 'on-time'
      };
    } else if (delaySeconds < 600) { // 5-10 minutes
      return {
        color: '#ffc107', // Yellow/Orange
        label: `${Math.round(delaySeconds / 60)} min delay`,
        severity: 'minor-delay'
      };
    } else { // More than 10 minutes
      return {
        color: '#dc3545', // Red
        label: `${Math.round(delaySeconds / 60)} min delay`,
        severity: 'major-delay'
      };
    }
  }
}
