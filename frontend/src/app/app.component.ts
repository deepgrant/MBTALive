import { Component, OnInit, OnDestroy } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RoutesComponent } from './components/routes/routes.component';
import { MapComponent } from './components/map/map.component';
import { BusMapComponent } from './components/bus-map/bus-map.component';
import { VehicleListComponent } from './components/vehicle-list/vehicle-list.component';
import { VehicleCompletionDialogComponent } from './components/vehicle-completion-dialog/vehicle-completion-dialog.component';
import { VehicleService } from './services/vehicle.service';
import { VehicleCompletionDialogService, VehicleCompletionDialogData } from './services/vehicle-completion-dialog.service';
import { CookieService } from './services/cookie.service';
import { Subscription, combineLatest } from 'rxjs';

@Component({
    selector: 'app-root',
    imports: [
        MatToolbarModule,
        MatButtonModule,
        MatIconModule,
        RoutesComponent,
        MapComponent,
        BusMapComponent,
        VehicleListComponent,
        VehicleCompletionDialogComponent
    ],
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'MBTA Tracker';
  selectedRoute: string | null = null;
  isBusRoute = false;
  routesPanelVisible = true;
  dialogData: VehicleCompletionDialogData | null = null;
  private subscriptions: Subscription[] = [];

  constructor(
    private vehicleService: VehicleService,
    private dialogService: VehicleCompletionDialogService,
    private cookieService: CookieService
  ) { }

  ngOnInit(): void {
    const settings = this.cookieService.getSettingsCookie();
    if (settings?.routesPanelVisible !== undefined) {
      this.routesPanelVisible = settings.routesPanelVisible;
    }

    this.subscriptions.push(
      this.vehicleService.selectedRoute$.subscribe({
        next: (routeId) => { this.selectedRoute = routeId; },
        error: (error) => { console.error('AppComponent: Error receiving selected route:', error); }
      }),
      // Derive isBusRoute reactively so cookie-restored routes resolve correctly once routes$ loads
      combineLatest([this.vehicleService.selectedRoute$, this.vehicleService.routes$]).subscribe(
        ([routeId, routes]) => {
          const route = routes.find(r => r.id === routeId);
          this.isBusRoute = route?.route_type === 3;
        }
      ),
      this.dialogService.dialogData$.subscribe({
        next: (data) => { this.dialogData = data; }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  toggleRoutesPanel(): void {
    this.routesPanelVisible = !this.routesPanelVisible;
    const currentSettings = this.cookieService.getSettingsCookie() ?? {};
    currentSettings.routesPanelVisible = this.routesPanelVisible;
    this.cookieService.setSettingsCookie(currentSettings);
  }

  onDialogClose(): void {
    this.dialogService.closeDialog();
  }

  resetToInitialState(): void {
    this.cookieService.deleteSettingsCookie();
    this.vehicleService.selectRoute(null, true);
    this.vehicleService.selectVehicle(null);
    this.routesPanelVisible = true;
  }
}
