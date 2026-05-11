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
  positionValid: boolean;
  positionStale?: boolean;
  bearingReported?: boolean;
  speedReported?: boolean;
  routeType?: number;
  predictedArrivalTime?: string;
  scheduledArrivalTime?: string;
  delaySeconds?: number;
  tripName?: string;
  formattedStatus?: string;
  delayStatus?: string;
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
  timeStamp: number;
  routeType?: number;
  predictedArrivalTime?: string;
  scheduledArrivalTime?: string;
  delaySeconds?: number;
  formattedStatus?: string;
  delayStatus?: string;
  positionValid: boolean;
  bearingReported: boolean;
  speedReported: boolean;
}
