import React, { useState } from 'react';
import wsClient from '../../services/websocket-client';
import MapEngine from '../map-engine/map-engine';

// Mumbai Bounding Box (Demo Area)
const NYC_BOUNDS = {
  minLat: 18.8,
  maxLat: 19.3,
  minLng: 72.7,
  maxLng: 73.1
};

export default function CadForm() {
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [priority, setPriority] = useState('ALS_CRITICAL');
  const [formError, setFormError] = useState('');

  const validateCoordinates = (coordString) => {
    const parts = coordString.split(',');
    if (parts.length !== 2) return false;

    const lat = parseFloat(parts[0].trim());
    const lng = parseFloat(parts[1].trim());

    if (isNaN(lat) || isNaN(lng)) return false;

    return (
      lat >= NYC_BOUNDS.minLat &&
      lat <= NYC_BOUNDS.maxLat &&
      lng >= NYC_BOUNDS.minLng &&
      lng <= NYC_BOUNDS.maxLng
    );
  };

  const handleDispatch = (e) => {
    e.preventDefault();
    setFormError('');

    if (!origin || !destination) {
      setFormError('Origin and Destination are required. Format: lat, lng');
      return;
    }

    wsClient.connect();

    const [start_lat, start_lng] = origin.split(',').map(s => s.trim());
    const [end_lat, end_lng] = destination.split(',').map(s => s.trim());

    // Hit the backend OSRM proxy
    fetch(`/api/route?start_lat=${start_lat}&start_lng=${start_lng}&end_lat=${end_lat}&end_lng=${end_lng}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setFormError(`Routing error: ${data.error}`);
          return;
        }
        
        wsClient.send({
          mission_id: 'M-042',
          path_polyline: data.path_polyline,
          priority: priority
        });
        alert('MISSION_START emitted! Switch to TMC Dashboard.');
      })
      .catch(err => {
        console.error(err);
        setFormError('Failed to contact backend for routing.');
      });
  };

  return (
    <div className="w-screen h-screen bg-[#0b0b0b] text-[#f5f5f5] flex flex-col font-sans">
      
      {/* Header */}
      <header className="h-16 border-b border-[#2a2a2a] flex items-center px-6 justify-between shrink-0 bg-[#0b0b0b]">
        <div className="flex items-center space-x-4">
          <h1 className="text-lg font-bold tracking-wide">HorizonGrid</h1>
          <span className="text-[#8b8b8b] text-sm">CAD Dispatch / Desktop</span>
          <div className="w-px h-5 bg-[#2a2a2a] mx-2" />
          <span className="text-[#8b8b8b] text-sm">SHIFT: 14:00 - 22:00</span>
        </div>
        <div className="flex items-center space-x-3">
          <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
          <span className="text-sm text-[#8b8b8b]">System Online</span>
          <span className="text-sm font-mono text-[#f5f5f5] ml-4">12ms</span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar / Dispatch Intake */}
        <aside className="w-[352px] border-r border-[#2a2a2a] bg-[#141414] p-6 flex flex-col overflow-y-auto">
          <p className="text-[#8b8b8b] text-xs font-semibold tracking-widest mb-2 uppercase">Intake</p>
          <h2 className="text-2xl font-bold mb-6">New Mission</h2>
          
          <div className="w-full h-px bg-[#2a2a2a] mb-6" />

          <div className="mb-6">
            <p className="text-[#8b8b8b] text-xs font-semibold mb-1 uppercase">Case ID</p>
            <p className="font-mono text-lg text-emerald-400">M-042</p>
          </div>

          <form onSubmit={handleDispatch} className="flex flex-col flex-1">
            
            <div className="mb-5">
              <label className="text-[#8b8b8b] text-xs font-semibold mb-2 block uppercase">Origin (Lat, Lng)</label>
              <input 
                type="text" 
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                placeholder="40.7128, -74.0060"
                className="w-full bg-[#1e1e1e] border border-[#2a2a2a] rounded p-3 text-sm focus:outline-none focus:border-emerald-500 font-mono"
              />
            </div>

            <div className="mb-8">
              <label className="text-[#8b8b8b] text-xs font-semibold mb-2 block uppercase">Destination (Lat, Lng)</label>
              <input 
                type="text" 
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="40.7306, -73.9352"
                className="w-full bg-[#1e1e1e] border border-[#2a2a2a] rounded p-3 text-sm focus:outline-none focus:border-emerald-500 font-mono"
              />
            </div>

            <p className="text-[#8b8b8b] text-xs font-semibold mb-3 uppercase">Triage Priority</p>
            
            <label className="flex items-start space-x-3 mb-4 cursor-pointer">
              <input 
                type="radio" 
                name="priority" 
                value="ALS_CRITICAL"
                checked={priority === 'ALS_CRITICAL'}
                onChange={() => setPriority('ALS_CRITICAL')}
                className="mt-1"
              />
              <div>
                <p className="font-semibold text-red-400">ALS — CRITICAL</p>
                <p className="text-xs text-[#8b8b8b] mt-1">Advanced Life Support required immediately.</p>
              </div>
            </label>

            <label className="flex items-start space-x-3 mb-8 cursor-pointer">
              <input 
                type="radio" 
                name="priority" 
                value="BLS_ROUTINE"
                checked={priority === 'BLS_ROUTINE'}
                onChange={() => setPriority('BLS_ROUTINE')}
                className="mt-1"
              />
              <div>
                <p className="font-semibold text-blue-400">BLS — ROUTINE</p>
                <p className="text-xs text-[#8b8b8b] mt-1">Basic Life Support, non-emergent transport.</p>
              </div>
            </label>

            <div className="w-full h-px bg-[#2a2a2a] mb-6" />
            
            <div className="mb-8">
              <p className="text-[#8b8b8b] text-xs font-semibold mb-2 uppercase">Assigned Unit</p>
              <div className="bg-[#1e1e1e] border border-[#2a2a2a] p-4 rounded flex items-center justify-between">
                <div>
                  <p className="font-bold">MED 14</p>
                  <p className="text-xs text-[#8b8b8b]">Available · 2.4 mi away</p>
                </div>
                <div className="w-3 h-3 bg-emerald-500 rounded-full" />
              </div>
            </div>

            <div className="mt-auto">
              {formError && (
                <div className="mb-4 p-3 bg-red-500/20 border border-red-500 rounded text-red-400 text-sm">
                  {formError}
                </div>
              )}
              <button 
                type="submit" 
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 rounded transition-colors shadow-lg"
              >
                START MISSION
              </button>
            </div>
            
          </form>
        </aside>

        {/* Map / Live Coverage */}
        <main className="flex-1 relative bg-[#101010] overflow-hidden">
          {/* Map Status Strip (Overlay) */}
          <div className="absolute bottom-6 left-6 z-10 bg-[#141414] border border-[#2a2a2a] rounded px-4 py-2 flex items-center space-x-3 shadow-lg pointer-events-none">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
            <span className="text-xs font-semibold text-[#8b8b8b] uppercase tracking-widest">Live Map Feed</span>
          </div>
          
          <MapEngine isRoadblockModeActive={false} />
        </main>
      </div>
    </div>
  );
}
