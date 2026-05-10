import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, EMPTY, of, timer } from 'rxjs';
import { map, switchMap, catchError, take, shareReplay } from 'rxjs/operators';
import { Vehicle } from '../models/vehicle.model';
import { Route, Shape } from '../models/route.model';
import { Station } from '../models/station.model';
import { Alert } from '../models/alert.model';
import { ApiService } from './api.service';
import { CookieService } from './cookie.service';

@Injectable({
  providedIn: 'root'
})
export class VehicleService {
  private vehiclesSubject = new BehaviorSubject<Vehicle[]>([]);
  private routesSubject = new BehaviorSubject<Route[]>([]);
  private selectedRouteSubject = new BehaviorSubject<string | null>(null);
  private selectedVehicleSubject = new BehaviorSubject<string | null>(null);
  private lastKnownPositions = new Map<string, {
    latitude:        number;
    longitude:       number;
    bearing:         number;
    speed:           number;
    bearingReported: boolean;
    speedReported:   boolean;
    updatedAt:       string;
  }>();

  public vehicles$ = this.vehiclesSubject.asObservable();
  public routes$ = this.routesSubject.asObservable();
  public selectedRoute$ = this.selectedRouteSubject.asObservable();
  public selectedVehicle$ = this.selectedVehicleSubject.asObservable();

  public filteredVehicles$: Observable<Vehicle[]>;
  public selectedRouteStations$: Observable<Station[]>;
  public selectedRouteShapes$: Observable<Shape[]>;
  public selectedRouteAlerts$: Observable<Alert[]>;
  public allAlerts$: Observable<Alert[]>;

  constructor(
    private apiService: ApiService,
    private cookieService: CookieService
  ) {
    // Load routes once on initialization
    this.loadRoutes();

    // Set up filtered vehicles based on selected route with polling
    this.filteredVehicles$ = this.selectedRoute$.pipe(
      switchMap(selectedRoute => {
        if (!selectedRoute) return of([]);
        return this.apiService.getRealTimeVehiclesByRoute(selectedRoute, 10000).pipe(
          switchMap(vehicles =>
            this.getRouteById(selectedRoute).pipe(
              map(route => {
                if (route) {
                  return vehicles.map(vehicle => ({ ...vehicle, routeType: route.route_type }));
                }
                return vehicles;
              })
            )
          ),
          map(vehicles => this.applyLastKnownPositions(vehicles))
        );
      })
    );

    // Set up observables for selected route data
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

    // Route-specific alerts — re-fetched on route change, refreshed every 90 s
    this.selectedRouteAlerts$ = this.selectedRoute$.pipe(
      switchMap(routeId => {
        if (!routeId) return of([]);
        return timer(0, 90000).pipe(
          switchMap(() => this.apiService.getAlertsForRoute(routeId)),
          catchError(() => of([]))
        );
      })
    );

    // Global alerts for route-list badges — refreshed every 90 s
    this.allAlerts$ = timer(0, 90000).pipe(
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
      const currentSettings = this.cookieService.getSettingsCookie() ?? {};
      currentSettings.selectedRoute = routeId;
      this.cookieService.setSettingsCookie(currentSettings);
    }
  }

  selectVehicle(vehicleId: string | null): void {
    this.selectedVehicleSubject.next(vehicleId);
  }

  getVehiclesByRoute(routeId: string): Observable<Vehicle[]> {
    return this.vehicles$.pipe(
      map(vehicles => vehicles.filter(vehicle => vehicle.routeId === routeId))
    );
  }

  getVehicleById(vehicleId: string): Observable<Vehicle | undefined> {
    return this.vehicles$.pipe(
      map(vehicles => vehicles.find(vehicle => vehicle.vehicleId === vehicleId))
    );
  }

  getRouteById(routeId: string): Observable<Route | undefined> {
    return this.routes$.pipe(
      map(routes => routes.find(route => route.id === routeId))
    );
  }

  /**
   * Restore route selection from cookie.
   * Should be called after routes are loaded and map is initialized.
   */
  restoreRouteFromCookie(): void {
    this.routes$.pipe(take(1)).subscribe(routes => {
      if (routes.length === 0) return;
      const settings = this.cookieService.getSettingsCookie();
      const savedRoute = settings?.selectedRoute;
      if (!savedRoute) return;

      const routeExists = routes.some(route => route.id === savedRoute);
      if (routeExists) {
        // Small delay to ensure map is ready; skip cookie save since we're restoring from it
        setTimeout(() => this.selectRoute(savedRoute, true), 100);
      } else {
        // Saved route no longer exists — clear it
        this.cookieService.setSettingsCookie({ ...settings, selectedRoute: null });
      }
    });
  }
}
