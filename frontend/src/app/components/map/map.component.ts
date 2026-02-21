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
    imports: [CommonModule],
    templateUrl: './map.component.html',
    styleUrls: ['./map.component.scss']
})
export class MapComponent implements OnInit, OnDestroy, AfterViewInit {
  private subscriptions: Subscription[] = [];
  private map: any;
  private currentRoute: Route | null = null;
  private currentRouteId: string | null = null;
  private routeFramed: boolean = false;
  private isInitialRouteLoad: boolean = true;

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
        
        // Restore route selection from cookie after map is fully initialized
        // Wait longer to ensure map bounds restoration completes and map is ready
        // This ensures the map is ready to display route shapes and vehicles
        setTimeout(() => {
          console.log('MapComponent: Restoring route from cookie after map initialization');
          this.vehicleService.restoreRouteFromCookie();
        }, 800);
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
      // Still pass route ID even if no vehicles
      this.mapService.updateVehicleMarkers(vehicles, this.currentRouteId);
      return;
    }

    // Get route ID from vehicles if not set (should all be same route)
    const routeIdFromVehicles = vehicles[0]?.routeId;
    
    console.log('MapComponent: Calling mapService.updateVehicleMarkers with route ID:', this.currentRouteId || routeIdFromVehicles);
    this.mapService.updateVehicleMarkers(vehicles, this.currentRouteId || routeIdFromVehicles);
    console.log('MapComponent: Vehicle markers update call completed');
    // DO NOT call fitBoundsToVehicles() - keep current map view
  }

  private handleRouteSelection(routeId: string | null): void {
    // Stop vehicle tracking silently when route changes to prevent false dialog
    console.log('MapComponent: Stopping vehicle tracking due to route change');
    this.mapService.stopVehicleTrackingSilently();

    // Check if this is a route change (not initial load)
    const isRouteChange = this.currentRouteId !== null && this.currentRouteId !== routeId;
    
    // Always clear existing route data first
    console.log('MapComponent: Clearing previous route data');
    this.mapService.clearRouteLayers();
    this.mapService.clearStationMarkers();
    this.routeFramed = false;  // Reset framing flag

    // Update current route ID
    this.currentRouteId = routeId;

    if (!routeId) {
      this.currentRoute = null;
      return;
    }

    // Get route information for new selection
    this.vehicleService.getRouteById(routeId).subscribe(route => {
      if (route) {
        console.log('MapComponent: Loading new route:', route.id);
        this.currentRoute = route;
        
        // If this is a route change (user manually selected a different route),
        // we should always frame the route, regardless of saved bounds
        if (isRouteChange) {
          console.log('MapComponent: Route changed, will frame new route');
          // Reset initial load flag so route will be framed
          this.isInitialRouteLoad = false;
        }
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
    // Skip framing on initial load if bounds were restored from cookies (user preference)
    // But always frame when user manually changes routes
    if (!this.routeFramed && this.map) {
      const shouldSkipFraming = this.isInitialRouteLoad && this.mapService.wereBoundsRestored();
      
      if (!shouldSkipFraming) {
        setTimeout(() => {
          console.log('MapComponent: Framing route to fit window');
          this.mapService.fitBoundsToRoute();
          this.routeFramed = true;
          // After first route is framed, mark that initial load is complete
          this.isInitialRouteLoad = false;
        }, 200); // Delay to ensure shapes and stations are rendered
      } else {
        console.log('MapComponent: Skipping route framing on initial load because bounds were restored from cookies');
        this.routeFramed = true; // Mark as framed to prevent future framing
        // Mark initial load as complete after skipping
        this.isInitialRouteLoad = false;
      }
    }
  }
}
