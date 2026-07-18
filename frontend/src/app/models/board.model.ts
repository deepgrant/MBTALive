import { z } from 'zod';
import { orNull } from '../shared/validation';

// The backend omits absent Option fields on this endpoint rather than emitting
// null (verified against a live payload: delaySeconds/delayStatus appear only
// on delayed trains; predictions omit predictedTime/scheduledTime entirely).
// orNull normalizes omitted → null so the declared `X | null` types are honest.

export const BoardStopInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  directionId: z.number(),
  sequence: z.number(),
});

export type BoardStopInfo = z.infer<typeof BoardStopInfoSchema>;

export const StopPredictionSchema = z.object({
  stopId: z.string(),
  stopName: z.string(),
  sequence: z.number(),
  predictedTime: orNull(z.string()),
  scheduledTime: orNull(z.string()),
  status: z.string(),
});

export type StopPrediction = z.infer<typeof StopPredictionSchema>;

export const TrainBoardDataSchema = z.object({
  vehicleId: z.string(),
  tripId: orNull(z.string()),
  tripName: orNull(z.string()),
  directionId: orNull(z.number()),
  direction: orNull(z.string()),
  destination: orNull(z.string()),
  currentStopId: orNull(z.string()),
  currentStopSequence: z.number(),
  delaySeconds: orNull(z.number()),
  delayStatus: orNull(z.string()),
  predictions: z.array(StopPredictionSchema),
});

export type TrainBoardData = z.infer<typeof TrainBoardDataSchema>;

export const RouteBoardDataSchema = z.object({
  routeId: z.string(),
  inboundStops: z.array(BoardStopInfoSchema),
  outboundStops: z.array(BoardStopInfoSchema),
  trains: z.array(TrainBoardDataSchema),
  generatedAt: z.string().nullish().transform(value => value ?? null),
});

export type RouteBoardData = z.infer<typeof RouteBoardDataSchema>;
