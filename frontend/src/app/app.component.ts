import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RoutesComponent } from './components/routes/routes.component';
import { MapComponent } from './components/map/map.component';
import { VehicleListComponent } from './components/vehicle-list/vehicle-list.component';
import { VehicleCompletionDialogComponent } from './components/vehicle-completion-dialog/vehicle-completion-dialog.component';
import { VehicleService } from './services/vehicle.service';
import { VehicleCompletionDialogService, VehicleCompletionDialogData } from './services/vehicle-completion-dialog.service';
import { CookieService } from './services/cookie.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-root',
  imports: [
    CommonModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    RoutesComponent,
    MapComponent,
    VehicleListComponent,
    VehicleCompletionDialogComponent
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'MBTA Tracker';
  selectedRoute: string | null = null;
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
      this.vehicleService.selectedRoute$.subscribe(routeId => { this.selectedRoute = routeId; }),
      this.dialogService.dialogData$.subscribe(data => { this.dialogData = data; })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(s => s.unsubscribe());
  }

  toggleRoutesPanel(): void {
    this.routesPanelVisible = !this.routesPanelVisible;
    this.cookieService.patchSettingsCookie({ routesPanelVisible: this.routesPanelVisible });
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
