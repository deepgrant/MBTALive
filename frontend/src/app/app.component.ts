import { Component, OnInit, OnDestroy, ViewChild, signal } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule, MatSidenav } from '@angular/material/sidenav';
import { BreakpointObserver } from '@angular/cdk/layout';
import { RoutesComponent } from './components/routes/routes.component';
import { MapComponent } from './components/map/map.component';
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
        VehicleListComponent,
    ],
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'MBTA Tracker';
  selectedRoute: string | null = null;
  routesPanelVisible = true;
  routeAlerts: Alert[] = [];
  isMobile = signal(false);

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

    this.subscriptions.push(
      this.breakpointObserver.observe('(max-width: 767.98px)').subscribe(state => {
        this.isMobile.set(state.matches);
        if (!state.matches) {
          this.vehicleDrawer?.close();
        }
      }),

      this.vehicleService.selectedRoute$.subscribe({
        next: (routeId) => {
          this.selectedRoute = routeId;
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
    if (this.isMobile()) {
      this.routesDrawer.toggle();
    } else {
      this.routesPanelVisible = !this.routesPanelVisible;
      const currentSettings = this.cookieService.getSettingsCookie() ?? {};
      currentSettings.routesPanelVisible = this.routesPanelVisible;
      this.cookieService.setSettingsCookie(currentSettings);
    }
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
    this.routesPanelVisible = true;
    if (this.isMobile()) {
      this.routesDrawer?.close();
      this.vehicleDrawer?.close();
    }
  }
}
