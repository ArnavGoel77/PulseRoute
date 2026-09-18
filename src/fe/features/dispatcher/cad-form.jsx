import React, { useState, useEffect } from 'react';
import wsClient from '../../services/websocket-client';
import { driverStore } from '../../services/driver-store';
import MapEngine from '../map-engine/map-engine';

// Mumbai Bounding Box (Demo Area)
const MUMBAI_BOUNDS = {
  minLat: 18.8, maxLat: 19.3,
  minLng: 72.7, maxLng: 73.1
};

function validateCoordinates(coordString) {
  const parts = coordString.split(',');
  if (parts.length !== 2) return false;
  const lat = parseFloat(parts[0].trim());
  const lng = parseFloat(parts[1].trim());
  if (isNaN(lat) || isNaN(lng)) return false;
  return (
    lat >= MUMBAI_BOUNDS.minLat && lat <= MUMBAI_BOUNDS.maxLat &&
    lng >= MUMBAI_BOUNDS.minLng && lng <= MUMBAI_BOUNDS.maxLng
  );
}

function generateMissionId() {
  return `M-${Math.floor(Math.random() * 900) + 100}`;
}

export default function CadForm() {
  const [missionId, setMissionId]       = useState(generateMissionId);
  const [unitId, setUnitId]             = useState('');
  const [origin, setOrigin]             = useState('');
  const [destination, setDestination]   = useState('');
  const [priority, setPriority]         = useState('ALS_CRITICAL');
  const [formError, setFormError]       = useState('');
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchedMissions, setDispatchedMissions] = useState([]);
  const [drivers, setDrivers]           = useState([]);
  const [closestDriver, setClosestDriver] = useState(null);

  // Subscribe to driver store
  useEffect(() => {
    const unsub = driverStore.subscribe(setDrivers);
    // Also subscribe to incoming DRIVER_REGISTERED from WS (other tabs/backend)
    const unsubWs = wsClient.on('DRIVER_REGISTERED', ({ driver_id, lat, lng }) => {
      driverStore.addOrUpdate(driver_id, lat, lng);
    });
    wsClient.connect();
    return () => { unsub(); unsubWs(); };
  }, []);

  // Auto-detect closest driver when origin changes
  useEffect(() => {
    if (!validateCoordinates(origin)) {
      setClosestDriver(null);
      return;
    }
    const [lat, lng] = origin.split(',').map(s => parseFloat(s.trim()));
    const result = driverStore.findClosest(lat, lng);
    setClosestDriver(result);
    if (result && !unitId) {
      setUnitId(result.driver.id);
    }
  }, [origin, drivers]);

  const handleDispatch = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!missionId || !unitId || !origin || !destination) {
      setFormError('Case ID, Unit, Origin, and Destination are required.');
      return;
    }
    if (!validateCoordinates(origin)) {
      setFormError('Invalid Origin. Must be Lat, Lng inside Mumbai bounds.');
      return;
    }
    if (!validateCoordinates(destination)) {
      setFormError('Invalid Destination. Must be Lat, Lng inside Mumbai bounds.');
      return;
    }

    setIsDispatching(true);

    const [incident_lat, incident_lng] = origin.split(',').map(s => s.trim());
    const [hospital_lat, hospital_lng] = destination.split(',').map(s => s.trim());

    // Find the selected driver to get their base location
    const selectedDriver = drivers.find(d => d.id === unitId);
    const unit_id_param = unitId.replace(/\s/g, '-'); // e.g. "AMB 1" -> "AMB-1"

    try {
      // Use the /legs endpoint which returns 3 separate polylines for each phase.
      // Do NOT pass driver lat/lng as base — the driver's live position is wherever
      // they are currently driving (the incident area), not their dispatch station.
      // The /legs backend resolves base from Redis (unit registration) or uses the default.
      const legsUrl = `/api/route/legs?incident_lat=${incident_lat}&incident_lng=${incident_lng}&hospital_lat=${hospital_lat}&hospital_lng=${hospital_lng}&unit_id=${encodeURIComponent(unit_id_param)}`;

      const res = await fetch(legsUrl);
      const data = await res.json();

      if (data.error) {
        setFormError(`Routing error: ${data.error}`);
        setIsDispatching(false);
        return;
      }

      // Build the full MISSION_START payload the backend expects
      const missionPayload = {
        mission_id: missionId,
        priority,
        unit_id: unitId,
        leg_to_incident: data.leg_to_incident,
        leg_to_hospital: data.leg_to_hospital,
        leg_to_base: data.leg_to_base,
        incident_coords: data.incident_coords,
        hospital_coords: data.hospital_coords,
        base_coords: data.base_coords,
      };

      wsClient.send(missionPayload);

      // Mark driver as on mission in local store
      driverStore.setOnMission(unitId, missionId);

      setDispatchedMissions(prev => [...prev, {
        id: missionId,
        unit: unitId,
        priority,
        status: 'EN ROUTE',
        phase: 'to_incident'
      }]);

      // Listen for phase changes to update our mission log
      wsClient.on('PHASE_CHANGE', ({ mission_id, new_phase }) => {
        if (mission_id !== missionId) return;
        setDispatchedMissions(prev => prev.map(m =>
          m.id === mission_id ? { ...m, phase: new_phase, status: new_phase === 'to_base' ? 'RETURNING' : 'EN ROUTE' } : m
        ));
      });

      setMissionId(generateMissionId());
      setUnitId('');
      setOrigin('');
      setMissionId(`M-0${Math.floor(Math.random() * 90) + 10}`);
    } catch (err) {
      console.error(err);
      setFormError('Failed to contact backend for routing. Is the server running?');
    }
    setIsDispatching(false);
  };

  const handleReset = () => {
    wsClient.send({ type: 'RESET_SIMULATION' });
  };

  useEffect(() => {
    const unsubReset = wsClient.on('RESET_SIMULATION', () => {
      setDispatchedMissions([]);
    });
    return () => unsubReset();
  }, []);

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
          <span className="text-sm font-mono text-[#f5f5f5] ml-4">{drivers.length} Unit{drivers.length !== 1 ? 's' : ''} Active</span>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-[352px] border-r border-[#2a2a2a] bg-[#141414] flex flex-col shrink-0 min-h-0">

          {/* Form Scrollable Area */}
          <div className="p-6 flex-1 min-h-0 overflow-y-auto">
            <p className="text-[#8b8b8b] text-xs font-semibold tracking-widest mb-2 uppercase">Intake</p>
            <h2 className="text-2xl font-bold mb-4">New Mission</h2>
            <div className="w-full h-px bg-[#2a2a2a] mb-4" />

            <form onSubmit={handleDispatch} className="flex flex-col gap-4">

              <div className="flex space-x-3">
                <div className="flex-1">
                  <label className="text-[#8b8b8b] text-xs font-semibold mb-2 block uppercase">Case ID</label>
                  <input
                    type="text"
                    value={missionId}
                    onChange={e => setMissionId(e.target.value)}
                    className="w-full bg-[#1e1e1e] border border-[#2a2a2a] rounded p-2.5 text-sm focus:outline-none focus:border-emerald-500 font-mono text-emerald-400"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[#8b8b8b] text-xs font-semibold mb-2 block uppercase">
                    Unit
                    {closestDriver && (
                      <span className="ml-2 text-emerald-400 normal-case font-normal">
                        ← {closestDriver.driver.id} ({closestDriver.distanceKm.toFixed(1)} km)
                      </span>
                    )}
                  </label>
                  <select
                    value={unitId}
                    onChange={e => setUnitId(e.target.value)}
                    className="w-full bg-[#1e1e1e] border border-[#2a2a2a] rounded p-2.5 text-sm focus:outline-none focus:border-emerald-500 font-mono"
                  >
                    <option value="">Select unit...</option>
                    {drivers.filter(d => d.status === 'AVAILABLE').map(d => (
                      <option key={d.id} value={d.id}>{d.id}</option>
                    ))}
                    {drivers.filter(d => d.status !== 'AVAILABLE').map(d => (
                      <option key={d.id} value={d.id} disabled>{d.id} (ON MISSION)</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[#8b8b8b] text-xs font-semibold mb-2 block uppercase">Origin / Incident (Lat, Lng)</label>
                <input
                  type="text"
                  value={origin}
                  onChange={e => setOrigin(e.target.value)}
                  placeholder="18.9221, 72.8234"
                  className="w-full bg-[#1e1e1e] border border-[#2a2a2a] rounded p-2.5 text-sm focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <div>
                <label className="text-[#8b8b8b] text-xs font-semibold mb-2 block uppercase">Destination / Hospital (Lat, Lng)</label>
                <input
                  type="text"
                  value={destination}
                  onChange={e => setDestination(e.target.value)}
                  placeholder="18.9451, 72.8277"
                  className="w-full bg-[#1e1e1e] border border-[#2a2a2a] rounded p-2.5 text-sm focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <p className="text-[#8b8b8b] text-xs font-semibold uppercase mt-1">Triage Priority</p>

              <label className="flex items-start space-x-3 cursor-pointer">
                <input type="radio" name="priority" value="ALS_CRITICAL" checked={priority === 'ALS_CRITICAL'} onChange={() => setPriority('ALS_CRITICAL')} className="mt-1" />
                <div>
                  <p className="font-semibold text-red-400">ALS — CRITICAL</p>
                  <p className="text-xs text-[#8b8b8b] mt-0.5">Advanced Life Support required immediately.</p>
                </div>
              </label>

              <label className="flex items-start space-x-3 cursor-pointer">
                <input type="radio" name="priority" value="BLS_ROUTINE" checked={priority === 'BLS_ROUTINE'} onChange={() => setPriority('BLS_ROUTINE')} className="mt-1" />
                <div>
                  <p className="font-semibold text-blue-400">BLS — ROUTINE</p>
                  <p className="text-xs text-[#8b8b8b] mt-0.5">Basic Life Support, non-emergent transport.</p>
                </div>
              </label>

              <div className="mt-2 shrink-0 flex flex-col gap-3">
                {formError && <div className="p-3 bg-red-500/20 border border-red-500 rounded text-red-400 text-sm">{formError}</div>}
                <button type="submit" disabled={isDispatching}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-4 rounded transition-colors shadow-lg">
                  {isDispatching ? 'ROUTING...' : 'START MISSION'}
                </button>
                <button type="button" onClick={handleReset}
                  className="w-full bg-red-900/30 hover:bg-red-900/60 border border-red-700 text-red-400 font-bold py-3 rounded transition-colors">
                  STOP / RESET SIMULATION
                </button>
              </div>
            </form>
          </div>

          {/* Active Missions Log */}
          <div className="border-t border-[#2a2a2a] bg-[#1a1a1a] shrink-0 h-44 overflow-y-auto p-4">
            <p className="text-[#8b8b8b] text-xs font-semibold tracking-widest mb-3 uppercase">Active Missions ({dispatchedMissions.length})</p>
            {dispatchedMissions.length === 0 ? (
              <p className="text-[#444] text-xs italic font-mono">No missions currently active.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {dispatchedMissions.map((m, i) => (
                  <div key={i} className="flex justify-between items-center border border-[#2a2a2a] p-2 rounded bg-[#141414]">
                    <div>
                      <span className="font-mono text-emerald-400 text-sm font-bold">{m.id}</span>
                      <span className="text-[#8b8b8b] text-xs ml-2">[{m.unit}]</span>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-[10px] font-bold text-white bg-[#272727] px-2 py-0.5 rounded-full">{m.status}</span>
                      <span className="text-[9px] text-[#8b8b8b] font-mono">{m.phase}</span>
                    </div>
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
            <span className="text-xs font-semibold text-[#8b8b8b] uppercase tracking-widest">Live Map Feed — All Units</span>
          </div>
          <MapEngine isRoadblockModeActive={false} />
        </main>
      </div>
    </div>
  );
}
