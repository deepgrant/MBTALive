import { RouteBoardDataSchema } from './board.model';

// Trimmed from a real /api/route/Orange/board payload captured 2026-06-11.
// Notable wire behavior this fixture preserves: the backend OMITS absent
// Option fields (train 1418 has no delaySeconds/delayStatus; its Forest Hills
// prediction has neither predictedTime nor scheduledTime).
const capturedBoardPayload = {
  routeId: 'Orange',
  inboundStops: [
    { directionId: 1, id: 'place-forhl', latitude: 42.300713, longitude: -71.113943, name: 'Forest Hills', sequence: 0 },
    { directionId: 1, id: 'place-grnst', latitude: 42.310525, longitude: -71.107414, name: 'Green Street', sequence: 1 },
  ],
  outboundStops: [
    { directionId: 0, id: 'place-ogmnl', latitude: 42.43668, longitude: -71.071097, name: 'Oak Grove', sequence: 0 },
    { directionId: 0, id: 'place-mlmnl', latitude: 42.426632, longitude: -71.07411, name: 'Malden Center', sequence: 1 },
  ],
  trains: [
    {
      currentStopId: 'place-sbmnl',
      currentStopSequence: 2,
      delaySeconds: 937,
      delayStatus: 'major-delay',
      destination: 'Oak Grove',
      direction: 'North',
      directionId: 1,
      predictions: [
        { predictedTime: '2026-06-11T20:12:37-04:00', scheduledTime: '2026-06-11T19:57:00-04:00', sequence: 2, status: 'upcoming', stopId: 'place-sbmnl', stopName: 'Stony Brook' },
      ],
      tripId: '75565702',
      tripName: '',
      vehicleId: '1454',
    },
    {
      currentStopId: 'place-forhl',
      currentStopSequence: 0,
      destination: 'Oak Grove',
      direction: 'North',
      directionId: 1,
      predictions: [
        { predictedTime: '2026-06-11T20:13:31-04:00', scheduledTime: '2026-06-11T20:01:00-04:00', sequence: 1, status: 'upcoming', stopId: 'place-grnst', stopName: 'Green Street' },
        { sequence: 0, status: 'upcoming', stopId: 'place-forhl', stopName: 'Forest Hills' },
      ],
      tripId: '75565712',
      tripName: '',
      vehicleId: '1418',
    },
  ],
};

describe('RouteBoardDataSchema', () => {
  it('parses a real captured payload', () => {
    const result = RouteBoardDataSchema.safeParse(capturedBoardPayload);
    expect(result.success).toBeTrue();
  });

  it('normalizes omitted Option fields to null (the declared types are X | null)', () => {
    const board = RouteBoardDataSchema.parse(capturedBoardPayload);
    const plainTrain = board.trains[1];
    expect(plainTrain.delaySeconds).toBeNull();
    expect(plainTrain.delayStatus).toBeNull();
    const noTimePred = plainTrain.predictions[1];
    expect(noTimePred.predictedTime).toBeNull();
    expect(noTimePred.scheduledTime).toBeNull();
  });

  it('keeps explicit null and present values intact', () => {
    const withNulls = {
      ...capturedBoardPayload,
      trains: [{ ...capturedBoardPayload.trains[0], tripName: null }],
    };
    const board = RouteBoardDataSchema.parse(withNulls);
    expect(board.trains[0].tripName).toBeNull();
    expect(board.trains[0].delaySeconds).toBe(937);
  });

  it('rejects a payload missing the trains array', () => {
    const { trains, ...rest } = capturedBoardPayload;
    expect(RouteBoardDataSchema.safeParse(rest).success).toBeFalse();
  });
});
