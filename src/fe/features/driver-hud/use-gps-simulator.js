import { useState, useEffect, useRef } from 'react';
import wsClient from '../../services/websocket-client';
import * as turf from '@turf/turf';

// A mock polyline to traverse (Mumbai)
const MOCK_POLYLINE = [
  [72.8234, 18.9221],
  [72.8311, 18.9300],
  [72.8347, 18.9388],
  [72.8277, 18.9451]
];

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
  const [route, setRoute] = useState(MOCK_POLYLINE);
  const [currentLocation, setCurrentLocation] = useState(MOCK_POLYLINE[0]);
  const [speed, setSpeed] = useState(0);
  const [eta, setEta] = useState('--');
  const [distanceLeft, setDistanceLeft] = useState('--');
  const [missionActive, setMissionActive] = useState(false);
  
  // MERGED STATES
  const [routeIndex, setRouteIndex] = useState(0);
  const [activeMissionId, setActiveMissionId] = useState(null);
  
  const [turnInstruction, setTurnInstruction] = useState('Follow Route');
  const [turnDistance, setTurnDistance] = useState('--');
  
  const [demoSpeed, setDemoSpeed] = useState(1);
  const [demoPaused, setDemoPaused] = useState(false);

  // Listen for route updates
  useEffect(() => {
    const unsubMission = wsClient.on('MISSION_START', ({ path_polyline, mission_id }) => {
      // Lock onto the first mission received. Ignore other missions.
      if (activeMissionId && activeMissionId !== mission_id) return;
      
      if (path_polyline) {
        const coords = decodePolyline(path_polyline);
        if (mission_id) setActiveMissionId(mission_id);
        
        // Anti-teleport: Prepend current location so we drive there smoothly
        setRoute([currentLocation, ...coords]);
        setRouteIndex(0);
        setMissionActive(true);
      }
    });

    const unsubRoute = wsClient.on('ROUTE_UPDATED', ({ new_polyline, mission_id }) => {
      if (activeMissionId && activeMissionId !== mission_id) return;

      if (new_polyline) {
        const coords = decodePolyline(new_polyline);
        // Anti-teleport: Prepend current location
        setRoute([currentLocation, ...coords]);
        setRouteIndex(0);
      }
    });

    const unsubDemoSpeed = wsClient.on('DEMO_SPEED_CONTROL', ({ speedMult, paused }) => {
      if (speedMult !== undefined) setDemoSpeed(speedMult);
      if (paused !== undefined) setDemoPaused(paused);
    });

    return () => {
      unsubMission();
      unsubRoute();
      unsubDemoSpeed();
    };
  }, [currentLocation, activeMissionId]); 
  
  useEffect(() => {
    if (!missionActive || !activeMissionId || demoPaused) return;

    const intervalTime = 1000 / demoSpeed;

    const interval = setInterval(() => {
      if (route.length === 0 || routeIndex >= route.length - 1) {
        setSpeed(0);
        setTurnInstruction('Arrived');
        setTurnDistance('0 ft');
        return; // Reached end of route
      }
      
      const nextIndex = routeIndex + 1;
      const nextLoc = route[nextIndex];
      
      setCurrentLocation(nextLoc);
      setRouteIndex(nextIndex);
      
      const simSpeedKph = Math.floor(Math.random() * 15) + 50; // 50-65 km/h
      setSpeed(simSpeedKph);
      
      // 1. Calculate dynamic telemetry (distance & ETA)
      const remainingRoute = route.slice(nextIndex);
      if (remainingRoute.length > 1) {
        try {
          const line = turf.lineString(remainingRoute);
          const distKm = turf.length(line, { units: 'kilometers' });
          setDistanceLeft(`${distKm.toFixed(1)} km`);
          
          // ETA: (dist in km) / (speed in km/h) -> hours
          if (simSpeedKph > 0) {
            const hours = distKm / simSpeedKph;
            const mins = Math.floor(hours * 60);
            const secs = Math.floor((hours * 3600) % 60);
            setEta(`${mins}m ${secs}s`);
          }
        } catch (e) {
           console.error("Turf distance calculation error", e);
        }
        
        // 2. Calculate next turn instruction using bearing
        try {
          let foundTurn = false;
          let turnIdx = -1;
          let currentBearing = turf.bearing(turf.point(remainingRoute[0]), turf.point(remainingRoute[1]));
          
          for (let i = 1; i < remainingRoute.length - 1; i++) {
            const nextBearing = turf.bearing(turf.point(remainingRoute[i]), turf.point(remainingRoute[i+1]));
            const bearingDiff = nextBearing - currentBearing;
            // Normalize between -180 and 180
            const normalizedDiff = (bearingDiff + 540) % 360 - 180; 
            
            if (Math.abs(normalizedDiff) > 20) { // Calibrated threshold for standard intersections (20 deg)
              turnIdx = i;
              setTurnInstruction(normalizedDiff > 0 ? 'Turn right' : 'Turn left');
              foundTurn = true;
              break;
            }
            currentBearing = nextBearing;
          }
          
          if (foundTurn && turnIdx > 0) {
            const routeToTurn = remainingRoute.slice(0, turnIdx + 1);
            if (routeToTurn.length > 1) {
               const turnLine = turf.lineString(routeToTurn);
               const turnDistKm = turf.length(turnLine, { units: 'kilometers' });
               const turnDistMeters = Math.floor(turnDistKm * 1000);
               if (turnDistMeters < 30) {
                 setTurnDistance('now');
               } else {
                 setTurnDistance(`in ${turnDistMeters} m`);
               }
            }
          } else {
            setTurnInstruction('Follow Route');
            setTurnDistance('--');
          }
        } catch (e) {
          console.error("Turf bearing calculation error", e);
        }

      } else {
        setDistanceLeft('0.0 km');
        setEta('Arrived');
      }
      
      wsClient.send({ 
        mission_id: activeMissionId, 
        lat: nextLoc[1], 
        lng: nextLoc[0], 
        speed: simSpeedKph 
      });
    }, intervalTime); 

    return () => clearInterval(interval);
  }, [route, routeIndex, missionActive, activeMissionId, demoSpeed, demoPaused]);

  return {
    currentLocation,
    speed,
    eta,
    distanceLeft,
    activeMissionId,
    turnInstruction,
    turnDistance
  };
}
