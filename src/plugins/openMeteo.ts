import type { WatcherPlugin, WatcherEvent } from '../types';

// ─── OPEN-METEO WEATHER PLUGIN ───
// Free, no API key required. Shows current weather conditions.
// https://open-meteo.com/en/docs
export const weatherPlugin: WatcherPlugin<{ locations: any[] }> = {
  id: 'open-meteo',
  name: 'Open-Meteo Weather',
  type: 'poll',
  defaultInterval: 300_000, // 5 minutes
  configSchema: {
    locations: { type: 'string', default: 'New York:40.71:-74.01', label: 'Locations', placeholder: 'Name:lat:lon, one per line (e.g., Tokyo:35.68:139.69)' },
  },

  async fetch(config) {
    const schema = this.configSchema as Record<string, { default?: unknown }>;
    const merged: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(schema)) {
      merged[key] = (config[key] !== undefined && config[key] !== '') ? config[key] : field.default;
    }

    const locationsRaw = (merged.locations as string) || 'New York:40.71:-74.01';
    const locations: { name: string; lat: number; lon: number }[] = [];

    for (const line of locationsRaw.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const parts = line.split(':');
      if (parts.length < 3) continue;
      const name = parts[0];
      const lat = parseFloat(parts[1]);
      const lon = parseFloat(parts[2]);
      if (isNaN(lat) || isNaN(lon)) continue;
      locations.push({ name, lat, lon });
    }

    if (locations.length === 0) throw new Error('No valid locations configured. Use format: Name:lat:lon');

    // Fetch all locations in parallel
    const results = await Promise.all(
      locations.map(async (loc) => {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current_weather=true&timezone=auto`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Open-Meteo HTTP ${resp.status} for ${loc.name}`);
        const data = await resp.json();
        return { location: loc.name, lat: loc.lat, lon: loc.lon, data: data.current_weather };
      })
    );

    return { locations: results };
  },

  parse(raw, _config) {
    const events: WatcherEvent[] = [];
    const now = Date.now();

    // WMO weather code descriptions
    const weatherDescriptions: Record<number, string> = {
      0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
      45: 'fog', 48: 'depositing rime fog',
      51: 'light drizzle', 53: 'drizzle', 55: 'dense drizzle',
      61: 'light rain', 63: 'rain', 65: 'heavy rain',
      71: 'light snow', 73: 'snow', 75: 'heavy snow',
      80: 'light showers', 81: 'showers', 82: 'heavy showers',
      95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'severe thunderstorm',
    };

    for (const loc of raw.locations) {
      const w = loc.data;
      const condition = weatherDescriptions[w.weathercode] || 'unknown';

      events.push({
        id: `weather-${loc.location.replace(/\s+/g, '-').toLowerCase()}-${now}`,
        watcherId: '',
        timestamp: now,
        type: 'data',
        severity: w.weathercode >= 95 ? 'warn' : w.weathercode >= 61 ? 'info' : 'info',
        payload: {
          location: loc.location,
          latitude: loc.lat,
          longitude: loc.lon,
          temperature: Math.round(w.temperature * 10) / 10,
          windspeed: Math.round(w.windspeed),
          winddirection: w.winddirection,
          weathercode: w.weathercode,
          condition,
          isDay: w.is_day === 1,
        },
      });
    }

    return events;
  },
};
