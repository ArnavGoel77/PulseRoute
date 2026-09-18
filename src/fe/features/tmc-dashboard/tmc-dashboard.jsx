/**
 * D4-7: TMC Command Dashboard
 * Replaces the static city grid placeholder with the live Mapbox MapEngine.
 * Wires the "DROP ROADBLOCK" button to enable roadblock mode on the map —
 * the next map click will drop a marker and fire INCIDENT_LOGGED over WebSocket.
 */

import React, { useState, useEffect } from 'react';
import MapEngine from '../map-engine/map-engine';
import wsClient from '../../services/websocket-client';

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

  // ── Live UTC Clock ────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClock(now.toUTCString().split(' ')[4]); // HH:MM:SS UTC
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  // ── WebSocket Subscriptions ───────────────────────────────────────────────
  useEffect(() => {
    wsClient.connect(true);

    const addEvent = (text, dim = false) => {
      const time = new Date().toUTCString().split(' ')[4];
      setEventFeed(prev => [{ time, text, dim }, ...prev].slice(0, 20));
    };

    const unsubConn = wsClient.on('__connected', () => {
      setWsConnected(true);
      addEvent('WS CONNECTED TO BACKEND');
    });

    const unsubDisconn = wsClient.on('__disconnected', () => {
      setWsConnected(false);
      addEvent('WS RECONNECTING...', true);
    });

    const unsubMission = wsClient.on('MISSION_START', ({ mission_id, priority }) => {
      setActiveMissions(prev => {
        const exists = prev.find(m => m.id === mission_id);
        if (exists) return prev;
        return [...prev, { id: mission_id, status: 'EN ROUTE', priority }];
      });
      addEvent(`MISSION ${mission_id} STARTED — ${priority}`);
    });

    const unsubTelemetry = wsClient.on('TELEMETRY_UPDATE', ({ mission_id }) => {
      // Throttle — only log every 10th telemetry to avoid flooding the feed
      if (Math.random() > 0.1) return;
      addEvent(`TELEMETRY ${mission_id} — GPS LOCK`, true);
    });

    const unsubPreempt = wsClient.on('SIGNAL_PREEMPT', ({ intersection_id }) => {
      addEvent(`SIG ${intersection_id} → GREEN PREEMPTED`);
    });

    const unsubRelease = wsClient.on('SIGNAL_RELEASE', ({ intersection_id }) => {
      addEvent(`SIG ${intersection_id} → ALL RED CLEARED`, true);
    });

    const unsubIncident = wsClient.on('INCIDENT_LOGGED', ({ lat, lng }) => {
      addEvent(`INCIDENT @ ${lat.toFixed(4)}, ${lng.toFixed(4)} — REROUTING`);
      setActiveMissions(prev =>
        prev.map(m => ({ ...m, status: 'REROUTING' }))
      );
    });

    const unsubRoute = wsClient.on('ROUTE_UPDATED', ({ mission_id }) => {
      addEvent(`ROUTE UPDATED — MISSION ${mission_id}`);
      setActiveMissions(prev =>
        prev.map(m => m.id === mission_id ? { ...m, status: 'EN ROUTE' } : m)
      );
    });

    return () => {
      unsubConn(); unsubDisconn(); unsubMission(); unsubTelemetry();
      unsubPreempt(); unsubRelease(); unsubIncident(); unsubRoute();
    };
  }, []);

  const handleRoadblockClick = () => {
    setRoadblockModeActive(prev => !prev);
  };

  const handleRoadblockPlaced = () => {
    setRoadblockModeActive(false);
  };

  const handleSpeedChange = (speed) => {
    setDemoSpeed(speed);
    wsClient.send({ speedMult: speed, paused: demoPaused });
  };

  const handlePauseToggle = () => {
    const nextPaused = !demoPaused;
    setDemoPaused(nextPaused);
    wsClient.send({ speedMult: demoSpeed, paused: nextPaused });
  };

  return (
    <div className="bg-[#0b0b0b] border border-[#2a2a2a] border-solid content-stretch flex items-start relative w-screen h-screen overflow-hidden">

      {/* ── Left: Live Mapbox Map (D4-4, D4-5, D4-6) ── */}
      <div className="flex-[1_0_0] h-full min-w-px relative overflow-clip">
        {/* Map overlay label */}
        <div className="absolute top-4 left-4 z-10 pointer-events-none">
          <p className="font-semibold text-[11px] text-[#8b8b8b] tracking-[1.32px]">
            CITY GRID / LIVE DIGITAL TWIN
          </p>
        </div>

        {/* Roadblock mode banner */}
        {roadblockModeActive && (
          <div className="absolute top-12 left-1/2 -translate-x-1/2 z-20 bg-red-900/80 border border-red-500 px-4 py-2 rounded text-red-300 text-xs font-semibold tracking-widest pointer-events-none">
            ROADBLOCK MODE — CLICK MAP TO DROP INCIDENT
          </div>
        )}

        <MapEngine
          isRoadblockModeActive={roadblockModeActive}
          onRoadblockPlaced={handleRoadblockPlaced}
        />
      </div>

      {/* ── Right: Chaos Control Panel (D4-7) ── */}
      <div className="bg-[#141414] border-l border-[#2a2a2a] border-solid flex flex-col gap-[20px] h-full items-start overflow-y-auto px-[20px] py-[24px] relative shrink-0 w-[360px]">

        {/* Header */}
        <div className="flex flex-col gap-[10px] items-start shrink-0 w-full">
          <p className="font-semibold leading-[22px] text-[18px] text-[#f5f5f5] whitespace-nowrap">
            CHAOS CONTROL
          </p>
          <p className="font-mono font-normal leading-[16px] text-[12px] text-[#8b8b8b] whitespace-pre">
            {`TMC-07  /  UTC  ${clock}`}
          </p>
        </div>

        {/* Active Missions */}
        <div className="flex flex-col gap-[10px] items-start w-full">
          <p className="font-semibold leading-[14px] text-[11px] text-[#8b8b8b] tracking-[1.32px] whitespace-nowrap">
            ACTIVE MISSIONS
          </p>
          <div className="bg-[#2a2a2a] h-px w-full" />

          {activeMissions.length === 0 ? (
            <p className="font-mono text-[12px] text-[#444] italic">No active missions.</p>
          ) : (
            activeMissions.map(mission => (
              <div
                key={mission.id}
                className="border border-[#2a2a2a] border-solid flex flex-col gap-[4px] items-start px-[10px] py-[8px] w-full"
              >
                <div className="flex items-start justify-between w-full">
                  <p className="font-mono font-normal leading-[16px] text-[12px] text-[#f5f5f5] whitespace-nowrap">
                    {mission.id}
                  </p>
                  <div className="bg-[#272727] flex items-center justify-center px-[7px] py-[2px] rounded-[999px]">
                    <p className="font-semibold leading-[14px] text-[11px] text-[#8b8b8b] tracking-[1.32px] whitespace-nowrap">
                      {mission.status}
                    </p>
                  </div>
                </div>
                <p className="font-mono font-normal leading-[16px] text-[12px] text-[#8b8b8b] whitespace-nowrap">
                  {mission.priority}
                </p>
              </div>
            ))
          )}
        </div>

        {/* Live Event Feed */}
        <div className="flex flex-col gap-[6px] items-start w-full">
          <p className="font-semibold leading-[14px] text-[11px] text-[#8b8b8b] tracking-[1.32px] whitespace-nowrap">
            LIVE EVENT FEED
          </p>
          <div className="bg-[#2a2a2a] h-px w-full" />
          <div className="flex flex-col gap-[4px] w-full max-h-48 overflow-hidden">
            {eventFeed.map((ev, i) => (
              <p
                key={i}
                className={`font-mono font-normal leading-[16px] text-[12px] whitespace-pre ${ev.dim ? 'text-[#8b8b8b]' : 'text-[#f5f5f5]'}`}
              >
                {`${ev.time}  ${ev.text}`}
              </p>
            ))}
          </div>
        </div>

        {/* Simulation Controls — D4-7 Chaos Panel */}
        <div className="flex flex-col gap-[10px] items-start w-full">
          <p className="font-semibold leading-[14px] text-[11px] text-[#8b8b8b] tracking-[1.32px] whitespace-nowrap">
            SIMULATION CONTROLS
          </p>
          <div className="bg-[#2a2a2a] h-px w-full" />
          <p className="font-mono font-normal leading-[16px] text-[12px] text-[#8b8b8b] whitespace-nowrap">
            {roadblockModeActive
              ? '⚡ Click map to drop incident...'
              : 'Inject a network incident into the live model.'}
          </p>

          {/* D4-7: DROP ROADBLOCK button — enables map click → INCIDENT_LOGGED */}
          <button
            id="drop-roadblock-btn"
            onClick={handleRoadblockClick}
            className={`transition-colors border border-solid flex h-[44px] items-center justify-between px-[14px] shadow-[0px_4px_8px_0px_rgba(0,0,0,0.35)] w-full whitespace-nowrap cursor-pointer
              ${roadblockModeActive
                ? 'bg-red-900/60 border-red-500 animate-pulse'
                : 'bg-[#272727] hover:bg-[#333] border-[#2a2a2a]'}`}
          >
            <p className={`font-semibold leading-[14px] text-[11px] tracking-[1.32px] ${roadblockModeActive ? 'text-red-300' : 'text-[#f5f5f5]'}`}>
              {roadblockModeActive ? 'CANCEL ROADBLOCK' : 'DROP ROADBLOCK'}
            </p>
            <p className="font-mono font-normal leading-[16px] text-[12px] text-[#8b8b8b]">
              {roadblockModeActive ? '[ × ]' : '[ + ]'}
            </p>
          </button>
          
          <div className="flex gap-[10px] w-full mt-[5px]">
             <button
                onClick={handlePauseToggle}
                className={`transition-colors border border-solid flex h-[44px] items-center justify-center px-[14px] shadow-[0px_4px_8px_0px_rgba(0,0,0,0.35)] w-1/3 cursor-pointer ${demoPaused ? 'bg-orange-600 border-orange-500' : 'bg-[#272727] hover:bg-[#333] border-[#2a2a2a]'}`}
             >
                <p className="font-semibold leading-[14px] text-[11px] tracking-[1.32px] text-[#f5f5f5]">
                   {demoPaused ? 'RESUME' : 'PAUSE'}
                </p>
             </button>
             
             <button
                onClick={() => handleSpeedChange(1)}
                className={`transition-colors border border-solid flex h-[44px] items-center justify-center px-[14px] shadow-[0px_4px_8px_0px_rgba(0,0,0,0.35)] w-1/3 cursor-pointer ${demoSpeed === 1 && !demoPaused ? 'bg-emerald-600 border-emerald-500' : 'bg-[#272727] hover:bg-[#333] border-[#2a2a2a]'}`}
             >
                <p className="font-semibold leading-[14px] text-[11px] tracking-[1.32px] text-[#f5f5f5]">1x SPEED</p>
             </button>

             <button
                onClick={() => handleSpeedChange(3)}
                className={`transition-colors border border-solid flex h-[44px] items-center justify-center px-[14px] shadow-[0px_4px_8px_0px_rgba(0,0,0,0.35)] w-1/3 cursor-pointer ${demoSpeed === 3 && !demoPaused ? 'bg-emerald-600 border-emerald-500' : 'bg-[#272727] hover:bg-[#333] border-[#2a2a2a]'}`}
             >
                <p className="font-semibold leading-[14px] text-[11px] tracking-[1.32px] text-[#f5f5f5]">3x SPEED</p>
             </button>
          </div>
        </div>

        <div className="flex-grow" />

        {/* Panel Footer — System Status */}
        <div className="flex flex-col gap-[10px] items-start w-full">
          <div className="bg-[#2a2a2a] h-px w-full" />
          <p className="font-semibold leading-[14px] text-[11px] text-[#8b8b8b] tracking-[1.32px] whitespace-nowrap">
            SYSTEM STATUS
          </p>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-red-500'}`} />
            <p className="font-mono font-normal leading-[16px] text-[12px] text-[#f5f5f5] whitespace-nowrap">
              {wsConnected ? 'SYNCED / BACKEND LIVE' : 'RECONNECTING...'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
