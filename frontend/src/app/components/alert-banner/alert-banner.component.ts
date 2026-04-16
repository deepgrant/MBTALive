import { Component, Input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { Alert, AlertSeverityLevel, alertSeverityLevel, highestSeverityLevel } from '../../models/alert.model';

@Component({
  selector: 'app-alert-banner',
  imports: [MatIconModule, MatButtonModule],
  templateUrl: './alert-banner.component.html',
  styleUrls: ['./alert-banner.component.scss']
})
export class AlertBannerComponent {
  @Input() alerts: Alert[] = [];
  expanded = false;

  get severityLevel(): AlertSeverityLevel | null {
    return highestSeverityLevel(this.alerts);
  }

  isSevere(alert: Alert): boolean {
    const level = alertSeverityLevel(alert);
    return level === 'critical' || level === 'warning';
  }

  formatEffect(effect: string): string {
    return effect.replace(/_/g, ' ');
  }

  toggleExpanded(): void {
    this.expanded = !this.expanded;
  }
}
