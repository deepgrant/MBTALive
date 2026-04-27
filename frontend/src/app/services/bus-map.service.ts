import { Injectable } from '@angular/core';
import maplibregl, { Map as MaplibreMap, GeoJSONSource, LngLatBounds } from 'maplibre-gl';
import * as Polyline from '@mapbox/polyline';
import { Vehicle } from '../models/vehicle.model';
import { Route, Shape } from '../models/route.model';
import { Station } from '../models/station.model';

@Injectable({ providedIn: 'root' })
export class BusMapService {
  private map: MaplibreMap | null = null;
  private mapReady = false;

  private readonly SOURCE_ROUTE = 'bus-route-source';
  private readonly SOURCE_STOPS = 'bus-stops-source';
  private readonly SOURCE_VEHICLES = 'bus-vehicles-source';

  private readonly LAYER_ROUTE_CASING = 'bus-route-casing';
  private readonly LAYER_ROUTE_LINE = 'bus-route-line';
  private readonly LAYER_STOPS = 'bus-stops-layer';
  private readonly LAYER_VEHICLES = 'bus-vehicles-layer';

  private pendingShapes: { shapes: Shape[]; routeColor: string } | null = null;
  private pendingStations: Station[] | null = null;
  private pendingVehicles: { vehicles: Vehicle[]; routeColor: string } | null = null;
  private currentRouteGeoJson: GeoJSON.FeatureCollection<GeoJSON.LineString> | null = null;

  initializeMap(containerId: string): MaplibreMap {
    this.map = new maplibregl.Map({
      container: containerId,
      style: '/assets/map-styles/dark-bus.json',
      center: [-71.0589, 42.3601],
      zoom: 11,
      pitch: 45,
      bearing: 0
    });

    this.map.on('load', () => {
      this.addSourcesAndLayers();
      this.mapReady = true;
      this.flushPendingUpdates();
    });

    return this.map;
  }

  destroyMap(): void {
    if (this.map) {
      this.map.remove();
      this.map = null;
      this.mapReady = false;
    }
    this.pendingShapes = null;
    this.pendingStations = null;
    this.pendingVehicles = null;
    this.currentRouteGeoJson = null;
  }

  updateRouteShapes(shapes: Shape[], route: Route): void {
    const geoJson = this.shapesToGeoJson(shapes, route.color);
    this.currentRouteGeoJson = geoJson;
    if (!this.mapReady) {
      this.pendingShapes = { shapes, routeColor: route.color };
      return;
    }
    (this.map!.getSource(this.SOURCE_ROUTE) as GeoJSONSource).setData(geoJson);
  }

  updateStops(stations: Station[]): void {
    const geoJson = this.stationsToGeoJson(stations);
    if (!this.mapReady) {
      this.pendingStations = stations;
      return;
    }
    (this.map!.getSource(this.SOURCE_STOPS) as GeoJSONSource).setData(geoJson);
  }

  updateVehicles(vehicles: Vehicle[], routeColor: string): void {
    const geoJson = this.vehiclesToGeoJson(vehicles, routeColor);
    if (!this.mapReady) {
      this.pendingVehicles = { vehicles, routeColor };
      return;
    }
    (this.map!.getSource(this.SOURCE_VEHICLES) as GeoJSONSource).setData(geoJson);
  }

  clearAll(): void {
    this.currentRouteGeoJson = null;
    this.pendingShapes = null;
    this.pendingStations = null;
    this.pendingVehicles = null;
    if (!this.mapReady) return;
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
    (this.map!.getSource(this.SOURCE_ROUTE) as GeoJSONSource)?.setData(empty);
    (this.map!.getSource(this.SOURCE_STOPS) as GeoJSONSource)?.setData(empty);
    (this.map!.getSource(this.SOURCE_VEHICLES) as GeoJSONSource)?.setData(empty);
  }

  fitBoundsToRoute(): void {
    if (!this.mapReady || !this.currentRouteGeoJson || !this.currentRouteGeoJson.features.length) return;
    const bounds = new LngLatBounds();
    for (const feature of this.currentRouteGeoJson.features) {
      for (const coord of feature.geometry.coordinates) {
        bounds.extend(coord as [number, number]);
      }
    }
    if (bounds.isEmpty()) return;
    this.map!.fitBounds(bounds, {
      padding: { top: 80, bottom: 120, left: 60, right: 60 },
      pitch: 45,
      duration: 800
    });
  }

  private addSourcesAndLayers(): void {
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

    this.map!.addSource(this.SOURCE_ROUTE, { type: 'geojson', data: empty });
    this.map!.addSource(this.SOURCE_STOPS, { type: 'geojson', data: empty });
    this.map!.addSource(this.SOURCE_VEHICLES, { type: 'geojson', data: empty });

    this.map!.addLayer({
      id: this.LAYER_ROUTE_CASING,
      type: 'line',
      source: this.SOURCE_ROUTE,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 10, 'line-opacity': 0.25 }
    });

    this.map!.addLayer({
      id: this.LAYER_ROUTE_LINE,
      type: 'line',
      source: this.SOURCE_ROUTE,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'routeColor'], 'line-width': 5, 'line-opacity': 0.9 }
    });

    this.map!.addLayer({
      id: this.LAYER_STOPS,
      type: 'circle',
      source: this.SOURCE_STOPS,
      paint: {
        'circle-radius': 4,
        'circle-color': '#2a3a4a',
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#8eaabf'
      }
    });

    this.map!.addLayer({
      id: this.LAYER_VEHICLES,
      type: 'circle',
      source: this.SOURCE_VEHICLES,
      paint: {
        'circle-radius': 8,
        'circle-color': ['get', 'routeColor'],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-opacity': 0.9
      }
    });
  }

  private flushPendingUpdates(): void {
    if (this.pendingShapes) {
      const geoJson = this.shapesToGeoJson(this.pendingShapes.shapes, this.pendingShapes.routeColor);
      this.currentRouteGeoJson = geoJson;
      (this.map!.getSource(this.SOURCE_ROUTE) as GeoJSONSource).setData(geoJson);
      this.pendingShapes = null;
    }
    if (this.pendingStations) {
      (this.map!.getSource(this.SOURCE_STOPS) as GeoJSONSource).setData(this.stationsToGeoJson(this.pendingStations));
      this.pendingStations = null;
    }
    if (this.pendingVehicles) {
      (this.map!.getSource(this.SOURCE_VEHICLES) as GeoJSONSource).setData(
        this.vehiclesToGeoJson(this.pendingVehicles.vehicles, this.pendingVehicles.routeColor)
      );
      this.pendingVehicles = null;
    }
  }

  // Mirrors MapService.addRouteLayer filtering: drop priority < 0, prefer canonical- shapes,
  // keep all shapes that tie at max priority per directionId (preserves branch routes).
  private shapesToGeoJson(shapes: Shape[], routeColor: string): GeoJSON.FeatureCollection<GeoJSON.LineString> {
    const validShapes = shapes.filter(s => s.priority >= 0);
    const canonicalShapes = validShapes.filter(s => s.id.startsWith('canonical-'));
    const candidates = canonicalShapes.length > 0 ? canonicalShapes : validShapes;

    const maxPriorityByDir: Record<number, number> = {};
    for (const shape of candidates) {
      const current = maxPriorityByDir[shape.directionId] ?? -Infinity;
      if (shape.priority > current) maxPriorityByDir[shape.directionId] = shape.priority;
    }
    const shapesToDraw = candidates.filter(s => s.priority === maxPriorityByDir[s.directionId]);
    const color = `#${routeColor}`;

    const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
    for (const shape of shapesToDraw) {
      const decoded = Polyline.decode(shape.polyline);
      if (!decoded.length) continue;
      features.push({
        type: 'Feature',
        properties: { routeColor: color },
        // @mapbox/polyline decodes as [lat, lng]; GeoJSON requires [lng, lat]
        geometry: { type: 'LineString', coordinates: decoded.map(([lat, lng]) => [lng, lat]) }
      });
    }

    return { type: 'FeatureCollection', features };
  }

  private stationsToGeoJson(stations: Station[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
    return {
      type: 'FeatureCollection',
      features: stations.map(s => ({
        type: 'Feature',
        properties: { id: s.id, name: s.name },
        geometry: { type: 'Point', coordinates: [s.longitude, s.latitude] }
      }))
    };
  }

  private vehiclesToGeoJson(vehicles: Vehicle[], routeColor: string): GeoJSON.FeatureCollection<GeoJSON.Point> {
    const color = `#${routeColor}`;
    return {
      type: 'FeatureCollection',
      features: vehicles.map(v => ({
        type: 'Feature',
        properties: {
          id: v.vehicleId,
          bearing: v.bearing ?? 0,
          routeColor: color,
          delayStatus: v.delayStatus ?? ''
        },
        geometry: { type: 'Point', coordinates: [v.longitude, v.latitude] }
      }))
    };
  }
}
