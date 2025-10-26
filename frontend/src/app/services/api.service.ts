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

  getRoutes(): Observable<Route[]> {
    console.log('Fetching routes from:', `${this.baseUrl}/routes`);
    return this.http.get<RouteResponse[]>(`${this.baseUrl}/routes`)
      .pipe(
        map((routes: RouteResponse[]) => {
          console.log('Raw routes response:', routes);
          return routes.map(route => ({
            id: route.id,
            long_name: route.long_name,
            short_name: route.short_name,
            color: route.color,
            text_color: route.text_color
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
    // First get vehicle IDs for the route
    return this.http.get<string[]>(`${this.baseUrl}/route/${routeId}/vehicles`)
      .pipe(
        switchMap(vehicleIds => {
          if (vehicleIds.length === 0) {
            return new Observable<Vehicle[]>(observer => {
              observer.next([]);
              observer.complete();
            });
          }
          // Then fetch vehicle data using POST
          return this.http.post<VehicleResponse[]>(`${this.baseUrl}/vehicles`, { vehicleIds })
            .pipe(
              map((vehicles: VehicleResponse[]) => 
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
