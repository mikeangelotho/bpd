import { createEffect, onMount, onCleanup } from 'solid-js';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { state } from '../store/appStore';

// Fix Leaflet's broken default marker icons in bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ─── CUSTOM AIRCRAFT ICON ───
function createAircraftIcon(heading: number = 0, altitude: number = 0): L.DivIcon {
  const rotation = heading || 0;
  // Color changes based on altitude
  const color = altitude < 5000 ? 'rgba(255, 167, 38, 0.9)' : 'rgba(0, 212, 255, 0.85)';
  const glow = altitude < 5000 ? 'rgba(255, 167, 38, 0.5)' : 'rgba(0, 212, 255, 0.5)';
  return L.divIcon({
    className: 'aircraft-marker',
    html: `<svg width="20" height="20" viewBox="0 0 20 20" style="transform: rotate(${rotation}deg); filter: drop-shadow(0 0 4px ${glow});">
      <path d="M10 2 L12 8 L18 10 L12 12 L10 18 L8 12 L2 10 L8 8 Z" fill="${color}" stroke="${glow}" stroke-width="0.5"/>
    </svg>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

// ─── WEATHER STATION ICON ───
function createWeatherIcon(temp: number, condition: string): L.DivIcon {
  const emoji = condition.includes('rain') ? '🌧' : condition.includes('cloud') ? '☁️' : condition.includes('clear') ? '☀️' : '🌡';
  return L.divIcon({
    className: 'weather-marker',
    html: `<div style="background: rgba(10,10,26,0.85); border: 1px solid rgba(198,40,170,0.4); border-radius: 4px; padding: 3px 6px; font-size: 10px; font-family: 'JetBrains Mono', monospace; color: #e91e9c; white-space: nowrap; pointer-events: auto;">
      ${emoji} ${temp}°C
    </div>`,
    iconSize: [65, 22],
    iconAnchor: [32, 11],
  });
}

// Export map instance accessor
let mapInstance: L.Map | null = null;
export function getMapInstance(): L.Map | null {
  return mapInstance;
}

export function MapBackgroundComponent() {
  let mapContainer: HTMLDivElement | undefined;
  let map: L.Map | null = null;
  let aircraftLayer: L.LayerGroup | null = null;
  let weatherLayer: L.LayerGroup | null = null;

  onMount(() => {
    if (!mapContainer) return;

    map = L.map(mapContainer, {
      center: [40.7128, -74.0060],
      zoom: 5,
      zoomControl: false,
      attributionControl: false,
      minZoom: 2,
      maxZoom: 18,
    });

    // Dark tile layer (CartoDB Dark Matter)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      opacity: 0.55,
    }).addTo(map);

    // Layer groups for overlays
    aircraftLayer = L.layerGroup().addTo(map);
    weatherLayer = L.layerGroup().addTo(map);

    // Zoom control
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    mapInstance = map;
  });

  // ─── RENDER AIRCRAFT FROM STORE ───
  createEffect(() => {
    if (!aircraftLayer || !map) return;

    // Read store reactively
    const watchers = { ...state.watchers };
    const allEvents: any[] = [];

    // Collect all ADS-B Exchange events
    for (const [id, w] of Object.entries(watchers)) {
      if (w.pluginId !== 'adsb-exchange') continue;
      for (const ev of w.events || []) {
        if (ev.payload.callsign || ev.payload.hex) {
          allEvents.push(ev);
        }
      }
    }

    // Deduplicate by hex
    const seen = new Map<string, any>();
    for (const ev of allEvents) {
      const hex = (ev.payload.hex as string) || '';
      if (!hex) continue;
      // Keep the most recent event for each hex
      const existing = seen.get(hex);
      if (!existing || ev.timestamp > existing.timestamp) {
        seen.set(hex, ev);
      }
    }

    aircraftLayer.clearLayers();

    for (const [hex, ev] of seen) {
      const lat = ev.payload.latitude as number | undefined;
      const lon = ev.payload.longitude as number | undefined;
      if (lat == null || lon == null) continue;

      const callsign = (ev.payload.callsign as string) || hex;
      const altitude = (ev.payload.altitude as number) || 0;
      const heading = (ev.payload.heading as number) || 0;
      const speed = (ev.payload.speed as number) || 0;
      const squawk = (ev.payload.squawk as string) || '';
      const reg = (ev.payload.registration as string) || '';

      const popupContent = `
        <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #e0e0e0; background: rgba(10,10,26,0.95); padding: 8px 12px; border: 1px solid rgba(0,212,255,0.3); border-radius: 4px;">
          <strong style="color: #00d4ff; font-size: 14px;">${callsign}</strong>
          ${reg ? `<span style="color: #888; margin-left: 8px;">${reg}</span>` : ''}<br/>
          <span style="color: #888;">Alt:</span> ${altitude.toLocaleString()} ft<br/>
          <span style="color: #888;">Spd:</span> ${speed} kts &nbsp; <span style="color: #888;">HDG:</span> ${heading}°<br/>
          ${squawk ? `<span style="color: #ffab26;">Squawk: ${squawk}</span><br/>` : ''}
          <span style="color: #666; font-size: 10px;">${lat.toFixed(4)}, ${lon.toFixed(4)}</span>
        </div>
      `;

      const marker = L.marker([lat, lon], {
        icon: createAircraftIcon(heading, altitude),
      }).bindPopup(popupContent, {
        closeButton: false,
        offset: [0, -10],
      });

      aircraftLayer!.addLayer(marker);
    }
  });

  // ─── RENDER WEATHER FROM STORE ───
  createEffect(() => {
    if (!weatherLayer || !map) return;

    const watchers = { ...state.watchers };
    const allEvents: any[] = [];

    for (const [id, w] of Object.entries(watchers)) {
      if (w.pluginId !== 'open-meteo') continue;
      for (const ev of w.events || []) {
        if (ev.payload.location) {
          allEvents.push(ev);
        }
      }
    }

    // Deduplicate by location name
    const seen = new Map<string, any>();
    for (const ev of allEvents) {
      const loc = (ev.payload.location as string) || '';
      if (!loc) continue;
      const existing = seen.get(loc);
      if (!existing || ev.timestamp > existing.timestamp) {
        seen.set(loc, ev);
      }
    }

    weatherLayer.clearLayers();

    for (const [loc, ev] of seen) {
      const lat = ev.payload.latitude as number | undefined;
      const lon = ev.payload.longitude as number | undefined;
      if (lat == null || lon == null) continue;

      const temp = (ev.payload.temperature as number) || 0;
      const condition = (ev.payload.condition as string) || 'unknown';
      const windspeed = (ev.payload.windspeed as number) || 0;

      const popupContent = `
        <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #e0e0e0; background: rgba(10,10,26,0.95); padding: 8px 12px; border: 1px solid rgba(198,40,170,0.3); border-radius: 4px;">
          <strong style="color: #c628aa; font-size: 13px;">${loc}</strong><br/>
          <span style="font-size: 16px;">${temp}°C</span> &nbsp; ${condition}<br/>
          <span style="color: #888;">Wind: ${windspeed} km/h</span>
        </div>
      `;

      const marker = L.marker([lat, lon], {
        icon: createWeatherIcon(temp, condition),
      }).bindPopup(popupContent, {
        closeButton: false,
        offset: [0, -11],
      });

      weatherLayer!.addLayer(marker);
    }
  });

  onCleanup(() => {
    map?.remove();
    mapInstance = null;
  });

  return (
    <div
      ref={mapContainer}
      style={{
        position: 'fixed',
        inset: 0,
        'z-index': 0,
        'pointer-events': 'auto',
      }}
    />
  );
}
