export interface Vehicle {
  routeId: string;
  vehicleId: string;
  latitude: number;
  longitude: number;
  bearing: number;
  speed: number;
  direction: string;
  destination: string;
  currentStatus: string;
  stopName: string;
  updatedAt: string;
  routeType?: number;
  predictedArrivalTime?: string;
  scheduledArrivalTime?: string;
  delaySeconds?: number;
  tripName?: string;
}

export interface VehicleResponse {
  routeId: string;
  vehicleId?: string;
  latitude?: number;
  longitude?: number;
  bearing?: number;
  speed?: number;
  direction?: string;
  destination?: string;
  currentStatus?: string;
  stopName?: string;
  updatedAt?: string;
  directionId?: number;
  stopId?: string;
  tripId?: string;
  tripName?: string;
  currentStopSequence?: number;
  timeStamp: number;
  routeType?: number;
  predictedArrivalTime?: string;
  scheduledArrivalTime?: string;
  delaySeconds?: number;
}
