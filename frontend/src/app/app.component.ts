import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RoutesComponent } from './components/routes/routes.component';
import { MapComponent } from './components/map/map.component';
import { VehicleListComponent } from './components/vehicle-list/vehicle-list.component';
import { VehicleService } from './services/vehicle.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    RoutesComponent,
    MapComponent,
    VehicleListComponent
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'MBTA Tracker';
  selectedRoute: string | null = null;
  routesPanelVisible = true;
  private subscriptions: Subscription[] = [];

  constructor(private vehicleService: VehicleService) { }

  ngOnInit(): void {
    // Subscribe to selected route to show/hide vehicle panel
    const selectedRouteSub = this.vehicleService.selectedRoute$.subscribe({
      next: (routeId) => {
        this.selectedRoute = routeId;
      },
      error: (error) => {
        console.error('AppComponent: Error receiving selected route:', error);
      }
    });

    this.subscriptions.push(selectedRouteSub);
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  toggleRoutesPanel(): void {
    this.routesPanelVisible = !this.routesPanelVisible;
  }
}