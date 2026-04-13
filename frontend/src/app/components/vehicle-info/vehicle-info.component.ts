import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Vehicle } from '../../models/vehicle.model';

/**
 * Placeholder component for detailed vehicle information.
 * Currently not rendered — reserved for future expansion.
 */
@Component({
  selector: 'app-vehicle-info',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatButtonModule, MatIconModule],
  templateUrl: './vehicle-info.component.html',
  styleUrls: ['./vehicle-info.component.scss']
})
export class VehicleInfoComponent {
  selectedVehicle: Vehicle | null = null;
}
