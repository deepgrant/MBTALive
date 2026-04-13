import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, EMPTY, of } from 'rxjs';
import { map, switchMap, catchError, take } from 'rxjs/operators';
import { Vehicle } from '../models/vehicle.model';
import { Route, Shape } from '../models/route.model';
import { Station } from '../models/station.model';
import { ApiService } from './api.service';
import { CookieService } from './cookie.service';

@Injectable({
  providedIn: 'root'
})
export class VehicleService {
  private routesSubject        = new BehaviorSubject<Route[]>([]);
  private selectedRouteSubject  = new BehaviorSubject<string | null>(null);
  private selectedVehicleSubject = new BehaviorSubject<string | null>(null);

  public routes$          = this.routesSubject.asObservable();
  public selectedRoute$   = this.selectedRouteSubject.asObservable();
  public selectedVehicle$ = this.selectedVehicleSubject.asObservable();

  public filteredVehicles$:      Observable<Vehicle[]>;
  public selectedRouteStations$: Observable<Station[]>;
  public selectedRouteShapes$:   Observable<Shape[]>;

  constructor(
    private apiService: ApiService,
    private cookieService: CookieService
  ) {
    this.loadRoutes();

    this.filteredVehicles$ = this.selectedRoute$.pipe(
      switchMap(routeId => {
        if (!routeId) return of([]);
        return this.apiService.getRealTimeVehiclesByRoute(routeId, 10000).pipe(
          switchMap(vehicles =>
            this.getRouteById(routeId).pipe(
              map(route => route
                ? vehicles.map(v => ({ ...v, routeType: route.route_type }))
                : vehicles
              )
            )
          )
        );
      })
    );

    this.selectedRouteStations$ = this.selectedRoute$.pipe(
      switchMap(routeId => routeId ? this.apiService.getRouteStops(routeId) : EMPTY),
      catchError(error => {
        console.error('VehicleService: Error fetching route stations:', error);
        return EMPTY;
      })
    );

    this.selectedRouteShapes$ = this.selectedRoute$.pipe(
      switchMap(routeId => routeId ? this.apiService.getRouteShapes(routeId) : EMPTY),
      catchError(error => {
        console.error('VehicleService: Error fetching route shapes:', error);
        return EMPTY;
      })
    );
  }

  private loadRoutes(): void {
    this.apiService.getRoutes().subscribe({
      next: routes => this.routesSubject.next(routes),
      error: error => console.error('VehicleService: Error loading routes:', error)
    });
  }

  refreshRoutes(): void {
    this.loadRoutes();
  }

  selectRoute(routeId: string | null, skipCookieSave = false): void {
    this.selectedRouteSubject.next(routeId);
    if (!skipCookieSave) {
      this.cookieService.patchSettingsCookie({ selectedRoute: routeId });
    }
  }

  selectVehicle(vehicleId: string | null): void {
    this.selectedVehicleSubject.next(vehicleId);
  }

  getRouteById(routeId: string): Observable<Route | undefined> {
    return this.routes$.pipe(
      map(routes => routes.find(r => r.id === routeId))
    );
  }

  restoreRouteFromCookie(): void {
    this.routes$.pipe(take(1)).subscribe(routes => {
      if (routes.length === 0) return;
      const savedRoute = this.cookieService.getSettingsCookie()?.selectedRoute;
      if (!savedRoute) return;

      if (routes.some(r => r.id === savedRoute)) {
        this.selectRoute(savedRoute, true);
      } else {
        // Saved route no longer exists — clear it
        this.cookieService.patchSettingsCookie({ selectedRoute: null });
      }
    });
  }
}
