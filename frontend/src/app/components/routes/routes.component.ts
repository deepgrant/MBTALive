import { Component, OnInit, OnDestroy } from '@angular/core';
import { MatListModule } from '@angular/material/list';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { Subscription } from 'rxjs';
import { Route } from '../../models/route.model';
import { Alert, AlertSeverityLevel, alertSeverityLevel, highestSeverityLevel } from '../../models/alert.model';
import { VehicleService } from '../../services/vehicle.service';
import { ROUTE_TYPE } from '../../services/vehicle-format.service';
import { REFRESH_SPINNER_MS } from '../../shared/timing.constants';

@Component({
    selector: 'app-routes',
    imports: [
        MatListModule,
        MatCardModule,
        MatButtonModule,
        MatIconModule,
        MatButtonToggleModule
    ],
    templateUrl: './routes.component.html',
    styleUrls: ['./routes.component.scss']
})
export class RoutesComponent implements OnInit, OnDestroy {
  routes: Route[] = [];
  filteredRoutes: Route[] = [];
  alertLevelMap: Map<string, AlertSeverityLevel | null> = new Map();
  selectedRoute: string | null = null;
  isRefreshing: boolean = false;
  routeTypeFilter: string = 'all';
  private allAlerts: Alert[] = [];
  private subscriptions: Subscription[] = [];

  constructor(private vehicleService: VehicleService) { }

  ngOnInit(): void {
    this.subscriptions.push(
      this.vehicleService.routes$.subscribe({
        next: (routes) => {
          this.routes = routes;
          this.updateFilteredRoutes();
          this.updateAlertLevelMap();
        },
        error: (error) => { console.error('RoutesComponent: Error receiving routes:', error); }
      }),
      this.vehicleService.selectedRoute$.subscribe({
        next: (route) => { this.selectedRoute = route; },
        error: (error) => { console.error('RoutesComponent: Error receiving selected route:', error); }
      }),
      this.vehicleService.allAlerts$.subscribe({
        next: (alerts) => {
          this.allAlerts = alerts;
          this.updateAlertLevelMap();
        },
        error: (error) => { console.error('RoutesComponent: Error receiving global alerts:', error); }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  selectRoute(routeId: string): void {
    this.vehicleService.selectRoute(this.selectedRoute === routeId ? null : routeId);
  }

  getRouteColor(route: Route): string {
    return `#${route.color}`;
  }

  getTextColor(route: Route): string {
    return `#${route.text_color}`;
  }

  refreshRoutes(): void {
    this.isRefreshing = true;
    this.vehicleService.refreshRoutes();
    setTimeout(() => { this.isRefreshing = false; }, REFRESH_SPINNER_MS);
  }

  setRouteTypeFilter(type: string): void {
    this.routeTypeFilter = type;
    this.updateFilteredRoutes();
  }

  getRouteTypeIcon(route: Route): string {
    switch (route.route_type) {
      case ROUTE_TYPE.LIGHT_RAIL:    return 'tram';
      case ROUTE_TYPE.HEAVY_RAIL:    return 'train';
      case ROUTE_TYPE.COMMUTER_RAIL: return 'train';
      case ROUTE_TYPE.BUS:           return 'directions_bus';
      default:                       return 'help';
    }
  }

  getRouteTypeLabel(route: Route): string {
    switch (route.route_type) {
      case ROUTE_TYPE.LIGHT_RAIL:    return 'Light Rail';
      case ROUTE_TYPE.HEAVY_RAIL:    return 'Heavy Rail';
      case ROUTE_TYPE.COMMUTER_RAIL: return 'Commuter Rail';
      case ROUTE_TYPE.BUS:           return 'Bus';
      default:                       return 'Unknown';
    }
  }

  private updateFilteredRoutes(): void {
    switch (this.routeTypeFilter) {
      case 'rail':
        this.filteredRoutes = this.routes.filter(r => r.route_type <= ROUTE_TYPE.COMMUTER_RAIL);
        break;
      case 'bus':
        this.filteredRoutes = this.routes.filter(r => r.route_type === ROUTE_TYPE.BUS);
        break;
      default:
        this.filteredRoutes = this.routes;
    }
  }

  private updateAlertLevelMap(): void {
    this.alertLevelMap = new Map(
      this.routes.map(r => {
        const routeAlerts = this.allAlerts.filter(a => a.routeIds?.includes(r.id));
        return [r.id, highestSeverityLevel(routeAlerts)];
      })
    );
  }
}
