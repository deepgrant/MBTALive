import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, interval, of } from 'rxjs';
import { switchMap, startWith, map, catchError } from 'rxjs/operators';
import { Vehicle, VehicleResponse } from '../models/vehicle.model';
import { Route, RouteResponse, Shape, ShapeResponse } from '../models/route.model';
import { Station, StationResponse } from '../models/station.model';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly baseUrl = '/api';

  constructor(private http: HttpClient) { }

  getRoutes(typeFilter?: string): Observable<Route[]> {
    const url = typeFilter ? `${this.baseUrl}/routes?type=${typeFilter}` : `${this.baseUrl}/routes`;
    return this.http.get<RouteResponse[]>(url).pipe(
      map(routes => routes.map(r => ({
        id: r.id,
        long_name: r.long_name,
        short_name: r.short_name,
        color: r.color,
        text_color: r.text_color,
        route_type: r.route_type
      }))),
      catchError(error => {
        console.error('ApiService: Error fetching routes:', error);
        return of([]);
      })
    );
  }

  getVehiclesByRoute(routeId: string): Observable<Vehicle[]> {
    return this.http.get<VehicleResponse[]>(`${this.baseUrl}/route/${routeId}/vehicles`).pipe(
      map(vehicles => vehicles.map(v => ({
        routeId:             v.routeId,
        vehicleId:           v.vehicleId           ?? 'unknown',
        latitude:            v.latitude             ?? 0,
        longitude:           v.longitude            ?? 0,
        bearing:             v.bearing              ?? 0,
        speed:               v.speed                ?? 0,
        direction:           v.direction            ?? 'Unknown',
        destination:         v.destination          ?? 'Unknown',
        currentStatus:       v.currentStatus        ?? 'Unknown',
        stopName:            v.stopName             ?? 'Unknown',
        updatedAt:           v.updatedAt            ?? new Date().toISOString(),
        routeType:           v.routeType,
        predictedArrivalTime: v.predictedArrivalTime,
        scheduledArrivalTime: v.scheduledArrivalTime,
        delaySeconds:        v.delaySeconds,
        tripName:            v.tripName
      }))),
      catchError(error => {
        console.error('ApiService: Error fetching vehicles for route:', routeId, error);
        return of([]);
      })
    );
  }

  getRealTimeVehiclesByRoute(routeId: string, intervalMs = 10000): Observable<Vehicle[]> {
    return this.poll(intervalMs, () => this.getVehiclesByRoute(routeId));
  }

  getRealTimeRoutes(intervalMs = 30000): Observable<Route[]> {
    return this.poll(intervalMs, () => this.getRoutes());
  }

  getRouteShapes(routeId: string): Observable<Shape[]> {
    return this.http.get<ShapeResponse[]>(`${this.baseUrl}/route/${routeId}/shapes`).pipe(
      map(shapes => shapes.map(s => ({ id: s.id, polyline: s.polyline })))
    );
  }

  getRouteStops(routeId: string): Observable<Station[]> {
    return this.http.get<StationResponse[]>(`${this.baseUrl}/route/${routeId}/stops`).pipe(
      map(stops => stops.map(s => ({
        id: s.id,
        name: s.name,
        latitude: s.latitude,
        longitude: s.longitude
      })))
    );
  }

  private poll<T>(intervalMs: number, fn: () => Observable<T>): Observable<T> {
    return interval(intervalMs).pipe(startWith(0), switchMap(() => fn()));
  }
}
