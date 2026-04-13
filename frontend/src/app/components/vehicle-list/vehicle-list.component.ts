import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatListModule } from '@angular/material/list';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { Vehicle } from '../../models/vehicle.model';
import { VehicleService } from '../../services/vehicle.service';
import { MapService } from '../../services/map.service';
import {
  DelayStatus,
  formatStatus,
  getDelayStatus,
  formatDelayTime,
  formatTime,
  formatSpeed,
  isBus
} from '../../utils/vehicle-utils';

@Component({
  selector: 'app-vehicle-list',
  imports: [CommonModule, MatListModule, MatCardModule, MatIconModule],
  templateUrl: './vehicle-list.component.html',
  styleUrls: ['./vehicle-list.component.scss']
})
export class VehicleListComponent implements OnInit, OnDestroy {
  vehicles: Vehicle[] = [];
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
        next: vehicles => { this.vehicles = vehicles; },
        error: error => console.error('VehicleListComponent: Error receiving vehicles:', error)
      }),
      this.vehicleService.selectedRoute$.subscribe({
        next: route => { this.selectedRoute = route; },
        error: error => console.error('VehicleListComponent: Error receiving selected route:', error)
      }),
      this.vehicleService.selectedVehicle$.subscribe({
        next: vehicleId => { this.selectedVehicle = vehicleId; },
        error: error => console.error('VehicleListComponent: Error receiving selected vehicle:', error)
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(s => s.unsubscribe());
  }

  selectVehicle(vehicleId: string): void {
    if (this.selectedVehicle === vehicleId) {
      // Deselect: stop map tracking first, then clear service state
      this.mapService.centerOnVehicle(vehicleId);
      this.vehicleService.selectVehicle(null);
      return;
    }
    this.vehicleService.selectVehicle(vehicleId);
    this.mapService.centerOnVehicle(vehicleId);
  }

  // Delegate to shared utilities so templates can call them
  getDelayStatus(delaySeconds?: number): DelayStatus { return getDelayStatus(delaySeconds); }
  formatStatus(status: string, stopName?: string): string { return formatStatus(status, stopName); }
  formatDelayTime(delaySeconds?: number): string { return formatDelayTime(delaySeconds); }
  formatTime(timestamp: string): string { return formatTime(timestamp); }
  formatSpeed(speed: number): string { return formatSpeed(speed); }
  isBus(vehicle: Vehicle): boolean { return isBus(vehicle.routeType); }
}
