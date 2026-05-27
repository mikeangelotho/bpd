import type { WatcherPlugin, WatcherEvent } from '../types';

// ─── CORS PROXY FALLBACK ───
// OpenSky doesn't allow browser CORS, so we proxy the request.
// Try direct first (in case it's ever enabled), then fall back to proxies.
const CORS_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?',
  'https://api.codetabs.com/v1/proxy?quest=',
];

async function fetchWithCORS(url: string): Promise<Response> {
  // Try direct first
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (resp.ok) return resp;
  } catch {
    // Direct failed — try proxies
  }

  for (const proxy of CORS_PROXIES) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(proxy + encodeURIComponent(url), { signal: controller.signal });
      clearTimeout(timeoutId);
      if (resp.ok) return resp;
    } catch {
      continue;
    }
  }
  throw new Error(`All CORS proxies failed for OpenSky`);
}

// ─── AIRCRAFT DATA (OpenSky format) ───
// OpenSky returns positional arrays, not named objects.
// Column indices for /states/all endpoint:
//   0: icao24 (string)     1: callsign (string)    2: country (string)
//   3: last_position_update 4: last_contact
//   5: longitude              6: latitude            7: baro_altitude (m)
//   8: on_ground              9: velocity (m/s)     10: heading (deg)
//  11: vertical_rate (m/s)   12: sensors            13: geo_altitude (m)
//  14: squawk                15: spi                16: position_source
interface OpenSkyState {
  icao24: string;
  callsign: string;
  country: string;
  longitude: number;
  latitude: number;
  baro_altitude: number | null;
  on_ground: boolean;
  velocity: number;
  heading: number;
  vertical_rate: number;
  geo_altitude: number | null;
  squawk: string | null;
}

interface OpenSkyResponse {
  time: number;
  states: unknown[][];
}

// ─── OPENSKY NETWORK PLUGIN ───
// Free, no API key required. Anonymous tier: 10s between requests.
// Fetches aircraft within a bounding box around a center point.
// https://opensky-network.org/apidoc/rest.html
export const adsbPlugin: WatcherPlugin<{ aircraft: OpenSkyState[] }> = {
  id: 'adsb-exchange',
  name: 'OpenSky Flights',
  type: 'poll',
  defaultInterval: 30_000, // 30 seconds (respects 10s anonymous rate limit)
  configSchema: {
    lat: { type: 'number', default: 40.7128, label: 'Latitude', placeholder: 'Center latitude' },
    lon: { type: 'number', default: -74.006, label: 'Longitude', placeholder: 'Center longitude' },
    radius: { type: 'number', default: 1.0, label: 'Radius (degrees)', placeholder: '~1.0 ≈ 111km / 60nm at equator' },
    minAltitude: { type: 'number', default: 0, label: 'Min altitude (ft)', placeholder: 'Filter aircraft below this altitude' },
  },

  async fetch(config) {
    const schema = this.configSchema as Record<string, { default?: unknown }>;
    const merged: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(schema)) {
      merged[key] = (config[key] !== undefined && config[key] !== '') ? config[key] : field.default;
    }

    const lat = Number(merged.lat) || 40.7128;
    const lon = Number(merged.lon) || -74.006;
    const radius = Number(merged.radius) || 1.0;
    const minAltitude = Number(merged.minAltitude) || 0;

    // OpenSky uses bounding boxes (not radius). Convert degrees radius to bbox.
    const lamin = lat - radius;
    const laminClamped = Math.max(lamin, -90);
    const lamax = lat + radius;
    const lamaxClamped = Math.min(lamax, 90);
    const lomin = lon - radius;
    const lomax = lon + radius;

    // Use Vite dev proxy in development (/api/opensky -> https://opensky-network.org/api)
    // In production, falls back to CORS proxies
    const devPath = `/api/opensky/states/all?lamin=${laminClamped}&lomin=${lomin}&lamax=${lamaxClamped}&lomax=${lomax}`;
    const directUrl = `https://opensky-network.org/api/states/all?lamin=${laminClamped}&lomin=${lomin}&lamax=${lamaxClamped}&lomax=${lomax}`;

    async function fetchOpenSky(): Promise<Response> {
      // Try dev proxy first (works when running `vite dev`)
      try {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), 8000);
        const resp = await fetch(devPath, { signal: c.signal });
        clearTimeout(t);
        if (resp.ok) return resp;
        // 404 from dev proxy means we're in production
      } catch {
        // Dev proxy unavailable (production build)
      }
      // Fall back to CORS proxy chain
      return fetchWithCORS(directUrl);
    }

    try {
      const resp = await fetchOpenSky();

      if (!resp.ok) {
        if (resp.status === 429) {
          throw new Error('OpenSky rate limit (anonymous: 1 req/10s). Wait or create a free account for 1 req/5s.');
        }
        throw new Error(`OpenSky returned HTTP ${resp.status}`);
      }

      const data: OpenSkyResponse = await resp.json();
      const raw = data.states || [];

      // Convert positional arrays to typed objects
      const aircraft: OpenSkyState[] = [];
      for (const s of raw) {
        if (s.length < 17) continue;

        const latVal = s[6];
        const lonVal = s[5];
        if (latVal == null || lonVal == null) continue;

        const baroAltM = s[7] as number | null;
        const geoAltM = s[13] as number | null;
        const altFt = (baroAltM ?? geoAltM ?? 0) * 3.28084;

        // Filter by minimum altitude
        if (altFt < minAltitude) continue;

        // Filter out ground vehicles
        const onGround = s[8] as boolean;
        if (onGround) continue;

        aircraft.push({
          icao24: (s[0] as string) || '',
          callsign: ((s[1] as string) || '').trim(),
          country: (s[2] as string) || '',
          longitude: lonVal as number,
          latitude: latVal as number,
          baro_altitude: baroAltM,
          on_ground: onGround,
          velocity: (s[9] as number) || 0,
          heading: (s[10] as number) || 0,
          vertical_rate: (s[11] as number) || 0,
          geo_altitude: geoAltM,
          squawk: (s[14] as string | null) || null,
        });
      }

      return { aircraft };
    } catch (e: any) {
      if (e.name === 'AbortError') throw new Error('OpenSky fetch timed out');
      throw e;
    }
  },

  parse(raw, _config) {
    const events: WatcherEvent[] = [];
    const now = Date.now();

    for (const ac of raw.aircraft) {
      const altM = ac.baro_altitude ?? ac.geo_altitude ?? 0;
      const altFt = altM * 3.28084;
      const speedKts = ac.velocity * 1.94384; // m/s → knots

      events.push({
        id: `adsb-${ac.icao24}-${now}-${Math.random().toString(36).slice(2, 6)}`,
        watcherId: '',
        timestamp: now,
        type: 'data',
        severity: altFt < 5000 ? 'warn' : 'info',
        payload: {
          callsign: ac.callsign || ac.icao24 || 'unknown',
          hex: ac.icao24,
          latitude: ac.latitude,
          longitude: ac.longitude,
          altitude: Math.round(altFt),
          heading: Math.round(ac.heading),
          speed: Math.round(speedKts),
          verticalRate: Math.round(ac.vertical_rate * 196.85), // m/s → ft/min
          category: '',
          squawk: ac.squawk || '',
          registration: '',
          type: '',
          country: ac.country,
        },
      });
    }

    return events;
  },
};
