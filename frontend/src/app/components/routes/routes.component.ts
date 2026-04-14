import { Component, OnInit, OnDestroy } from '@angular/core';
import { MatListModule } from '@angular/material/list';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { Subscription } from 'rxjs';
import { Route } from '../../models/route.model';
import { VehicleService } from '../../services/vehicle.service';

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
  selectedRoute: string | null = null;
  isRefreshing: boolean = false;
  routeTypeFilter: string = 'all';
  private subscriptions: Subscription[] = [];

  constructor(private vehicleService: VehicleService) { }

  ngOnInit(): void {
    this.subscriptions.push(
      this.vehicleService.routes$.subscribe({
        next: (routes) => { this.routes = routes; },
        error: (error) => { console.error('RoutesComponent: Error receiving routes:', error); }
      }),
      this.vehicleService.selectedRoute$.subscribe({
        next: (route) => { this.selectedRoute = route; },
        error: (error) => { console.error('RoutesComponent: Error receiving selected route:', error); }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  selectRoute(routeId: string): void {
    if (this.selectedRoute === routeId) {
      this.vehicleService.selectRoute(null);
    } else {
      this.vehicleService.selectRoute(routeId);
    }
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
    // Reset after animation completes
    setTimeout(() => { this.isRefreshing = false; }, 500);
  }

  getFilteredRoutes(): Route[] {
    if (this.routeTypeFilter === 'all') {
      return this.routes;
    } else if (this.routeTypeFilter === 'rail') {
      return this.routes.filter(route => route.route_type <= 2);
    } else if (this.routeTypeFilter === 'bus') {
      return this.routes.filter(route => route.route_type === 3);
    }
    return this.routes;
  }

  setRouteTypeFilter(type: string): void {
    this.routeTypeFilter = type;
  }

  getRouteTypeIcon(route: Route): string {
    switch (route.route_type) {
      case 0: return 'tram';
      case 1: return 'train';
      case 2: return 'train';
      case 3: return 'directions_bus';
      default: return 'help';
    }
  }

  getRouteTypeLabel(route: Route): string {
    switch (route.route_type) {
      case 0: return 'Light Rail';
      case 1: return 'Heavy Rail';
      case 2: return 'Commuter Rail';
      case 3: return 'Bus';
      default: return 'Unknown';
    }
  }
}
