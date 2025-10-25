import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { Vehicle } from '../../models/vehicle.model';
import { VehicleService } from '../../services/vehicle.service';
import { MapService } from '../../services/map.service';

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.scss']
})
export class MapComponent implements OnInit, OnDestroy, AfterViewInit {
  private subscriptions: Subscription[] = [];
  private map: any;

  constructor(
    private vehicleService: VehicleService,
    private mapService: MapService
  ) { }

  ngOnInit(): void {
    // Subscribe to vehicle updates
    const vehicleSub = this.vehicleService.filteredVehicles$.subscribe(vehicles => {
      this.updateMapWithVehicles(vehicles);
    });

    this.subscriptions.push(vehicleSub);
  }

  ngAfterViewInit(): void {
    // Initialize map after view is ready
    setTimeout(() => {
      this.map = this.mapService.initializeMap('map');
    }, 100);
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  private updateMapWithVehicles(vehicles: Vehicle[]): void {
    if (vehicles.length > 0) {
      this.mapService.updateVehicleMarkers(vehicles);
      this.mapService.fitBoundsToVehicles(vehicles);
    }
  }
}
