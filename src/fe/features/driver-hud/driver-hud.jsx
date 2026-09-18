import React, { useState, useEffect } from 'react';
import { useGPSSimulator } from './use-gps-simulator';
import wsClient from '../../services/websocket-client';

export default function DriverHud() {
  useEffect(() => { wsClient.connect(); }, []);
  const { currentLocation, speed, eta, distanceLeft } = useGPSSimulator();
  
  // State to simulate the preemption banner (GREEN or ALL_RED)
  const [signalStatus, setSignalStatus] = useState('GREEN');

  return (
    <div className="bg-slate-900 text-white min-h-screen w-full flex justify-center">
      <div className="w-full max-w-md h-screen relative bg-[#0b0b0b] overflow-hidden flex flex-col shadow-2xl border-x border-slate-800">
        
        {/* Top Instruction Panel */}
        <div className="bg-[#141414] border-b border-[#2a2a2a] p-6 z-20 flex flex-col shadow-md">
          <p className="text-[#8b8b8b] text-[10px] font-semibold tracking-[0.15em] mb-6 uppercase">HorizonGrid Navigate</p>
          <div className="flex items-center space-x-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8-8-8z" />
            </svg>
            <div className="flex flex-col">
              <h1 className="text-[28px] leading-tight font-bold text-[#f5f5f5]">Turn right</h1>
              <p className="text-[15px] text-[#8b8b8b] mt-1">in 500 ft · on West 4th St</p>
            </div>
          </div>
        </div>

        {/* Preemption Banner */}
        {signalStatus && (
          <div className="absolute top-[140px] left-1/2 -translate-x-1/2 w-[90%] py-3 px-4 rounded-md flex items-center shadow-lg z-30 bg-[#2b8a3e] border border-[#2b8a3e]">
            {/* Traffic Light Icon */}
            <div className="flex flex-col items-center justify-between w-3 h-7 bg-black rounded-[4px] p-[2px] mr-3 border border-[#444]">
              <div className="w-1.5 h-1.5 rounded-full bg-red-600 opacity-30"></div>
              <div className="w-1.5 h-1.5 rounded-full bg-yellow-500 opacity-30"></div>
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shadow-[0_0_4px_#22c55e]"></div>
            </div>
            <p className="font-semibold text-sm tracking-wide text-white uppercase">
              PREEMPTED: GREEN IN 12s
            </p>
          </div>
        )}

        {/* Map View / 3D Pitched City (Placeholder) */}
        <div className="flex-1 relative bg-[#1a1a1a] overflow-hidden">
          {/* Simulated Perspective Grid */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:40px_40px] [transform:rotateX(60deg)_scale(2)] origin-bottom" />
          
          {/* Vehicle Position Halo */}
          <div className="absolute bottom-32 left-1/2 -translate-x-1/2">
            <div className="w-16 h-16 bg-emerald-500/20 rounded-full animate-ping absolute -inset-2" />
            <div className="w-12 h-12 bg-[#2a2a2a] border-2 border-emerald-500 rounded-full flex items-center justify-center relative z-10 shadow-[0_0_20px_rgba(16,185,129,0.5)]">
               <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-emerald-500 transform -rotate-45" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
              </svg>
            </div>
          </div>

          {/* FAB / Roadblock Warning */}
          <button 
            className="absolute bottom-6 right-6 w-16 h-16 bg-red-600 hover:bg-red-500 transition-colors rounded-full flex flex-col items-center justify-center shadow-2xl border-2 border-red-400 z-30"
            onClick={() => {
              wsClient.send({ lat: currentLocation[0], lng: currentLocation[1], type: 'OBSTRUCTION' });
              alert('Obstruction logged! Check TMC.');
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-[9px] font-bold tracking-wider text-white">BLOCK</span>
          </button>
        </div>

        {/* Telemetry Bar */}
        <div className="bg-[#141414] border-t border-[#2a2a2a] p-5 z-20 flex items-center shadow-[0_-10px_20px_rgba(0,0,0,0.3)]">
          <div className="flex flex-col flex-1 pl-2">
            <p className="text-[#8b8b8b] text-[10px] font-semibold tracking-widest mb-1 uppercase">ETA</p>
            <p className="text-[17px] font-bold text-[#f5f5f5]">4m 20s</p>
          </div>
          <div className="w-px h-10 bg-[#2a2a2a]" />
          <div className="flex flex-col flex-1 pl-5">
            <p className="text-[#8b8b8b] text-[10px] font-semibold tracking-widest mb-1 uppercase">Distance</p>
            <p className="text-[17px] font-bold text-[#f5f5f5]">2.1 mi</p>
          </div>
          <div className="w-px h-10 bg-[#2a2a2a]" />
          <div className="flex flex-col flex-1 pl-5">
            <p className="text-[#8b8b8b] text-[10px] font-semibold tracking-widest mb-1 uppercase">Speed</p>
            <p className="text-[17px] font-bold text-[#f5f5f5]">45 MPH</p>
          </div>
        </div>

      </div>
    </div>
  );
}
