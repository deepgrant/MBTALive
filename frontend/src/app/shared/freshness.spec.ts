import { degradedDataMessage } from './freshness';
import { ApiStatus } from '../models/status.model';

describe('degradedDataMessage', () => {
  const now = Date.parse('2026-07-15T18:40:00Z');
  const base: ApiStatus = {
    status: 'ok',
    generatedAt: '2026-07-15T18:40:00Z',
    vehiclesLastSuccess: '2026-07-15T18:39:50Z',
    boardsLastSuccess: '2026-07-15T18:39:30Z',
    alertsLastSuccess: '2026-07-15T18:38:00Z',
    referencesLastSuccess: '2026-07-15T06:00:00Z',
    activeRouteCount: 1,
  };

  it('returns null while snapshots are fresh', () => {
    expect(degradedDataMessage(base, true, now)).toBeNull();
  });

  it('prioritizes stale vehicle data', () => {
    const status = { ...base, vehiclesLastSuccess: '2026-07-15T18:39:00Z' };
    expect(degradedDataMessage(status, true, now)).toContain('vehicle');
  });

  it('does not report idle vehicle snapshots when no route is selected', () => {
    const status = { ...base, vehiclesLastSuccess: '2026-07-15T18:39:00Z' };
    expect(degradedDataMessage(status, false, now)).toBeNull();
  });

  it('only checks board freshness when a route is selected', () => {
    const status = { ...base, boardsLastSuccess: '2026-07-15T18:38:00Z' };
    expect(degradedDataMessage(status, false, now)).toBeNull();
    expect(degradedDataMessage(status, true, now)).toContain('board');
  });

  it('does not call pre-selection status delayed during the activation grace period', () => {
    const status = { ...base, vehiclesLastSuccess: '2026-07-15T18:39:00Z' };
    expect(degradedDataMessage(status, true, now, now - 20_000)).toBeNull();
    expect(degradedDataMessage(status, true, now, now - 31_000)).toContain('vehicle');
  });

  it('accepts a vehicle refresh that completed after route selection', () => {
    const status = { ...base, vehiclesLastSuccess: '2026-07-15T18:39:50Z' };
    expect(degradedDataMessage(status, true, now, now - 60_000)).toBeNull();
  });
});
