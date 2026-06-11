import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, interval, switchMap, startWith, map, catchError, of } from 'rxjs';
import { Vehicle, VehicleResponse } from '../models/vehicle.model';
import { Route, Shape } from '../models/route.model';
import { Station } from '../models/station.model';
import { Alert } from '../models/alert.model';
import { RouteBoardData } from '../models/board.model';
import { BOARD_POLL_MS, VEHICLE_POLL_MS } from '../shared/timing.constants';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private baseUrl: string;

  constructor(private http: HttpClient) {
    this.baseUrl = '/api';
  }

  getRoutes(typeFilter?: string): Observable<Route[]> {
    const url = typeFilter ? `${this.baseUrl}/routes?type=${typeFilter}` : `${this.baseUrl}/routes`;
    return this.http.get<Route[]>(url)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          console.error('Error fetching routes:', error);
          return of([]);
        })
      );
  }

  private getVehiclesByRoute(routeId: string): Observable<Vehicle[]> {
    return this.http.get<VehicleResponse[]>(`${this.baseUrl}/route/${routeId}/vehicles`)
      .pipe(
        map((vehicles: VehicleResponse[]) =>
          vehicles.map(vehicle => ({
            routeId:             vehicle.routeId,
            vehicleId:           vehicle.vehicleId ?? 'unknown',
            positionValid:       vehicle.positionValid,
            positionStale:       false,
            bearingReported:     vehicle.bearingReported,
            speedReported:       vehicle.speedReported,
            latitude:            vehicle.latitude ?? 0,
            longitude:           vehicle.longitude ?? 0,
            bearing:             vehicle.bearing ?? 0,
            speed:               vehicle.speed ?? 0,
            direction:           vehicle.direction ?? 'Unknown',
            destination:         vehicle.destination ?? 'Unknown',
            currentStatus:       vehicle.currentStatus ?? 'Unknown',
            stopName:            vehicle.stopName ?? 'Unknown',
            platformName:        vehicle.platformName,
            updatedAt:           vehicle.updatedAt ?? '',
            routeType:           vehicle.routeType,
            predictedArrivalTime: vehicle.predictedArrivalTime,
            scheduledArrivalTime: vehicle.scheduledArrivalTime,
            delaySeconds:        vehicle.delaySeconds,
            tripName:            vehicle.tripName,
            formattedStatus:     vehicle.formattedStatus,
            delayStatus:         vehicle.delayStatus
          }))
        ),
        catchError((error: HttpErrorResponse) => {
          console.error('ApiService: Error fetching vehicles for route:', routeId, error);
          return of([]);
        })
      );
  }

  getRealTimeVehiclesByRoute(routeId: string, intervalMs: number = VEHICLE_POLL_MS): Observable<Vehicle[]> {
    return interval(intervalMs)
      .pipe(
        startWith(0),
        switchMap(() => this.getVehiclesByRoute(routeId))
      );
  }

  getRouteShapes(routeId: string): Observable<Shape[]> {
    return this.http.get<Shape[]>(`${this.baseUrl}/route/${routeId}/shapes`);
  }

  getRouteStops(routeId: string): Observable<Station[]> {
    return this.http.get<Station[]>(`${this.baseUrl}/route/${routeId}/stops`);
  }

  getAlertsForRoute(routeId: string): Observable<Alert[]> {
    return this.http.get<Alert[]>(`${this.baseUrl}/route/${routeId}/alerts`)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          console.error('ApiService: Error fetching alerts for route:', routeId, error);
          return of([]);
        })
      );
  }

  getRouteBoardData(routeId: string, intervalMs: number = BOARD_POLL_MS): Observable<RouteBoardData | null> {
    return interval(intervalMs).pipe(
      startWith(0),
      switchMap(() =>
        this.http.get<RouteBoardData>(`${this.baseUrl}/route/${routeId}/board`).pipe(
          catchError((error: HttpErrorResponse) => {
            console.error('ApiService: Error fetching board data for route:', routeId, error);
            return of(null);
          })
        )
      )
    );
  }

  getAlertsGlobal(): Observable<Alert[]> {
    return this.http.get<Alert[]>(`${this.baseUrl}/alerts`)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          console.error('ApiService: Error fetching global alerts:', error);
          return of([]);
        })
      );
  }
}
