import { Component, OnInit, OnDestroy, ViewChild, signal } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule, MatSidenav } from '@angular/material/sidenav';
import { BreakpointObserver } from '@angular/cdk/layout';
import { RoutesComponent } from './components/routes/routes.component';
import { MapComponent } from './components/map/map.component';
import { TrainBoardComponent } from './components/train-board/train-board.component';
import { VehicleListComponent } from './components/vehicle-list/vehicle-list.component';
import { VehicleService } from './services/vehicle.service';
import { CookieService } from './services/cookie.service';
import { AlertTickerComponent } from './components/alert-ticker/alert-ticker.component';
import { Alert } from './models/alert.model';
import { Subscription } from 'rxjs';

@Component({
    selector: 'app-root',
    imports: [
        MatToolbarModule,
        MatButtonModule,
        MatIconModule,
        MatSidenavModule,
        AlertTickerComponent,
        RoutesComponent,
        MapComponent,
        TrainBoardComponent,
        VehicleListComponent,
    ],
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'MBTA Tracker';
  selectedRoute: string | null = null;
  selectedStation: string | null = null;
  routesPanelVisible = true;
  routeAlerts: Alert[] = [];
  isMobile = signal(false);
  viewMode: 'board' | 'map' = 'board';

  @ViewChild('routesDrawer') routesDrawer!: MatSidenav;
  @ViewChild('vehicleDrawer') vehicleDrawer!: MatSidenav;

  private subscriptions: Subscription[] = [];
  private swipeStartX = 0;

  constructor(
    private vehicleService: VehicleService,
    private cookieService: CookieService,
    private breakpointObserver: BreakpointObserver
  ) {
    // Set synchronously so the template renders with the correct mode on first
    // paint and avoids a flash of the desktop layout on mobile.
    this.isMobile.set(breakpointObserver.isMatched('(max-width: 767.98px)'));
  }

  ngOnInit(): void {
    const settings = this.cookieService.getSettingsCookie();
    if (settings?.routesPanelVisible !== undefined) {
      this.routesPanelVisible = settings.routesPanelVisible;
    }

    // Restore route (and station via selectedRoute$ subscription below).
    // 800 ms delay lets Leaflet initialize on desktop before the route is selected.
    setTimeout(() => this.vehicleService.restoreRouteFromCookie(), 800);

    this.subscriptions.push(
      this.breakpointObserver.observe('(max-width: 767.98px)').subscribe(state => {
        this.isMobile.set(state.matches);
        if (!state.matches) {
          this.vehicleDrawer?.close();
        }
      }),

      this.vehicleService.selectedRoute$.subscribe({
        next: (routeId) => {
          const prevRoute = this.selectedRoute;
          this.selectedRoute = routeId;
          if (routeId && routeId !== prevRoute) this.viewMode = 'board';
          if (routeId !== prevRoute) {
            const saved = this.cookieService.getSettingsCookie();
            if (routeId && routeId === saved?.selectedRoute) {
              this.selectedStation = saved?.selectedStation ?? null;
            } else {
              this.selectedStation = null;
              if (saved?.selectedStation) {
                this.cookieService.setSettingsCookie({ ...saved, selectedStation: null });
              }
            }
          }
          // On mobile: close the vehicle drawer when a route is deselected.
          // Do NOT auto-open on selection — the user opens it via the toolbar button.
          if (this.isMobile() && !routeId) {
            this.vehicleDrawer?.close();
          }
        },
        error: (error) => { console.error('AppComponent: Error receiving selected route:', error); }
      }),

      this.vehicleService.selectedRouteAlerts$.subscribe({
        next: (alerts) => { this.routeAlerts = alerts; }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  toggleRoutesPanel(): void {
    if (!this.isMobile()) {
      this.routesPanelVisible = !this.routesPanelVisible;
      const currentSettings = this.cookieService.getSettingsCookie() ?? {};
      currentSettings.routesPanelVisible = this.routesPanelVisible;
      this.cookieService.setSettingsCookie(currentSettings);
    }
  }

  backToRoutes(): void {
    this.vehicleService.selectRoute(null);
    this.viewMode = 'board';
  }

  onStationSelected(station: string | null): void {
    this.selectedStation = station;
    const currentSettings = this.cookieService.getSettingsCookie() ?? {};
    currentSettings.selectedStation = station;
    this.cookieService.setSettingsCookie(currentSettings);
  }

  toggleView(): void {
    this.viewMode = this.viewMode === 'board' ? 'map' : 'board';
  }

  toggleVehiclePanel(): void {
    this.vehicleDrawer.toggle();
  }

  onSwipeStart(event: TouchEvent): void {
    this.swipeStartX = event.touches[0].clientX;
  }

  onSwipeEnd(event: TouchEvent): void {
    const deltaX = event.changedTouches[0].clientX - this.swipeStartX;
    if (deltaX > 60) {
      this.vehicleDrawer.close();
    }
  }

  onRoutesSwipeEnd(event: TouchEvent): void {
    const deltaX = event.changedTouches[0].clientX - this.swipeStartX;
    if (deltaX < -60) {
      this.routesDrawer.close();
    }
  }

  resetToInitialState(): void {
    this.cookieService.deleteSettingsCookie();
    this.vehicleService.selectRoute(null, true);
    this.selectedStation = null;
    this.routesPanelVisible = true;
    if (this.isMobile()) {
      this.routesDrawer?.close();
      this.vehicleDrawer?.close();
    }
  }
}
