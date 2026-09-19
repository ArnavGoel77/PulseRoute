/**
 * Horizon Grid — Root Application
 * Dev 4 Domain: Simple state-based view router connecting all three screens.
 * No external router library needed — view state is sufficient for a hackathon demo.
 */

import React, { useState, createContext, useContext, useEffect } from 'react';
import CadForm from './features/dispatcher/cad-form';
import DriverHud from './features/driver-hud/driver-hud';
import TmcCommandDashboard from './features/tmc-dashboard/tmc-dashboard';

export const ThemeContext = createContext({
  isDarkMode: true,
  toggleTheme: () => {}
});

export const useTheme = () => useContext(ThemeContext);

const VIEWS = {
  DISPATCHER: 'dispatcher',
  TMC: 'tmc',
  HUD: 'hud',
};

export default function App() {
  const [view, setView] = useState(VIEWS.DISPATCHER);
  const [isDarkMode, setIsDarkMode] = useState(true);

  const toggleTheme = () => setIsDarkMode(!isDarkMode);

  // Sync with body for global background
  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.add('dark');
      document.body.style.backgroundColor = '#0b0b0b';
    } else {
      document.body.classList.remove('dark');
      document.body.style.backgroundColor = '#f3f4f6'; // bg-gray-100
    }
  }, [isDarkMode]);

  return (
    <ThemeContext.Provider value={{ isDarkMode, toggleTheme }}>
      <div className={`w-screen h-screen flex flex-col overflow-hidden transition-colors duration-300 ${isDarkMode ? 'dark bg-[#0b0b0b] text-[#f5f5f5]' : 'bg-gray-100 text-gray-900'}`}>

        {/* ── Top Navigation Bar ── */}
        <nav className="shrink-0 h-10 bg-white dark:bg-[#0b0b0b] border-b border-gray-300 dark:border-[#2a2a2a] flex items-center px-4 gap-1 z-50 transition-colors duration-300 shadow-sm dark:shadow-none">

          {[
            { id: VIEWS.DISPATCHER, label: 'DISPATCH CAD',  short: 'CAD'   },
            { id: VIEWS.TMC,        label: 'TMC DASHBOARD', short: 'TMC'   },
            { id: VIEWS.HUD,        label: 'DRIVER HUD',    short: 'HUD'   },
          ].map(({ id, label, short }) => (
            <button
              key={id}
              id={`nav-${id}`}
              onClick={() => setView(id)}
              className={`px-2 md:px-3 py-1 text-[10px] font-semibold tracking-[1.2px] transition-colors rounded-sm
                ${view === id
                  ? 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700'
                  : 'text-gray-500 dark:text-[#8b8b8b] hover:text-gray-900 dark:hover:text-[#f5f5f5] border border-transparent hover:bg-gray-100 dark:hover:bg-transparent'
                }`}
            >
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden">{short}</span>
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-full hover:bg-gray-200 dark:hover:bg-[#1a1a1a] transition-colors text-gray-500 dark:text-[#8b8b8b] hover:text-gray-900 dark:hover:text-[#f5f5f5]"
            title="Toggle Light/Dark Mode"
          >
            {isDarkMode ? (
              /* Sun icon */
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
              </svg>
            ) : (
              /* Moon icon */
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>
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
    </ThemeContext.Provider>
  );
}
