/** Shared formatting utilities for vehicle data display. */

export type DelaySeverity = 'on-time' | 'minor-delay' | 'major-delay' | 'ahead-of-schedule';

export interface DelayStatus {
  color: string;
  label: string;
  severity: DelaySeverity;
}

export function formatStatus(status: string, stopName?: string): string {
  if (!status) return 'Unknown';
  const stop = stopName && stopName !== 'Unknown' ? stopName : 'next stop';
  switch (status.toUpperCase()) {
    case 'IN_TRANSIT_TO': return `In transit to ${stop}`;
    case 'STOPPED_AT':    return `Stopped at ${stop}`;
    case 'INCOMING_AT':   return `Incoming at ${stop}`;
    default:
      return status.replace(/_/g, ' ')
        .split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
  }
}

export function getDelayStatus(delaySeconds?: number): DelayStatus {
  if (delaySeconds === undefined || delaySeconds === null) {
    return { color: '#28a745', label: 'On Time', severity: 'on-time' };
  }
  if (delaySeconds < 0) {
    const minutesAhead = Math.abs(Math.round(delaySeconds / 60));
    return { color: '#17a2b8', label: `Ahead by ${minutesAhead} min`, severity: 'ahead-of-schedule' };
  }
  if (delaySeconds < 300) {
    return { color: '#28a745', label: 'On Time', severity: 'on-time' };
  }
  if (delaySeconds < 600) {
    return { color: '#ffc107', label: `${Math.round(delaySeconds / 60)} min delay`, severity: 'minor-delay' };
  }
  return { color: '#dc3545', label: `${Math.round(delaySeconds / 60)} min delay`, severity: 'major-delay' };
}

export function formatDelayTime(delaySeconds?: number): string {
  if (!delaySeconds) return 'On Time';
  if (delaySeconds < 0) return `Ahead by ${Math.abs(Math.round(delaySeconds / 60))} min`;
  if (delaySeconds < 60)  return `${delaySeconds} sec delay`;
  return `${Math.round(delaySeconds / 60)} min delay`;
}

export function formatTime(timestamp: string | undefined): string {
  if (!timestamp) return 'N/A';
  try {
    return new Date(timestamp).toLocaleTimeString();
  } catch {
    return timestamp;
  }
}

export function formatSpeed(speed: number): string {
  return `${speed.toFixed(1)} mph`;
}

export function isBus(routeType?: number): boolean {
  return routeType === 3;
}
