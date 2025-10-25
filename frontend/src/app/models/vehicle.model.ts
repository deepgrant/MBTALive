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
  updatedAt: string;
}

export interface VehicleResponse {
  routeId: string;
  vehicleId: string;
  latitude: number;
  longitude: number;
  bearing: number;
  speed: number;
  direction: string;
  destination: string;
  currentStatus: string;
  updatedAt: string;
}
