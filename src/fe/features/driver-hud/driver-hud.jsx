import React, { useState, useEffect } from 'react';
import { useGPSSimulator } from './use-gps-simulator';
import wsClient from '../../services/websocket-client';
import MapEngine from '../map-engine/map-engine';

export default function DriverHud() {
  useEffect(() => { wsClient.connect(); }, []);
  const { currentLocation, speed, eta, distanceLeft, activeMissionId, turnInstruction, turnDistance } = useGPSSimulator();
  
  const [signalStatus, setSignalStatus] = useState(null);

  const [recenterTrigger, setRecenterTrigger] = useState(0);
  const [baseLocation, setBaseLocation] = useState('18.9300, 72.8200');
  const [isSavingBase, setIsSavingBase] = useState(false);

  const handleSaveBase = async () => {
    setIsSavingBase(true);
    const parts = baseLocation.split(',');
    if (parts.length === 2) {
      try {
        await fetch('/api/unit/base', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            unit_id: 'UNIT-1',
            base_lat: parts[0].trim(),
            base_lng: parts[1].trim()
          })
        });
      } catch (err) {
        console.error('Failed to save base location', err);
      }
    }
    setIsSavingBase(false);
  };

  useEffect(() => {
    const unsubPreempt = wsClient.on('SIGNAL_PREEMPT', () => {
      setSignalStatus('GREEN');
    });
    const unsubRelease = wsClient.on('SIGNAL_RELEASE', () => {
      setSignalStatus(null); // Hide banner
    });

    return () => {
      unsubPreempt();
      unsubRelease();
    };
  }, []);

  return (
    <div className="bg-slate-900 text-white min-h-screen w-full flex justify-center">
      <div className="w-full max-w-md h-screen relative bg-[#0b0b0b] overflow-hidden flex flex-col shadow-2xl border-x border-slate-800">
        
        {/* Full Screen Map Container */}
        <div className="absolute inset-0 z-0 bg-[#1a1a1a]">
          <MapEngine isRoadblockModeActive={false} recenterTrigger={recenterTrigger} />
        </div>

        {/* Top Google Maps Style Card Overlay */}
        <div className="absolute top-6 left-4 right-4 z-20">
          <div className="bg-[#1e1e1e]/95 backdrop-blur-md rounded-xl p-5 shadow-[0_10px_30px_rgba(0,0,0,0.5)] border border-[#333]">
            <div className="flex items-center space-x-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-emerald-400 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8-8-8z" />
              </svg>
              <div className="flex flex-col min-w-0">
                <h1 className="text-[24px] leading-tight font-bold text-[#f5f5f5] truncate">{turnInstruction}</h1>
                {turnDistance !== '--' && <p className="text-[15px] text-[#8b8b8b] font-medium mt-0.5">{turnDistance}</p>}
              </div>
            </div>
            
            <div className="w-full h-px bg-[#333] my-4" />
            
            <div className="flex justify-between items-center px-1">
              <div className="flex flex-col">
                <p className="text-[#8b8b8b] text-[10px] font-bold tracking-widest uppercase mb-1">ETA</p>
                <p className="text-[17px] font-bold text-emerald-400">{eta}</p>
              </div>
              <div className="w-px h-8 bg-[#333]" />
              <div className="flex flex-col">
                <p className="text-[#8b8b8b] text-[10px] font-bold tracking-widest uppercase mb-1">Dist</p>
                <p className="text-[17px] font-bold text-[#f5f5f5]">{distanceLeft}</p>
              </div>
              <div className="w-px h-8 bg-[#333]" />
              <div className="flex flex-col">
                <p className="text-[#8b8b8b] text-[10px] font-bold tracking-widest uppercase mb-1">Speed</p>
                <p className="text-[17px] font-bold text-[#f5f5f5]">{speed} kph</p>
              </div>
            </div>
          </div>
        </div>

        {/* Preemption Banner (Floating below top card) */}
        {signalStatus && (
          <div className="absolute top-[180px] left-1/2 -translate-x-1/2 w-[90%] py-3 px-4 rounded-lg flex items-center shadow-2xl z-30 bg-emerald-600 border border-emerald-400">
            {/* Traffic Light Icon */}
            <div className="flex flex-col items-center justify-between w-4 h-9 bg-black rounded p-[2px] mr-4 border border-[#444]">
              <div className="w-2 h-2 rounded-full bg-red-600 opacity-20"></div>
              <div className="w-2 h-2 rounded-full bg-yellow-500 opacity-20"></div>
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_#10b981]"></div>
            </div>
            <p className="font-bold text-sm tracking-wide text-white uppercase">
              PREEMPTED: {signalStatus} IN 10s
            </p>
          </div>
        )}

        {/* Base Location Settings (Bottom Left) */}
        <div className="absolute bottom-8 left-6 z-30 flex flex-col space-y-2 bg-[#1e1e1e]/90 backdrop-blur-md p-3 rounded-xl border border-[#333] shadow-xl w-64">
          <label className="text-[#8b8b8b] text-[10px] font-bold tracking-widest uppercase">Base Location (Lat, Lng)</label>
          <div className="flex space-x-2">
            <input 
              type="text" 
              value={baseLocation}
              onChange={(e) => setBaseLocation(e.target.value)}
              className="flex-1 bg-[#0b0b0b] border border-[#333] rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-emerald-500"
            />
            <button 
              onClick={handleSaveBase}
              disabled={isSavingBase}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-1 rounded transition-colors"
            >
              {isSavingBase ? '...' : 'SAVE'}
            </button>
          </div>
        </div>

        {/* Floating Action Buttons Container (Bottom Right) */}
        <div className="absolute bottom-8 right-6 z-30 flex flex-col items-center space-y-4">
          
          {/* Recenter Button */}
          <button 
            className="w-14 h-14 bg-[#1e1e1e]/90 hover:bg-[#2a2a2a] backdrop-blur transition-colors rounded-full flex items-center justify-center shadow-xl border border-[#333]"
            onClick={() => setRecenterTrigger(Date.now())}
            title="Recenter Map"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2L2 22l10-4 10 4L12 2z" />
            </svg>
          </button>

          {/* Block / Panic Button */}
          <button 
            className="w-16 h-16 bg-red-600 hover:bg-red-500 transition-colors rounded-full flex flex-col items-center justify-center shadow-[0_0_20px_rgba(220,38,38,0.4)] border-2 border-red-400"
            onClick={() => {
              if (activeMissionId) {
                wsClient.send({ lat: currentLocation[1], lng: currentLocation[0], type: 'OBSTRUCTION', mission_id: activeMissionId });
                alert('Obstruction logged! Check TMC.');
              } else {
                alert('No active mission to log obstruction for!');
              }
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-[9px] font-bold tracking-wider text-white">BLOCK</span>
          </button>
        </div>

      </div>
    </div>
  );
}
