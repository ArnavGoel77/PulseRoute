import { useState, useEffect } from 'react';

// A mock polyline to traverse
const MOCK_POLYLINE = [
  [40.7128, -74.0060],
  [40.7130, -74.0065],
  [40.7135, -74.0070],
];

export function useGPSSimulator() {
  const [currentLocation, setCurrentLocation] = useState(MOCK_POLYLINE[0]);
  const [speed, setSpeed] = useState(25); // m/s
  const [eta, setEta] = useState('4 MIN');
  const [distanceLeft, setDistanceLeft] = useState('1.2 KM');
  
  useEffect(() => {
    // Simulated traversal logic
    const interval = setInterval(() => {
      // In a real implementation, this would step through the polyline
      // based on the timestamp and emit 'TELEMETRY_UPDATE' WS events.
      
      // Stub WebSocket emission
      // ws.send(JSON.stringify({ 
      //   event: 'TELEMETRY_UPDATE', 
      //   payload: { mission_id: 'M-017', lat: currentLocation[0], lng: currentLocation[1], speed }
      // }));
    }, 1000); // 1Hz updates as per spec

    return () => clearInterval(interval);
  }, [currentLocation, speed]);

  return {
    currentLocation,
    speed,
    eta,
    distanceLeft
  };
}
