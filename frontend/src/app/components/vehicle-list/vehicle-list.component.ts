import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatListModule } from '@angular/material/list';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { Vehicle } from '../../models/vehicle.model';
import { Alert } from '../../models/alert.model';
import { VehicleService } from '../../services/vehicle.service';
import { VehicleFormatService } from '../../services/vehicle-format.service';
import { AlertBannerComponent } from '../alert-banner/alert-banner.component';

@Component({
    selector: 'app-vehicle-list',
    imports: [
        CommonModule,
        MatListModule,
        MatCardModule,
        MatIconModule,
        AlertBannerComponent
    ],
    templateUrl: './vehicle-list.component.html',
    styleUrls: ['./vehicle-list.component.scss']
})
export class VehicleListComponent implements OnInit, OnDestroy {
  vehicles: Vehicle[] = [];
  alerts: Alert[] = [];
  selectedRoute: string | null = null;
  private subscriptions: Subscription[] = [];

  constructor(
    private vehicleService: VehicleService,
    readonly fmt: VehicleFormatService
  ) { }

  ngOnInit(): void {
    this.subscriptions.push(
      this.vehicleService.filteredVehicles$.subscribe({
        next: (vehicles) => { this.vehicles = vehicles; },
        error: (error) => { console.error('VehicleListComponent: Error receiving vehicles:', error); }
      }),
      this.vehicleService.selectedRoute$.subscribe({
        next: (route) => { this.selectedRoute = route; },
        error: (error) => { console.error('VehicleListComponent: Error receiving selected route:', error); }
      }),
      this.vehicleService.selectedRouteAlerts$.subscribe({
        next: (alerts) => { this.alerts = alerts; },
        error: (error) => { console.error('VehicleListComponent: Error receiving alerts:', error); }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

}
