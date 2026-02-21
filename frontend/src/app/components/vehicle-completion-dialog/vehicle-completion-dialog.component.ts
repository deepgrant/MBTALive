import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';

@Component({
    selector: 'app-vehicle-completion-dialog',
    imports: [
        CommonModule,
        MatCardModule,
        MatButtonModule
    ],
    templateUrl: './vehicle-completion-dialog.component.html',
    styleUrls: ['./vehicle-completion-dialog.component.scss']
})
export class VehicleCompletionDialogComponent {
  @Input() vehicleId: string = '';
  @Input() routeId: string = '';
  @Input() completedNormally: boolean = true;
  @Input() finalArrivalTime: string | undefined = undefined;
  @Input() lastUpdateTime: string = '';
  @Output() closed = new EventEmitter<void>();

  onClose(): void {
    this.closed.emit();
  }

  formatTime(timestamp: string | undefined): string {
    if (!timestamp) return 'N/A';
    try {
      return new Date(timestamp).toLocaleString();
    } catch (e) {
      return timestamp;
    }
  }
}

