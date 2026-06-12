import { z } from 'zod';

export const RouteSchema = z.object({
  id: z.string(),
  long_name: z.string(),
  short_name: z.string(),
  color: z.string(),
  text_color: z.string(),
  route_type: z.number(),
});

export type Route = z.infer<typeof RouteSchema>;

export const ShapeSchema = z.object({
  id: z.string(),
  polyline: z.string(),
  priority: z.number(),
  directionId: z.number(),
  typicality: z.number(),
});

export type Shape = z.infer<typeof ShapeSchema>;
