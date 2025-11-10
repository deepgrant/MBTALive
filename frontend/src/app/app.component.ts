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
import { VehicleCompletionDialogService } from './services/vehicle-completion-dialog.service';
import { CookieService } from './services/cookie.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
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
  dialogData: any = null;
  private subscriptions: Subscription[] = [];

  constructor(
    private vehicleService: VehicleService,
    private dialogService: VehicleCompletionDialogService,
    private cookieService: CookieService
  ) { }

  ngOnInit(): void {
    // Restore routes panel visibility from cookie
    const savedVisibility = this.cookieService.getCookie('mbta_routes_panel_visible');
    if (savedVisibility !== null) {
      this.routesPanelVisible = savedVisibility === 'true';
      console.log('AppComponent: Restored routes panel visibility from cookie:', this.routesPanelVisible);
    }

    // Subscribe to selected route to show/hide vehicle panel
    const selectedRouteSub = this.vehicleService.selectedRoute$.subscribe({
      next: (routeId) => {
        this.selectedRoute = routeId;
      },
      error: (error) => {
        console.error('AppComponent: Error receiving selected route:', error);
      }
    });

    // Subscribe to dialog service
    const dialogSub = this.dialogService.dialogData$.subscribe({
      next: (data) => {
        this.dialogData = data;
      }
    });

    this.subscriptions.push(selectedRouteSub, dialogSub);
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  toggleRoutesPanel(): void {
    this.routesPanelVisible = !this.routesPanelVisible;
    // Save routes panel visibility to cookie
    this.cookieService.setCookie('mbta_routes_panel_visible', this.routesPanelVisible.toString());
    console.log('AppComponent: Saved routes panel visibility to cookie:', this.routesPanelVisible);
  }

  onDialogClose(): void {
    this.dialogService.closeDialog();
  }
}