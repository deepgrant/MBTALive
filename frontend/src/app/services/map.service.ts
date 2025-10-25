import { Injectable } from '@angular/core';
import * as L from 'leaflet';
import { Vehicle } from '../models/vehicle.model';
import { Route } from '../models/route.model';

@Injectable({
  providedIn: 'root'
})
export class MapService {
  private map: L.Map | null = null;
  private vehicleMarkers: Map<string, L.Marker> = new Map();
  private routeLayers: Map<string, L.Polyline> = new Map();

  constructor() { }

  initializeMap(containerId: string): L.Map {
    this.map = L.map(containerId).setView([42.3601, -71.0589], 10); // Boston coordinates

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

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

  addRouteLayer(route: Route, coordinates: L.LatLngExpression[]): void {
    if (!this.map) return;

    const routeId = route.id;
    
    // Remove existing route if it exists
    if (this.routeLayers.has(routeId)) {
      this.map.removeLayer(this.routeLayers.get(routeId)!);
    }

    const polyline = L.polyline(coordinates, {
      color: `#${route.color}`,
      weight: 4,
      opacity: 0.8
    }).addTo(this.map);

    this.routeLayers.set(routeId, polyline);
  }

  clearRouteLayers(): void {
    if (!this.map) return;
    
    this.routeLayers.forEach(polyline => this.map!.removeLayer(polyline));
    this.routeLayers.clear();
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
}
