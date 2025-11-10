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
  standalone: true,
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

  formatStatus(status: string, stopName?: string): string {
    if (!status) return 'Unknown';

    const stop = stopName && stopName !== 'Unknown' ? stopName : 'next stop';

    switch (status.toUpperCase()) {
      case 'IN_TRANSIT_TO':
        return `In transit to ${stop}`;
      case 'STOPPED_AT':
        return `Stopped at ${stop}`;
      case 'INCOMING_AT':
        return `Incoming at ${stop}`;
      default:
        // Convert underscores to spaces and title case
        return status.replace(/_/g, ' ')
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');
    }
  }

  isBus(vehicle: Vehicle): boolean {
    return vehicle.routeType === 3;
  }

  /**
   * Get delay status for a vehicle based on delay seconds
   * @param delaySeconds - Delay in seconds (positive = late, negative = early)
   * @returns Object with color, label, and severity information
   */
  getDelayStatus(delaySeconds?: number): { color: string; label: string; severity: 'on-time' | 'minor-delay' | 'major-delay' | 'ahead-of-schedule' } {
    if (!delaySeconds) {
      return {
        color: '#28a745', // Green
        label: 'On Time',
        severity: 'on-time'
      };
    }

    if (delaySeconds < 0) {
      // Vehicle is ahead of schedule
      const minutesAhead = Math.abs(Math.round(delaySeconds / 60));
      return {
        color: '#17a2b8', // Blue
        label: `Ahead by ${minutesAhead} min`,
        severity: 'ahead-of-schedule'
      };
    } else if (delaySeconds < 300) { // Less than 5 minutes
      return {
        color: '#28a745', // Green
        label: 'On Time',
        severity: 'on-time'
      };
    } else if (delaySeconds < 600) { // 5-10 minutes
      return {
        color: '#ffc107', // Yellow/Orange
        label: `${Math.round(delaySeconds / 60)} min delay`,
        severity: 'minor-delay'
      };
    } else { // More than 10 minutes
      return {
        color: '#dc3545', // Red
        label: `${Math.round(delaySeconds / 60)} min delay`,
        severity: 'major-delay'
      };
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
