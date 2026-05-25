export interface BoardStopInfo {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  directionId: number;
  sequence: number;
}

export interface StopPrediction {
  stopId: string;
  stopName: string;
  sequence: number;
  predictedTime: string | null;
  scheduledTime: string | null;
  status: string;
}

export interface TrainBoardData {
  vehicleId: string;
  tripId: string | null;
  tripName: string | null;
  directionId: number | null;
  direction: string | null;
  destination: string | null;
  currentStopId: string | null;
  currentStopSequence: number;
  delaySeconds: number | null;
  delayStatus: string | null;
  predictions: StopPrediction[];
}

export interface RouteBoardData {
  routeId: string;
  inboundStops: BoardStopInfo[];
  outboundStops: BoardStopInfo[];
  trains: TrainBoardData[];
}
