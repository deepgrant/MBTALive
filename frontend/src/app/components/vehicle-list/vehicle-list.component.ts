import { Component, OnInit, OnDestroy } from '@angular/core';
import { NgClass } from '@angular/common';
import { MatListModule } from '@angular/material/list';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { Vehicle } from '../../models/vehicle.model';
import { Alert } from '../../models/alert.model';
import { VehicleService } from '../../services/vehicle.service';
import { VehicleFormatService } from '../../services/vehicle-format.service';
import { AlertBannerComponent } from '../alert-banner/alert-banner.component';

// Display strings precomputed once per 10 s poll so the template binds plain
// fields instead of calling formatters on every change-detection cycle.
interface VehicleView {
  vehicle: Vehicle;
  statusClass: string;
  delayColor: string;
  delayText: string;
  speedText: string;
  scheduledText: string | null;
  predictedText: string | null;
  updatedText: string;
  typeIcon: string;
}

@Component({
    selector: 'app-vehicle-list',
    imports: [
        NgClass,
        MatListModule,
        MatCardModule,
        MatIconModule,
        AlertBannerComponent
    ],
    templateUrl: './vehicle-list.component.html',
    styleUrls: ['./vehicle-list.component.scss']
})
export class VehicleListComponent implements OnInit, OnDestroy {
  vehicleViews: VehicleView[] = [];
  alerts: Alert[] = [];
  selectedRoute: string | null = null;
  warming = false;
  private subscriptions: Subscription[] = [];

  constructor(
    private vehicleService: VehicleService,
    private fmt: VehicleFormatService
  ) { }

  ngOnInit(): void {
    this.subscriptions.push(
      this.vehicleService.filteredVehicles$.subscribe({
        next: (vehicles) => { this.vehicleViews = vehicles.map(v => this.toView(v)); },
        error: (error) => { console.error('VehicleListComponent: Error receiving vehicles:', error); }
      }),
      this.vehicleService.selectedRoute$.subscribe({
        next: (route) => { this.selectedRoute = route; },
        error: (error) => { console.error('VehicleListComponent: Error receiving selected route:', error); }
      }),
      this.vehicleService.selectedRouteAlerts$.subscribe({
        next: (alerts) => { this.alerts = alerts; },
        error: (error) => { console.error('VehicleListComponent: Error receiving alerts:', error); }
      }),
      this.vehicleService.routeWarming$.subscribe(warming => { this.warming = warming; }),
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  private toView(vehicle: Vehicle): VehicleView {
    return {
      vehicle,
      statusClass: vehicle.delayStatus || 'on-time',
      delayColor: this.fmt.getDelayColor(vehicle.delayStatus),
      delayText: this.fmt.formatDelayTime(vehicle.delaySeconds),
      speedText: this.fmt.formatSpeed(vehicle.speed),
      scheduledText: vehicle.scheduledArrivalTime ? this.fmt.formatTime(vehicle.scheduledArrivalTime) : null,
      predictedText: vehicle.predictedArrivalTime ? this.fmt.formatTime(vehicle.predictedArrivalTime) : null,
      updatedText: this.fmt.formatTime(vehicle.updatedAt),
      typeIcon: this.fmt.isBus(vehicle) ? 'directions_bus' : 'train',
    };
  }
}
