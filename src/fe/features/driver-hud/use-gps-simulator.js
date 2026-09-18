/**
 * GPS Simulator — 3-Phase Mission Tracking
 *
 * Phases:
 *  'to_incident'  — ambulance drives from base to scene
 *  'to_hospital'  — ambulance transports patient to hospital
 *  'to_base'      — ambulance returns to standby base
 *
 * Phase transitions are broadcast as PHASE_CHANGE over WebSocket so ALL
 * clients (CAD, TMC, HUD) update their displayed route simultaneously.
 */
import { useState, useEffect, useRef } from 'react';
import wsClient from '../../services/websocket-client';
import * as turf from '@turf/turf';

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

export function useGPSSimulator() {
  // No mission active by default — do NOT start moving until MISSION_START received
  const [missionActive, setMissionActive]       = useState(false);
  const [activeMissionId, setActiveMissionId]   = useState(null);
  const [currentPhase, setCurrentPhase]         = useState('to_incident');

  // The route for the CURRENT phase only
  const [route, setRoute]                       = useState([]);
  const [routeIndex, setRouteIndex]             = useState(0);

  // All 3 legs (stored so we can switch on phase change)
  const legsRef = useRef({ to_incident: [], to_hospital: [], to_base: [] });
  const missionIdRef = useRef(null);
  const currentPhaseRef = useRef('to_incident');
  const currentLocationRef = useRef(null);

  const [currentLocation, setCurrentLocation]   = useState(null);
  const [speed, setSpeed]                       = useState(0);
  const [eta, setEta]                           = useState('--');
  const [distanceLeft, setDistanceLeft]         = useState('--');
  const [turnInstruction, setTurnInstruction]   = useState('Waiting for mission...');
  const [turnDistance, setTurnDistance]         = useState('--');
  const [demoSpeed, setDemoSpeed]               = useState(1);
  const [demoPaused, setDemoPaused]             = useState(false);

  // Keep refs in sync with state for use inside setInterval closures
  currentPhaseRef.current = currentPhase;

  const switchToPhase = (newPhase, missionId) => {
    const leg = legsRef.current[newPhase];
    if (!leg || leg.length === 0) return;

    // Start from the current location for a seamless transition
    const startCoord = currentLocationRef.current || leg[0];
    const newRoute = [startCoord, ...leg];
    setRoute(newRoute);
    setRouteIndex(0);
    setCurrentPhase(newPhase);
    currentPhaseRef.current = newPhase;

    // Tell backend (and all other clients) about the phase change
    wsClient.send({ mission_id: missionId || missionIdRef.current, new_phase: newPhase });

    const phaseLabels = {
      to_incident: 'En Route to Incident',
      to_hospital: 'Transporting Patient',
      to_base:     'Returning to Base'
    };
    setTurnInstruction(phaseLabels[newPhase] || 'Follow Route');
  };

  // Listen for mission start / updates / phase changes from WS
  useEffect(() => {
    const unsubMission = wsClient.on('MISSION_START', (payload) => {
      // Accept first mission only (or if no active mission)
      if (missionIdRef.current && missionIdRef.current !== payload.mission_id) return;

      const { mission_id, leg_to_incident, leg_to_hospital, leg_to_base, current_phase } = payload;

      legsRef.current = {
        to_incident: decodePolyline(leg_to_incident),
        to_hospital: decodePolyline(leg_to_hospital),
        to_base:     decodePolyline(leg_to_base)
      };

      missionIdRef.current = mission_id;
      setActiveMissionId(mission_id);

      // Restore phase if this is a state replay (reconnect)
      const phase = current_phase || 'to_incident';
      const leg = legsRef.current[phase];
      setRoute(leg);
      setRouteIndex(0);
      setCurrentPhase(phase);
      currentPhaseRef.current = phase;
      setMissionActive(true);
      setTurnInstruction('En Route to Incident');
    });

    const unsubPhase = wsClient.on('PHASE_CHANGE', ({ mission_id, new_phase }) => {
      if (mission_id !== missionIdRef.current) return;
      // Only update our route if we didn't trigger this (avoid double-switching)
      if (new_phase === currentPhaseRef.current) return;
      const leg = legsRef.current[new_phase];
      if (leg && leg.length > 0) {
        const startCoord = currentLocationRef.current || leg[0];
        setRoute([startCoord, ...leg]);
        setRouteIndex(0);
        setCurrentPhase(new_phase);
        currentPhaseRef.current = new_phase;
        const phaseLabels = { to_incident: 'En Route to Incident', to_hospital: 'Transporting Patient', to_base: 'Returning to Base' };
        setTurnInstruction(phaseLabels[new_phase] || 'Follow Route');
      }
    });

    const unsubRoute = wsClient.on('ROUTE_UPDATED', ({ new_polyline, mission_id }) => {
      if (mission_id !== missionIdRef.current) return;
      const coords = decodePolyline(new_polyline);
      legsRef.current[currentPhaseRef.current] = coords;
      const startCoord = currentLocationRef.current || coords[0];
      setRoute([startCoord, ...coords]);
      setRouteIndex(0);
    });

    const unsubDemoSpeed = wsClient.on('DEMO_SPEED_CONTROL', ({ speedMult, paused }) => {
      if (speedMult !== undefined) setDemoSpeed(speedMult);
      if (paused !== undefined) setDemoPaused(paused);
    });

    // After listeners are registered, request full state from backend.
    // Small delay ensures the event listeners above are attached before the backend responds.
    const stateTimer = setTimeout(() => { wsClient.send({ request_state: true }); }, 80);

    return () => { unsubMission(); unsubPhase(); unsubRoute(); unsubDemoSpeed(); clearTimeout(stateTimer); };
  }, []);

  // Main GPS tick loop
  useEffect(() => {
    if (!missionActive || !activeMissionId || demoPaused || route.length === 0) return;

    const intervalTime = Math.max(100, 1000 / demoSpeed);

    const interval = setInterval(() => {
      setRouteIndex(prevIndex => {
        if (prevIndex >= route.length - 1) {
          // End of current leg — advance to next phase
          const phase = currentPhaseRef.current;
          if (phase === 'to_incident') {
            setSpeed(0);
            setTurnInstruction('Arrived at Incident');
            setTimeout(() => switchToPhase('to_hospital', missionIdRef.current), 2000);
          } else if (phase === 'to_hospital') {
            setSpeed(0);
            setTurnInstruction('Patient Loaded — Heading to Hospital');
            setTimeout(() => switchToPhase('to_base', missionIdRef.current), 2000);
          } else if (phase === 'to_base') {
            setSpeed(0);
            setTurnInstruction('Mission Complete — Back at Base');
            setEta('--');
            setDistanceLeft('0.0 km');
          }
          return prevIndex;
        }

        const nextIndex = prevIndex + 1;
        const nextLoc = route[nextIndex];

        setCurrentLocation(nextLoc);
        currentLocationRef.current = nextLoc;

        const simSpeedKph = Math.floor(Math.random() * 15) + 50;
        setSpeed(simSpeedKph);

        const remainingRoute = route.slice(nextIndex);
        if (remainingRoute.length > 1) {
          try {
            const line = turf.lineString(remainingRoute);
            const distKm = turf.length(line, { units: 'kilometers' });
            setDistanceLeft(`${distKm.toFixed(1)} km`);
            if (simSpeedKph > 0) {
              const hours = distKm / simSpeedKph;
              const mins = Math.floor(hours * 60);
              const secs = Math.floor((hours * 3600) % 60);
              setEta(`${mins}m ${secs}s`);
            }
          } catch (e) { /* skip */ }

          // Turn instruction — find next significant bearing change
          try {
            let currentBearing = turf.bearing(turf.point(remainingRoute[0]), turf.point(remainingRoute[1]));
            let foundTurn = false;
            for (let i = 1; i < remainingRoute.length - 1; i++) {
              const nextBearing = turf.bearing(turf.point(remainingRoute[i]), turf.point(remainingRoute[i + 1]));
              const diff = (((nextBearing - currentBearing) + 540) % 360) - 180;
              if (Math.abs(diff) > 20) {
                setTurnInstruction(diff > 0 ? 'Turn right' : 'Turn left');
                const routeToTurn = remainingRoute.slice(0, i + 1);
                if (routeToTurn.length > 1) {
                  const d = turf.length(turf.lineString(routeToTurn), { units: 'kilometers' });
                  const dm = Math.floor(d * 1000);
                  setTurnDistance(dm < 30 ? 'now' : `in ${dm} m`);
                }
                foundTurn = true;
                break;
              }
              currentBearing = nextBearing;
            }
            if (!foundTurn) {
              const phaseLabels = { to_incident: 'En Route to Incident', to_hospital: 'Transporting Patient', to_base: 'Returning to Base' };
              setTurnInstruction(phaseLabels[currentPhaseRef.current] || 'Follow Route');
              setTurnDistance('--');
            }
          } catch (e) { /* skip */ }
        } else {
          setDistanceLeft('0.0 km');
          setEta('Arrived');
        }

        // Broadcast telemetry
        wsClient.send({
          mission_id: missionIdRef.current,
          lat: nextLoc[1],
          lng: nextLoc[0],
          speed: simSpeedKph
        });

        return nextIndex;
      });
    }, intervalTime);

    return () => clearInterval(interval);
  }, [route, missionActive, activeMissionId, demoSpeed, demoPaused]);

  return { currentLocation, speed, eta, distanceLeft, activeMissionId, currentPhase, turnInstruction, turnDistance };
}
