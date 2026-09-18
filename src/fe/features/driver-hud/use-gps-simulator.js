import { useState, useEffect } from 'react';
import wsClient from '../../services/websocket-client';

// A mock polyline to traverse (Mumbai)
const MOCK_POLYLINE = [
  [72.8234, 18.9221],
  [72.8311, 18.9300],
  [72.8347, 18.9388],
  [72.8277, 18.9451]
];

export function useGPSSimulator() {
  const [currentLocation, setCurrentLocation] = useState(MOCK_POLYLINE[0]);
  const [speed, setSpeed] = useState(25); // m/s
  const [eta, setEta] = useState('4 MIN');
  const [distanceLeft, setDistanceLeft] = useState('1.2 KM');
  
  useEffect(() => {
    let index = 0;
    const interval = setInterval(() => {
      index = (index + 1) % MOCK_POLYLINE.length;
      setCurrentLocation(MOCK_POLYLINE[index]);
      
      wsClient.send({ 
        mission_id: 'M-042', 
        lat: MOCK_POLYLINE[index][1], 
        lng: MOCK_POLYLINE[index][0], 
        speed 
      });
    }, 1000); // 1Hz updates as per spec

    return () => clearInterval(interval);
  }, [speed]);

  return {
    currentLocation,
    speed,
    eta,
    distanceLeft
  };
}
