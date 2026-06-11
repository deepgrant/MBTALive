import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { Vehicle } from '../../models/vehicle.model';
import { Route, Shape } from '../../models/route.model';
import { Station } from '../../models/station.model';
import { Alert } from '../../models/alert.model';
import { VehicleService } from '../../services/vehicle.service';
import { MapService } from '../../services/map.service';
import { AlertTickerComponent } from '../alert-ticker/alert-ticker.component';

@Component({
    selector: 'app-map',
    imports: [AlertTickerComponent],
    templateUrl: './map.component.html',
    styleUrls: ['./map.component.scss']
})
export class MapComponent implements OnInit, OnDestroy, AfterViewInit {
  private subscriptions: Subscription[] = [];
  private mapInitialized = false;
  private currentRoute: Route | null = null;
  private currentRouteId: string | null = null;
  private routeFramed: boolean = false;
  private isInitialRouteLoad: boolean = true;
  private lastShapes: Shape[] | null = null;
  private lastStations: Station[] | null = null;
  alerts: Alert[] = [];

  constructor(
    private vehicleService: VehicleService,
    private mapService: MapService
  ) { }

  ngOnInit(): void {
    this.subscriptions.push(
      this.vehicleService.filteredVehicles$.subscribe({
        next: (vehicles) => { this.updateMapWithVehicles(vehicles); },
        error: (error) => { console.error('MapComponent: Error receiving vehicles:', error); }
      }),
      this.vehicleService.selectedRoute$.subscribe({
        next: (routeId) => { this.handleRouteSelection(routeId); },
        error: (error) => { console.error('MapComponent: Error receiving selected route:', error); }
      }),
      this.vehicleService.selectedRouteStations$.subscribe({
        next: (stations) => { this.updateMapWithStations(stations); },
        error: (error) => { console.error('MapComponent: Error receiving stations:', error); }
      }),
      this.vehicleService.selectedRouteShapes$.subscribe({
        next: (shapes) => { this.updateMapWithShapes(shapes); },
        error: (error) => { console.error('MapComponent: Error receiving shapes:', error); }
      }),
      this.vehicleService.selectedRouteAlerts$.subscribe({
        next: (alerts) => {
          this.alerts = alerts;
          const alertedStopIds = new Set(alerts.filter(a => a.effect !== 'DELAY').flatMap(a => a.stopIds ?? []));
          const delayedStopIds = new Set(alerts.filter(a => a.effect === 'DELAY').flatMap(a => a.stopIds ?? []));
          this.mapService.updateStationAlerts(alertedStopIds, delayedStopIds);
        },
        error: (error) => { console.error('MapComponent: Error receiving alerts:', error); }
      })
    );
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      try {
        this.mapService.initializeMap('map');
        this.mapInitialized = true;
        // Re-apply any data that arrived before the map was ready (fast responses
        // on mobile may have targeted the previous map instance which was removed).
        if (this.lastShapes && this.lastShapes.length > 0 && this.currentRoute) {
          this.mapService.addRouteLayer(this.currentRoute, this.lastShapes);
        }
        if (this.lastStations && this.lastStations.length > 0) {
          this.mapService.updateStationMarkers(this.lastStations);
        }
        if ((this.lastShapes?.length ?? 0) > 0 || (this.lastStations?.length ?? 0) > 0) {
          this.fitBoundsToRouteAndStations();
        }
      } catch (error) {
        console.error('MapComponent: Error initializing map:', error);
      }
    }, 300);
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  private updateMapWithVehicles(vehicles: Vehicle[]): void {
    this.mapService.updateVehicleMarkers(vehicles);
  }

  private handleRouteSelection(routeId: string | null): void {
    const isRouteChange = this.currentRouteId !== null && this.currentRouteId !== routeId;

    this.lastShapes = null;
    this.lastStations = null;
    this.mapService.clearRouteLayers();
    this.mapService.clearStationMarkers();
    this.routeFramed = false;
    this.currentRouteId = routeId;

    if (!routeId) {
      this.currentRoute = null;
      return;
    }

    this.vehicleService.getRouteById(routeId).subscribe(route => {
      if (route) {
        this.currentRoute = route;
        if (isRouteChange) {
          this.isInitialRouteLoad = false;
        }
      }
    });
  }

  private updateMapWithStations(stations: Station[]): void {
    if (stations.length > 0) {
      this.lastStations = stations;
      this.mapService.updateStationMarkers(stations);
      this.fitBoundsToRouteAndStations();
    }
  }

  private updateMapWithShapes(shapes: Shape[]): void {
    if (shapes.length > 0 && this.currentRoute) {
      this.lastShapes = shapes;
      this.mapService.addRouteLayer(this.currentRoute, shapes);
      this.fitBoundsToRouteAndStations();
    }
  }

  private fitBoundsToRouteAndStations(): void {
    if (!this.routeFramed && this.mapInitialized) {
      // Skip auto-framing only on the very first route load of the session when
      // the map already has saved bounds — this preserves the user's last position
      // on desktop. Once the session is initialized (any map view has completed),
      // always re-frame so route changes on mobile get proper centering.
      const shouldSkipFraming = !this.mapService.isSessionInitialized()
        && this.isInitialRouteLoad
        && this.mapService.wereBoundsRestored();

      if (!shouldSkipFraming) {
        setTimeout(() => {
          this.mapService.fitBoundsToRoute();
          this.routeFramed = true;
          this.isInitialRouteLoad = false;
          this.mapService.markSessionInitialized();
        }, 200);
      } else {
        this.routeFramed = true;
        this.isInitialRouteLoad = false;
        this.mapService.markSessionInitialized();
      }
    }
  }
}
