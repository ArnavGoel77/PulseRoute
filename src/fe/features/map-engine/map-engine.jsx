/**
 * D4-4 / D4-5 / D4-6: Horizon Grid Map Engine
 *
 * D4-4: Initializes Mapbox GL JS with CartoDB Dark Matter tiles.
 *        Hardcodes pitch and zoom for a fixed TMC macro-city perspective.
 * D4-5: Creates a GeoJSON ambulance source. Uses a requestAnimationFrame
 *        loop with linear interpolation to smoothly move the icon between
 *        1Hz telemetry updates using Map#setData (never destroying layers).
 * D4-6: Seeds 20 intersection nodes as a GeoJSON layer. Listens for
 *        SIGNAL_PREEMPT and SIGNAL_RELEASE WebSocket events and uses
 *        Map#setFilter to snap node colors (Red → Green → Flashing Orange)
 *        without re-rendering the map.
 */

import React, { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import wsClient from '../../services/websocket-client';
import { INTERSECTION_NODES_GEOJSON } from './intersection-nodes';

// ── Config ─────────────────────────────────────────────────────────────────────
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// D4-4: Hardcoded TMC perspective — fixed macro-city view of Mumbai
const MUMBAI_CENTER = [72.8777, 19.0176]; // [lng, lat]
const TMC_ZOOM     = 11.5;
const TMC_PITCH    = 45;
const TMC_BEARING  = -10;

// CartoDB Dark Matter vector tile style for hardware-accelerated WebGL rendering
const DARK_MATTER_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// D4-5: Ambulance initial GeoJSON source
const AMBULANCE_GEOJSON = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: MUMBAI_CENTER }
};

// D4-6: Mapbox expression filter helper — legacy syntax guaranteed to work
const makeIdFilter = (ids) =>
  ids.length > 0
    ? ['in', 'intersection_id', ...ids]
    : ['==', 'intersection_id', '__NONE__']; // matches nothing

/**
 * Precision-5 polyline decoder (matches OSRM / Google Maps encoding).
 * @param {string} encoded
 * @returns {Array<[number, number]>} Array of [lng, lat] pairs (GeoJSON order).
 */
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
    coords.push([lng / 1e5, lat / 1e5]); // GeoJSON is [lng, lat]
  }
  return coords;
}

/** Linear interpolation helper for D4-5 smooth movement. */
const lerp = (a, b, t) => a + (b - a) * t;

export default function MapEngine({ isRoadblockModeActive, onRoadblockPlaced }) {
  const containerRef    = useRef(null);
  const mapRef          = useRef(null);
  const animFrameRef    = useRef(null);
  const flashTimerRef   = useRef(null);

  // D4-5 interpolation state — using refs to avoid re-renders inside rAF loop
  const prevPosRef          = useRef(MUMBAI_CENTER);
  const targetPosRef        = useRef(MUMBAI_CENTER);
  const lastTelemetryRef    = useRef(Date.now());

  // D4-6 signal phase tracking
  const signalStateRef      = useRef({}); // { 'node-01': 'RED'|'GREEN'|'RELEASING' }
  const orangeTimersRef     = useRef({}); // per-node timers for RELEASING → RED

  // D4-7 roadblock mode ref (mirrors prop to avoid stale closure in map click handler)
  const roadblockActiveRef  = useRef(isRoadblockModeActive);
  useEffect(() => { roadblockActiveRef.current = isRoadblockModeActive; }, [isRoadblockModeActive]);

  // ── Map Initialization ──────────────────────────────────────────────────────
  useEffect(() => {
    // signalStateRef is initialized empty; populated on MISSION_START
    signalStateRef.current = {};

    // D4-4: Create the map with fixed TMC perspective
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
      // ── D4-5: Ambulance GeoJSON source + layer ──────────────────────────────
      map.addSource('ambulance', {
        type: 'geojson',
        data: AMBULANCE_GEOJSON
      });

      // Outer halo (pulse effect simulated via large, semi-transparent circle)
      map.addLayer({
        id: 'ambulance-halo',
        type: 'circle',
        source: 'ambulance',
        paint: {
          'circle-radius': 18,
          'circle-color': '#10b981',
          'circle-opacity': 0.25,
          'circle-blur': 1
        }
      });

      // Load custom ambulance SVG via synchronous Image object to avoid network/path issues
      const ambulanceImg = new Image(64, 64);
      ambulanceImg.onload = () => {
        if (!map.hasImage('ambulance-icon')) map.addImage('ambulance-icon', ambulanceImg);
        
        // Core ambulance icon
        map.addLayer({
          id: 'ambulance-core',
          type: 'symbol',
          source: 'ambulance',
          layout: {
            'icon-image': 'ambulance-icon',
            'icon-size': 0.7,
            'icon-allow-overlap': true
          }
        });
      };
      ambulanceImg.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4NCiAgPCEtLSBWZWhpY2xlIEJvZHkgLS0+DQogIDxyZWN0IHg9IjgiIHk9IjI0IiB3aWR0aD0iNDgiIGhlaWdodD0iMjQiIHJ4PSI0IiBmaWxsPSIjZmZmZmZmIi8+DQogIDxyZWN0IHg9IjQyIiB5PSIzMiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiByeD0iMiIgZmlsbD0iI2UwZTBlMCIvPg0KICA8IS0tIFdpbmRvd3MgLS0+DQogIDxyZWN0IHg9IjQ0IiB5PSIyNiIgd2lkdGg9IjEwIiBoZWlnaHQ9IjgiIHJ4PSIxIiBmaWxsPSIjNGFkZTgwIi8+DQogIDwhLS0gQ3Jvc3MgLS0+DQogIDxyZWN0IHg9IjIyIiB5PSIyOCIgd2lkdGg9IjQiIGhlaWdodD0iMTYiIHJ4PSIxIiBmaWxsPSIjZWY0NDQ0Ii8+DQogIDxyZWN0IHg9IjE2IiB5PSIzNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjQiIHJ4PSIxIiBmaWxsPSIjZWY0NDQ0Ii8+DQogIDwhLS0gV2hlZWxzIC0tPg0KICA8Y2lyY2xlIGN4PSIxOCIgY3k9IjQ4IiByPSI2IiBmaWxsPSIjMWYyOTM3Ii8+DQogIDxjaXJjbGUgY3g9IjQ2IiBjeT0iNDgiIHI9IjYiIGZpbGw9IiMxZjI5MzciLz4NCiAgPGNpcmNsZSBjeD0iMTgiIGN5PSI0OCIgcj0iMyIgZmlsbD0iIzljYTNhZiIvPg0KICA8Y2lyY2xlIGN4PSI0NiIgY3k9IjQ4IiByPSIzIiBmaWxsPSIjOWNhM2FmIi8+DQogIDwhLS0gTGlnaHRiYXIgLS0+DQogIDxyZWN0IHg9IjE2IiB5PSIyMCIgd2lkdGg9IjgiIGhlaWdodD0iNCIgcng9IjIiIGZpbGw9IiNlZjQ0NDQiLz4NCiAgPHJlY3QgeD0iMjYiIHk9IjIwIiB3aWR0aD0iOCIgaGVpZ2h0PSI0IiByeD0iMiIgZmlsbD0iIzNiODJmNiIvPg0KPC9zdmc+DQo=';

      // ── Active route line source + layer ────────────────────────────────────
      map.addSource('route', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } }
      });

      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#10b981',
          'line-width': 3,
          'line-opacity': 0.8,
          'line-dasharray': [2, 1]
        }
      });

      // ── D4-6: Intersection nodes source ────────────────────────────────────
      map.addSource('intersections', {
        type: 'geojson',
        data: INTERSECTION_NODES_GEOJSON
      });

      // RED nodes layer (default — all nodes start red)
      map.addLayer({
        id: 'intersections-red',
        type: 'circle',
        source: 'intersections',
        filter: makeIdFilter(Object.keys(signalStateRef.current)), // all IDs initially
        paint: {
          'circle-radius': 5,
          'circle-color': '#c92a2a',
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ff6b6b',
          'circle-opacity': 0.9
        }
      });

      // GREEN nodes layer (empty initially)
      map.addLayer({
        id: 'intersections-green',
        type: 'circle',
        source: 'intersections',
        filter: makeIdFilter([]),
        paint: {
          'circle-radius': 6,
          'circle-color': '#2b8a3e',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#51cf66',
          'circle-opacity': 1
        }
      });

      // RELEASING (flashing orange) nodes layer (empty initially)
      map.addLayer({
        id: 'intersections-orange',
        type: 'circle',
        source: 'intersections',
        filter: makeIdFilter([]),
        paint: {
          'circle-radius': 6,
          'circle-color': '#f08c00',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffd43b',
          'circle-opacity': 1
        }
      });

      // ── Roadblock markers source (D4-7) ─────────────────────────────────────
      map.addSource('roadblocks', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.addLayer({
        id: 'roadblocks-layer',
        type: 'circle',
        source: 'roadblocks',
        paint: {
          'circle-radius': 8,
          'circle-color': '#e03131',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ff8787'
        }
      });

      // ── D4-7: Map click handler for roadblock placement ─────────────────────
      map.on('click', (e) => {
        if (!roadblockActiveRef.current) return;

        const { lng, lat } = e.lngLat;
        
        // Fire INCIDENT_LOGGED over WebSocket per the WS contract.
        // The local WS listener will catch the broadcast and draw it so all clients sync.
        wsClient.send({ lat, lng, type: 'OBSTRUCTION' });

        // Notify parent so it can toggle roadblock mode off
        onRoadblockPlaced?.();
      });

      // Change cursor to crosshair when roadblock mode is active
      map.on('mousemove', () => {
        map.getCanvas().style.cursor = roadblockActiveRef.current ? 'crosshair' : '';
      });

      // ── D4-5: Start rAF smooth movement loop ────────────────────────────────
      const animate = () => {
        const elapsed = Date.now() - lastTelemetryRef.current;
        const t = Math.min(elapsed / 1000, 1); // 0 → 1 over 1 second between telemetry ticks

        const lng = lerp(prevPosRef.current[0], targetPosRef.current[0], t);
        const lat = lerp(prevPosRef.current[1], targetPosRef.current[1], t);

        map.getSource('ambulance')?.setData({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lng, lat] }
        });

        animFrameRef.current = requestAnimationFrame(animate);
      };
      animFrameRef.current = requestAnimationFrame(animate);

      // ── D4-6: Flashing orange loop via setPaintProperty ─────────────────────
      // Toggles opacity of the orange layer every 500ms to simulate flashing
      // without destroying or re-creating any map layers.
      let flashOn = true;
      flashTimerRef.current = setInterval(() => {
        flashOn = !flashOn;
        if (map.getLayer('intersections-orange')) {
          map.setPaintProperty('intersections-orange', 'circle-opacity', flashOn ? 1 : 0.15);
        }
      }, 500);
    });

    // ── WS Event Listeners ──────────────────────────────────────────────────────
    // D4-5: Telemetry → update interpolation targets
    const unsubTelemetry = wsClient.on('TELEMETRY_UPDATE', ({ lat, lng }) => {
      prevPosRef.current = targetPosRef.current;
      targetPosRef.current = [lng, lat];
      lastTelemetryRef.current = Date.now();
    });

    // MISSION_START → draw the route polyline on the map and generate intersections
    const unsubMission = wsClient.on('MISSION_START', ({ path_polyline }) => {
      if (!path_polyline || !mapRef.current) return;
      const coords = decodePolyline(path_polyline);
      mapRef.current.getSource('route')?.setData({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords }
      });
      // Fly to the start of the route
      if (coords.length > 0) {
        mapRef.current.flyTo({ center: coords[0], zoom: 13, speed: 1.2 });
      }

      // Generate nodes dynamically along the route (guarantee ~5 nodes)
      const features = [];
      const newSignalState = {};
      const step = Math.max(1, Math.floor(coords.length / 6));
      let nodeId = 1;
      for (let i = step; i < coords.length - 1; i += step) {
        const id = `node-${nodeId++}`;
        features.push({
          type: 'Feature',
          properties: { intersection_id: id, signal_phase: 'RED' },
          geometry: { type: 'Point', coordinates: coords[i] }
        });
        newSignalState[id] = 'RED';
      }
      
      signalStateRef.current = newSignalState;
      mapRef.current.getSource('intersections')?.setData({
        type: 'FeatureCollection',
        features
      });
      _applySignalFilters(mapRef.current, signalStateRef.current);
    });

    // ROUTE_UPDATED → update the route polyline on reroute
    const unsubRoute = wsClient.on('ROUTE_UPDATED', ({ new_polyline }) => {
      if (!new_polyline || !mapRef.current) return;
      const coords = decodePolyline(new_polyline);
      mapRef.current.getSource('route')?.setData({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords }
      });
    });

    // INCIDENT_LOGGED → draw roadblock marker
    const unsubIncident = wsClient.on('INCIDENT_LOGGED', ({ lat, lng }) => {
      const map = mapRef.current;
      if (!map || !map.loaded()) return;
      const existing = map.getSource('roadblocks')?._data;
      const newFeatures = [
        ...(existing?.features || []),
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lng, lat] }
        }
      ];
      map.getSource('roadblocks')?.setData({
        type: 'FeatureCollection',
        features: newFeatures
      });
    });

    // D4-6: SIGNAL_PREEMPT → snap node to GREEN via Map#setFilter
    const unsubPreempt = wsClient.on('SIGNAL_PREEMPT', ({ intersection_id }) => {
      const map = mapRef.current;
      if (!map || !map.loaded()) return;
      signalStateRef.current[intersection_id] = 'GREEN';
      _applySignalFilters(map, signalStateRef.current);
    });

    // D4-6: SIGNAL_RELEASE → snap node to RELEASING (orange) via Map#setFilter,
    //        then after 3s restore to RED (All-Red clearance complete).
    const unsubRelease = wsClient.on('SIGNAL_RELEASE', ({ intersection_id }) => {
      const map = mapRef.current;
      if (!map || !map.loaded()) return;
      signalStateRef.current[intersection_id] = 'RELEASING';
      _applySignalFilters(map, signalStateRef.current);

      // Clear any existing timer for this node
      clearTimeout(orangeTimersRef.current[intersection_id]);
      // After 3 seconds, snap back to RED (all traffic has cleared)
      orangeTimersRef.current[intersection_id] = setTimeout(() => {
        signalStateRef.current[intersection_id] = 'RED';
        _applySignalFilters(mapRef.current, signalStateRef.current);
      }, 3000);
    });

    // Cleanup on unmount
    return () => {
      unsubTelemetry();
      unsubMission();
      unsubRoute();
      unsubPreempt();
      unsubRelease();
      unsubIncident();
      cancelAnimationFrame(animFrameRef.current);
      clearInterval(flashTimerRef.current);
      Object.values(orangeTimersRef.current).forEach(clearTimeout);
      map.remove();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%' }}
      id="tmc-map-container"
    />
  );
}

/**
 * D4-6: Recomputes and applies Map#setFilter on all 3 signal layers
 * based on the current signalState map. Never touches the GeoJSON source data —
 * only the layer filter expressions are updated.
 *
 * @param {mapboxgl.Map} map
 * @param {Object} signalState - { intersection_id: 'RED'|'GREEN'|'RELEASING' }
 */
function _applySignalFilters(map, signalState) {
  if (!map || !map.loaded()) return;

  const redIds      = [];
  const greenIds    = [];
  const orangeIds   = [];

  Object.entries(signalState).forEach(([id, phase]) => {
    if (phase === 'RED')       redIds.push(id);
    else if (phase === 'GREEN')    greenIds.push(id);
    else if (phase === 'RELEASING') orangeIds.push(id);
  });

  if (map.getLayer('intersections-red'))    map.setFilter('intersections-red',    makeIdFilter(redIds));
  if (map.getLayer('intersections-green'))  map.setFilter('intersections-green',  makeIdFilter(greenIds));
  if (map.getLayer('intersections-orange')) map.setFilter('intersections-orange', makeIdFilter(orangeIds));
}
