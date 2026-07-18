import { z } from 'zod';

const OptionalTimestamp = z.string().nullish().transform(value => value ?? null);

export const ApiStatusSchema = z.object({
  status: z.string(),
  generatedAt: z.string(),
  vehiclesLastSuccess: OptionalTimestamp,
  boardsLastSuccess: OptionalTimestamp,
  alertsLastSuccess: OptionalTimestamp,
  referencesLastSuccess: OptionalTimestamp,
  activeRouteCount: z.number(),
});

export type ApiStatus = z.output<typeof ApiStatusSchema>;

export interface RouteActivity {
  routeId: string;
  activeUntil: string;
}

export const RouteActivitySchema = z.object({
  routeId: z.string(),
  activeUntil: z.string(),
});
