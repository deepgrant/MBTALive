import { z } from 'zod';

export const StationSchema = z.object({
  id: z.string(),
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
});

export type Station = z.infer<typeof StationSchema>;
