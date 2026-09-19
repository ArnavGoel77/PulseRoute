import React, { useState, useEffect } from 'react';
import { useGPSSimulator } from './use-gps-simulator';
import wsClient from '../../services/websocket-client';
import { driverStore } from '../../services/driver-store';
import MapEngine from '../map-engine/map-engine';

const PHASE_LABELS = {
  to_incident: 'EN ROUTE TO INCIDENT',
  to_hospital: 'TRANSPORTING PATIENT',
  to_base:     'RETURNING TO BASE',
};

const PHASE_COLORS = {
  to_incident: 'text-red-600 dark:text-red-400 border-red-300 dark:border-red-600 bg-red-100 dark:bg-red-900/20',
  to_hospital: 'text-yellow-600 dark:text-yellow-400 border-yellow-300 dark:border-yellow-600 bg-yellow-100 dark:bg-yellow-900/20',
  to_base:     'text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700 bg-emerald-100 dark:bg-emerald-900/20',
};

export default function DriverHud() {
  useEffect(() => { wsClient.connect(); }, []);

  const [drivers, setDrivers]               = useState([]);
  const [selectedDriverId, setSelectedDriverId] = useState(null);

  // Subscribe to driver store so the pill list updates live
  useEffect(() => {
    const unsub = driverStore.subscribe((all) => {
      setDrivers(all);
      // Auto-select first driver if none selected yet
      setSelectedDriverId(prev => prev || (all.length > 0 ? all[0].id : null));
    });
    const unsubWs = wsClient.on('DRIVER_REGISTERED', ({ driver_id, lat, lng }) => {
      driverStore.addOrUpdate(driver_id, lat, lng);
    });
    return () => { unsub(); unsubWs(); };
  }, []);

  const {
    currentLocation, speed, eta, distanceLeft,
    activeMissionId, currentPhase, turnInstruction, turnDistance
  } = useGPSSimulator(selectedDriverId);

  const [signalStatus, setSignalStatus]       = useState(null);
  const [recenterTrigger, setRecenterTrigger] = useState(0);

  useEffect(() => {
    const unsubPreempt = wsClient.on('SIGNAL_PREEMPT', () => { setSignalStatus('GREEN'); });
    const unsubRelease = wsClient.on('SIGNAL_RELEASE', () => { setSignalStatus(null); });
    return () => { unsubPreempt(); unsubRelease(); };
  }, []);

  const phaseLabel = PHASE_LABELS[currentPhase] || 'STANDBY';
  const phaseColor = PHASE_COLORS[currentPhase] || 'text-gray-500 dark:text-[#8b8b8b] border-gray-300 dark:border-[#333] bg-gray-100 dark:bg-[#1a1a1a]';
  const hasMission = !!activeMissionId;

  return (
    <div className="bg-gray-200 dark:bg-slate-900 text-gray-900 dark:text-white min-h-screen w-full flex justify-center transition-colors duration-300">
      <div className="w-full max-w-md h-screen relative bg-white dark:bg-[#0b0b0b] overflow-hidden flex flex-col shadow-2xl border-x border-gray-300 dark:border-slate-800 transition-colors duration-300">

        {/* Full Screen Map */}
        <div className="absolute inset-0 z-0 bg-gray-100 dark:bg-[#1a1a1a] transition-colors duration-300">
          <MapEngine
            isRoadblockModeActive={false}
            recenterTrigger={recenterTrigger}
            watchMissionId={activeMissionId}
          />
        </div>

        {/* Top HUD Card */}
        <div className="absolute top-4 left-4 right-4 z-20">
          <div className="bg-white/95 dark:bg-[#1a1a1a]/95 backdrop-blur-md rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.1)] dark:shadow-[0_10px_30px_rgba(0,0,0,0.6)] border border-gray-300 dark:border-[#2a2a2a] overflow-hidden transition-colors duration-300">

            {/* Phase banner */}
            {hasMission && (
              <div className={`px-4 py-2 border-b border-gray-300 dark:border-[#2a2a2a] flex items-center gap-2 text-[10px] font-bold tracking-widest transition-colors duration-300 ${phaseColor}`}>
                <div className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                {phaseLabel}
              </div>
            )}

            {/* Turn instruction */}
            <div className="flex items-center gap-3 px-4 py-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-9 w-9 text-emerald-400 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8-8-8z" />
              </svg>
              <div className="flex flex-col min-w-0">
                <h1 className="text-[22px] leading-tight font-bold text-gray-900 dark:text-[#f5f5f5] truncate transition-colors duration-300">
                  {hasMission ? turnInstruction : (selectedDriverId ? 'No active mission' : 'Select a driver')}
                </h1>
                {hasMission && turnDistance !== '--' && (
                  <p className="text-[14px] text-gray-500 dark:text-[#8b8b8b] font-medium mt-0.5 transition-colors duration-300">{turnDistance}</p>
                )}
              </div>
            </div>

            <div className="w-full h-px bg-gray-300 dark:bg-[#2a2a2a] transition-colors duration-300" />

            {/* Stats row */}
            <div className="flex justify-between items-center px-4 py-3">
              <div className="flex flex-col items-center">
                <p className="text-gray-500 dark:text-[#8b8b8b] text-[9px] font-bold tracking-widest uppercase mb-1 transition-colors duration-300">ETA</p>
                <p className="text-[16px] font-bold text-emerald-600 dark:text-emerald-400 transition-colors duration-300">{eta}</p>
              </div>
              <div className="w-px h-8 bg-gray-300 dark:bg-[#2a2a2a] transition-colors duration-300" />
              <div className="flex flex-col items-center">
                <p className="text-gray-500 dark:text-[#8b8b8b] text-[9px] font-bold tracking-widest uppercase mb-1 transition-colors duration-300">Dist</p>
                <p className="text-[16px] font-bold text-gray-900 dark:text-[#f5f5f5] transition-colors duration-300">{distanceLeft}</p>
              </div>
              <div className="w-px h-8 bg-gray-300 dark:bg-[#2a2a2a] transition-colors duration-300" />
              <div className="flex flex-col items-center">
                <p className="text-gray-500 dark:text-[#8b8b8b] text-[9px] font-bold tracking-widest uppercase mb-1 transition-colors duration-300">Speed</p>
                <p className="text-[16px] font-bold text-gray-900 dark:text-[#f5f5f5] transition-colors duration-300">{speed} kph</p>
              </div>
              {activeMissionId && (
                <>
                  <div className="w-px h-8 bg-gray-300 dark:bg-[#2a2a2a] transition-colors duration-300" />
                  <div className="flex flex-col items-center">
                    <p className="text-gray-500 dark:text-[#8b8b8b] text-[9px] font-bold tracking-widest uppercase mb-1 transition-colors duration-300">Mission</p>
                    <p className="text-[12px] font-bold text-emerald-600 dark:text-emerald-400 font-mono transition-colors duration-300">{activeMissionId}</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Signal preemption banner */}
        {signalStatus && (
          <div className="absolute top-[240px] left-1/2 -translate-x-1/2 w-[90%] py-3 px-4 rounded-lg flex items-center shadow-2xl z-30 bg-emerald-600 border border-emerald-400">
            <div className="flex flex-col items-center justify-between w-4 h-9 bg-black rounded p-[2px] mr-4 border border-[#444]">
              <div className="w-2 h-2 rounded-full bg-red-600 opacity-20" />
              <div className="w-2 h-2 rounded-full bg-yellow-500 opacity-20" />
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_#10b981]" />
            </div>
            <p className="font-bold text-sm tracking-wide text-white uppercase">PREEMPTED: ALL SIGNALS GREEN</p>
          </div>
        )}

        {/* Driver Pill Switcher (bottom) */}
        <div className="absolute bottom-36 left-0 right-0 z-30 flex justify-center px-4">
          {drivers.length > 0 ? (
            <div className="flex gap-2 bg-white/90 dark:bg-[#0b0b0b]/90 backdrop-blur-md rounded-full px-3 py-2 border border-gray-300 dark:border-[#2a2a2a] shadow-lg dark:shadow-2xl overflow-x-auto max-w-full transition-colors duration-300">
              {drivers.map(d => (
                <button
                  key={d.id}
                  onClick={() => setSelectedDriverId(d.id)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold font-mono transition-all ${
                    selectedDriverId === d.id
                      ? 'bg-emerald-600 text-white shadow-[0_0_12px_rgba(16,185,129,0.4)]'
                      : d.status === 'ON_MISSION'
                        ? 'bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700'
                        : 'bg-gray-100 dark:bg-[#1e1e1e] text-gray-500 dark:text-[#8b8b8b] border border-gray-300 dark:border-[#2a2a2a] hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  {d.id}
                </button>
              ))}
            </div>
          ) : (
            <div className="bg-white/80 dark:bg-[#0b0b0b]/80 backdrop-blur-md rounded-full px-4 py-2 border border-gray-300 dark:border-[#2a2a2a] text-[11px] text-gray-500 dark:text-[#555] font-mono transition-colors duration-300">
              No units registered — go to TMC Dashboard
            </div>
          )}
        </div>

        {/* Floating Action Buttons */}
        <div className="absolute bottom-20 right-0 z-30 flex flex-col items-end space-y-2.5 pr-2">
          {/* Recenter */}
          <button
            className="w-10 h-10 bg-white/90 dark:bg-[#1a1a1a]/90 hover:bg-gray-100 dark:hover:bg-[#2a2a2a] backdrop-blur transition-colors duration-300 rounded-full flex items-center justify-center shadow-lg border border-gray-200 dark:border-[#2a2a2a]"
            onClick={() => setRecenterTrigger(Date.now())}
            title="Recenter Map"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13l-2 6 6-2-2-6-2 2z"/>
            </svg>
          </button>

          {/* BLOCK obstruction button */}
          <button
            className="flex items-center gap-1.5 px-3 py-2 bg-red-600/90 hover:bg-red-500 backdrop-blur transition-colors duration-200 rounded-xl shadow-lg border border-red-400/50 text-white"
            onClick={() => {
              if (activeMissionId && currentLocation) {
                wsClient.send({ lat: currentLocation[1], lng: currentLocation[0], type: 'OBSTRUCTION', mission_id: activeMissionId });
                alert('Obstruction logged! Check TMC.');
              } else {
                alert('No active mission to log obstruction for!');
              }
            }}
            title="Log Obstruction"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-[10px] font-bold tracking-wider">BLOCK</span>
          </button>
        </div>

      </div>
    </div>
  );
}
