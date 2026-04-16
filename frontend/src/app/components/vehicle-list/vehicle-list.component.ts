import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatListModule } from '@angular/material/list';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { Vehicle } from '../../models/vehicle.model';
import { Alert } from '../../models/alert.model';
import { VehicleService } from '../../services/vehicle.service';
import { MapService } from '../../services/map.service';
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
  selectedVehicle: string | null = null;
  private subscriptions: Subscription[] = [];

  constructor(
    private vehicleService: VehicleService,
    private mapService: MapService
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
      this.vehicleService.selectedVehicle$.subscribe({
        next: (vehicleId) => { this.selectedVehicle = vehicleId; },
        error: (error) => { console.error('VehicleListComponent: Error receiving selected vehicle:', error); }
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

  selectVehicle(vehicleId: string): void {
    if (this.selectedVehicle === vehicleId) {
      this.vehicleService.selectVehicle(null);
      this.mapService.centerOnVehicle(vehicleId);
      return;
    }
    this.vehicleService.selectVehicle(vehicleId);
    this.mapService.centerOnVehicle(vehicleId);
  }

  formatSpeed(speed: number): string {
    return `${speed.toFixed(1)} mph`;
  }

  formatTime(timestamp: string): string {
    return new Date(timestamp).toLocaleTimeString();
  }

  isBus(vehicle: Vehicle): boolean {
    return vehicle.routeType === 3;
  }

  getDelayColor(delayStatus?: string): string {
    switch (delayStatus) {
      case 'ahead':       return '#17a2b8';
      case 'minor-delay': return '#ffc107';
      case 'major-delay': return '#dc3545';
      default:            return '#28a745';
    }
  }

  formatDelayTime(delaySeconds?: number): string {
    if (!delaySeconds) return 'On Time';

    if (delaySeconds < 0) {
      const minutesAhead = Math.abs(Math.round(delaySeconds / 60));
      return `Ahead by ${minutesAhead} min`;
    } else if (delaySeconds < 60) {
      return `${delaySeconds} sec delay`;
    } else {
      const minutes = Math.round(delaySeconds / 60);
      return `${minutes} min delay`;
    }
  }
}
