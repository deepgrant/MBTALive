import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest } from 'rxjs';
import { map, distinctUntilChanged } from 'rxjs/operators';
import { Vehicle } from '../models/vehicle.model';
import { Route } from '../models/route.model';
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

  constructor(private apiService: ApiService) {
    // Set up filtered vehicles based on selected route
    this.filteredVehicles$ = combineLatest([
      this.vehicles$,
      this.selectedRoute$
    ]).pipe(
      map(([vehicles, selectedRoute]) => {
        if (!selectedRoute) {
          return vehicles;
        }
        return vehicles.filter(vehicle => vehicle.routeId === selectedRoute);
      }),
      distinctUntilChanged()
    );

    // Start polling for data
    this.startDataPolling();
  }

  private startDataPolling(): void {
    // Poll vehicles every 5 seconds
    this.apiService.getRealTimeVehicles(5000).subscribe(vehicles => {
      this.vehiclesSubject.next(vehicles);
    });

    // Poll routes every 30 seconds
    this.apiService.getRealTimeRoutes(30000).subscribe(routes => {
      this.routesSubject.next(routes);
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
