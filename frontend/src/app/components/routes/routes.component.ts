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

@Component({
  selector: 'app-routes',
  standalone: true,
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
  isRefreshing: boolean = false;
  routeTypeFilter: string = 'all';
  private subscriptions: Subscription[] = [];

  constructor(private vehicleService: VehicleService) { }

  ngOnInit(): void {
    console.log('RoutesComponent: Initializing...');

    // Subscribe to routes
    const routesSub = this.vehicleService.routes$.subscribe({
      next: (routes) => {
        console.log('RoutesComponent: Routes received:', routes);
        console.log('RoutesComponent: Routes length:', routes.length);
        this.routes = routes;
      },
      error: (error) => {
        console.error('RoutesComponent: Error receiving routes:', error);
      }
    });

    // Subscribe to selected route
    const selectedRouteSub = this.vehicleService.selectedRoute$.subscribe({
      next: (route) => {
        console.log('RoutesComponent: Selected route changed:', route);
        this.selectedRoute = route;
      },
      error: (error) => {
        console.error('RoutesComponent: Error receiving selected route:', error);
      }
    });

    this.subscriptions.push(routesSub, selectedRouteSub);
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  selectRoute(routeId: string): void {
    console.log('RoutesComponent: Route clicked:', routeId, 'currently selected:', this.selectedRoute);
    if (this.selectedRoute === routeId) {
      // Deselect if already selected
      console.log('RoutesComponent: Deselecting route');
      this.vehicleService.selectRoute(null);
    } else {
      console.log('RoutesComponent: Selecting new route:', routeId);
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
    console.log('RoutesComponent: Refreshing routes...');
    this.isRefreshing = true;

    this.vehicleService.refreshRoutes();

    // Reset after animation completes
    setTimeout(() => {
      this.isRefreshing = false;
    }, 500);
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
    console.log('RoutesComponent: Setting route type filter to:', type);
    this.routeTypeFilter = type;
  }

  getRouteTypeIcon(route: Route): string {
    switch (route.route_type) {
      case 0: return 'tram'; // Light Rail
      case 1: return 'train'; // Heavy Rail
      case 2: return 'train'; // Commuter Rail
      case 3: return 'directions_bus'; // Bus
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
