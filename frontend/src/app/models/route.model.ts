export interface Route {
  id: string;
  long_name: string;
  short_name: string;
  color: string;
  text_color: string;
  route_type: number;
}

export interface Shape {
  id: string;
  polyline: string;
  priority: number;
  directionId: number;
}
