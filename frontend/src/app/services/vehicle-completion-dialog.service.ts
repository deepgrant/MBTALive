import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface VehicleCompletionDialogData {
  vehicleId: string;
  routeId: string;
  completedNormally: boolean;
  finalArrivalTime?: string;
  lastUpdateTime: string;
}

@Injectable({
  providedIn: 'root'
})
export class VehicleCompletionDialogService {
  private dialogDataSubject = new BehaviorSubject<VehicleCompletionDialogData | null>(null);
  public dialogData$ = this.dialogDataSubject.asObservable();

  showDialog(data: VehicleCompletionDialogData): void {
    this.dialogDataSubject.next(data);
  }

  closeDialog(): void {
    this.dialogDataSubject.next(null);
  }
}

