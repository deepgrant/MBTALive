import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatListModule } from '@angular/material/list';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { Vehicle } from '../../models/vehicle.model';
import { VehicleService } from '../../services/vehicle.service';
import { MapService } from '../../services/map.service';

@Component({
    selector: 'app-vehicle-list',
    imports: [
        CommonModule,
        MatListModule,
        MatCardModule,
        MatIconModule
    ],
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
    console.log('VehicleListComponent: Initializing...');

    // Subscribe to filtered vehicles
    const vehiclesSub = this.vehicleService.filteredVehicles$.subscribe({
      next: (vehicles) => {
        console.log('VehicleListComponent: Vehicles received:', vehicles);
        this.vehicles = vehicles;
      },
      error: (error) => {
        console.error('VehicleListComponent: Error receiving vehicles:', error);
      }
    });

    // Subscribe to selected route
    const selectedRouteSub = this.vehicleService.selectedRoute$.subscribe({
      next: (route) => {
        console.log('VehicleListComponent: Selected route changed:', route);
        this.selectedRoute = route;
      },
      error: (error) => {
        console.error('VehicleListComponent: Error receiving selected route:', error);
      }
    });

    // Subscribe to selected vehicle
    const selectedVehicleSub = this.vehicleService.selectedVehicle$.subscribe({
      next: (vehicleId) => {
        console.log('VehicleListComponent: Selected vehicle changed:', vehicleId);
        this.selectedVehicle = vehicleId;
      },
      error: (error) => {
        console.error('VehicleListComponent: Error receiving selected vehicle:', error);
      }
    });

    this.subscriptions.push(vehiclesSub, selectedRouteSub, selectedVehicleSub);
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  selectVehicle(vehicleId: string): void {
    console.log('VehicleListComponent: Vehicle clicked:', vehicleId);
    console.log('VehicleListComponent: Available vehicles:', this.vehicles.map(v => v.vehicleId));
    console.log('VehicleListComponent: Current selected vehicle:', this.selectedVehicle);
    
    // If clicking the same vehicle that's already selected, deselect it
    if (this.selectedVehicle === vehicleId) {
      console.log('VehicleListComponent: Deselecting vehicle:', vehicleId);
      this.vehicleService.selectVehicle(null);
      // centerOnVehicle will handle stopping tracking
      this.mapService.centerOnVehicle(vehicleId);
      console.log('VehicleListComponent: Vehicle deselected');
      return;
    }
    
    // Select the new vehicle
    console.log('VehicleListComponent: Calling vehicleService.selectVehicle...');
    this.vehicleService.selectVehicle(vehicleId);
    console.log('VehicleListComponent: Calling mapService.centerOnVehicle...');
    this.mapService.centerOnVehicle(vehicleId);
    console.log('VehicleListComponent: Vehicle selection complete');
  }

  testHighlighting(): void {
    console.log('VehicleListComponent: Testing highlighting...');
    this.mapService.testHighlighting();
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

  /**
   * Format delay time for display
   * @param delaySeconds - Delay in seconds
   * @returns Formatted delay string
   */
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
