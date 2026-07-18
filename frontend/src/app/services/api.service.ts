import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, interval, switchMap, startWith, catchError, of } from 'rxjs';
import { Vehicle, VehicleSchema } from '../models/vehicle.model';
import { Route, RouteSchema, Shape, ShapeSchema } from '../models/route.model';
import { Station, StationSchema } from '../models/station.model';
import { Alert, AlertSchema } from '../models/alert.model';
import { RouteBoardData, RouteBoardDataSchema } from '../models/board.model';
import { ApiStatus, ApiStatusSchema, RouteActivity, RouteActivitySchema } from '../models/status.model';
import { parseArrayWith, parseWith } from '../shared/validation';
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
    return this.http.get<unknown>(url)
      .pipe(
        parseArrayWith(RouteSchema, 'GET /routes'),
        catchError((error: HttpErrorResponse) => {
          console.error('Error fetching routes:', error);
          return of([] as Route[]);
        })
      );
  }

  private getVehiclesByRoute(routeId: string): Observable<Vehicle[]> {
    return this.http.get<unknown>(`${this.baseUrl}/route/${routeId}/vehicles`)
      .pipe(
        parseArrayWith(VehicleSchema, `GET /route/${routeId}/vehicles`),
        catchError((error: HttpErrorResponse) => {
          console.error('ApiService: Error fetching vehicles for route:', routeId, error);
          return of([] as Vehicle[]);
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
    return this.http.get<unknown>(`${this.baseUrl}/route/${routeId}/shapes`)
      .pipe(
        parseArrayWith(ShapeSchema, `GET /route/${routeId}/shapes`),
        catchError((error: HttpErrorResponse) => {
          console.error('ApiService: Error fetching shapes for route:', routeId, error);
          return of([] as Shape[]);
        })
      );
  }

  getRouteStops(routeId: string): Observable<Station[]> {
    return this.http.get<unknown>(`${this.baseUrl}/route/${routeId}/stops`)
      .pipe(
        parseArrayWith(StationSchema, `GET /route/${routeId}/stops`),
        catchError((error: HttpErrorResponse) => {
          console.error('ApiService: Error fetching stops for route:', routeId, error);
          return of([] as Station[]);
        })
      );
  }

  getAlertsForRoute(routeId: string): Observable<Alert[]> {
    return this.http.get<unknown>(`${this.baseUrl}/route/${routeId}/alerts`)
      .pipe(
        parseArrayWith(AlertSchema, `GET /route/${routeId}/alerts`),
        catchError((error: HttpErrorResponse) => {
          console.error('ApiService: Error fetching alerts for route:', routeId, error);
          return of([] as Alert[]);
        })
      );
  }

  getRouteBoardData(routeId: string, intervalMs: number = BOARD_POLL_MS): Observable<RouteBoardData | null> {
    return interval(intervalMs).pipe(
      startWith(0),
      switchMap(() =>
        this.http.get<unknown>(`${this.baseUrl}/route/${routeId}/board`).pipe(
          parseWith(RouteBoardDataSchema, `GET /route/${routeId}/board`),
          catchError((error: HttpErrorResponse) => {
            console.error('ApiService: Error fetching board data for route:', routeId, error);
            return of(null);
          })
        )
      )
    );
  }

  getAlertsGlobal(): Observable<Alert[]> {
    return this.http.get<unknown>(`${this.baseUrl}/alerts`)
      .pipe(
        parseArrayWith(AlertSchema, 'GET /alerts'),
        catchError((error: HttpErrorResponse) => {
          console.error('ApiService: Error fetching global alerts:', error);
          return of([] as Alert[]);
        })
      );
  }

  activateRoute(routeId: string): Observable<RouteActivity> {
    return this.http.put<unknown>(`${this.baseUrl}/control/routes/${encodeURIComponent(routeId)}/activity`, {})
      .pipe(parseWith(RouteActivitySchema, `PUT /control/routes/${routeId}/activity`));
  }

  getStatus(): Observable<ApiStatus | null> {
    return this.http.get<unknown>(`${this.baseUrl}/status`).pipe(
      parseWith(ApiStatusSchema, 'GET /status'),
      catchError((error: HttpErrorResponse) => {
        console.error('ApiService: Error fetching snapshot status:', error);
        return of(null);
      }),
    );
  }
}
