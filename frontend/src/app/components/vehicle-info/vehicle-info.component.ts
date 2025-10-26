import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { Vehicle } from '../../models/vehicle.model';
import { VehicleService } from '../../services/vehicle.service';

@Component({
  selector: 'app-vehicle-info',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule
  ],
  templateUrl: './vehicle-info.component.html',
  styleUrls: ['./vehicle-info.component.scss']
})
export class VehicleInfoComponent implements OnInit, OnDestroy {
  selectedVehicle: Vehicle | null = null;
  private subscriptions: Subscription[] = [];

  constructor(private vehicleService: VehicleService) { }

  ngOnInit(): void {
    // This component would be expanded to show detailed vehicle information
    // when a vehicle marker is clicked on the map
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  closeInfo(): void {
    this.selectedVehicle = null;
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
}
