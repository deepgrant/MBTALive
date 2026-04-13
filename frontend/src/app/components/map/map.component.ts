import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import * as L from 'leaflet';
import { Vehicle } from '../../models/vehicle.model';
import { Route, Shape } from '../../models/route.model';
import { Station } from '../../models/station.model';
import { VehicleService } from '../../services/vehicle.service';
import { MapService } from '../../services/map.service';

@Component({
  selector: 'app-map',
  imports: [CommonModule],
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.scss']
})
export class MapComponent implements OnInit, OnDestroy, AfterViewInit {
  private subscriptions: Subscription[] = [];
  private map: L.Map | null = null;
  private currentRoute: Route | null = null;
  private currentRouteId: string | null = null;
  private routeFramed = false;
  private isInitialRouteLoad = true;

  constructor(
    private vehicleService: VehicleService,
    private mapService: MapService
  ) { }

  ngOnInit(): void {
    this.subscriptions.push(
      this.vehicleService.filteredVehicles$.subscribe({
        next: vehicles => this.updateMapWithVehicles(vehicles),
        error: error => console.error('MapComponent: Error receiving vehicles:', error)
      }),
      this.vehicleService.selectedRoute$.subscribe({
        next: routeId => this.handleRouteSelection(routeId),
        error: error => console.error('MapComponent: Error receiving selected route:', error)
      }),
      this.vehicleService.selectedRouteStations$.subscribe({
        next: stations => this.updateMapWithStations(stations),
        error: error => console.error('MapComponent: Error receiving stations:', error)
      }),
      this.vehicleService.selectedRouteShapes$.subscribe({
        next: shapes => this.updateMapWithShapes(shapes),
        error: error => console.error('MapComponent: Error receiving shapes:', error)
      }),
      this.vehicleService.selectedVehicle$.subscribe({
        next: vehicleId => {
          if (vehicleId && this.map) {
            setTimeout(() => this.mapService.highlightVehicleMarker(vehicleId), 100);
          }
        },
        error: error => console.error('MapComponent: Error receiving selected vehicle:', error)
      })
    );
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      try {
        this.map = this.mapService.initializeMap('map');
        setTimeout(() => this.vehicleService.restoreRouteFromCookie(), 800);
      } catch (error) {
        console.error('MapComponent: Error initializing map:', error);
      }
    }, 300);
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(s => s.unsubscribe());
  }

  private updateMapWithVehicles(vehicles: Vehicle[]): void {
    this.mapService.updateVehicleMarkers(vehicles, this.currentRouteId);
  }

  private handleRouteSelection(routeId: string | null): void {
    this.mapService.stopVehicleTrackingSilently();
    this.mapService.clearRouteLayers();
    this.mapService.clearStationMarkers();
    this.routeFramed = false;

    const isRouteChange   = this.currentRouteId !== null && this.currentRouteId !== routeId;
    this.currentRouteId   = routeId;

    if (!routeId) {
      this.currentRoute = null;
      return;
    }

    this.vehicleService.getRouteById(routeId).subscribe(route => {
      if (route) {
        this.currentRoute = route;
        if (isRouteChange) this.isInitialRouteLoad = false;
      }
    });
  }

  private updateMapWithStations(stations: Station[]): void {
    if (stations.length > 0) {
      this.mapService.updateStationMarkers(stations);
      this.fitBoundsToRouteAndStations();
    }
  }

  private updateMapWithShapes(shapes: Shape[]): void {
    if (shapes.length > 0 && this.currentRoute) {
      this.mapService.addRouteLayer(this.currentRoute, shapes);
      this.fitBoundsToRouteAndStations();
    }
  }

  private fitBoundsToRouteAndStations(): void {
    if (this.routeFramed || !this.map) return;

    if (this.isInitialRouteLoad && this.mapService.wereBoundsRestored()) {
      this.routeFramed       = true;
      this.isInitialRouteLoad = false;
      return;
    }

    setTimeout(() => {
      this.mapService.fitBoundsToRoute();
      this.routeFramed       = true;
      this.isInitialRouteLoad = false;
    }, 200);
  }
}
