import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { Subscription, combineLatest } from 'rxjs';
import { take } from 'rxjs/operators';
import { VehicleService } from '../../services/vehicle.service';
import { BusMapService } from '../../services/bus-map.service';
import { AlertTickerComponent } from '../alert-ticker/alert-ticker.component';
import { Route } from '../../models/route.model';
import { Alert } from '../../models/alert.model';

@Component({
  selector: 'app-bus-map',
  standalone: true,
  imports: [AlertTickerComponent],
  templateUrl: './bus-map.component.html',
  styleUrls: ['./bus-map.component.scss']
})
export class BusMapComponent implements OnInit, OnDestroy, AfterViewInit {
  alerts: Alert[] = [];

  private subscriptions: Subscription[] = [];
  private currentRoute: Route | null = null;
  private routeFramed = false;

  constructor(
    private vehicleService: VehicleService,
    private busMapService: BusMapService
  ) {}

  ngOnInit(): void {
    // Track the current route object whenever selectedRoute$ or routes$ changes
    this.subscriptions.push(
      combineLatest([this.vehicleService.selectedRoute$, this.vehicleService.routes$]).subscribe(
        ([routeId, routes]) => {
          const route = routes.find(r => r.id === routeId) ?? null;
          if (route?.id !== this.currentRoute?.id) {
            this.currentRoute = route;
            this.routeFramed = false;
            this.busMapService.clearAll();
          }
        }
      ),

      this.vehicleService.selectedRouteShapes$.subscribe(shapes => {
        if (!this.currentRoute || !shapes.length) return;
        this.busMapService.updateRouteShapes(shapes, this.currentRoute);
        if (!this.routeFramed) {
          this.routeFramed = true;
          setTimeout(() => this.busMapService.fitBoundsToRoute(), 200);
        }
      }),

      this.vehicleService.selectedRouteStations$.subscribe(stations => {
        if (stations.length) this.busMapService.updateStops(stations);
      }),

      this.vehicleService.filteredVehicles$.subscribe(vehicles => {
        if (this.currentRoute) {
          this.busMapService.updateVehicles(vehicles, this.currentRoute.color);
        }
      }),

      this.vehicleService.selectedRouteAlerts$.subscribe(alerts => {
        this.alerts = alerts;
      })
    );
  }

  ngAfterViewInit(): void {
    // Delay matches MapComponent pattern — ensures the container has rendered dimensions
    setTimeout(() => this.busMapService.initializeMap('bus-map'), 300);
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(s => s.unsubscribe());
    this.busMapService.destroyMap();
  }
}
