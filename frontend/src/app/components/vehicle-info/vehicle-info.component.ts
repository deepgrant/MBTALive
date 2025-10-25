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
}
