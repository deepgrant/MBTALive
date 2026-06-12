import { z } from 'zod';
import { orUndefined, withDefault } from '../shared/validation';

// The vehicles endpoint emits explicit nulls for unreported values (verified
// live: speed/delaySeconds/tripName arrive as null, not omitted), so every
// non-required field must tolerate null as well as omission.
//
// Parsing also performs the response→domain defaulting that used to live as a
// manual `??` mapping in ApiService: the schema IS the transform.

export const VehicleSchema = z.object({
  routeId:              z.string(),
  vehicleId:            withDefault(z.string(), 'unknown'),
  latitude:             withDefault(z.number(), 0),
  longitude:            withDefault(z.number(), 0),
  bearing:              withDefault(z.number(), 0),
  speed:                withDefault(z.number(), 0),
  direction:            withDefault(z.string(), 'Unknown'),
  destination:          withDefault(z.string(), 'Unknown'),
  currentStatus:        withDefault(z.string(), 'Unknown'),
  stopName:             withDefault(z.string(), 'Unknown'),
  updatedAt:            withDefault(z.string(), ''),
  positionValid:        z.boolean(),
  // Backend doesn't send this today; it's set in-app when reusing a cached
  // position. Was hardcoded false in the old mapping.
  positionStale:        withDefault(z.boolean(), false),
  bearingReported:      z.boolean(),
  speedReported:        z.boolean(),
  platformName:         orUndefined(z.string()),
  routeType:            orUndefined(z.number()),
  predictedArrivalTime: orUndefined(z.string()),
  scheduledArrivalTime: orUndefined(z.string()),
  delaySeconds:         orUndefined(z.number()),
  tripName:             orUndefined(z.string()),
  formattedStatus:      orUndefined(z.string()),
  delayStatus:          orUndefined(z.string()),
});

/** Parsed, defaulted domain type — what the rest of the app consumes. */
export type Vehicle = z.output<typeof VehicleSchema>;

/** Raw wire shape (pre-defaulting). Only ApiService ever consumed this. */
export type VehicleResponse = z.input<typeof VehicleSchema>;
