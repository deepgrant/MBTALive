export interface AppSettings {
  selectedRoute?: string | null;
  mapCenter?: {
    lat: number;
    lng: number;
  };
  mapZoom?: number;
  routesPanelVisible?: boolean;
}

