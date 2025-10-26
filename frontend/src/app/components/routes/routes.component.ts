import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatListModule } from '@angular/material/list';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
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
    MatIconModule
  ],
  templateUrl: './routes.component.html',
  styleUrls: ['./routes.component.scss']
})
export class RoutesComponent implements OnInit, OnDestroy {
  routes: Route[] = [];
  selectedRoute: string | null = null;
  isRefreshing: boolean = false;
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
    if (this.selectedRoute === routeId) {
      // Deselect if already selected
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
    console.log('RoutesComponent: Refreshing routes...');
    this.isRefreshing = true;
    
    this.vehicleService.refreshRoutes();
    
    // Reset after animation completes
    setTimeout(() => {
      this.isRefreshing = false;
    }, 500);
  }
}
