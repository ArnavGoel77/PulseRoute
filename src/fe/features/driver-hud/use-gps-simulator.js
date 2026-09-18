import { useState, useEffect, useRef } from 'react';
import wsClient from '../../services/websocket-client';

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
  const [eta, setEta] = useState('4m 20s');
  const [distanceLeft, setDistanceLeft] = useState('2.1 mi');
  const [missionActive, setMissionActive] = useState(false);
  const [demoSpeed, setDemoSpeed] = useState(1);
  const [demoPaused, setDemoPaused] = useState(false);
  const indexRef = useRef(0);

  // Listen for route updates
  useEffect(() => {
    const unsubMission = wsClient.on('MISSION_START', ({ path_polyline }) => {
      if (path_polyline) {
        const coords = decodePolyline(path_polyline);
        setRoute(coords);
        setCurrentLocation(coords[0]);
        setMissionActive(true);
      }
    });

    const unsubRoute = wsClient.on('ROUTE_UPDATED', ({ new_polyline }) => {
      if (new_polyline) {
        const coords = decodePolyline(new_polyline);
        setRoute(coords);
        setCurrentLocation(coords[0]);
        indexRef.current = 0; // Reset index on reroute
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
  }, []);
  
  useEffect(() => {
    if (!missionActive || demoPaused) return;

    const intervalTime = 1000 / demoSpeed;

    const interval = setInterval(() => {
      if (route.length === 0) return;
      indexRef.current = (indexRef.current + 1) % route.length;
      setCurrentLocation(route[indexRef.current]);
      
      const simSpeed = Math.floor(Math.random() * 20) + 30; // 30-50 mph
      setSpeed(simSpeed);
      
      wsClient.send({ 
        mission_id: 'M-042', 
        lat: route[indexRef.current][1], 
        lng: route[indexRef.current][0], 
        speed: simSpeed 
      });
    }, intervalTime); // 1Hz scaled by demoSpeed

    return () => clearInterval(interval);
  }, [route, missionActive, demoSpeed, demoPaused]);

  return {
    currentLocation,
    speed,
    eta,
    distanceLeft
  };
}
