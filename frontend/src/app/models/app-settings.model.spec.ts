import { AppSettingsSchema } from './app-settings.model';

describe('AppSettingsSchema', () => {
  it('parses a fully valid settings object', () => {
    const result = AppSettingsSchema.parse({
      selectedRoute: 'Orange',
      selectedStation: 'Back Bay',
      mapCenter: { lat: 42.36, lng: -71.05 },
      mapZoom: 11.5,
      routesPanelVisible: true,
    });
    expect(result.selectedRoute).toBe('Orange');
    expect(result.mapZoom).toBe(11.5);
  });

  it('salvages siblings when one field is corrupt', () => {
    const result = AppSettingsSchema.parse({
      selectedRoute: 'Red',
      mapZoom: 'banana',
    });
    expect(result.selectedRoute).toBe('Red');   // survives
    expect(result.mapZoom).toBeUndefined();     // degrades to unset
  });

  it('accepts null route/station (the app writes null on deselection)', () => {
    const result = AppSettingsSchema.parse({ selectedRoute: null, selectedStation: null });
    expect(result.selectedRoute).toBeNull();
  });

  it('degrades a corrupt mapCenter without losing the route', () => {
    const result = AppSettingsSchema.parse({
      selectedRoute: 'Blue',
      mapCenter: { lat: 'x', lng: -71 },
    });
    expect(result.selectedRoute).toBe('Blue');
    expect(result.mapCenter).toBeUndefined();
  });

  it('rejects non-object roots (caller falls back to null)', () => {
    expect(AppSettingsSchema.safeParse('garbage').success).toBeFalse();
    expect(AppSettingsSchema.safeParse(null).success).toBeFalse();
    expect(AppSettingsSchema.safeParse([1, 2]).success).toBeFalse();
  });
});
