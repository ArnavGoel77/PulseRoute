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
  const [roadblockModeActive, setRoadblockModeActive] = useState(false);
  const [activeRoadblocks, setActiveRoadblocks] = useState([]);

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
      const legsUrl = `/api/route/legs?incident_lat=${incident_lat}&incident_lng=${incident_lng}&hospital_lat=${hospital_lat}&hospital_lng=${hospital_lng}&unit_id=${encodeURIComponent(unit_id_param)}&base_lat=${selectedDriver.lat}&base_lng=${selectedDriver.lng}`;

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

      setMissionId(generateMissionId());
      setUnitId('');
      setOrigin('');
      setDestination('');
    } catch (err) {
      console.error(err);
      setFormError('Failed to contact backend for routing. Is the server running?');
    }
    setIsDispatching(false);
  };

  const handleReset = () => {
    wsClient.send({ type: 'RESET_SIMULATION' });
  };

  const handleRemoveRoadblock = (id) => {
    wsClient.send({ type: 'REMOVE_OBSTRUCTION', id });
  };

  useEffect(() => {
    const unsubReset = wsClient.on('RESET_SIMULATION', () => {
      setDispatchedMissions([]);
    });
    // Listen for phase changes globally to update the dispatched missions log
    const unsubPhase = wsClient.on('PHASE_CHANGE', ({ mission_id, new_phase }) => {
      if (new_phase === 'complete') {
        setDispatchedMissions(prev => prev.filter(m => m.id !== mission_id));
      } else {
        setDispatchedMissions(prev => prev.map(m =>
          m.id === mission_id
            ? { ...m, phase: new_phase, status: new_phase === 'to_base' ? 'RETURNING' : 'EN ROUTE' }
            : m
        ));
      }
    });

    const unsubIncident = wsClient.on('INCIDENT_LOGGED', (rb) => {
      setActiveRoadblocks(prev => {
        if (prev.find(r => r.id === rb.id)) return prev;
        return [...prev, rb];
      });
    });

    const unsubRemoveObstruction = wsClient.on('REMOVE_OBSTRUCTION', ({ id }) => {
      setActiveRoadblocks(prev => prev.filter(rb => rb.id !== id));
    });

    return () => { unsubReset(); unsubPhase(); unsubIncident(); unsubRemoveObstruction(); };
  }, []);

  return (
    <div className="w-screen h-screen bg-gray-100 dark:bg-[#0b0b0b] text-gray-900 dark:text-[#f5f5f5] flex flex-col font-sans overflow-hidden transition-colors duration-300">

      {/* Header */}
      <header className="border-b border-gray-300 dark:border-[#2a2a2a] flex items-center px-4 md:px-6 justify-between shrink-0 bg-white dark:bg-[#0b0b0b] transition-colors duration-300 shadow-sm dark:shadow-none h-14">
        <div className="flex items-center gap-2 md:gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 md:w-7 md:h-7 bg-emerald-500 rounded-lg flex items-center justify-center shadow-[0_0_10px_rgba(16,185,129,0.4)]">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 md:w-4 md:h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="2 12 6 12 8 4 10 20 12 10 14 15 16 12 22 12" />
              </svg>
            </div>
            <h1 className="text-[14px] md:text-[15px] font-extrabold tracking-tight">
              <span className="text-emerald-600 dark:text-emerald-400">Pulse</span><span className="text-gray-900 dark:text-white">Route</span>
            </h1>
          </div>
          <div className="w-px h-5 bg-gray-300 dark:bg-[#2a2a2a] transition-colors duration-300 hidden sm:block" />
          <span className="text-gray-500 dark:text-[#8b8b8b] text-xs md:text-sm hidden sm:block">CAD Dispatch</span>
          <div className="w-px h-5 bg-gray-300 dark:bg-[#2a2a2a] transition-colors duration-300 hidden md:block" />
          <span className="text-gray-500 dark:text-[#8b8b8b] text-xs md:text-sm hidden md:block">SHIFT: 14:00 - 22:00</span>
        </div>
        <div className="flex items-center space-x-2 md:space-x-3">
          <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
          <span className="text-xs md:text-sm text-gray-500 dark:text-[#8b8b8b] hidden sm:block">System Online</span>
          <span className="text-xs md:text-sm font-mono text-gray-900 dark:text-[#f5f5f5] md:ml-4">{drivers.length} Unit{drivers.length !== 1 ? 's' : ''} Active</span>
        </div>
      </header>

      {/* Main content — stacks vertically on mobile, side-by-side on desktop */}
      <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-hidden">
        {/* Map — top on mobile, right on desktop */}
        <main className="order-first md:order-last flex-1 relative bg-gray-200 dark:bg-[#101010] min-h-0 overflow-hidden transition-colors duration-300 z-0 h-[42vh] md:h-auto">
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 bg-white dark:bg-[#141414]/95 border border-gray-300 dark:border-[#2a2a2a] rounded-full px-5 py-2 flex items-center space-x-2.5 shadow-xl pointer-events-none transition-colors duration-300 backdrop-blur-sm">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping shrink-0" />
            <span className="text-xs font-bold text-gray-600 dark:text-[#8b8b8b] uppercase tracking-widest whitespace-nowrap">Live Map Feed — All Units</span>
          </div>
          <MapEngine isRoadblockModeActive={false} />
        </main>

        {/* Sidebar */}
        <aside className="order-last md:order-first w-full md:w-[352px] border-t md:border-t-0 md:border-r border-gray-300 dark:border-[#2a2a2a] bg-white dark:bg-[#141414] flex flex-col shrink-0 min-h-0 transition-colors duration-300 md:shadow-lg dark:shadow-none z-10">

          {/* Form Scrollable Area */}
          <div className="p-6 flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
            <p className="text-gray-500 dark:text-[#8b8b8b] text-xs font-semibold tracking-widest mb-2 uppercase">Intake</p>
            <h2 className="text-2xl font-bold mb-4">New Mission</h2>
            <div className="w-full h-px bg-gray-300 dark:bg-[#2a2a2a] mb-4 transition-colors duration-300" />

            <form onSubmit={handleDispatch} className="flex flex-col gap-4">

              <div className="flex space-x-3">
                <div className="flex-1">
                  <label className="text-gray-500 dark:text-[#8b8b8b] text-xs font-semibold mb-2 block uppercase">Case ID</label>
                  <input
                    type="text"
                    value={missionId}
                    onChange={e => setMissionId(e.target.value)}
                    className="w-full bg-gray-50 dark:bg-[#1e1e1e] border border-gray-300 dark:border-[#2a2a2a] rounded p-2.5 text-sm focus:outline-none focus:border-emerald-500 font-mono text-emerald-600 dark:text-emerald-400 transition-colors duration-300"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-gray-500 dark:text-[#8b8b8b] text-xs font-semibold mb-2 block uppercase">
                    Unit
                    {closestDriver && (
                      <span className="ml-2 text-emerald-600 dark:text-emerald-400 normal-case font-normal">
                        ← {closestDriver.driver.id} ({closestDriver.distanceKm.toFixed(1)} km)
                      </span>
                    )}
                  </label>
                  <select
                    value={unitId}
                    onChange={e => setUnitId(e.target.value)}
                    className="w-full bg-gray-50 dark:bg-[#1e1e1e] border border-gray-300 dark:border-[#2a2a2a] rounded p-2.5 text-sm focus:outline-none focus:border-emerald-500 font-mono transition-colors duration-300 appearance-none"
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
                <label className="text-gray-500 dark:text-[#8b8b8b] text-xs font-semibold mb-2 block uppercase">Origin / Incident (Lat, Lng)</label>
                <input
                  type="text"
                  value={origin}
                  onChange={e => setOrigin(e.target.value)}
                  placeholder="18.9221, 72.8234"
                  className="w-full bg-gray-50 dark:bg-[#1e1e1e] border border-gray-300 dark:border-[#2a2a2a] rounded p-2.5 text-sm focus:outline-none focus:border-emerald-500 font-mono transition-colors duration-300"
                />
              </div>

              <div>
                <label className="text-gray-500 dark:text-[#8b8b8b] text-xs font-semibold mb-2 block uppercase">Destination / Hospital (Lat, Lng)</label>
                <input
                  type="text"
                  value={destination}
                  onChange={e => setDestination(e.target.value)}
                  placeholder="18.9451, 72.8277"
                  className="w-full bg-gray-50 dark:bg-[#1e1e1e] border border-gray-300 dark:border-[#2a2a2a] rounded p-2.5 text-sm focus:outline-none focus:border-emerald-500 font-mono transition-colors duration-300"
                />
              </div>

              <p className="text-gray-500 dark:text-[#8b8b8b] text-xs font-semibold uppercase mt-1">Triage Priority</p>

              <label className="flex items-start space-x-3 cursor-pointer p-2.5 rounded-lg border border-gray-200 dark:border-transparent hover:border-red-200 dark:hover:border-transparent hover:bg-red-50 dark:hover:bg-transparent transition-colors">
                <input type="radio" name="priority" value="ALS_CRITICAL" checked={priority === 'ALS_CRITICAL'} onChange={() => setPriority('ALS_CRITICAL')} className="mt-1 accent-red-500" />
                <div>
                  <p className="font-bold text-red-700 dark:text-red-400">ALS — CRITICAL</p>
                  <p className="text-xs text-gray-500 dark:text-[#8b8b8b] mt-0.5">Advanced Life Support required immediately.</p>
                </div>
              </label>

              <label className="flex items-start space-x-3 cursor-pointer p-2.5 rounded-lg border border-gray-200 dark:border-transparent hover:border-blue-200 dark:hover:border-transparent hover:bg-blue-50 dark:hover:bg-transparent transition-colors">
                <input type="radio" name="priority" value="BLS_ROUTINE" checked={priority === 'BLS_ROUTINE'} onChange={() => setPriority('BLS_ROUTINE')} className="mt-1 accent-blue-500" />
                <div>
                  <p className="font-bold text-blue-700 dark:text-blue-400">BLS — ROUTINE</p>
                  <p className="text-xs text-gray-500 dark:text-[#8b8b8b] mt-0.5">Basic Life Support, non-emergent transport.</p>
                </div>
              </label>

              <div className="mt-2 shrink-0 flex flex-col gap-3">
                {formError && <div className="p-3 bg-red-500/20 border border-red-500 rounded text-red-400 text-sm">{formError}</div>}
                <button type="submit" disabled={isDispatching}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-4 rounded transition-colors shadow-lg">
                  {isDispatching ? 'ROUTING...' : 'START MISSION'}
                </button>
                <button type="button" onClick={handleReset}
                  className="w-full bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/60 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 font-bold py-3 rounded transition-colors">
                  STOP / RESET SIMULATION
                </button>
                <button type="button" onClick={() => setRoadblockModeActive(!roadblockModeActive)}
                  className={`w-full border font-bold py-3 rounded transition-colors flex items-center justify-between px-4 ${roadblockModeActive ? 'bg-red-900/60 border-red-500 text-red-300 animate-pulse' : 'bg-[#272727] hover:bg-[#333] border-[#2a2a2a] text-[#f5f5f5]'}`}>
                  <span>{roadblockModeActive ? 'CANCEL ROADBLOCK' : 'DROP ROADBLOCK'}</span>
                  <span className="font-mono text-xs">{roadblockModeActive ? '[ × ]' : '[ + ]'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Active Missions Log */}
          <div className="border-t border-gray-300 dark:border-[#2a2a2a] bg-gray-50 dark:bg-[#1a1a1a] shrink-0 h-44 overflow-y-auto p-4 transition-colors duration-300">
            <p className="text-gray-500 dark:text-[#8b8b8b] text-xs font-semibold tracking-widest mb-3 uppercase">Active Missions ({dispatchedMissions.length})</p>
            {dispatchedMissions.length === 0 ? (
              <p className="text-gray-400 dark:text-[#444] text-xs italic font-mono">No missions currently active.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {dispatchedMissions.map((m, i) => (
                  <div key={i} className="flex justify-between items-center border border-gray-300 dark:border-[#2a2a2a] p-2 rounded bg-white dark:bg-[#141414] transition-colors duration-300">
                    <div>
                      <span className="font-mono text-emerald-600 dark:text-emerald-400 text-sm font-bold">{m.id}</span>
                      <span className="text-gray-500 dark:text-[#8b8b8b] text-xs ml-2">[{m.unit}]</span>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-[10px] font-bold text-white bg-gray-800 dark:bg-[#272727] px-2 py-0.5 rounded-full">{m.status}</span>
                      <span className="text-[9px] text-gray-500 dark:text-[#8b8b8b] font-mono">{m.phase}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Active Roadblocks Log */}
          {activeRoadblocks.length > 0 && (
            <div className="border-t border-[#2a2a2a] bg-[#1a1a1a] shrink-0 h-32 overflow-y-auto p-4">
              <p className="text-[#8b8b8b] text-xs font-semibold tracking-widest mb-3 uppercase">Active Roadblocks</p>
              <div className="flex flex-col gap-2">
                {activeRoadblocks.map((rb, i) => (
                  <div key={rb.id || i} className="flex justify-between items-center border border-[#2a2a2a] p-2 rounded bg-[#141414] group">
                    <span className="font-mono text-red-400 text-sm font-bold">{rb.lat?.toFixed(4)}, {rb.lng?.toFixed(4)}</span>
                    <button 
                      type="button"
                      onClick={() => handleRemoveRoadblock(rb.id)}
                      className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 font-bold px-2 transition-opacity cursor-pointer text-sm"
                      title="Remove roadblock"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
<<<<<<< HEAD

        {/* Map */}
        <main className="flex-1 relative bg-[#101010] min-h-0 overflow-hidden">
          <div className="absolute bottom-6 left-6 z-10 bg-[#141414] border border-[#2a2a2a] rounded px-4 py-2 flex items-center space-x-3 shadow-lg pointer-events-none">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
            <span className="text-xs font-semibold text-[#8b8b8b] uppercase tracking-widest">Live Map Feed — All Units</span>
          </div>
          {roadblockModeActive && (
            <div className="absolute top-12 left-1/2 -translate-x-1/2 z-20 bg-red-900/80 border border-red-500 px-4 py-2 rounded text-red-300 text-xs font-semibold tracking-widest pointer-events-none">
              ROADBLOCK MODE — CLICK MAP TO DROP INCIDENT
            </div>
          )}
          <MapEngine 
            isRoadblockModeActive={roadblockModeActive} 
            onRoadblockPlaced={() => setRoadblockModeActive(false)} 
          />
        </main>
=======
>>>>>>> d263dd7 (ui changes)
      </div>
    </div>
  );
}
