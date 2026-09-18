/**
 * GPS Simulator — Multi-Driver, 3-Phase Mission Tracking
 *
 * Accepts a `driverId` param. Only processes MISSION_START events
 * that contain a matching `unit_id` field (or the first mission if
 * no driverId is set) to support the Driver HUD switcher.
 *
 * Phases:
 *  'to_incident'  — ambulance drives from base to scene
 *  'to_hospital'  — ambulance transports patient to hospital
 *  'to_base'      — ambulance returns to standby base
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
    coords.push([lng / 1e5, lat / 1e5]);
  }
  return coords;
}

export function useGPSSimulator(driverId = null) {
  const [missionActive, setMissionActive]     = useState(false);
  const [activeMissionId, setActiveMissionId] = useState(null);
  const [currentPhase, setCurrentPhase]       = useState('to_incident');

  const [route, setRoute]       = useState([]);
  const [routeIndex, setRouteIndex] = useState(0);

  const legsRef             = useRef({ to_incident: [], to_hospital: [], to_base: [] });
  const missionIdRef        = useRef(null);
  const currentPhaseRef     = useRef('to_incident');
  const currentLocationRef  = useRef(null);
  const driverIdRef         = useRef(driverId);
  const recoveredPosRef     = useRef(null); // last known Redis position on state recovery

  const [currentLocation, setCurrentLocation] = useState(null);
  const [speed, setSpeed]                     = useState(0);
  const [eta, setEta]                         = useState('--');
  const [distanceLeft, setDistanceLeft]       = useState('--');
  const [turnInstruction, setTurnInstruction] = useState('Waiting for mission...');
  const [turnDistance, setTurnDistance]       = useState('--');
  const [demoSpeed, setDemoSpeed]             = useState(1);
  const [demoPaused, setDemoPaused]           = useState(false);

  // Keep refs current
  currentPhaseRef.current = currentPhase;
  driverIdRef.current = driverId;

  const switchToPhase = (newPhase, missionId) => {
    const leg = legsRef.current[newPhase];
    if (!leg || leg.length === 0) return;
    const startCoord = currentLocationRef.current || leg[0];
    setRoute([startCoord, ...leg]);
    setRouteIndex(0);
    setCurrentPhase(newPhase);
    currentPhaseRef.current = newPhase;
    wsClient.send({ mission_id: missionId || missionIdRef.current, new_phase: newPhase });
    const phaseLabels = { to_incident: 'En Route to Incident', to_hospital: 'Transporting Patient', to_base: 'Returning to Base' };
    setTurnInstruction(phaseLabels[newPhase] || 'Follow Route');
  };

  // Reset state when driverId changes
  useEffect(() => {
    setMissionActive(false);
    setActiveMissionId(null);
    setRoute([]);
    setRouteIndex(0);
    setCurrentLocation(null);
    setSpeed(0);
    setEta('--');
    setDistanceLeft('--');
    setTurnInstruction('Waiting for mission...');
    setTurnDistance('--');
    missionIdRef.current = null;
    legsRef.current = { to_incident: [], to_hospital: [], to_base: [] };
    currentLocationRef.current = null;
    // Request fresh state from backend
    setTimeout(() => wsClient.send({ request_state: true }), 80);
  }, [driverId]);

  useEffect(() => {
    const unsubMission = wsClient.on('MISSION_START', (payload) => {
      const { mission_id, unit_id, leg_to_incident, leg_to_hospital, leg_to_base, current_phase } = payload;

      // Filter: only accept missions for this driver
      if (driverIdRef.current && unit_id && unit_id !== driverIdRef.current) return;
      // If we already have a different active mission, skip
      if (missionIdRef.current && missionIdRef.current !== mission_id) return;

      legsRef.current = {
        to_incident: decodePolyline(leg_to_incident),
        to_hospital: decodePolyline(leg_to_hospital),
        to_base:     decodePolyline(leg_to_base)
      };

      missionIdRef.current = mission_id;
      setActiveMissionId(mission_id);

      const phase = current_phase || 'to_incident';
      const leg = legsRef.current[phase];

      // If we have a recovered telemetry position, find the nearest point on
      // the route and start from there instead of index 0 (prevents HUD restart)
      let startIndex = 0;
      if (recoveredPosRef.current && leg.length > 1) {
        const [recLng, recLat] = recoveredPosRef.current;
        let minDist = Infinity;
        leg.forEach(([lng, lat], idx) => {
          const d = Math.abs(lng - recLng) + Math.abs(lat - recLat);
          if (d < minDist) { minDist = d; startIndex = idx; }
        });
      }
      recoveredPosRef.current = null; // consumed

      setRoute(leg);
      setRouteIndex(startIndex);
      setCurrentPhase(phase);
      currentPhaseRef.current = phase;
      setMissionActive(true);
      setTurnInstruction('En Route to Incident');
    });

    const unsubPhase = wsClient.on('PHASE_CHANGE', ({ mission_id, new_phase }) => {
      if (mission_id !== missionIdRef.current) return;
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

    const unsubReset = wsClient.on('RESET_SIMULATION', () => {
      setMissionActive(false);
      setActiveMissionId(null);
      missionIdRef.current = null;
      setRoute([]);
      setRouteIndex(0);
      legsRef.current = { to_incident: [], to_hospital: [], to_base: [] };
      setTurnInstruction('Waiting for mission...');
      setEta('--');
      setDistanceLeft('--');
      setSpeed(0);
    });

    // On state recovery, the backend sends a TELEMETRY_UPDATE with the last known
    // position right after the MISSION_START replay. Store it so the MISSION_START
    // handler (which may fire next) can seek to the correct route index.
    const unsubRecovery = wsClient.on('TELEMETRY_UPDATE', ({ mission_id, lat, lng }) => {
      // Only capture if we don't have an active mission yet (i.e. we're recovering)
      if (!missionIdRef.current || missionIdRef.current === mission_id) {
        recoveredPosRef.current = [lng, lat];
      }
    });

    return () => { unsubMission(); unsubPhase(); unsubRoute(); unsubDemoSpeed(); unsubReset(); unsubRecovery(); };
  }, []);

  // Main GPS tick loop
  useEffect(() => {
    if (!missionActive || !activeMissionId || demoPaused || route.length === 0) return;

    const intervalTime = Math.max(100, 1000 / demoSpeed);

    const interval = setInterval(() => {
      setRouteIndex(prevIndex => {
        if (prevIndex >= route.length - 1) {
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
            setMissionActive(false);
            missionIdRef.current = null;
            setActiveMissionId(null);
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

          // Turn instruction
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
