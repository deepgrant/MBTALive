import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, interval, switchMap, startWith } from 'rxjs';
import { Vehicle, VehicleResponse } from '../models/vehicle.model';
import { Route, RouteResponse } from '../models/route.model';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private baseUrl = '/api';

  constructor(private http: HttpClient) { }

  getRoutes(): Observable<Route[]> {
    return this.http.get<RouteResponse[]>(`${this.baseUrl}/routes`)
      .pipe(
        switchMap((routes: RouteResponse[]) => 
          routes.map(route => ({
            id: route.id,
            long_name: route.long_name,
            short_name: route.short_name,
            color: route.color,
            text_color: route.text_color
          }))
        )
      );
  }

  getVehicles(): Observable<Vehicle[]> {
    return this.http.get<VehicleResponse[]>(`${this.baseUrl}/vehicles`)
      .pipe(
        switchMap((vehicles: VehicleResponse[]) => 
          vehicles.map(vehicle => ({
            routeId: vehicle.routeId,
            vehicleId: vehicle.vehicleId,
            latitude: vehicle.latitude,
            longitude: vehicle.longitude,
            bearing: vehicle.bearing,
            speed: vehicle.speed,
            direction: vehicle.direction,
            destination: vehicle.destination,
            currentStatus: vehicle.currentStatus,
            updatedAt: vehicle.updatedAt
          }))
        )
      );
  }

  getVehiclesByRoute(routeId: string): Observable<Vehicle[]> {
    return this.http.get<VehicleResponse[]>(`${this.baseUrl}/vehicles/${routeId}`)
      .pipe(
        switchMap((vehicles: VehicleResponse[]) => 
          vehicles.map(vehicle => ({
            routeId: vehicle.routeId,
            vehicleId: vehicle.vehicleId,
            latitude: vehicle.latitude,
            longitude: vehicle.longitude,
            bearing: vehicle.bearing,
            speed: vehicle.speed,
            direction: vehicle.direction,
            destination: vehicle.destination,
            currentStatus: vehicle.currentStatus,
            updatedAt: vehicle.updatedAt
          }))
        )
      );
  }

  // Real-time data polling
  getRealTimeVehicles(intervalMs: number = 5000): Observable<Vehicle[]> {
    return interval(intervalMs)
      .pipe(
        startWith(0),
        switchMap(() => this.getVehicles())
      );
  }

  getRealTimeRoutes(intervalMs: number = 30000): Observable<Route[]> {
    return interval(intervalMs)
      .pipe(
        startWith(0),
        switchMap(() => this.getRoutes())
      );
  }
}
