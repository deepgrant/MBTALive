import { z } from 'zod';
import { orUndefined } from '../shared/validation';

// The backend omits `description` when absent (verified live); other optional
// fields are tolerant of omitted/null via orUndefined.
export const AlertSchema = z.object({
  id: z.string(),
  header: z.string(),
  effect: z.string(),
  severity: z.number(),
  lifecycle: z.string(),
  updatedAt: z.string(),
  description: orUndefined(z.string()),
  cause: orUndefined(z.string()),
  routeIds: orUndefined(z.array(z.string())),
  stopIds: orUndefined(z.array(z.string())),
});

export type Alert = z.infer<typeof AlertSchema>;

export type AlertSeverityLevel = 'critical' | 'warning' | 'info';

const CRITICAL_EFFECTS = new Set(['SUSPENSION', 'CANCELLATION', 'NO_SERVICE']);
const WARNING_EFFECTS  = new Set(['DELAY', 'SIGNIFICANT_DELAYS', 'MODIFIED_SERVICE', 'REDUCED_SERVICE', 'SHUTTLE']);

export function alertSeverityLevel(alert: Alert): AlertSeverityLevel {
  if (CRITICAL_EFFECTS.has(alert.effect)) return 'critical';
  if (WARNING_EFFECTS.has(alert.effect))  return 'warning';
  return 'info';
}

/** Turns an MBTA effect code like "SIGNIFICANT_DELAYS" into display text. */
export function formatAlertEffect(effect: string): string {
  return effect.replace(/_/g, ' ');
}

export function highestSeverityLevel(alerts: Alert[]): AlertSeverityLevel | null {
  if (alerts.length === 0) return null;
  const levels = alerts.map(alertSeverityLevel);
  if (levels.includes('critical')) return 'critical';
  if (levels.includes('warning'))  return 'warning';
  return 'info';
}
