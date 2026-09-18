/**
 * PulseRoute Map Engine — Multi-Mission Fleet Visualization
 *
 * Features:
 * - Multi-mission routes with distinct colors per ambulance
 * - Google Maps-style animated destination pin marker
 * - Phase-aware preemption (disabled on to_base leg)
 * - Driver icon layer for all registered units
 * - Roadblocks rendered at top z-index
 * - Smooth 60fps ambulance interpolation per mission
 */

import React, { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import wsClient from '../../services/websocket-client';
import { driverStore } from '../../services/driver-store';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const MUMBAI_CENTER = [72.8777, 19.0176];
const TMC_ZOOM     = 11.5;
const TMC_PITCH    = 45;
const TMC_BEARING  = -10;
const DARK_MATTER_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// Distinct colors per mission slot (cycles if more than 6)
const MISSION_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

function getMissionColor(index) {
  return MISSION_COLORS[index % MISSION_COLORS.length];
}

function decodePolyline(encoded) {
  const coords = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let shift = 0, result = 0, b;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;
    coords.push([lng / 1e5, lat / 1e5]);
  }
  return coords;
}

const lerp = (a, b, t) => a + (b - a) * t;

const makeIdFilter = (ids) =>
  ids.length > 0
    ? ['in', 'intersection_id', ...ids]
    : ['==', 'intersection_id', '__NONE__'];

// Creates the destination pin HTML element (Google Maps style)
function createDestinationPinEl(color = '#e03131') {
  const el = document.createElement('div');
  el.style.cssText = `
    width: 32px; height: 40px;
    position: relative;
    cursor: pointer;
  `;
  el.innerHTML = `
    <svg viewBox="0 0 32 40" width="32" height="40" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 0C9.37 0 4 5.37 4 12c0 9 12 28 12 28s12-19 12-28c0-6.63-5.37-12-12-12z" fill="${color}"/>
      <circle cx="16" cy="12" r="5" fill="white" opacity="0.9"/>
    </svg>
    <div style="
      position: absolute; bottom: -6px; left: 50%;
      transform: translateX(-50%);
      width: 12px; height: 4px;
      background: rgba(0,0,0,0.3);
      border-radius: 50%;
      filter: blur(2px);
    "></div>
  `;
  return el;
}

// Creates driver icon element
function createDriverIconEl(driverId, color) {
  const el = document.createElement('div');
  el.style.cssText = `
    width: 36px; height: 36px;
    border-radius: 50%;
    background: ${color};
    border: 2.5px solid white;
    display: flex; align-items: center; justify-content: center;
    font-size: 9px; font-weight: 700; color: white;
    font-family: monospace;
    box-shadow: 0 2px 8px rgba(0,0,0,0.5);
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0 2px;
  `;
  el.textContent = driverId.length > 5 ? driverId.slice(0, 5) : driverId;
  el.title = driverId;
  return el;
}

export default function MapEngine({ isRoadblockModeActive, onRoadblockPlaced, recenterTrigger, watchMissionId }) {
  const containerRef         = useRef(null);
  const mapRef               = useRef(null);
  const mapLoadedRef         = useRef(false);

  // Per-mission tracking
  const missionIndexRef      = useRef({}); // mission_id -> color index
  const missionCountRef      = useRef(0);
  const missionPhaseRef      = useRef({}); // mission_id -> current_phase
  const missionMarkersRef    = useRef({}); // mission_id -> mapboxgl.Marker (destination pin)
  const animStateRef         = useRef({}); // mission_id -> { prev, target, lastTime }

  // Signal state
  const signalStateRef       = useRef({});
  const orangeTimersRef      = useRef({});
  const flashTimerRef        = useRef(null);

  // Driver markers
  const driverMarkersRef     = useRef({}); // driver_id -> mapboxgl.Marker

  // Roadblock mode ref
  const roadblockActiveRef   = useRef(isRoadblockModeActive);
  useEffect(() => { roadblockActiveRef.current = isRoadblockModeActive; }, [isRoadblockModeActive]);

  // Recenter effect
  useEffect(() => {
    if (!recenterTrigger || !mapRef.current) return;
    // Find the ambulance position for the watched mission
    const state = animStateRef.current[watchMissionId];
    if (state?.target) {
      mapRef.current.flyTo({ center: state.target, zoom: 15, speed: 1.5 });
    }
  }, [recenterTrigger, watchMissionId]);

  // Helper: ensure per-mission sources/layers exist
  const ensureMissionLayers = (map, missionId) => {
    if (!map.getSource(`ambulance-${missionId}`)) {
      const colorIdx = missionCountRef.current++;
      missionIndexRef.current[missionId] = colorIdx;
      const color = getMissionColor(colorIdx);

      map.addSource(`ambulance-${missionId}`, {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'Point', coordinates: MUMBAI_CENTER } }
      });

      // Halo
      map.addLayer({
        id: `amb-halo-${missionId}`,
        type: 'circle',
        source: `ambulance-${missionId}`,
        paint: { 'circle-radius': 20, 'circle-color': color, 'circle-opacity': 0.2, 'circle-blur': 1 }
      }, 'roadblocks-layer'); // Insert below roadblocks

      // Core circle
      map.addLayer({
        id: `amb-core-${missionId}`,
        type: 'circle',
        source: `ambulance-${missionId}`,
        paint: { 'circle-radius': 8, 'circle-color': color, 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff', 'circle-opacity': 1 }
      }, 'roadblocks-layer');

      // Route line source + layer
      map.addSource(`route-${missionId}`, {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } }
      });

      map.addLayer({
        id: `route-line-${missionId}`,
        type: 'line',
        source: `route-${missionId}`,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': color, 'line-width': 4, 'line-opacity': 0.85, 'line-dasharray': [2, 1] }
      }, 'roadblocks-layer');

      // Init animation state
      animStateRef.current[missionId] = {
        prev: MUMBAI_CENTER,
        target: MUMBAI_CENTER,
        lastTime: Date.now()
      };
    }
  };

  // Main map initialization
  useEffect(() => {
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: DARK_MATTER_STYLE,
      center: MUMBAI_CENTER,
      zoom: TMC_ZOOM,
      pitch: TMC_PITCH,
      bearing: TMC_BEARING,
      antialias: true,
    });
    mapRef.current = map;

    map.on('load', () => {
      mapLoadedRef.current = true;

      // ── Intersection node layers ────────────────────────────────────────────
      map.addSource('intersections', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      // Glow halo behind each node (always visible, low opacity)
      map.addLayer({
        id: 'intersections-glow', type: 'circle', source: 'intersections',
        paint: { 'circle-radius': 14, 'circle-color': '#c92a2a', 'circle-opacity': 0.18, 'circle-blur': 1 }
      });
      // Red state
      map.addLayer({
        id: 'intersections-red', type: 'circle', source: 'intersections',
        filter: makeIdFilter([]),
        paint: {
          'circle-radius': 8,
          'circle-color': '#c92a2a',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ff6b6b',
          'circle-opacity': 0.95
        }
      });
      // Green state
      map.addLayer({
        id: 'intersections-green', type: 'circle', source: 'intersections',
        filter: makeIdFilter([]),
        paint: {
          'circle-radius': 10,
          'circle-color': '#2b8a3e',
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#51cf66',
          'circle-opacity': 1
        }
      });
      // Orange flashing state
      map.addLayer({
        id: 'intersections-orange', type: 'circle', source: 'intersections',
        filter: makeIdFilter([]),
        paint: {
          'circle-radius': 10,
          'circle-color': '#f08c00',
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#ffd43b',
          'circle-opacity': 1
        }
      });
      // Traffic light emoji label on every node
      map.addLayer({
        id: 'intersections-icon', type: 'symbol', source: 'intersections',
        layout: {
          'text-field': '🚦',
          'text-size': 16,
          'text-offset': [0, -1.8],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        }
      });

      // ── Roadblocks layer — added LAST so it's always on top ────────────────
      map.addSource('roadblocks', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addLayer({
        id: 'roadblocks-layer',
        type: 'circle',
        source: 'roadblocks',
        paint: {
          'circle-radius': 10,
          'circle-color': '#e03131',
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#ff8787',
          'circle-opacity': 0.95
        }
      });

      // Roadblock text label
      map.addLayer({
        id: 'roadblocks-label',
        type: 'symbol',
        source: 'roadblocks',
        layout: {
          'text-field': '⛔',
          'text-size': 14,
          'text-offset': [0, -2],
          'text-allow-overlap': true
        }
      });

      // ── Click handler ────────────────────────────────────────────────────────
      map.on('click', (e) => {
        if (!roadblockActiveRef.current) return;
        const { lng, lat } = e.lngLat;
        wsClient.send({ lat, lng, type: 'OBSTRUCTION' });
        onRoadblockPlaced?.();
      });

      map.on('mousemove', () => {
        map.getCanvas().style.cursor = roadblockActiveRef.current ? 'crosshair' : '';
      });

      // ── rAF smooth movement loop (per-mission) ───────────────────────────────
      const animate = () => {
        const now = Date.now();
        for (const [missionId, state] of Object.entries(animStateRef.current)) {
          const elapsed = now - state.lastTime;
          const t = Math.min(elapsed / 1000, 1);
          const lng = lerp(state.prev[0], state.target[0], t);
          const lat = lerp(state.prev[1], state.target[1], t);
          if (map.getSource(`ambulance-${missionId}`)) {
            map.getSource(`ambulance-${missionId}`).setData({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [lng, lat] }
            });
          }
        }
        requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);

      // ── Flashing orange signal loop ──────────────────────────────────────────
      let flashOn = true;
      flashTimerRef.current = setInterval(() => {
        flashOn = !flashOn;
        if (map.getLayer('intersections-orange')) {
          map.setPaintProperty('intersections-orange', 'circle-opacity', flashOn ? 1 : 0.15);
        }
      }, 500);

      // ── Sync existing drivers from store (fixes disappearing markers on page switch) ──
      // driverStore is a module singleton — data persists across React remounts.
      // But Mapbox markers are destroyed with the map, so we rebuild them after load.
      for (const driver of driverStore.getAll()) {
        if (driver.lat && driver.lng && !isNaN(driver.lat) && !isNaN(driver.lng)) {
          _upsertDriverMarker(driver.id, [driver.lng, driver.lat], map);
        }
      }

      // ── Request full state AFTER map is ready (fixes traffic lights disappearing) ──
      // Requesting state before map.on('load') fires means the replayed MISSION_START
      // events arrive while mapLoadedRef.current is still false, silently dropping
      // all route drawing and node generation calls.
      setTimeout(() => {
        wsClient.send({ request_state: true });
      }, 100);

    });

    // ── WS Event Listeners ──────────────────────────────────────────────────────

    const unsubMission = wsClient.on('MISSION_START', (payload) => {
      const { mission_id, leg_to_incident, incident_coords, hospital_coords, current_phase } = payload;
      if (!mapRef.current || !mapLoadedRef.current) return;

      missionPhaseRef.current[mission_id] = current_phase || 'to_incident';
      ensureMissionLayers(mapRef.current, mission_id);

      // Draw route for current phase
      const activeLeg = current_phase === 'to_hospital' ? payload.leg_to_hospital
        : current_phase === 'to_base' ? payload.leg_to_base
        : leg_to_incident;

      if (activeLeg) {
        const coords = decodePolyline(activeLeg);
        mapRef.current.getSource(`route-${mission_id}`)?.setData({
          type: 'Feature', geometry: { type: 'LineString', coordinates: coords }
        });

        // Generate intersection nodes from the current leg
        _generateNodes(mapRef.current, signalStateRef, coords, mission_id);


        // Fly to route start
        if (coords.length > 0) {
          mapRef.current.flyTo({ center: coords[0], zoom: 13, speed: 1.2 });
        }
      }

      // Place destination pin at incident location
      if (incident_coords) {
        _upsertDestinationMarker(mission_id, [incident_coords.lng, incident_coords.lat], getMissionColor(missionIndexRef.current[mission_id] ?? 0));
      }
    });

    const unsubPhase = wsClient.on('PHASE_CHANGE', ({ mission_id, new_phase }) => {
      if (!mapRef.current || !mapLoadedRef.current) return;
      missionPhaseRef.current[mission_id] = new_phase;
      // Phase change doesn't need a full route redraw here — ROUTE_UPDATED handles that
    });

    const unsubTelemetry = wsClient.on('TELEMETRY_UPDATE', ({ mission_id, lat, lng }) => {
      const state = animStateRef.current[mission_id];
      if (state) {
        state.prev = state.target;
        state.target = [lng, lat];
        state.lastTime = Date.now();
      }
    });

    const unsubRoute = wsClient.on('ROUTE_UPDATED', ({ mission_id, new_polyline }) => {
      if (!mapRef.current || !mapLoadedRef.current || !new_polyline) return;
      const coords = decodePolyline(new_polyline);
      mapRef.current.getSource(`route-${mission_id}`)?.setData({
        type: 'Feature', geometry: { type: 'LineString', coordinates: coords }
      });
      _generateNodes(mapRef.current, signalStateRef, coords, mission_id);
    });

    const unsubIncident = wsClient.on('INCIDENT_LOGGED', ({ lat, lng }) => {
      const map = mapRef.current;
      if (!map || !mapLoadedRef.current) return;
      const existing = map.getSource('roadblocks')?._data;
      const newFeatures = [
        ...(existing?.features || []),
        { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] } }
      ];
      map.getSource('roadblocks')?.setData({ type: 'FeatureCollection', features: newFeatures });
    });

    const unsubPreempt = wsClient.on('SIGNAL_PREEMPT', ({ intersection_id, mission_id }) => {
      // Skip preemption if mission is on return-to-base leg
      if (mission_id && missionPhaseRef.current[mission_id] === 'to_base') return;
      const map = mapRef.current;
      if (!map || !mapLoadedRef.current) return;
      signalStateRef.current[intersection_id] = 'GREEN';
      _applySignalFilters(map, signalStateRef.current);
    });

    const unsubRelease = wsClient.on('SIGNAL_RELEASE', ({ intersection_id }) => {
      const map = mapRef.current;
      if (!map || !mapLoadedRef.current) return;
      signalStateRef.current[intersection_id] = 'RELEASING';
      _applySignalFilters(map, signalStateRef.current);
      clearTimeout(orangeTimersRef.current[intersection_id]);
      orangeTimersRef.current[intersection_id] = setTimeout(() => {
        signalStateRef.current[intersection_id] = 'RED';
        _applySignalFilters(mapRef.current, signalStateRef.current);
      }, 3000);
    });

    const unsubDriver = wsClient.on('DRIVER_REGISTERED', ({ driver_id, lat, lng }) => {
      driverStore.addOrUpdate(driver_id, lat, lng);
      _upsertDriverMarker(driver_id, [lng, lat], mapRef.current);
    });

    // Sync driver markers from store on mount
    const unsubStore = driverStore.subscribe((allDrivers) => {
      if (!mapRef.current || !mapLoadedRef.current) return;
      for (const driver of allDrivers) {
        _upsertDriverMarker(driver.id, [driver.lng, driver.lat], mapRef.current);
      }
    });

    return () => {
      unsubMission(); unsubPhase(); unsubTelemetry(); unsubRoute();
      unsubIncident(); unsubPreempt(); unsubRelease(); unsubDriver();
      unsubStore();
      clearInterval(flashTimerRef.current);
      Object.values(orangeTimersRef.current).forEach(clearTimeout);
      Object.values(missionMarkersRef.current).forEach(m => m.remove());
      Object.values(driverMarkersRef.current).forEach(m => m.remove());
      map.remove();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Helpers ---

  function _upsertDestinationMarker(missionId, lngLat, color) {
    if (!mapRef.current) return;
    missionMarkersRef.current[missionId]?.remove();
    const el = createDestinationPinEl(color);
    const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat(lngLat)
      .addTo(mapRef.current);
    missionMarkersRef.current[missionId] = marker;
  }

  function _upsertDriverMarker(driverId, lngLat, map) {
    if (!map || !mapLoadedRef.current || !lngLat[0] || !lngLat[1]) return;
    if (isNaN(lngLat[0]) || isNaN(lngLat[1])) return;

    if (driverMarkersRef.current[driverId]) {
      driverMarkersRef.current[driverId].setLngLat(lngLat);
    } else {
      // Assign a color based on driver index
      const allDriverIds = driverStore.getAll().map(d => d.id);
      const idx = allDriverIds.indexOf(driverId);
      const color = getMissionColor(idx >= 0 ? idx : 0);
      const el = createDriverIconEl(driverId, color);
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat(lngLat)
        .setPopup(new mapboxgl.Popup({ offset: 20 }).setHTML(`<strong>${driverId}</strong>`))
        .addTo(map);
      driverMarkersRef.current[driverId] = marker;
    }
  }

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%' }}
      id="tmc-map-container"
    />
  );
}

function _generateNodes(map, signalStateRef, coords, missionId) {
  // Need at least 2 points to generate meaningful nodes
  if (!map || !map.loaded() || coords.length < 2) return;

  // Use mission-scoped IDs so multiple missions don't overwrite each other's nodes
  const prefix = missionId ? `m${missionId.replace(/[^a-zA-Z0-9]/g, '')}-node` : 'node';
  const newFeatures = [];
  const addedState = {};
  // Use 10 nodes per route (was 6) for better coverage of intersections
  const step = Math.max(1, Math.floor(coords.length / 10));
  let nodeIdx = 1;
  for (let i = step; i < coords.length - 1; i += step) {
    const id = `${prefix}-${nodeIdx++}`;
    newFeatures.push({
      type: 'Feature',
      properties: { intersection_id: id, signal_phase: 'RED' },
      geometry: { type: 'Point', coordinates: coords[i] }
    });
    addedState[id] = 'RED';
  }

  // Merge with existing signal state (accumulate, don't replace)
  const existing = map.getSource('intersections')?._data?.features || [];
  const existingMissionIds = new Set(newFeatures.map(f => f.properties.intersection_id));
  const retained = existing.filter(f => !existingMissionIds.has(f.properties.intersection_id));
  signalStateRef.current = { ...signalStateRef.current, ...addedState };

  map.getSource('intersections')?.setData({
    type: 'FeatureCollection',
    features: [...retained, ...newFeatures]
  });
  _applySignalFilters(map, signalStateRef.current);
}

function _applySignalFilters(map, signalState) {
  if (!map || !map.loaded()) return;
  const redIds = [], greenIds = [], orangeIds = [];
  Object.entries(signalState).forEach(([id, phase]) => {
    if (phase === 'RED') redIds.push(id);
    else if (phase === 'GREEN') greenIds.push(id);
    else if (phase === 'RELEASING') orangeIds.push(id);
  });
  if (map.getLayer('intersections-red'))    map.setFilter('intersections-red',    makeIdFilter(redIds));
  if (map.getLayer('intersections-green'))  map.setFilter('intersections-green',  makeIdFilter(greenIds));
  if (map.getLayer('intersections-orange')) map.setFilter('intersections-orange', makeIdFilter(orangeIds));
}
