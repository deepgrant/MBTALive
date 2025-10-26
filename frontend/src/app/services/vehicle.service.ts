import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, EMPTY, of } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';
import { Vehicle } from '../models/vehicle.model';
import { Route, Shape } from '../models/route.model';
import { Station } from '../models/station.model';
import { ApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class VehicleService {
  private vehiclesSubject = new BehaviorSubject<Vehicle[]>([]);
  private routesSubject = new BehaviorSubject<Route[]>([]);
  private selectedRouteSubject = new BehaviorSubject<string | null>(null);

  public vehicles$ = this.vehiclesSubject.asObservable();
  public routes$ = this.routesSubject.asObservable();
  public selectedRoute$ = this.selectedRouteSubject.asObservable();

  public filteredVehicles$: Observable<Vehicle[]>;
  public selectedRouteStations$: Observable<Station[]>;
  public selectedRouteShapes$: Observable<Shape[]>;

  constructor(private apiService: ApiService) {
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

  selectRoute(routeId: string | null): void {
    console.log('VehicleService: Selecting route:', routeId);
    this.selectedRouteSubject.next(routeId);
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
}
