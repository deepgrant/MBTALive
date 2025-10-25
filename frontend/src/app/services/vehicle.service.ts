import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, EMPTY } from 'rxjs';
import { map, distinctUntilChanged, switchMap, catchError } from 'rxjs/operators';
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
    // Set up filtered vehicles based on selected route
    this.filteredVehicles$ = this.selectedRoute$.pipe(
      switchMap(selectedRoute => {
        if (!selectedRoute) {
          return new Observable<Vehicle[]>(observer => {
            observer.next([]);
            observer.complete();
          });
        }
        return this.apiService.getVehiclesByRoute(selectedRoute);
      }),
      distinctUntilChanged()
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

    // Start polling for data
    this.startDataPolling();
  }

  private startDataPolling(): void {
    // Poll routes every 30 seconds
    this.apiService.getRealTimeRoutes(30000).subscribe({
      next: (routes) => {
        console.log('VehicleService: Routes received:', routes);
        this.routesSubject.next(routes);
      },
      error: (error) => {
        console.error('VehicleService: Error fetching routes:', error);
      }
    });
  }

  selectRoute(routeId: string | null): void {
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
