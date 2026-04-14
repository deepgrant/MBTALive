import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, interval, switchMap, startWith, map, catchError } from 'rxjs';
import { of } from 'rxjs';
import { Vehicle, VehicleResponse } from '../models/vehicle.model';
import { Route, RouteResponse, Shape, ShapeResponse } from '../models/route.model';
import { Station, StationResponse } from '../models/station.model';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private baseUrl = '/api';

  constructor(private http: HttpClient) { }

  getRoutes(typeFilter?: string): Observable<Route[]> {
    const url = typeFilter ? `${this.baseUrl}/routes?type=${typeFilter}` : `${this.baseUrl}/routes`;
    return this.http.get<RouteResponse[]>(url)
      .pipe(
        map((routes: RouteResponse[]) =>
          routes.map(route => ({
            id: route.id,
            long_name: route.long_name,
            short_name: route.short_name,
            color: route.color,
            text_color: route.text_color,
            route_type: route.route_type
          }))
        ),
        catchError((error: HttpErrorResponse) => {
          console.error('Error fetching routes:', error);
          return of([]);
        })
      );
  }

  getVehicles(): Observable<Vehicle[]> {
    // For now, return empty array since we need vehicle IDs to fetch vehicle data
    // This will be populated when routes are selected and vehicles are fetched
    return new Observable(observer => {
      observer.next([]);
      observer.complete();
    });
  }

  getVehiclesByRoute(routeId: string): Observable<Vehicle[]> {
    return this.http.get<VehicleResponse[]>(`${this.baseUrl}/route/${routeId}/vehicles`)
      .pipe(
        map((vehicles: VehicleResponse[]) =>
          vehicles.map(vehicle => ({
            routeId: vehicle.routeId,
            vehicleId: vehicle.vehicleId ?? 'unknown',
            latitude: vehicle.latitude ?? 0,
            longitude: vehicle.longitude ?? 0,
            bearing: vehicle.bearing ?? 0,
            speed: vehicle.speed ?? 0,
            direction: vehicle.direction ?? 'Unknown',
            destination: vehicle.destination ?? 'Unknown',
            currentStatus: vehicle.currentStatus ?? 'Unknown',
            stopName: vehicle.stopName ?? 'Unknown',
            updatedAt: vehicle.updatedAt ?? new Date().toISOString(),
            routeType: vehicle.routeType,
            predictedArrivalTime: vehicle.predictedArrivalTime,
            scheduledArrivalTime: vehicle.scheduledArrivalTime,
            delaySeconds: vehicle.delaySeconds,
            tripName: vehicle.tripName,
            formattedStatus: vehicle.formattedStatus,
            delayStatus: vehicle.delayStatus
          }))
        ),
        catchError((error: HttpErrorResponse) => {
          console.error('ApiService: Error fetching vehicles for route:', routeId, error);
          return of([]);
        })
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

  getRealTimeVehiclesByRoute(routeId: string, intervalMs: number = 10000): Observable<Vehicle[]> {
    return interval(intervalMs)
      .pipe(
        startWith(0),
        switchMap(() => this.getVehiclesByRoute(routeId))
      );
  }

  getRouteShapes(routeId: string): Observable<Shape[]> {
    return this.http.get<ShapeResponse[]>(`${this.baseUrl}/route/${routeId}/shapes`)
      .pipe(
        map((shapes: ShapeResponse[]) =>
          shapes.map(shape => ({
            id: shape.id,
            polyline: shape.polyline
          }))
        )
      );
  }

  getRouteStops(routeId: string): Observable<Station[]> {
    return this.http.get<StationResponse[]>(`${this.baseUrl}/route/${routeId}/stops`)
      .pipe(
        map((stops: StationResponse[]) =>
          stops.map(stop => ({
            id: stop.id,
            name: stop.name,
            latitude: stop.latitude,
            longitude: stop.longitude
          }))
        )
      );
  }
}
