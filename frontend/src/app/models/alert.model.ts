export interface Alert {
  id: string;
  header: string;
  effect: string;
  severity: number;
  lifecycle: string;
  updatedAt: string;
  description?: string;
  cause?: string;
  routeIds?: string[];
}

export type AlertSeverityLevel = 'critical' | 'warning' | 'info';

const CRITICAL_EFFECTS = new Set(['SUSPENSION', 'CANCELLATION', 'NO_SERVICE']);
const WARNING_EFFECTS  = new Set(['DELAY', 'SIGNIFICANT_DELAYS', 'MODIFIED_SERVICE', 'REDUCED_SERVICE', 'SHUTTLE']);

export function alertSeverityLevel(alert: Alert): AlertSeverityLevel {
  if (CRITICAL_EFFECTS.has(alert.effect)) return 'critical';
  if (WARNING_EFFECTS.has(alert.effect))  return 'warning';
  return 'info';
}

export function highestSeverityLevel(alerts: Alert[]): AlertSeverityLevel | null {
  if (alerts.length === 0) return null;
  const levels = alerts.map(alertSeverityLevel);
  if (levels.includes('critical')) return 'critical';
  if (levels.includes('warning'))  return 'warning';
  return 'info';
}
