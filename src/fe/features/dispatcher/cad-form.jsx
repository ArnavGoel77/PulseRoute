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
  const [missionId, setMissionId] = useState('M-042');
  const [unitId, setUnitId] = useState('UNIT-1');
  const [base, setBase] = useState('18.9300, 72.8200');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [priority, setPriority] = useState('ALS_CRITICAL');
  const [formError, setFormError] = useState('');
  
  const [dispatchedMissions, setDispatchedMissions] = useState([]);

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

    if (!missionId || !unitId || !origin || !destination || !base) {
      setFormError('Case ID, Unit, Base, Origin, and Destination are required.');
      return;
    }

    if (!validateCoordinates(origin) || !validateCoordinates(destination) || !validateCoordinates(base)) {
      setFormError('Invalid Base, Origin or Destination. Must be Lat, Lng inside Mumbai bounds.');
      return;
    }

    wsClient.connect();

    const [start_lat, start_lng] = origin.split(',').map(s => s.trim());
    const [end_lat, end_lng] = destination.split(',').map(s => s.trim());
    const [base_lat, base_lng] = base.split(',').map(s => s.trim());

    // Hit the backend OSRM proxy
    fetch(`/api/route?start_lat=${start_lat}&start_lng=${start_lng}&end_lat=${end_lat}&end_lng=${end_lng}&base_lat=${base_lat}&base_lng=${base_lng}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setFormError(`Routing error: ${data.error}`);
          return;
        }
        
        wsClient.send({
          mission_id: missionId,
          path_polyline: data.path_polyline,
          priority: priority
        });
        
        setDispatchedMissions(prev => [...prev, {
          id: missionId,
          unit: unitId,
          priority: priority,
          status: 'DISPATCHED'
        }]);
        
        // Generate new random ID for next mission
        setMissionId(`M-0${Math.floor(Math.random() * 90) + 10}`);
      })
      .catch(err => {
        console.error(err);
        setFormError('Failed to contact backend for routing.');
      });
  };

  return (
    <div className="w-screen h-screen bg-[#0b0b0b] text-[#f5f5f5] flex flex-col font-sans overflow-hidden">
      
      {/* Header */}
      <header className="h-16 border-b border-[#2a2a2a] flex items-center px-6 justify-between shrink-0 bg-[#0b0b0b]">
        <div className="flex items-center space-x-4">
          <h1 className="text-lg font-bold tracking-wide">PulseRoute</h1>
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

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar / Dispatch Intake */}
        <aside className="w-[352px] border-r border-[#2a2a2a] bg-[#141414] flex flex-col shrink-0 min-h-0">
          
          {/* Form Scrollable Area */}
          <div className="p-6 flex-1 overflow-y-auto">
            <p className="text-[#8b8b8b] text-xs font-semibold tracking-widest mb-2 uppercase">Intake</p>
            <h2 className="text-2xl font-bold mb-6">New Mission</h2>
            
            <div className="w-full h-px bg-[#2a2a2a] mb-6" />

            <form onSubmit={handleDispatch} className="flex flex-col">
              
              <div className="mb-4 flex space-x-4">
                <div className="flex-1">
                  <label className="text-[#8b8b8b] text-xs font-semibold mb-2 block uppercase">Case ID</label>
                  <input 
                    type="text" 
                    value={missionId}
                    onChange={(e) => setMissionId(e.target.value)}
                    className="w-full bg-[#1e1e1e] border border-[#2a2a2a] rounded p-2 text-sm focus:outline-none focus:border-emerald-500 font-mono text-emerald-400"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[#8b8b8b] text-xs font-semibold mb-2 block uppercase">Unit</label>
                  <input 
                    type="text" 
                    value={unitId}
                    onChange={(e) => setUnitId(e.target.value)}
                    className="w-full bg-[#1e1e1e] border border-[#2a2a2a] rounded p-2 text-sm focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
              </div>

              <div className="mb-4">
                <label className="text-[#8b8b8b] text-xs font-semibold mb-2 block uppercase">Base (Lat, Lng)</label>
                <input 
                  type="text" 
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                  placeholder="18.9300, 72.8200"
                  className="w-full bg-[#1e1e1e] border border-[#2a2a2a] rounded p-2 text-sm focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <div className="mb-4">
                <label className="text-[#8b8b8b] text-xs font-semibold mb-2 block uppercase">Origin (Lat, Lng)</label>
                <input 
                  type="text" 
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                  placeholder="18.9221, 72.8234"
                  className="w-full bg-[#1e1e1e] border border-[#2a2a2a] rounded p-2 text-sm focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <div className="mb-6">
                <label className="text-[#8b8b8b] text-xs font-semibold mb-2 block uppercase">Destination (Lat, Lng)</label>
                <input 
                  type="text" 
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="18.9451, 72.8277"
                  className="w-full bg-[#1e1e1e] border border-[#2a2a2a] rounded p-2 text-sm focus:outline-none focus:border-emerald-500 font-mono"
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

              <label className="flex items-start space-x-3 mb-6 cursor-pointer">
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

              <div className="mt-2 shrink-0">
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
          </div>

          {/* Active Missions Log */}
          <div className="p-4 border-t border-[#2a2a2a] bg-[#1a1a1a] shrink-0 h-40 overflow-y-auto">
             <p className="text-[#8b8b8b] text-xs font-semibold tracking-widest mb-4 uppercase">Dispatched Missions</p>
             {dispatchedMissions.length === 0 ? (
               <p className="text-[#444] text-xs italic font-mono">No missions currently active.</p>
             ) : (
               <div className="flex flex-col gap-3">
                 {dispatchedMissions.map((m, i) => (
                   <div key={i} className="flex justify-between items-center border border-[#2a2a2a] p-2 rounded bg-[#141414]">
                     <div>
                       <span className="font-mono text-emerald-400 text-sm">{m.id}</span>
                       <span className="text-[#8b8b8b] text-xs ml-2">[{m.unit}]</span>
                     </div>
                     <span className="text-[10px] font-bold text-white bg-[#272727] px-2 py-1 rounded-full">{m.status}</span>
                   </div>
                 ))}
               </div>
             )}
          </div>
        </aside>

        {/* Map / Live Coverage */}
        <main className="flex-1 relative bg-[#101010] min-h-0 overflow-hidden">
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
