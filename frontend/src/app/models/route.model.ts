export interface Route {
  id: string;
  long_name: string;
  short_name: string;
  color: string;
  text_color: string;
}

export interface RouteResponse {
  id: string;
  long_name: string;
  short_name: string;
  color: string;
  text_color: string;
}

export interface Shape {
  id: string;
  polyline: string;
}

export interface ShapeResponse {
  id: string;
  polyline: string;
}
