import { ApiStatus } from '../models/status.model';

function ageMs(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.max(0, nowMs - parsed) : null;
}

export function degradedDataMessage(
  status: ApiStatus | null,
  routeSelected: boolean,
  nowMs: number = Date.now(),
  routeSelectedAtMs: number | null = null,
): string | null {
  if (!status) return null;
  const selectedAge = routeSelectedAtMs === null ? null : Math.max(0, nowMs - routeSelectedAtMs);
  const vehicleAge = ageMs(status.vehiclesLastSuccess, nowMs);
  const boardAge = ageMs(status.boardsLastSuccess, nowMs);
  const alertAge = ageMs(status.alertsLastSuccess, nowMs);

  const vehicleSucceededAfterSelection = routeSelectedAtMs === null
    || Date.parse(status.vehiclesLastSuccess ?? '') >= routeSelectedAtMs;
  const boardSucceededAfterSelection = routeSelectedAtMs === null
    || Date.parse(status.boardsLastSuccess ?? '') >= routeSelectedAtMs;

  if (routeSelected
      && (selectedAge === null || selectedAge > 30_000)
      && (!vehicleSucceededAfterSelection || (vehicleAge !== null && vehicleAge > 30_000))) {
    return 'Live vehicle data is delayed.';
  }
  if (routeSelected
      && (selectedAge === null || selectedAge > 90_000)
      && (!boardSucceededAfterSelection || (boardAge !== null && boardAge > 90_000))) {
    return 'Arrival board data is delayed.';
  }
  if (alertAge !== null && alertAge > 300_000) return 'Service alert data is delayed.';
  return null;
}
