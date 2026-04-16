import { Component, Input } from '@angular/core';
import { Alert, AlertSeverityLevel, highestSeverityLevel } from '../../models/alert.model';

@Component({
  selector: 'app-alert-ticker',
  imports: [],
  templateUrl: './alert-ticker.component.html',
  styleUrls: ['./alert-ticker.component.scss']
})
export class AlertTickerComponent {
  @Input() alerts: Alert[] = [];

  get severityLevel(): AlertSeverityLevel | null {
    return highestSeverityLevel(this.alerts);
  }

  get tickerText(): string {
    return this.alerts.map(a => `${a.effect.replace(/_/g, ' ')}: ${a.header}`).join(' \u25C6 ');
  }

  get animationDuration(): string {
    // Scale by alert count and average header length; 50% slower than original
    const charCount = this.alerts.reduce((sum, a) => sum + a.header.length, 0);
    return `${Math.max(Math.round(charCount * 0.3), 30)}s`;
  }
}
