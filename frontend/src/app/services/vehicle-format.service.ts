import { Injectable } from '@angular/core';
import { Vehicle } from '../models/vehicle.model';

export const ROUTE_TYPE = {
  LIGHT_RAIL:    0,
  HEAVY_RAIL:    1,
  COMMUTER_RAIL: 2,
  BUS:           3,
} as const;

@Injectable({ providedIn: 'root' })
export class VehicleFormatService {

  formatSpeed(speed: number): string {
    return `${speed.toFixed(1)} mph`;
  }

  formatTime(timestamp: string): string {
    if (!timestamp) return '—';
    return new Date(timestamp).toLocaleTimeString();
  }

  isBus(vehicle: Vehicle): boolean {
    return vehicle.routeType === ROUTE_TYPE.BUS;
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
