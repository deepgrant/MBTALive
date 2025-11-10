import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, EMPTY, of } from 'rxjs';
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
  private vehiclesSubject = new BehaviorSubject<Vehicle[]>([]);
  private routesSubject = new BehaviorSubject<Route[]>([]);
  private selectedRouteSubject = new BehaviorSubject<string | null>(null);
  private selectedVehicleSubject = new BehaviorSubject<string | null>(null);

  public vehicles$ = this.vehiclesSubject.asObservable();
  public routes$ = this.routesSubject.asObservable();
  public selectedRoute$ = this.selectedRouteSubject.asObservable();
  public selectedVehicle$ = this.selectedVehicleSubject.asObservable();

  public filteredVehicles$: Observable<Vehicle[]>;
  public selectedRouteStations$: Observable<Station[]>;
  public selectedRouteShapes$: Observable<Shape[]>;

  constructor(
    private apiService: ApiService,
    private cookieService: CookieService
  ) {
    // Load routes once on initialization
    this.loadRoutes();

    // Set up filtered vehicles based on selected route with polling
    this.filteredVehicles$ = this.selectedRoute$.pipe(
      switchMap(selectedRoute => {
        console.log('VehicleService: Selected route changed to:', selectedRoute);
        if (!selectedRoute) {
          console.log('VehicleService: No route selected, returning empty vehicles');
          return of([]);
        }
        console.log('VehicleService: Starting vehicle polling for route:', selectedRoute);
        return this.apiService.getRealTimeVehiclesByRoute(selectedRoute, 10000).pipe(
          switchMap(vehicles => {
            // Get route info to add route type to vehicles
            return this.getRouteById(selectedRoute).pipe(
              map(route => {
                if (route) {
                  return vehicles.map(vehicle => ({
                    ...vehicle,
                    routeType: route.route_type
                  }));
                }
                return vehicles;
              })
            );
          })
        );
      })
    );

    // Set up observables for selected route data
    this.selectedRouteStations$ = this.selectedRoute$.pipe(
      switchMap(routeId => {
        if (!routeId) {
          return EMPTY;
        }
        return this.apiService.getRouteStops(routeId);
      }),
      catchError(error => {
        console.error('Error fetching route stations:', error);
        return EMPTY;
      })
    );

    this.selectedRouteShapes$ = this.selectedRoute$.pipe(
      switchMap(routeId => {
        if (!routeId) {
          return EMPTY;
        }
        return this.apiService.getRouteShapes(routeId);
      }),
      catchError(error => {
        console.error('Error fetching route shapes:', error);
        return EMPTY;
      })
    );
  }

  private loadRoutes(): void {
    this.apiService.getRoutes().subscribe({
      next: (routes) => {
        console.log('VehicleService: Routes loaded:', routes);
        this.routesSubject.next(routes);
      },
      error: (error) => {
        console.error('VehicleService: Error loading routes:', error);
      }
    });
  }

  refreshRoutes(): void {
    console.log('VehicleService: Refreshing routes...');
    this.apiService.getRoutes().subscribe({
      next: (routes) => {
        console.log('VehicleService: Routes refreshed:', routes);
        this.routesSubject.next(routes);
      },
      error: (error) => {
        console.error('VehicleService: Error refreshing routes:', error);
      }
    });
  }

  selectRoute(routeId: string | null, skipCookieSave: boolean = false): void {
    console.log('VehicleService: Selecting route:', routeId);
    this.selectedRouteSubject.next(routeId);
    
    // Save route selection to settings cookie (unless we're restoring from cookie)
    if (!skipCookieSave) {
      const currentSettings = this.cookieService.getSettingsCookie() || {};
      currentSettings.selectedRoute = routeId;
      this.cookieService.setSettingsCookie(currentSettings);
    }
  }

  selectVehicle(vehicleId: string | null): void {
    console.log('VehicleService: Selecting vehicle:', vehicleId);
    console.log('VehicleService: Current selected vehicle:', this.selectedVehicleSubject.value);
    this.selectedVehicleSubject.next(vehicleId);
    console.log('VehicleService: Vehicle selection updated');
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
   * Restore route selection from cookie
   * Should be called after routes are loaded and map is initialized
   */
  restoreRouteFromCookie(): void {
    this.routes$.pipe(take(1)).subscribe(routes => {
      if (routes.length > 0) {
        const settings = this.cookieService.getSettingsCookie();
        const savedRoute = settings?.selectedRoute;
        if (savedRoute) {
          // Verify the route exists in the loaded routes
          const routeExists = routes.some(route => route.id === savedRoute);
          if (routeExists) {
            console.log('VehicleService: Restoring route selection from cookie:', savedRoute);
            // Use a small delay to ensure map is ready
            // Skip cookie save since we're restoring from cookie
            setTimeout(() => {
              this.selectRoute(savedRoute, true);
            }, 100);
          } else {
            console.log('VehicleService: Saved route not found in routes, clearing from settings');
            // Update settings to remove invalid route
            const updatedSettings = { ...settings, selectedRoute: null };
            this.cookieService.setSettingsCookie(updatedSettings);
          }
        }
      }
    });
  }
}
