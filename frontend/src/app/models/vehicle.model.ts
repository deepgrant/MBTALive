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
  platformName?: string;
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
  platformName?: string;
  updatedAt?: string;
  tripName?: string;
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
