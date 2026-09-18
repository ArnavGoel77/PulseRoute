import React, { useState, useEffect } from 'react';
import wsClient from '../../services/websocket-client';
import MapEngine from '../map-engine/map-engine';

// Mumbai Bounding Box (Demo Area)
const MUMBAI_BOUNDS = {
  minLat: 18.8, maxLat: 19.3,
  minLng: 72.7, maxLng: 73.1
};

const validateCoords = (str) => {
  if (!str) return false;
  const parts = str.split(',');
  if (parts.length !== 2) return false;
  const lat = parseFloat(parts[0].trim());
  const lng = parseFloat(parts[1].trim());
  if (isNaN(lat) || isNaN(lng)) return false;
  return lat >= MUMBAI_BOUNDS.minLat && lat <= MUMBAI_BOUNDS.maxLat &&
         lng >= MUMBAI_BOUNDS.minLng && lng <= MUMBAI_BOUNDS.maxLng;
};

export default function CadForm() {
  useEffect(() => { wsClient.connect(); }, []);

  const [missionId, setMissionId]       = useState('M-042');
  const [unitId, setUnitId]             = useState('UNIT-1');
  const [incident, setIncident]         = useState('');
  const [hospital, setHospital]         = useState('');
  const [priority, setPriority]         = useState('ALS_CRITICAL');
  const [formError, setFormError]       = useState('');
  const [loading, setLoading]           = useState(false);
  const [dispatchedMissions, setDispatchedMissions] = useState([]);

  const handleDispatch = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!missionId || !unitId || !incident || !hospital) {
      setFormError('All fields are required.');
      return;
    }
    if (!validateCoords(incident) || !validateCoords(hospital)) {
      setFormError('Invalid coordinates. Use Lat, Lng inside Mumbai bounds.');
      return;
    }

    const [inc_lat, inc_lng] = incident.split(',').map(s => s.trim());
    const [hos_lat, hos_lng] = hospital.split(',').map(s => s.trim());

    setLoading(true);
    try {
      // Fetch 3 separate leg polylines from backend
      const resp = await fetch(
        `/api/route/legs?incident_lat=${inc_lat}&incident_lng=${inc_lng}&hospital_lat=${hos_lat}&hospital_lng=${hos_lng}&unit_id=${unitId}`
      );
      const data = await resp.json();

      if (data.error) {
        setFormError(`Routing error: ${data.error} — ${data.message || ''}`);
        setLoading(false);
        return;
      }

      // Send full 3-leg mission over WebSocket — backend stores and broadcasts to all clients
      wsClient.send({
        mission_id: missionId,
        priority,
        leg_to_incident: data.leg_to_incident,
        leg_to_hospital: data.leg_to_hospital,
        leg_to_base:     data.leg_to_base,
        incident_coords: data.incident_coords,
        hospital_coords: data.hospital_coords,
        base_coords:     data.base_coords
      });

      setDispatchedMissions(prev => [...prev, { id: missionId, unit: unitId, priority, status: 'DISPATCHED' }]);
      setMissionId(`M-0${Math.floor(Math.random() * 90) + 10}`);
    } catch (err) {
      console.error(err);
      setFormError('Failed to contact backend for routing. Is the server running?');
    }
    setLoading(false);
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
        </div>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-[352px] border-r border-[#2a2a2a] bg-[#141414] flex flex-col shrink-0 min-h-0">
          <div className="p-6 flex-1 overflow-y-auto">
            <p className="text-[#8b8b8b] text-xs font-semibold tracking-widest mb-2 uppercase">Intake</p>
            <h2 className="text-2xl font-bold mb-6">New Mission</h2>
            <div className="w-full h-px bg-[#2a2a2a] mb-6" />

            <form onSubmit={handleDispatch} className="flex flex-col">
              <div className="mb-4 flex space-x-4">
                <div className="flex-1">
                  <label className="text-[#8b8b8b] text-xs font-semibold mb-2 block uppercase">Case ID</label>
                  <input type="text" value={missionId} onChange={e => setMissionId(e.target.value)}
                    className="w-full bg-[#1e1e1e] border border-[#2a2a2a] rounded p-2 text-sm focus:outline-none focus:border-emerald-500 font-mono text-emerald-400" />
                </div>
                <div className="flex-1">
                  <label className="text-[#8b8b8b] text-xs font-semibold mb-2 block uppercase">Unit</label>
                  <input type="text" value={unitId} onChange={e => setUnitId(e.target.value)}
                    className="w-full bg-[#1e1e1e] border border-[#2a2a2a] rounded p-2 text-sm focus:outline-none focus:border-emerald-500 font-mono" />
                </div>
              </div>

              <div className="mb-4">
                <label className="text-[#8b8b8b] text-xs font-semibold mb-2 block uppercase">Incident Location (Lat, Lng)</label>
                <input type="text" value={incident} onChange={e => setIncident(e.target.value)}
                  placeholder="19.1136, 72.8697"
                  className="w-full bg-[#1e1e1e] border border-[#2a2a2a] rounded p-2 text-sm focus:outline-none focus:border-emerald-500 font-mono" />
              </div>

              <div className="mb-6">
                <label className="text-[#8b8b8b] text-xs font-semibold mb-2 block uppercase">Hospital Location (Lat, Lng)</label>
                <input type="text" value={hospital} onChange={e => setHospital(e.target.value)}
                  placeholder="19.0135, 72.8166"
                  className="w-full bg-[#1e1e1e] border border-[#2a2a2a] rounded p-2 text-sm focus:outline-none focus:border-emerald-500 font-mono" />
                <p className="text-[#555] text-[10px] mt-1 font-mono">Base location set from Driver HUD</p>
              </div>

              <p className="text-[#8b8b8b] text-xs font-semibold mb-3 uppercase">Triage Priority</p>
              <label className="flex items-start space-x-3 mb-4 cursor-pointer">
                <input type="radio" name="priority" value="ALS_CRITICAL" checked={priority === 'ALS_CRITICAL'} onChange={() => setPriority('ALS_CRITICAL')} className="mt-1" />
                <div>
                  <p className="font-semibold text-red-400">ALS — CRITICAL</p>
                  <p className="text-xs text-[#8b8b8b] mt-1">Advanced Life Support required immediately.</p>
                </div>
              </label>
              <label className="flex items-start space-x-3 mb-6 cursor-pointer">
                <input type="radio" name="priority" value="BLS_ROUTINE" checked={priority === 'BLS_ROUTINE'} onChange={() => setPriority('BLS_ROUTINE')} className="mt-1" />
                <div>
                  <p className="font-semibold text-blue-400">BLS — ROUTINE</p>
                  <p className="text-xs text-[#8b8b8b] mt-1">Basic Life Support, non-emergent transport.</p>
                </div>
              </label>

              <div className="mt-2 shrink-0">
                {formError && <div className="mb-4 p-3 bg-red-500/20 border border-red-500 rounded text-red-400 text-sm">{formError}</div>}
                <button type="submit" disabled={loading}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-4 rounded transition-colors shadow-lg">
                  {loading ? 'ROUTING...' : 'START MISSION'}
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

        {/* Map */}
        <main className="flex-1 relative bg-[#101010] min-h-0 overflow-hidden">
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
