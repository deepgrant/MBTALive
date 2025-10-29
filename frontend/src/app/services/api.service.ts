import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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
    console.log('Fetching routes from:', url);
    return this.http.get<RouteResponse[]>(url)
      .pipe(
        map((routes: RouteResponse[]) => {
          console.log('Raw routes response:', routes);
          return routes.map(route => ({
            id: route.id,
            long_name: route.long_name,
            short_name: route.short_name,
            color: route.color,
            text_color: route.text_color,
            route_type: route.route_type
          }));
        }),
        catchError((error: any) => {
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
    console.log('ApiService: Getting vehicles for route:', routeId);
    // Directly fetch vehicle data from the route endpoint
    return this.http.get<VehicleResponse[]>(`${this.baseUrl}/route/${routeId}/vehicles`)
      .pipe(
        map((vehicles: VehicleResponse[]) => {
          console.log('ApiService: Got vehicle data:', vehicles);
          const mappedVehicles = vehicles.map(vehicle => ({
            routeId: vehicle.routeId,
            vehicleId: vehicle.vehicleId || 'unknown',
            latitude: vehicle.latitude || 0,
            longitude: vehicle.longitude || 0,
            bearing: vehicle.bearing || 0,
            speed: vehicle.speed || 0,
            direction: vehicle.direction || 'Unknown',
            destination: vehicle.destination || 'Unknown',
            currentStatus: vehicle.currentStatus || 'Unknown',
            stopName: vehicle.stopName || 'Unknown',
            updatedAt: vehicle.updatedAt || new Date().toISOString(),
            routeType: vehicle.routeType,
            predictedArrivalTime: vehicle.predictedArrivalTime,
            scheduledArrivalTime: vehicle.scheduledArrivalTime,
            delaySeconds: vehicle.delaySeconds
          }));
          console.log('ApiService: Mapped vehicle data:', mappedVehicles);
          return mappedVehicles;
        }),
        catchError(error => {
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
    console.log('ApiService: Starting real-time vehicle polling for route:', routeId, 'interval:', intervalMs);
    return interval(intervalMs)
      .pipe(
        startWith(0),
        switchMap(() => {
          console.log('ApiService: Polling vehicles for route:', routeId, 'at', new Date().toLocaleTimeString());
          return this.getVehiclesByRoute(routeId);
        })
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
