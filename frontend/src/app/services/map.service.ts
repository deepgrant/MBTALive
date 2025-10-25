import { Injectable } from '@angular/core';
import * as L from 'leaflet';
import * as polyline from '@mapbox/polyline';
import { Vehicle } from '../models/vehicle.model';
import { Route, Shape } from '../models/route.model';
import { Station } from '../models/station.model';

@Injectable({
  providedIn: 'root'
})
export class MapService {
  private map: L.Map | null = null;
  private vehicleMarkers: Map<string, L.Marker> = new Map();
  private routeLayers: Map<string, L.Polyline> = new Map();
  private stationMarkers: Map<string, L.Marker> = new Map();

  constructor() { }

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
    if (!this.map) return;

    const markerId = vehicle.vehicleId;
    
    // Remove existing marker if it exists
    if (this.vehicleMarkers.has(markerId)) {
      this.map.removeLayer(this.vehicleMarkers.get(markerId)!);
    }

    // Create custom icon for vehicle with direction
    const vehicleIcon = L.divIcon({
      className: 'vehicle-marker',
      html: this.createVehicleMarkerHtml(vehicle),
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    const marker = L.marker([vehicle.latitude, vehicle.longitude], {
      icon: vehicleIcon
    }).addTo(this.map);

    // Add popup with vehicle information
    marker.bindPopup(`
      <div>
        <strong>Vehicle ${vehicle.vehicleId}</strong><br>
        Route: ${vehicle.routeId}<br>
        Direction: ${vehicle.direction}<br>
        Destination: ${vehicle.destination}<br>
        Speed: ${vehicle.speed.toFixed(1)} mph<br>
        Status: ${vehicle.currentStatus}<br>
        Updated: ${new Date(vehicle.updatedAt).toLocaleTimeString()}
      </div>
    `);

    this.vehicleMarkers.set(markerId, marker);
  }

  updateVehicleMarkers(vehicles: Vehicle[]): void {
    if (!this.map) return;

    // Clear existing markers
    this.vehicleMarkers.forEach(marker => this.map!.removeLayer(marker));
    this.vehicleMarkers.clear();

    // Add new markers
    vehicles.forEach(vehicle => {
      this.addVehicleMarker(vehicle);
    });
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
        const polyline = L.polyline(coordinates, {
          color: `#${route.color}`,
          weight: 4,
          opacity: 0.8
        }).addTo(this.map!);

        this.routeLayers.set(`${routeId}-${shape.id}`, polyline);
        console.log('MapService: Added polyline to map');
      } else {
        console.warn('MapService: No coordinates decoded for shape:', shape.id);
      }
    });
    
    console.log('MapService: Route layer added successfully');
  }

  clearRouteLayers(): void {
    if (!this.map) return;
    
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
      icon: stationIcon
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

  private createVehicleMarkerHtml(vehicle: Vehicle): string {
    const rotation = vehicle.bearing || 0;
    const speed = vehicle.speed || 0;
    
    return `
      <div style="
        width: 20px;
        height: 20px;
        background: #80276C;
        border: 2px solid white;
        border-radius: 50%;
        transform: rotate(${rotation}deg);
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        position: relative;
      ">
        <div style="
          position: absolute;
          top: -8px;
          left: 50%;
          transform: translateX(-50%);
          width: 0;
          height: 0;
          border-left: 4px solid transparent;
          border-right: 4px solid transparent;
          border-bottom: 8px solid #80276C;
        "></div>
        <div style="
          position: absolute;
          bottom: -12px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 8px;
          color: #80276C;
          font-weight: bold;
          background: white;
          padding: 1px 2px;
          border-radius: 2px;
        ">${speed.toFixed(0)}</div>
      </div>
    `;
  }

  private createStationMarkerHtml(station: Station): string {
    return `
      <div style="
        width: 24px;
        height: 24px;
        background: #1E88E5;
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
          color: #1E88E5;
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
}
