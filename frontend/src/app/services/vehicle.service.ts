import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, EMPTY, Subscription, fromEvent, merge, of, timer } from 'rxjs';
import { map, filter, switchMap, catchError, take, shareReplay, withLatestFrom, exhaustMap } from 'rxjs/operators';
import { Vehicle } from '../models/vehicle.model';
import { Route, Shape } from '../models/route.model';
import { Station } from '../models/station.model';
import { Alert } from '../models/alert.model';
import { ApiService } from './api.service';
import { CookieService } from './cookie.service';
import {
  ALERT_POLL_MS,
  POSITION_STALE_MAX_MS,
  ROUTE_ACTIVITY_HEARTBEAT_MS,
  ROUTE_RESTORE_SELECT_DELAY_MS,
  ROUTE_WARMUP_MS,
} from '../shared/timing.constants';

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
    sourceAt:        number;
  }>();
  private warmingSubject = new BehaviorSubject<boolean>(false);
  private serviceSubscriptions = new Subscription();
  private warmupTimer: ReturnType<typeof setTimeout> | null = null;

  public routes$ = this.routesSubject.asObservable();
  public selectedRoute$ = this.selectedRouteSubject.asObservable();
  public routeWarming$ = this.warmingSubject.asObservable();

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
    this.startRouteActivityHeartbeat();

    this.filteredVehicles$ = this.selectedRoute$.pipe(
      switchMap(selectedRoute => {
        if (!selectedRoute) return of([]);
        return this.apiService.getRealTimeVehiclesByRoute(selectedRoute).pipe(
          withLatestFrom(this.routes$),
          map(([vehicles, routes]) => {
            const route = routes.find(r => r.id === selectedRoute);
            return route ? vehicles.map(v => ({ ...v, routeType: route.route_type })) : vehicles;
          }),
          map(vehicles => this.applyLastKnownPositions(vehicles)),
          map(vehicles => {
            if (vehicles.length > 0) this.finishWarmup();
            return vehicles;
          }),
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
        const updatedAt = Date.parse(v.updatedAt);
        const sourceAt = v.timeStamp > 0
          ? v.timeStamp
          : (Number.isFinite(updatedAt) ? updatedAt : Date.now());
        this.lastKnownPositions.set(v.vehicleId, {
          latitude:        v.latitude,
          longitude:       v.longitude,
          bearing:         v.bearing,
          speed:           v.speed,
          bearingReported: v.bearingReported ?? false,
          speedReported:   v.speedReported ?? false,
          updatedAt:       v.updatedAt,
          sourceAt,
        });
        return v;
      }
      const cached = this.lastKnownPositions.get(v.vehicleId);
      if (cached && Date.now() - cached.sourceAt <= POSITION_STALE_MAX_MS) {
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
      if (cached) this.lastKnownPositions.delete(v.vehicleId);
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
    this.beginWarmup(routeId);
    this.selectedRouteSubject.next(routeId);

    if (!skipCookieSave) {
      this.cookieService.updateSettings({ selectedRoute: routeId });
    }
  }

  private startRouteActivityHeartbeat(): void {
    const visibility$ = fromEvent(document, 'visibilitychange').pipe(
      filter(() => document.visibilityState === 'visible'),
    );
    this.serviceSubscriptions.add(
      this.selectedRoute$.pipe(
        switchMap(routeId => {
          if (!routeId) return EMPTY;
          return merge(timer(0, ROUTE_ACTIVITY_HEARTBEAT_MS), visibility$).pipe(
            filter(() => document.visibilityState === 'visible'),
            exhaustMap(() => this.apiService.activateRoute(routeId).pipe(
              catchError(error => {
                console.error('VehicleService: route activity heartbeat failed:', routeId, error);
                return EMPTY;
              }),
            )),
          );
        }),
      ).subscribe(),
    );
  }

  private beginWarmup(routeId: string | null): void {
    if (this.warmupTimer) clearTimeout(this.warmupTimer);
    this.warmupTimer = null;
    this.warmingSubject.next(routeId !== null);
    if (routeId) {
      this.warmupTimer = setTimeout(() => this.finishWarmup(), ROUTE_WARMUP_MS);
    }
  }

  private finishWarmup(): void {
    if (this.warmupTimer) clearTimeout(this.warmupTimer);
    this.warmupTimer = null;
    this.warmingSubject.next(false);
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
    // Wait for the first real routes emission: the caller fires this on a
    // fixed delay, and racing a slow /api/routes response with take(1) on the
    // []-seeded BehaviorSubject used to silently drop the saved route.
    this.routes$.pipe(
      filter(routes => routes.length > 0),
      take(1)
    ).subscribe(routes => {
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
