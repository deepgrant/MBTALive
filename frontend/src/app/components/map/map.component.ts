import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { Vehicle } from '../../models/vehicle.model';
import { Route, Shape } from '../../models/route.model';
import { Station } from '../../models/station.model';
import { VehicleService } from '../../services/vehicle.service';
import { MapService } from '../../services/map.service';

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.scss']
})
export class MapComponent implements OnInit, OnDestroy, AfterViewInit {
  private subscriptions: Subscription[] = [];
  private map: any;
  private currentRoute: Route | null = null;
  private routeFramed: boolean = false;

  constructor(
    private vehicleService: VehicleService,
    private mapService: MapService
  ) { }

  ngOnInit(): void {
    console.log('MapComponent: Initializing...');

    // Subscribe to vehicle updates
    const vehicleSub = this.vehicleService.filteredVehicles$.subscribe({
      next: (vehicles) => {
        console.log('MapComponent: Vehicles received:', vehicles);
        this.updateMapWithVehicles(vehicles);
      },
      error: (error) => {
        console.error('MapComponent: Error receiving vehicles:', error);
      }
    });

    // Subscribe to selected route changes
    const selectedRouteSub = this.vehicleService.selectedRoute$.subscribe({
      next: (routeId) => {
        console.log('MapComponent: Selected route changed:', routeId);
        this.handleRouteSelection(routeId);
      },
      error: (error) => {
        console.error('MapComponent: Error receiving selected route:', error);
      }
    });

    // Subscribe to route stations
    const stationsSub = this.vehicleService.selectedRouteStations$.subscribe({
      next: (stations) => {
        console.log('MapComponent: Stations received:', stations);
        this.updateMapWithStations(stations);
      },
      error: (error) => {
        console.error('MapComponent: Error receiving stations:', error);
      }
    });

    // Subscribe to route shapes
    const shapesSub = this.vehicleService.selectedRouteShapes$.subscribe({
      next: (shapes) => {
        console.log('MapComponent: Shapes received:', shapes);
        this.updateMapWithShapes(shapes);
      },
      error: (error) => {
        console.error('MapComponent: Error receiving shapes:', error);
      }
    });

    // Subscribe to selected vehicle
    const selectedVehicleSub = this.vehicleService.selectedVehicle$.subscribe({
      next: (vehicleId) => {
        console.log('MapComponent: Selected vehicle changed:', vehicleId);
        if (vehicleId && this.map) {
          console.log('MapComponent: Map is ready, highlighting vehicle:', vehicleId);
          // Add a small delay to ensure map centering has completed
          setTimeout(() => {
            this.mapService.highlightVehicleMarker(vehicleId);
          }, 100);
        } else if (vehicleId && !this.map) {
          console.log('MapComponent: Map not ready yet, vehicle selection queued:', vehicleId);
        }
      },
      error: (error) => {
        console.error('MapComponent: Error receiving selected vehicle:', error);
      }
    });

    this.subscriptions.push(vehicleSub, selectedRouteSub, stationsSub, shapesSub, selectedVehicleSub);
  }

  ngAfterViewInit(): void {
    // Initialize map after view is ready
    setTimeout(() => {
      console.log('MapComponent: Initializing map...');
      try {
        this.map = this.mapService.initializeMap('map');
        console.log('MapComponent: Map initialized successfully:', this.map);
      } catch (error) {
        console.error('MapComponent: Error initializing map:', error);
      }
    }, 300);
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  private updateMapWithVehicles(vehicles: Vehicle[]): void {
    console.log('MapComponent: Updating vehicles on map:', vehicles.length);
    console.log('MapComponent: Vehicle data received:', vehicles);

    if (vehicles.length === 0) {
      console.log('MapComponent: No vehicles to display');
      return;
    }

    console.log('MapComponent: Calling mapService.updateVehicleMarkers');
    this.mapService.updateVehicleMarkers(vehicles);
    console.log('MapComponent: Vehicle markers update call completed');
    // DO NOT call fitBoundsToVehicles() - keep current map view
  }

  private handleRouteSelection(routeId: string | null): void {
    // Always clear existing route data first
    console.log('MapComponent: Clearing previous route data');
    this.mapService.clearRouteLayers();
    this.mapService.clearStationMarkers();
    this.routeFramed = false;  // Reset framing flag

    if (!routeId) {
      this.currentRoute = null;
      return;
    }

    // Get route information for new selection
    this.vehicleService.getRouteById(routeId).subscribe(route => {
      if (route) {
        console.log('MapComponent: Loading new route:', route.id);
        this.currentRoute = route;
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
    // Only frame once when route is first loaded
    if (!this.routeFramed && this.map) {
      setTimeout(() => {
        console.log('MapComponent: Framing route to fit window');
        this.mapService.fitBoundsToRoute();
        this.routeFramed = true;
      }, 200); // Delay to ensure shapes and stations are rendered
    }
  }
}
