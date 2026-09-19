/**
 * Horizon Grid — Root Application
 * Dev 4 Domain: Simple state-based view router connecting all three screens.
 * No external router library needed — view state is sufficient for a hackathon demo.
 */

import React, { useState } from 'react';
import CadForm from './features/dispatcher/cad-form';
import DriverHud from './features/driver-hud/driver-hud';
import TmcCommandDashboard from './features/tmc-dashboard/tmc-dashboard';

const VIEWS = {
  DISPATCHER: 'dispatcher',
  TMC: 'tmc',
  HUD: 'hud',
};

export default function App() {
  const [view, setView] = useState(VIEWS.DISPATCHER);

  return (
    <div className="bg-[#0b0b0b] w-screen h-screen flex flex-col overflow-hidden">

      {/* ── Top Navigation Bar ── */}
      <nav className="shrink-0 h-10 bg-[#0b0b0b] border-b border-[#2a2a2a] flex items-center px-4 gap-1 z-50">
        <span className="text-[#444] text-xs font-mono mr-3 tracking-widest">PULSEROUTE /</span>
        {[
          { id: VIEWS.DISPATCHER, label: 'DISPATCH CAD' },
          { id: VIEWS.TMC,        label: 'TMC DASHBOARD' },
          { id: VIEWS.HUD,        label: 'DRIVER HUD' },
        ].map(({ id, label }) => (
          <button
            key={id}
            id={`nav-${id}`}
            onClick={() => setView(id)}
            className={`px-3 py-1 text-[10px] font-semibold tracking-[1.2px] transition-colors rounded-sm
              ${view === id
                ? 'bg-emerald-900/60 text-emerald-400 border border-emerald-700'
                : 'text-[#8b8b8b] hover:text-[#f5f5f5] border border-transparent'
              }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* ── View Content ── */}
      <div className="flex-1 overflow-hidden relative">
        <div className={`absolute inset-0 transition-opacity duration-300 ${view === VIEWS.DISPATCHER ? 'opacity-100 z-10 pointer-events-auto' : 'opacity-0 z-0 pointer-events-none'}`}>
          <CadForm />
        </div>
        <div className={`absolute inset-0 transition-opacity duration-300 ${view === VIEWS.TMC ? 'opacity-100 z-10 pointer-events-auto' : 'opacity-0 z-0 pointer-events-none'}`}>
          <TmcCommandDashboard />
        </div>
        <div className={`absolute inset-0 transition-opacity duration-300 ${view === VIEWS.HUD ? 'opacity-100 z-10 pointer-events-auto' : 'opacity-0 z-0 pointer-events-none'}`}>
          <DriverHud />
        </div>
      </div>
    </div>
  );
}
