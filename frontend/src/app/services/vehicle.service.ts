import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, EMPTY, of, timer } from 'rxjs';
import { map, filter, switchMap, catchError, take, shareReplay, withLatestFrom } from 'rxjs/operators';
import { Vehicle } from '../models/vehicle.model';
import { Route, Shape } from '../models/route.model';
import { Station } from '../models/station.model';
import { Alert } from '../models/alert.model';
import { ApiService } from './api.service';
import { CookieService } from './cookie.service';
import { ALERT_POLL_MS, ROUTE_RESTORE_SELECT_DELAY_MS } from '../shared/timing.constants';

@Injectable({
  providedIn: 'root'
})
export class VehicleService {
  private routesSubject = new BehaviorSubject<Route[]>([]);
  private selectedRouteSubject = new BehaviorSubject<string | null>(null);
  private lastKnownPositions = new Map<string, {
    latitude:        number;
    longitude:       number;
    bearing:         number;
    speed:           number;
    bearingReported: boolean;
    speedReported:   boolean;
    updatedAt:       string;
  }>();

  public routes$ = this.routesSubject.asObservable();
  public selectedRoute$ = this.selectedRouteSubject.asObservable();

  public filteredVehicles$: Observable<Vehicle[]>;
  public selectedRouteStations$: Observable<Station[]>;
  public selectedRouteShapes$: Observable<Shape[]>;
  public selectedRouteAlerts$: Observable<Alert[]>;
  public allAlerts$: Observable<Alert[]>;

  constructor(
    private apiService: ApiService,
    private cookieService: CookieService
  ) {
    this.loadRoutes();

    this.filteredVehicles$ = this.selectedRoute$.pipe(
      switchMap(selectedRoute => {
        if (!selectedRoute) return of([]);
        return this.apiService.getRealTimeVehiclesByRoute(selectedRoute).pipe(
          withLatestFrom(this.routes$),
          map(([vehicles, routes]) => {
            const route = routes.find(r => r.id === selectedRoute);
            return route ? vehicles.map(v => ({ ...v, routeType: route.route_type })) : vehicles;
          }),
          map(vehicles => this.applyLastKnownPositions(vehicles))
        );
      })
    );

    this.selectedRouteStations$ = this.selectedRoute$.pipe(
      switchMap(routeId => {
        if (!routeId) return EMPTY;
        return this.apiService.getRouteStops(routeId);
      }),
      catchError(() => EMPTY)
    );

    this.selectedRouteShapes$ = this.selectedRoute$.pipe(
      switchMap(routeId => {
        if (!routeId) return EMPTY;
        return this.apiService.getRouteShapes(routeId);
      }),
      catchError(() => EMPTY)
    );

    this.selectedRouteAlerts$ = this.selectedRoute$.pipe(
      switchMap(routeId => {
        if (!routeId) return of([]);
        return timer(0, ALERT_POLL_MS).pipe(
          switchMap(() => this.apiService.getAlertsForRoute(routeId)),
          catchError(() => of([]))
        );
      })
    );

    this.allAlerts$ = timer(0, ALERT_POLL_MS).pipe(
      switchMap(() => this.apiService.getAlertsGlobal()),
      catchError(() => of([])),
      shareReplay(1)
    );
  }

  private loadRoutes(): void {
    this.apiService.getRoutes().subscribe({
      next: (routes) => this.routesSubject.next(routes),
      error: (error) => console.error('VehicleService: Error loading routes:', error)
    });
  }

  refreshRoutes(): void {
    this.apiService.getRoutes().subscribe({
      next: (routes) => this.routesSubject.next(routes),
      error: (error) => console.error('VehicleService: Error refreshing routes:', error)
    });
  }

  private applyLastKnownPositions(vehicles: Vehicle[]): Vehicle[] {
    const result = vehicles.map(v => {
      if (v.positionValid) {
        this.lastKnownPositions.set(v.vehicleId, {
          latitude:        v.latitude,
          longitude:       v.longitude,
          bearing:         v.bearing,
          speed:           v.speed,
          bearingReported: v.bearingReported ?? false,
          speedReported:   v.speedReported ?? false,
          updatedAt:       v.updatedAt,
        });
        return v;
      }
      const cached = this.lastKnownPositions.get(v.vehicleId);
      if (cached) {
        return {
          ...v,
          latitude:        cached.latitude,
          longitude:       cached.longitude,
          bearing:         cached.bearing,
          speed:           cached.speed,
          bearingReported: cached.bearingReported,
          speedReported:   cached.speedReported,
          positionStale:   true,
        };
      }
      return v;
    });

    const liveIds = new Set(vehicles.map(v => v.vehicleId));
    this.lastKnownPositions.forEach((_, id) => {
      if (!liveIds.has(id)) this.lastKnownPositions.delete(id);
    });

    return result;
  }

  selectRoute(routeId: string | null, skipCookieSave: boolean = false): void {
    this.lastKnownPositions.clear();
    this.selectedRouteSubject.next(routeId);

    if (!skipCookieSave) {
      this.cookieService.updateSettings({ selectedRoute: routeId });
    }
  }

  // Waits until the route appears in routes$ (which starts empty and fills in
  // asynchronously — e.g. during cookie restore on cold start), then completes.
  getRouteById(routeId: string): Observable<Route> {
    return this.routes$.pipe(
      map(routes => routes.find(route => route.id === routeId)),
      filter((route): route is Route => route !== undefined),
      take(1)
    );
  }

  restoreRouteFromCookie(): void {
    this.routes$.pipe(take(1)).subscribe(routes => {
      if (routes.length === 0) return;
      const settings = this.cookieService.getSettingsCookie();
      const savedRoute = settings?.selectedRoute;
      if (!savedRoute) return;

      const routeExists = routes.some(route => route.id === savedRoute);
      if (routeExists) {
        setTimeout(() => this.selectRoute(savedRoute, true), ROUTE_RESTORE_SELECT_DELAY_MS);
      } else {
        this.cookieService.setSettingsCookie({ ...settings, selectedRoute: null });
      }
    });
  }
}
