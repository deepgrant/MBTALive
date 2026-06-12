import { z } from 'zod';

// Per-field .catch(undefined): one corrupt field (e.g. mapZoom: "banana")
// degrades to "unset" while its siblings — most importantly selectedRoute —
// survive. Range validation of mapCenter/mapZoom deliberately stays in
// MapService.restoreMapBounds(), which self-heals bad values.
export const AppSettingsSchema = z.object({
  selectedRoute:      z.string().nullable().optional().catch(undefined),
  selectedStation:    z.string().nullable().optional().catch(undefined),
  mapCenter:          z.object({ lat: z.number(), lng: z.number() }).optional().catch(undefined),
  mapZoom:            z.number().optional().catch(undefined),
  routesPanelVisible: z.boolean().optional().catch(undefined),
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;
