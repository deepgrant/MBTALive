import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatListModule } from '@angular/material/list';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { Subscription } from 'rxjs';
import { Route } from '../../models/route.model';
import { VehicleService } from '../../services/vehicle.service';

const ROUTE_TYPE_META: Record<number, { icon: string; label: string }> = {
  0: { icon: 'tram',          label: 'Light Rail' },
  1: { icon: 'train',         label: 'Heavy Rail' },
  2: { icon: 'train',         label: 'Commuter Rail' },
  3: { icon: 'directions_bus', label: 'Bus' }
};

@Component({
  selector: 'app-routes',
  imports: [
    CommonModule,
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
  isRefreshing = false;
  routeTypeFilter = 'all';
  private subscriptions: Subscription[] = [];

  constructor(private vehicleService: VehicleService) { }

  ngOnInit(): void {
    this.subscriptions.push(
      this.vehicleService.routes$.subscribe({
        next: routes => { this.routes = routes; },
        error: error => console.error('RoutesComponent: Error receiving routes:', error)
      }),
      this.vehicleService.selectedRoute$.subscribe({
        next: route => { this.selectedRoute = route; },
        error: error => console.error('RoutesComponent: Error receiving selected route:', error)
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(s => s.unsubscribe());
  }

  selectRoute(routeId: string): void {
    this.vehicleService.selectRoute(this.selectedRoute === routeId ? null : routeId);
  }

  getRouteColor(route: Route): string { return `#${route.color}`; }
  getTextColor(route: Route): string  { return `#${route.text_color}`; }

  getRouteTypeIcon(route: Route): string  { return ROUTE_TYPE_META[route.route_type]?.icon  ?? 'help'; }
  getRouteTypeLabel(route: Route): string { return ROUTE_TYPE_META[route.route_type]?.label ?? 'Unknown'; }

  refreshRoutes(): void {
    this.isRefreshing = true;
    this.vehicleService.refreshRoutes();
    setTimeout(() => { this.isRefreshing = false; }, 500);
  }

  getFilteredRoutes(): Route[] {
    switch (this.routeTypeFilter) {
      case 'rail': return this.routes.filter(r => r.route_type <= 2);
      case 'bus':  return this.routes.filter(r => r.route_type === 3);
      default:     return this.routes;
    }
  }
}
