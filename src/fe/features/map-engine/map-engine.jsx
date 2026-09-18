/**
 * Map Engine — Phase-Aware Route Display
 *
 * - Displays only the CURRENT leg's route (switches on PHASE_CHANGE)
 * - Traffic lights are generated from the current route leg
 * - Roadblocks are rendered as red circles
 * - Ambulance smoothly interpolates between GPS ticks
 */

import React, { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import wsClient from '../../services/websocket-client';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const MUMBAI_CENTER = [72.8777, 19.0176]; // [lng, lat]
const TMC_ZOOM    = 11.5;
const TMC_PITCH   = 45;
const TMC_BEARING = -10;

const DARK_MATTER_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// Ambulance SVG base64
const AMBULANCE_SVG_B64 = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4NCiAgPCEtLSBWZWhpY2xlIEJvZHkgLS0+DQogIDxyZWN0IHg9IjgiIHk9IjI0IiB3aWR0aD0iNDgiIGhlaWdodD0iMjQiIHJ4PSI0IiBmaWxsPSIjZmZmZmZmIi8+DQogIDxyZWN0IHg9IjQyIiB5PSIzMiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiByeD0iMiIgZmlsbD0iI2UwZTBlMCIvPg0KICA8IS0tIFdpbmRvd3MgLS0+DQogIDxyZWN0IHg9IjQ0IiB5PSIyNiIgd2lkdGg9IjEwIiBoZWlnaHQ9IjgiIHJ4PSIxIiBmaWxsPSIjNGFkZTgwIi8+DQogIDwhLS0gQ3Jvc3MgLS0+DQogIDxyZWN0IHg9IjIyIiB5PSIyOCIgd2lkdGg9IjQiIGhlaWdodD0iMTYiIHJ4PSIxIiBmaWxsPSIjZWY0NDQ0Ii8+DQogIDxyZWN0IHg9IjE2IiB5PSIzNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjQiIHJ4PSIxIiBmaWxsPSIjZWY0NDQ0Ii8+DQogIDwhLS0gV2hlZWxzIC0tPg0KICA8Y2lyY2xlIGN4PSIxOCIgY3k9IjQ4IiByPSI2IiBmaWxsPSIjMWYyOTM3Ii8+DQogIDxjaXJjbGUgY3g9IjQ2IiBjeT0iNDgiIHI9IjYiIGZpbGw9IiMxZjI5MzciLz4NCiAgPGNpcmNsZSBjeD0iMTgiIGN5PSI0OCIgcj0iMyIgZmlsbD0iIzljYTNhZiIvPg0KICA8Y2lyY2xlIGN4PSI0NiIgY3k9IjQ4IiByPSIzIiBmaWxsPSIjOWNhM2FmIi8+DQogIDwhLS0gTGlnaHRiYXIgLS0+DQogIDxyZWN0IHg9IjE2IiB5PSIyMCIgd2lkdGg9IjgiIGhlaWdodD0iNCIgcng9IjIiIGZpbGw9IiNlZjQ0NDQiLz4NCiAgPHJlY3QgeD0iMjYiIHk9IjIwIiB3aWR0aD0iOCIgaGVpZ2h0PSI0IiByeD0iMiIgZmlsbD0iIzNiODJmNiIvPg0KPC9zdmc+DQo=';

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
    coords.push([lng / 1e5, lat / 1e5]); // [lng, lat]
  }
  return coords;
}

const lerp = (a, b, t) => a + (b - a) * t;

const makeIdFilter = (ids) =>
  ids.length > 0 ? ['in', 'intersection_id', ...ids] : ['==', 'intersection_id', '__NONE__'];

// Generate intersection node features from a decoded coord array
function generateNodeFeatures(coords) {
  const features = [];
  const step = Math.max(1, Math.floor(coords.length / 8));
  let nodeId = 1;
  for (let i = step; i < coords.length - 1; i += step) {
    features.push({
      type: 'Feature',
      properties: { intersection_id: `node-${nodeId}`, signal_phase: 'RED' },
      geometry: { type: 'Point', coordinates: coords[i] }
    });
    nodeId++;
  }
  return features;
}

export default function MapEngine({ isRoadblockModeActive, onRoadblockPlaced, recenterTrigger }) {
  const containerRef   = useRef(null);
  const mapRef         = useRef(null);
  const animFrameRef   = useRef(null);
  const flashTimerRef  = useRef(null);

  const prevPosRef        = useRef(MUMBAI_CENTER);
  const targetPosRef      = useRef(MUMBAI_CENTER);
  const lastTelemetryRef  = useRef(Date.now());

  const signalStateRef    = useRef({});
  const orangeTimersRef   = useRef({});
  const roadblocksRef     = useRef({ type: 'FeatureCollection', features: [] });
  const roadblockActiveRef = useRef(isRoadblockModeActive);

  // Store all 3 legs so we can switch on PHASE_CHANGE
  const legsRef = useRef({ to_incident: [], to_hospital: [], to_base: [] });
  const mapReadyRef = useRef(false);
  const pendingMissionRef = useRef(null);

  useEffect(() => { roadblockActiveRef.current = isRoadblockModeActive; }, [isRoadblockModeActive]);

  useEffect(() => {
    if (recenterTrigger && mapRef.current) {
      mapRef.current.flyTo({ center: targetPosRef.current, zoom: 16, speed: 1.5 });
    }
  }, [recenterTrigger]);

  // Helper: display the route for a given phase
  const displayLeg = (phase) => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    const coords = legsRef.current[phase];
    if (!coords || coords.length === 0) return;

    map.getSource('route')?.setData({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords }
    });

    // Fly to start of new leg
    map.flyTo({ center: coords[0], zoom: 13, speed: 1.2 });

    // Regenerate traffic light nodes for this leg
    const features = generateNodeFeatures(coords);
    const newSignalState = {};
    features.forEach(f => { newSignalState[f.properties.intersection_id] = 'RED'; });
    signalStateRef.current = newSignalState;
    map.getSource('intersections')?.setData({ type: 'FeatureCollection', features });
    applySignalFilters(map, signalStateRef.current);
  };

  useEffect(() => {
    signalStateRef.current = {};

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
      mapReadyRef.current = true;

      // ── Ambulance source ──────────────────────────────────────────────────
      map.addSource('ambulance', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Point', coordinates: MUMBAI_CENTER } } });
      map.addLayer({ id: 'ambulance-halo', type: 'circle', source: 'ambulance', paint: { 'circle-radius': 18, 'circle-color': '#10b981', 'circle-opacity': 0.25, 'circle-blur': 1 } });

      const ambulanceImg = new Image(64, 64);
      ambulanceImg.onload = () => {
        if (!map.hasImage('ambulance-icon')) map.addImage('ambulance-icon', ambulanceImg);
        map.addLayer({ id: 'ambulance-core', type: 'symbol', source: 'ambulance', layout: { 'icon-image': 'ambulance-icon', 'icon-size': 0.7, 'icon-allow-overlap': true } });
      };
      ambulanceImg.src = AMBULANCE_SVG_B64;

      // ── Route line ─────────────────────────────────────────────────────────
      map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
      map.addLayer({
        id: 'route-line', type: 'line', source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#10b981', 'line-width': 4, 'line-opacity': 0.9 }
      });

      // ── Traffic light nodes ────────────────────────────────────────────────
      map.addSource('intersections', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'intersections-red',    type: 'circle', source: 'intersections', filter: makeIdFilter([]), paint: { 'circle-radius': 6, 'circle-color': '#c92a2a', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#ff6b6b', 'circle-opacity': 0.9 } });
      map.addLayer({ id: 'intersections-green',  type: 'circle', source: 'intersections', filter: makeIdFilter([]), paint: { 'circle-radius': 7, 'circle-color': '#2b8a3e', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#51cf66', 'circle-opacity': 1 } });
      map.addLayer({ id: 'intersections-orange', type: 'circle', source: 'intersections', filter: makeIdFilter([]), paint: { 'circle-radius': 7, 'circle-color': '#f08c00', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#ffd43b', 'circle-opacity': 1 } });

      // ── Roadblock markers ─────────────────────────────────────────────────
      map.addSource('roadblocks', { type: 'geojson', data: roadblocksRef.current });
      map.addLayer({ id: 'roadblocks-layer', type: 'circle', source: 'roadblocks', paint: { 'circle-radius': 12, 'circle-color': '#e03131', 'circle-stroke-width': 3, 'circle-stroke-color': '#ff8787', 'circle-opacity': 0.9 } });

      // ── Map click for roadblocks ───────────────────────────────────────────
      map.on('click', (e) => {
        if (!roadblockActiveRef.current) return;
        const { lng, lat } = e.lngLat;
        wsClient.send({ lat, lng, type: 'OBSTRUCTION' });
        onRoadblockPlaced?.();
      });
      map.on('mousemove', () => {
        map.getCanvas().style.cursor = roadblockActiveRef.current ? 'crosshair' : '';
      });

      // Process any mission that arrived before the map was ready
      if (pendingMissionRef.current) {
        const { legs, phase } = pendingMissionRef.current;
        legsRef.current = legs;
        displayLeg(phase);
        pendingMissionRef.current = null;
      }

      // ── Smooth ambulance animation loop ────────────────────────────────────
      const animate = () => {
        const elapsed = Date.now() - lastTelemetryRef.current;
        const t = Math.min(elapsed / 1000, 1);
        const lng = lerp(prevPosRef.current[0], targetPosRef.current[0], t);
        const lat = lerp(prevPosRef.current[1], targetPosRef.current[1], t);
        map.getSource('ambulance')?.setData({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] } });
        animFrameRef.current = requestAnimationFrame(animate);
      };
      animFrameRef.current = requestAnimationFrame(animate);

      // ── Flashing orange traffic light loop ────────────────────────────────
      let flashOn = true;
      flashTimerRef.current = setInterval(() => {
        flashOn = !flashOn;
        if (map.getLayer('intersections-orange')) {
          map.setPaintProperty('intersections-orange', 'circle-opacity', flashOn ? 1 : 0.1);
        }
      }, 500);
    });

    // ── WS listeners ──────────────────────────────────────────────────────────

    // MISSION_START: store all 3 legs and display leg 1
    const unsubMission = wsClient.on('MISSION_START', ({ leg_to_incident, leg_to_hospital, leg_to_base, current_phase }) => {
      const legs = {
        to_incident: decodePolyline(leg_to_incident),
        to_hospital: decodePolyline(leg_to_hospital),
        to_base:     decodePolyline(leg_to_base)
      };
      const phase = current_phase || 'to_incident';

      if (!mapReadyRef.current) {
        pendingMissionRef.current = { legs, phase };
        return;
      }
      legsRef.current = legs;
      displayLeg(phase);
    });

    // PHASE_CHANGE: switch to new leg on map
    const unsubPhase = wsClient.on('PHASE_CHANGE', ({ new_phase }) => {
      if (mapReadyRef.current) {
        displayLeg(new_phase);
      }
    });

    // TELEMETRY_UPDATE: move ambulance
    const unsubTelemetry = wsClient.on('TELEMETRY_UPDATE', ({ lat, lng }) => {
      prevPosRef.current = targetPosRef.current;
      targetPosRef.current = [lng, lat];
      lastTelemetryRef.current = Date.now();
    });

    // ROUTE_UPDATED (detour): update current leg display
    const unsubRoute = wsClient.on('ROUTE_UPDATED', ({ new_polyline }) => {
      if (!new_polyline || !mapReadyRef.current) return;
      const coords = decodePolyline(new_polyline);
      mapRef.current?.getSource('route')?.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } });
    });

    // INCIDENT_LOGGED: draw roadblock
    const unsubIncident = wsClient.on('INCIDENT_LOGGED', ({ lat, lng }) => {
      roadblocksRef.current.features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] } });
      const map = mapRef.current;
      if (map && mapReadyRef.current) {
        map.getSource('roadblocks')?.setData(roadblocksRef.current);
        if (map.getLayer('roadblocks-layer')) map.moveLayer('roadblocks-layer');
      }
    });

    // Signal preemption
    const unsubPreempt = wsClient.on('SIGNAL_PREEMPT', ({ intersection_id }) => {
      const map = mapRef.current;
      if (!map || !mapReadyRef.current) return;
      signalStateRef.current[intersection_id] = 'GREEN';
      applySignalFilters(map, signalStateRef.current);
    });

    const unsubRelease = wsClient.on('SIGNAL_RELEASE', ({ intersection_id }) => {
      const map = mapRef.current;
      if (!map || !mapReadyRef.current) return;
      signalStateRef.current[intersection_id] = 'RELEASING';
      applySignalFilters(map, signalStateRef.current);
      clearTimeout(orangeTimersRef.current[intersection_id]);
      orangeTimersRef.current[intersection_id] = setTimeout(() => {
        signalStateRef.current[intersection_id] = 'RED';
        applySignalFilters(mapRef.current, signalStateRef.current);
      }, 3000);
    });

    // After all listeners are registered, request state replay from backend.
    // 100ms delay allows React to finish registering all listeners before backend responds.
    const stateTimer = setTimeout(() => { wsClient.send({ request_state: true }); }, 100);

    return () => {
      unsubMission(); unsubPhase(); unsubTelemetry(); unsubRoute();
      unsubIncident(); unsubPreempt(); unsubRelease();
      clearTimeout(stateTimer);
      cancelAnimationFrame(animFrameRef.current);
      clearInterval(flashTimerRef.current);
      Object.values(orangeTimersRef.current).forEach(clearTimeout);
      mapRef.current?.remove();
      mapReadyRef.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" id="tmc-map-container" />
      <button
        className="absolute top-6 right-6 z-40 bg-[#1e1e1e] border border-[#333] hover:bg-[#2a2a2a] p-3 rounded shadow-lg transition-colors group"
        onClick={() => { mapRef.current?.flyTo({ center: targetPosRef.current, zoom: 16, pitch: 60, speed: 1.5 }); }}
        title="Recenter Map on Ambulance"
      >
        {/* Compass icon */}
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-emerald-500" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13l-2 6 6-2-2-6-2 2z"/>
        </svg>
      </button>
    </div>
  );
}

function applySignalFilters(map, signalState) {
  if (!map || !map.getSource('intersections')) return;
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
