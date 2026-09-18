/**
 * TMC Command Dashboard — Fleet Management
 * Includes: Live map with all ambulances, Register Driver panel,
 * Active Missions board, Live Event Feed, Simulation Controls.
 */

import React, { useState, useEffect } from 'react';
import MapEngine from '../map-engine/map-engine';
import wsClient from '../../services/websocket-client';
import { driverStore } from '../../services/driver-store';

// Mumbai Bounding Box for validation
const MUMBAI_BOUNDS = { minLat: 18.8, maxLat: 19.3, minLng: 72.7, maxLng: 73.1 };

function validateCoord(v) {
  const n = parseFloat(v);
  return !isNaN(n);
}

export default function TmcCommandDashboard() {
  const [roadblockModeActive, setRoadblockModeActive] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [eventFeed, setEventFeed] = useState([
    { time: '--:--:--', text: 'TMC ONLINE — AWAITING MISSIONS', dim: false },
  ]);
  const [activeMissions, setActiveMissions] = useState([]);
  const [clock, setClock] = useState('');
  const [demoSpeed, setDemoSpeed] = useState(1);
  const [demoPaused, setDemoPaused] = useState(false);

  // Driver registration form
  const [driverIdInput, setDriverIdInput]   = useState('AMB-1');
  const [driverLat, setDriverLat]           = useState('');
  const [driverLng, setDriverLng]           = useState('');
  const [driverError, setDriverError]       = useState('');
  const [drivers, setDrivers]               = useState([]);

  // ── Live UTC Clock ──────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => setClock(new Date().toUTCString().split(' ')[4]);
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  // ── Driver Store Subscription ───────────────────────────────────────────────
  useEffect(() => {
    const unsub = driverStore.subscribe(setDrivers);
    return unsub;
  }, []);

  // ── WebSocket Subscriptions ─────────────────────────────────────────────────
  useEffect(() => {
    wsClient.connect(true);

    const addEvent = (text, dim = false) => {
      const time = new Date().toUTCString().split(' ')[4];
      setEventFeed(prev => [{ time, text, dim }, ...prev].slice(0, 30));
    };

    const unsubConn     = wsClient.on('__connected',    () => { setWsConnected(true);  addEvent('WS CONNECTED TO BACKEND'); });
    const unsubDisconn  = wsClient.on('__disconnected', () => { setWsConnected(false); addEvent('WS RECONNECTING...', true); });

    const unsubMission = wsClient.on('MISSION_START', ({ mission_id, priority, unit_id }) => {
      setActiveMissions(prev => {
        const exists = prev.find(m => m.id === mission_id);
        if (exists) return prev;
        return [...prev, { id: mission_id, status: 'EN ROUTE', priority, unit: unit_id, phase: 'to_incident' }];
      });
      addEvent(`MISSION ${mission_id} STARTED — ${priority || ''} [${unit_id || '?'}]`);
    });

    const unsubPhase = wsClient.on('PHASE_CHANGE', ({ mission_id, new_phase }) => {
      setActiveMissions(prev => prev.map(m =>
        m.id === mission_id ? {
          ...m,
          phase: new_phase,
          status: new_phase === 'to_base' ? 'RETURNING' : new_phase === 'to_hospital' ? 'TRANSPORTING' : 'EN ROUTE'
        } : m
      ));
      const labels = { to_incident: 'EN ROUTE', to_hospital: 'TRANSPORTING PATIENT', to_base: 'RETURNING TO BASE' };
      addEvent(`MISSION ${mission_id} → ${labels[new_phase] || new_phase}`);
    });

    const unsubTelemetry = wsClient.on('TELEMETRY_UPDATE', ({ mission_id }) => {
      if (Math.random() > 0.05) return;
      addEvent(`TELEMETRY ${mission_id} — GPS LOCK`, true);
    });

    const unsubPreempt  = wsClient.on('SIGNAL_PREEMPT', ({ intersection_id }) => addEvent(`SIG ${intersection_id} → GREEN PREEMPTED`));
    const unsubRelease  = wsClient.on('SIGNAL_RELEASE', ({ intersection_id }) => addEvent(`SIG ${intersection_id} → ALL RED CLEARED`, true));

    const unsubIncident = wsClient.on('INCIDENT_LOGGED', ({ lat, lng }) => {
      addEvent(`INCIDENT @ ${lat?.toFixed(4)}, ${lng?.toFixed(4)} — REROUTING`);
      setActiveMissions(prev => prev.map(m => ({ ...m, status: 'REROUTING' })));
    });

    const unsubRoute = wsClient.on('ROUTE_UPDATED', ({ mission_id }) => {
      addEvent(`ROUTE UPDATED — MISSION ${mission_id}`);
      setActiveMissions(prev => prev.map(m => m.id === mission_id ? { ...m, status: 'EN ROUTE' } : m));
    });

    const unsubDriver = wsClient.on('DRIVER_REGISTERED', ({ driver_id, lat, lng }) => {
      driverStore.addOrUpdate(driver_id, lat, lng);
      addEvent(`UNIT ${driver_id} REGISTERED @ ${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}`);
    });

    return () => {
      unsubConn(); unsubDisconn(); unsubMission(); unsubPhase();
      unsubTelemetry(); unsubPreempt(); unsubRelease(); unsubIncident();
      unsubRoute(); unsubDriver();
    };
  }, []);

  const handleRegisterDriver = (e) => {
    e.preventDefault();
    setDriverError('');
    if (!driverIdInput.trim()) { setDriverError('Unit ID required.'); return; }
    if (!validateCoord(driverLat) || !validateCoord(driverLng)) {
      setDriverError('Valid Lat and Lng required.');
      return;
    }
    const lat = parseFloat(driverLat);
    const lng = parseFloat(driverLng);
    driverStore.addOrUpdate(driverIdInput.trim(), lat, lng);
    // Broadcast to all clients
    wsClient.send({ driver_id: driverIdInput.trim(), lat, lng });

    // Increment default ID
    const match = driverIdInput.match(/^([A-Z]+-?)(\d+)$/);
    if (match) setDriverIdInput(`${match[1]}${parseInt(match[2]) + 1}`);
    setDriverLat('');
    setDriverLng('');
  };

  const handleRoadblockClick  = () => setRoadblockModeActive(prev => !prev);
  const handleRoadblockPlaced = () => setRoadblockModeActive(false);

  const handleSpeedChange = (speed) => {
    setDemoSpeed(speed);
    wsClient.send({ speedMult: speed, paused: demoPaused });
  };

  const handlePauseToggle = () => {
    const nextPaused = !demoPaused;
    setDemoPaused(nextPaused);
    wsClient.send({ speedMult: demoSpeed, paused: nextPaused });
  };

  const PHASE_COLORS = {
    to_incident: 'text-red-400',
    to_hospital: 'text-yellow-400',
    to_base:     'text-emerald-400',
    REROUTING:   'text-orange-400',
  };

  return (
    <div className="bg-[#0b0b0b] flex items-start relative w-screen h-screen overflow-hidden">

      {/* ── Left: Live Map ── */}
      <div className="flex-[1_0_0] h-full min-w-px relative overflow-clip">
        <div className="absolute top-4 left-4 z-10 pointer-events-none">
          <p className="font-semibold text-[11px] text-[#8b8b8b] tracking-[1.32px]">CITY GRID / LIVE DIGITAL TWIN</p>
        </div>

        {roadblockModeActive && (
          <div className="absolute top-12 left-1/2 -translate-x-1/2 z-20 bg-red-900/80 border border-red-500 px-4 py-2 rounded text-red-300 text-xs font-semibold tracking-widest pointer-events-none">
            ROADBLOCK MODE — CLICK MAP TO DROP INCIDENT
          </div>
        )}

        {/* Fleet badge overlay */}
        <div className="absolute bottom-4 left-4 z-10 flex gap-2 flex-wrap">
          {drivers.map(d => (
            <div key={d.id} className={`px-2 py-1 rounded text-[10px] font-bold font-mono border ${d.status === 'ON_MISSION' ? 'bg-red-900/60 border-red-600 text-red-300' : 'bg-emerald-900/60 border-emerald-600 text-emerald-300'}`}>
              {d.id} · {d.status === 'ON_MISSION' ? 'MISSION' : 'AVAIL'}
            </div>
          ))}
        </div>

        <MapEngine
          isRoadblockModeActive={roadblockModeActive}
          onRoadblockPlaced={handleRoadblockPlaced}
        />
      </div>

      {/* ── Right: Control Panel ── */}
      <div className="bg-[#141414] border-l border-[#2a2a2a] flex flex-col h-full shrink-0 w-[360px] min-h-0">
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-6 flex flex-col gap-5">

          {/* Header */}
          <div className="flex flex-col gap-1 shrink-0">
            <p className="font-semibold text-[18px] text-[#f5f5f5]">CHAOS CONTROL</p>
            <p className="font-mono text-[12px] text-[#8b8b8b]">{`TMC-07  /  UTC  ${clock}`}</p>
          </div>

          {/* ── Register Driver ── */}
          <div className="flex flex-col gap-3 shrink-0">
            <p className="font-semibold text-[11px] text-[#8b8b8b] tracking-[1.32px] uppercase">Register Unit</p>
            <div className="bg-[#2a2a2a] h-px w-full" />
            <form onSubmit={handleRegisterDriver} className="flex flex-col gap-2">
              <input
                type="text"
                value={driverIdInput}
                onChange={e => setDriverIdInput(e.target.value)}
                placeholder="Unit code (AMB-1)"
                className="w-full bg-[#1e1e1e] border border-[#333] rounded px-3 py-2 text-xs font-mono text-emerald-400 focus:outline-none focus:border-emerald-500"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={driverLat}
                  onChange={e => setDriverLat(e.target.value)}
                  placeholder="Latitude"
                  className="flex-1 bg-[#1e1e1e] border border-[#333] rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-emerald-500"
                />
                <input
                  type="text"
                  value={driverLng}
                  onChange={e => setDriverLng(e.target.value)}
                  placeholder="Longitude"
                  className="flex-1 bg-[#1e1e1e] border border-[#333] rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>
              {driverError && <p className="text-red-400 text-[11px]">{driverError}</p>}
              <button
                type="submit"
                className="bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold py-2 rounded tracking-wider transition-colors"
              >
                + REGISTER UNIT
              </button>
            </form>

            {/* Registered drivers list */}
            {drivers.length > 0 && (
              <div className="flex flex-col gap-1 mt-1">
                {drivers.map(d => (
                  <div key={d.id} className="flex items-center justify-between bg-[#1e1e1e] border border-[#2a2a2a] rounded px-3 py-1.5">
                    <span className="font-mono text-xs text-emerald-400 font-bold">{d.id}</span>
                    <span className="font-mono text-[10px] text-[#8b8b8b]">{d.lat?.toFixed(4)}, {d.lng?.toFixed(4)}</span>
                    <span className={`text-[10px] font-bold ${d.status === 'ON_MISSION' ? 'text-red-400' : 'text-emerald-400'}`}>
                      {d.status === 'ON_MISSION' ? '● MISSION' : '● AVAIL'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Active Missions ── */}
          <div className="flex flex-col gap-2 shrink-0">
            <p className="font-semibold text-[11px] text-[#8b8b8b] tracking-[1.32px] uppercase">Active Missions ({activeMissions.length})</p>
            <div className="bg-[#2a2a2a] h-px w-full" />
            {activeMissions.length === 0 ? (
              <p className="font-mono text-[12px] text-[#444] italic">No active missions.</p>
            ) : (
              activeMissions.map(mission => (
                <div key={mission.id} className="border border-[#2a2a2a] flex flex-col gap-1 items-start px-3 py-2 w-full rounded">
                  <div className="flex items-center justify-between w-full">
                    <span className="font-mono text-[13px] text-[#f5f5f5] font-bold">{mission.id}</span>
                    <div className="flex items-center gap-2">
                      {mission.unit && <span className="text-[10px] text-emerald-400 font-mono">[{mission.unit}]</span>}
                      <span className="bg-[#272727] px-2 py-0.5 rounded-full text-[10px] text-[#8b8b8b] font-semibold">{mission.status}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between w-full">
                    <span className="font-mono text-[11px] text-[#8b8b8b]">{mission.priority}</span>
                    <span className={`font-mono text-[10px] font-bold ${PHASE_COLORS[mission.phase] || 'text-[#8b8b8b]'}`}>
                      {mission.phase?.replace(/_/g, ' ').toUpperCase()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* ── Live Event Feed ── */}
          <div className="flex flex-col gap-2 shrink-0">
            <p className="font-semibold text-[11px] text-[#8b8b8b] tracking-[1.32px] uppercase">Live Event Feed</p>
            <div className="bg-[#2a2a2a] h-px w-full" />
            <div className="flex flex-col gap-1 w-full max-h-40 overflow-y-auto">
              {eventFeed.map((ev, i) => (
                <p key={i} className={`font-mono text-[11px] leading-[16px] ${ev.dim ? 'text-[#555]' : 'text-[#f5f5f5]'}`}>
                  <span className="text-[#444] mr-2">{ev.time}</span>{ev.text}
                </p>
              ))}
            </div>
          </div>

          {/* ── Simulation Controls ── */}
          <div className="flex flex-col gap-3 shrink-0">
            <p className="font-semibold text-[11px] text-[#8b8b8b] tracking-[1.32px] uppercase">Simulation Controls</p>
            <div className="bg-[#2a2a2a] h-px w-full" />
            <p className="font-mono text-[12px] text-[#8b8b8b]">
              {roadblockModeActive ? '⚡ Click map to drop incident...' : 'Inject a network incident into the live model.'}
            </p>

            <button
              id="drop-roadblock-btn"
              onClick={handleRoadblockClick}
              className={`transition-colors border flex h-[44px] items-center justify-between px-4 shadow-md w-full cursor-pointer rounded
                ${roadblockModeActive ? 'bg-red-900/60 border-red-500 animate-pulse' : 'bg-[#272727] hover:bg-[#333] border-[#2a2a2a]'}`}
            >
              <p className={`font-semibold text-[11px] tracking-[1.32px] ${roadblockModeActive ? 'text-red-300' : 'text-[#f5f5f5]'}`}>
                {roadblockModeActive ? 'CANCEL ROADBLOCK' : 'DROP ROADBLOCK'}
              </p>
              <p className="font-mono text-[12px] text-[#8b8b8b]">{roadblockModeActive ? '[ × ]' : '[ + ]'}</p>
            </button>

            <div className="flex gap-2 w-full">
              <button onClick={handlePauseToggle}
                className={`flex-1 h-[40px] flex items-center justify-center border rounded text-[11px] font-bold tracking-wider cursor-pointer transition-colors ${demoPaused ? 'bg-orange-600 border-orange-500' : 'bg-[#272727] hover:bg-[#333] border-[#2a2a2a]'} text-[#f5f5f5]`}>
                {demoPaused ? 'RESUME' : 'PAUSE'}
              </button>
              <button onClick={() => handleSpeedChange(1)}
                className={`flex-1 h-[40px] flex items-center justify-center border rounded text-[11px] font-bold tracking-wider cursor-pointer transition-colors ${demoSpeed === 1 && !demoPaused ? 'bg-emerald-600 border-emerald-500' : 'bg-[#272727] hover:bg-[#333] border-[#2a2a2a]'} text-[#f5f5f5]`}>
                1×
              </button>
              <button onClick={() => handleSpeedChange(3)}
                className={`flex-1 h-[40px] flex items-center justify-center border rounded text-[11px] font-bold tracking-wider cursor-pointer transition-colors ${demoSpeed === 3 && !demoPaused ? 'bg-emerald-600 border-emerald-500' : 'bg-[#272727] hover:bg-[#333] border-[#2a2a2a]'} text-[#f5f5f5]`}>
                3×
              </button>
              <button onClick={() => handleSpeedChange(10)}
                className={`flex-1 h-[40px] flex items-center justify-center border rounded text-[11px] font-bold tracking-wider cursor-pointer transition-colors ${demoSpeed === 10 && !demoPaused ? 'bg-emerald-600 border-emerald-500' : 'bg-[#272727] hover:bg-[#333] border-[#2a2a2a]'} text-[#f5f5f5]`}>
                10×
              </button>
            </div>
          </div>

        </div>

        {/* System Status Footer */}
        <div className="shrink-0 border-t border-[#2a2a2a] px-5 py-4 flex flex-col gap-2">
          <p className="font-semibold text-[11px] text-[#8b8b8b] tracking-[1.32px] uppercase">System Status</p>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-red-500'}`} />
            <p className="font-mono text-[12px] text-[#f5f5f5]">
              {wsConnected ? 'SYNCED / BACKEND LIVE' : 'RECONNECTING...'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6]" />
            <p className="font-mono text-[12px] text-[#8b8b8b]">
              {drivers.length} unit{drivers.length !== 1 ? 's' : ''} registered · {activeMissions.length} mission{activeMissions.length !== 1 ? 's' : ''} active
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
