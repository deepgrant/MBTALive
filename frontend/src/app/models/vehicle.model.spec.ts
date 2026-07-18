import { VehicleSchema } from './vehicle.model';

// Field shapes mirror the live /api/route/{id}/vehicles payload: the backend
// emits explicit nulls for unreported values rather than omitting keys.
const minimalWire = {
  routeId: 'Orange',
  positionValid: true,
  bearingReported: false,
  speedReported: false,
};

const fullWire = {
  routeId: 'Orange',
  vehicleId: '1418',
  latitude: 42.30122,
  longitude: -71.11384,
  bearing: 30,
  speed: null,             // trains: speed is null when unreported
  direction: 'North',
  destination: 'Oak Grove',
  currentStatus: 'STOPPED_AT',
  stopName: 'Forest Hills',
  platformName: 'Track 2',
  updatedAt: '2026-06-11T20:08:51-04:00',
  positionValid: true,
  bearingReported: true,
  speedReported: false,
  predictedArrivalTime: null,
  scheduledArrivalTime: null,
  delaySeconds: null,
  tripName: '',
  formattedStatus: 'Stopped at Forest Hills',
  delayStatus: null,
  // Wire-only fields the frontend never declared — must be stripped, not fatal:
  stopId: 'Forest Hills-02',
  tripId: '75565712',
  directionId: 1,
  // Snapshot generation time is retained so stale position reuse is based on
  // source age rather than the browser's observation time.
  timeStamp: 1781223125801,
};

describe('VehicleSchema', () => {
  it('applies all defaults to a minimal payload', () => {
    const v = VehicleSchema.parse(minimalWire);
    expect(v.vehicleId).toBe('unknown');
    expect(v.latitude).toBe(0);
    expect(v.longitude).toBe(0);
    expect(v.bearing).toBe(0);
    expect(v.speed).toBe(0);
    expect(v.direction).toBe('Unknown');
    expect(v.destination).toBe('Unknown');
    expect(v.currentStatus).toBe('Unknown');
    expect(v.stopName).toBe('Unknown');
    expect(v.updatedAt).toBe('');
    expect(v.positionStale).toBeFalse();
    expect(v.delaySeconds).toBeUndefined();
  });

  it('parses a realistic full payload, defaulting nulls and stripping unknown keys', () => {
    const v = VehicleSchema.parse(fullWire);
    expect(v.vehicleId).toBe('1418');
    expect(v.speed).toBe(0);                    // null → default
    expect(v.delaySeconds).toBeUndefined();     // null → undefined (optional field)
    expect(v.tripName).toBe('');                // empty string preserved, stays falsy
    expect('stopId' in v).toBeFalse();          // unknown keys stripped
    expect(v.timeStamp).toBe(1781223125801);
  });

  it('rejects a payload missing routeId', () => {
    const { routeId, ...rest } = fullWire;
    expect(VehicleSchema.safeParse(rest).success).toBeFalse();
  });
});
