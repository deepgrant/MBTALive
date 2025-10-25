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
  private subscriptions: Subscription[] = [];

  constructor(private vehicleService: VehicleService) { }

  ngOnInit(): void {
    // Subscribe to routes
    const routesSub = this.vehicleService.routes$.subscribe(routes => {
      this.routes = routes;
    });

    // Subscribe to selected route
    const selectedRouteSub = this.vehicleService.selectedRoute$.subscribe(route => {
      this.selectedRoute = route;
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
}
