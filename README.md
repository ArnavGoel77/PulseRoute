# 🚑 PulseRoute — Predictive Ambulance Routing & Signal Preemption System

> A real-time emergency vehicle coordination platform. PulseRoute enables dispatchers to deploy ambulances, gives drivers a live navigation HUD, and gives traffic controllers full situational awareness — all synchronized over a low-latency WebSocket backbone.

---

## 📖 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [How It Works](#how-it-works)
  - [Three Views](#three-views)
  - [Mission Lifecycle](#mission-lifecycle)
  - [Real-Time Telemetry Pipeline](#real-time-telemetry-pipeline)
  - [Signal Preemption](#signal-preemption)
  - [Dynamic Rerouting Around Roadblocks](#dynamic-rerouting-around-roadblocks)
  - [ETA Calculation](#eta-calculation)
- [API Reference](#api-reference)
- [WebSocket Event Protocol](#websocket-event-protocol)
- [Deployment](#deployment)
- [Sample Coordinates](#sample-coordinates-mumbai)

---

## Overview

PulseRoute (internally codenamed **Horizon Grid**) is a full-stack, real-time emergency vehicle management system. It simulates an end-to-end ambulance dispatch pipeline:

1. A **Dispatcher** creates a mission by entering an incident location and hospital.
2. The system auto-assigns the closest available ambulance and calculates a 3-phase route (Base → Incident → Hospital → Base) using OSRM.
3. A **GPS Simulator** drives the ambulance along the polyline, broadcasting live telemetry at 1 Hz over WebSocket.
4. The **Traffic Management Center (TMC)** monitors all units on a live map, can drop roadblocks, and watches signal preemption events fire in real time.
5. The **Driver HUD** gives the ambulance crew turn-by-turn navigation with a stable ETA.
6. When a roadblock is detected on the active route, the **Rerouting Engine** uses the Mapbox Directions API to calculate a new path that natively excludes the blocked coordinates and broadcasts the updated polyline to all clients.

---

## Features

- ✅ **3-Phase Mission Routing** — Base → Incident → Hospital → Base, each leg fetched as an independent polyline
- ✅ **Live GPS Simulation** — Ambulance traverses the route at a configurable speed with telemetry emitted via WebSocket
- ✅ **Multi-Unit Fleet** — Register multiple ambulance units (AMB-1, AMB-2, etc.) with individual positions
- ✅ **Auto-Dispatch** — Dispatcher CAD auto-suggests the closest available unit to the incident
- ✅ **Signal Preemption** — Broadcasts `SIGNAL_PREEMPT` (GREEN) 10 seconds before reaching an intersection node; clears with `ALL_RED` after passing
- ✅ **Live Map Engine** — WebGL-accelerated Mapbox GL JS with real-time ambulance movement, route overlays, and roadblock markers
- ✅ **Dynamic Rerouting** — Drop roadblocks from the Dispatcher CAD or TMC map; the backend uses the **Mapbox Directions API** to calculate a native exclusion-based detour around ALL active roadblocks simultaneously
- ✅ **Stable ETA** — ETA is decoupled from instantaneous speed fluctuation and uses the routing engine's own average speed per leg; formatted Google Maps-style (minutes only when > 2 min)
- ✅ **State Persistence & Recovery** — New/reconnecting clients receive a full state replay (missions, drivers, roadblocks) via Redis + WebSocket
- ✅ **Driver HUD Persistence** — Switching between driver views in the HUD does not reset their mission state; each DriverSimulator runs independently in the background
- ✅ **Driver Auto-Release** — Ambulances are automatically freed back to AVAILABLE status when a mission completes or is reset
- ✅ **Dark/Light Mode** — System-wide theme toggle
- ✅ **Simulation Controls** — Pause, resume, and speed-multiply the simulation from the TMC panel

---

## Architecture

```
BROWSER (Vite + React)
+-- Dispatcher CAD Form     → Mission intake, roadblock dropping
+-- TMC Dashboard           → Fleet monitor, event feed, signal viz
+-- Driver HUD              → GPS simulator, turn-by-turn, ETA
         |
         → WebSocket (singleton with auto-reconnect)
NODE.JS BACKEND (Express + ws)
+-- server.js               → Fuses REST + WS on a single HTTP server
+-- telemetry.js            → WS hub: mission state, driver registry, roadblocks, state replay
+-- osrm.js                 → /api/route — OSRM proxy, Redis cache, /legs endpoint
+-- unit.js                 → /api/unit/base — ambulance base persistence
+-- tomtom.js               → /api/incidents — TomTom traffic polling
+-- eta-calculator.js       → Intersection node proximity + SIGNAL_PREEMPT / ALL_RED
+-- anomaly-detector.js     → Spatial analysis + Mapbox rerouting engine
+-- redis-client.js         → Upstash Redis wrapper (telemetry r/w)
         |
         → REST APIs
+-- Upstash Redis            → Telemetry state (mission:id:location hash, 60s TTL)
+-- OSRM Public API          → Polyline routing for all 3 legs
+-- Mapbox Directions API    → Live rerouting with native point exclusion
+-- TomTom Traffic API       → Real-time traffic incident polygons
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend Framework | React 19 + Vite 8 |
| Styling | Tailwind CSS v4 |
| Map Engine | Mapbox GL JS v3 |
| Real-Time Transport | WebSocket (`ws` v8) |
| Backend | Node.js + Express 5 |
| State Database | Upstash Redis (serverless) |
| Geospatial Math | Turf.js v7 |
| Primary Routing | OSRM Public API |
| Rerouting Engine | Mapbox Directions API v5 |
| Traffic Incidents | TomTom Traffic Incidents API v5 |
| Frontend Hosting | Vercel |
| Backend Hosting | Render |

---

## Project Structure

```
PulseRoute/
+-- src/
|   +-- be/                           # Backend (Node.js)
|   |   +-- server.js                 # Express + WebSocket server fusion
|   |   +-- routes/
|   |   |   +-- osrm.js               # /api/route — OSRM proxy + Redis cache + /legs endpoint
|   |   |   +-- tomtom.js             # /api/incidents — TomTom traffic polling service
|   |   |   +-- unit.js               # /api/unit/base — ambulance base location storage
|   |   +-- services/
|   |   |   +-- redis-client.js       # Upstash Redis wrapper (updateTelemetry, getTelemetry)
|   |   |   +-- eta-calculator.js     # Intersection ETA + SIGNAL_PREEMPT / ALL_RED logic
|   |   |   +-- anomaly-detector.js   # Spatial anomaly detection + Mapbox rerouting engine
|   |   +-- sockets/
|   |       +-- telemetry.js          # WebSocket hub — all message routing, state, replay
|   |
|   +-- fe/                           # Frontend (React + Vite)
|       +-- App.jsx                   # Root view router (DISPATCHER / TMC / HUD)
|       +-- services/
|       |   +-- websocket-client.js   # WS singleton with auto-reconnect + payload router
|       |   +-- driver-store.js       # In-memory fleet registry (pub/sub pattern)
|       +-- features/
|           +-- dispatcher/
|           |   +-- cad-form.jsx      # Dispatch UI (mission intake, roadblock mode)
|           +-- driver-hud/
|           |   +-- driver-hud.jsx    # Driver HUD shell + multi-driver switcher
|           |   +-- use-gps-simulator.js  # GPS simulation hook (3-phase traversal + ETA)
|           +-- tmc-dashboard/
|           |   +-- tmc-dashboard.jsx # TMC Command Center (fleet, event feed, controls)
|           +-- map-engine/
|               +-- map-engine.jsx    # Mapbox GL JS engine (routes, markers, roadblocks)
|               +-- intersection-nodes.js  # Seeded GeoJSON intersection nodes
|
+-- render.yaml                       # Render backend deployment config
+-- vercel.json                       # Vercel frontend deployment + API proxy config
+-- package.json
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- [Upstash Redis](https://upstash.com/) account (free tier works)
- [Mapbox](https://mapbox.com/) account (free tier works)
- [TomTom Developer](https://developer.tomtom.com/) account (optional — for live traffic)

### Installation

```bash
git clone https://github.com/ArnavGoel77/PulseRoute.git
cd PulseRoute
npm install
```

### Running Locally

```bash
npm run dev
```

This starts both the Express backend (port 3000) and Vite frontend (port 5173) concurrently via `concurrently`. Open `http://localhost:5173`.

---

## Environment Variables

Create a `.env` file at the project root:

```env
# Mapbox — used by the frontend map engine AND backend Mapbox rerouting API
VITE_MAPBOX_TOKEN=pk.your_token_here

# TomTom — used by the traffic incidents polling service
TOMTOM_API_KEY=your_key_here

# Upstash Redis — used for telemetry state persistence
UPSTASH_REDIS_REST_URL=https://your-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_token_here

# Backend port (local)
PORT=3000

# WebSocket backend URL (used by the frontend in dev mode)
VITE_BACKEND_WS_URL=ws://localhost:3000

# (Production only) Your Vercel frontend URL — used for CORS allowlist on Render
# FRONTEND_URL=https://your-app.vercel.app
```

---

## How It Works

### Three Views

The app is a single-page React app with three views switchable from the top nav bar:

| View | Role | Key Features |
|---|---|---|
| **DISPATCH CAD** | Emergency Dispatcher | Mission intake form, closest unit suggestion, active missions log, roadblock dropping |
| **TMC DASHBOARD** | Traffic Management Center | Live fleet map, driver registration, event feed, signal preemption visualization, simulation speed controls |
| **DRIVER HUD** | Ambulance Crew | Turn-by-turn navigation, stable ETA, speed display, mission phase banner, BLOCK panic button |

All three views share the same WebSocket connection singleton and `driverStore` registry, keeping them synchronized in real time.

---

### Mission Lifecycle

```
1. REGISTER DRIVER (TMC Dashboard)
   +-> Fill in driver ID (e.g., AMB-1) + lat/lng → click Register
       +-> Sends { driver_id, lat, lng } via WS
           +-> Backend stores in registeredDrivers{}; broadcasts DRIVER_REGISTERED

2. DISPATCH MISSION (Dispatcher CAD)
   +-> Enter incident + hospital coordinates → pick unit → Start Mission
       +-> Frontend calls GET /api/route/legs (3 OSRM requests in parallel)
           +-> Returns 3 encoded polylines + distances + durations for each leg
               +-> Frontend sends MISSION_START payload via WS
                   +-> Backend stores in activeMissions{}; broadcasts to all clients

3. GPS SIMULATION (Driver HUD — useGPSSimulator hook)
   +-> Traverses leg_to_incident polyline point-by-point on setInterval
       +-> Emits TELEMETRY_UPDATE { mission_id, lat, lng, speed } each tick
           +-> Backend writes to Redis hash `mission:id:location` (60s TTL)
               +-> Calls processTelemetryUpdate() → checks proximity to intersection nodes
               |    +-> ETA = 10s → broadcast SIGNAL_PREEMPT (phase: GREEN)
               |    +-> Passed node → broadcast SIGNAL_RELEASE (phase: ALL_RED)
               +-> Broadcasts TELEMETRY_UPDATE to all clients (map updates)

4. PHASE TRANSITIONS (auto, driven by GPS simulator)
   +-> End of leg_to_incident → 2s delay → switchToPhase('to_hospital')
   +-> End of leg_to_hospital → teleport ambulance back to base coords
   |    +-> Send PHASE_CHANGE: complete → backend deletes activeMissions[id]
   +-> Driver freed: driverStore.setAvailable(driverId) called globally

5. RESET (Dispatcher CAD → STOP/RESET button)
   +-> Sends RESET_SIMULATION via WS
       +-> Backend clears all activeMissions{}
           +-> driverStore auto-releases all ON_MISSION drivers
```

---

### Real-Time Telemetry Pipeline

Every GPS tick (configurable interval based on demo speed):

1. `useGPSSimulator` computes the next `[lng, lat]` coordinate on the current leg polyline
2. Calls `wsClient.send({ type: 'TELEMETRY_UPDATE', mission_id, lat, lng, speed })`
3. Backend `telemetry.js` receives it → writes to Redis → calls `processTelemetryUpdate()`
4. `eta-calculator.js` checks distance from vehicle to the next upcoming intersection node
5. Backend broadcasts `TELEMETRY_UPDATE` to all connected WebSocket clients
6. The `MapEngine` receives it and calls `map.setData()` on the ambulance GeoJSON source, smoothly animating the marker

---

### Signal Preemption

`eta-calculator.js` implements a **rolling-horizon preemption window**:

- Intersection nodes are extracted dynamically from the active leg polyline (10 evenly-spaced points) — no hardcoded data
- When temporal distance to next node `= 10 seconds` at current speed → broadcasts `{ intersection_id, phase: 'GREEN' }` (SIGNAL_PREEMPT)
- TMC map changes the node color to green; Driver HUD shows the preemption banner
- Node is considered **passed** when distance starts increasing after being within 50m OR the vehicle is within 15m of the node
- After passing → broadcasts `{ intersection_id, phase: 'ALL_RED' }` (SIGNAL_RELEASE)
- TMC map returns the node to normal; Driver HUD banner clears

---

### Dynamic Rerouting Around Roadblocks

**Placing a roadblock:**
- Dispatcher CAD: `DROP ROADBLOCK` button → click anywhere on the map
- TMC Dashboard: Click directly on the map while roadblock mode is active
- Driver HUD: `BLOCK` panic button logs the vehicle's own current position

**What happens:**

```
1. Frontend sends { type: 'OBSTRUCTION', lat, lng } via WS

2. Backend (telemetry.js):
   +-> Assigns a unique roadblock ID
   +-> Pushes to activeRoadblocks[] (persisted for state replay)
   +-> Auto-resolves which mission is affected:
   |    +-> If 1 active mission → trivially assigned
   |    +-> If multiple → find closest via Redis telemetry positions
   +-> Enriches payload with: mission destination + full activeRoadblocks[] array
   +-> Emits incidentEmitter('OBSTRUCTION', enrichedPayload)

3. anomaly-detector.js triggerReroute():
   +-> Reads current vehicle position from Redis
   +-> Reads destination from mission state (changes per phase: incident / hospital / base)
   +-> Constructs Mapbox exclude param: "point(lng lat)" for EVERY active roadblock
   +-> Calls Mapbox Directions API v5:
       https://api.mapbox.com/directions/v5/mapbox/driving-traffic/
       {current_lng},{current_lat};{dest_lng},{dest_lat}
       ?overview=full&geometries=polyline&exclude=point(rb1_lng rb1_lat),point(rb2_lng rb2_lat)
       &access_token=...

4. Mapbox returns a route that natively bypasses ALL excluded coordinates

5. Backend broadcasts ROUTE_UPDATED { mission_id, new_polyline, distance, duration }

6. useGPSSimulator receives it → decodes polyline → switches route from current position
   +-> Also updates routeMetaRef speed baseline for the new route geometry

7. MapEngine re-draws the route on the live map
```

> **Why Mapbox over OSRM for rerouting?**  
> OSRM does not support point exclusions natively. Any waypoint-based workaround can still result in OSRM routing through the blocked road since it optimizes for shortest distance. Mapbox Directions API's `exclude=point(...)` parameter removes specific road segments directly from its routing graph at the engine level — this guarantees the path will never cross the blocked coordinate.

---

### ETA Calculation

The ETA shown in the Driver HUD is **stable and monotonically decreasing**, matching the behavior of Google Maps:

**Root cause of instability:** Simple `ETA = remaining_distance / current_speed`. The display speedometer is randomized slightly each frame to look realistic, making this fraction jump by minutes every second.

**Solution — Routing Engine Baseline Speed:**

1. When `/api/route/legs` returns, it provides `distance_meters` and `duration_seconds` per leg (directly from OSRM's own traffic model for those specific roads)
2. `use-gps-simulator.js` calculates: `avg_speed_kmh = (distance / duration) * 3.6`
3. This value is stored in `routeMetaRef.current.speeds[phase]` — one constant per leg, never changing mid-leg
4. ETA calculation becomes: `remaining_distance_km / avg_speed_kmh` — since the divisor is constant, the result only decreases smoothly
5. When a reroute happens, Mapbox returns fresh `distance` + `duration` for the new path, and the speed baseline is updated accordingly

**Display formatting (Google Maps style):**
- `> 2 min` → shows only `12 min` (suppresses seconds, only ticks down once per full minute of driving)
- `= 2 min` → shows `1m 45s` (high precision for final approach)
- `= 0 min` → shows `Arrived`

---

## API Reference

### `GET /api/route`

Single route between two points with Redis caching (30s TTL).

| Param | Description |
|---|---|
| `start_lat`, `start_lng` | Origin |
| `end_lat`, `end_lng` | Destination |
| `unit_id` | (Optional) Fetches base from Redis |

**Response:** `{ path_polyline, decoded_path, distance_meters, duration_seconds }`

---

### `GET /api/route/legs`

Primary dispatch endpoint. Fetches all 3 mission legs in parallel.

| Param | Description |
|---|---|
| `incident_lat`, `incident_lng` | Incident location |
| `hospital_lat`, `hospital_lng` | Hospital location |
| `base_lat`, `base_lng` | Ambulance base (can be driver current position) |
| `unit_id` | (Optional) Fallback base lookup from Redis |

**Response:**
```json
{
  "leg_to_incident": "<encoded polyline>",
  "leg_to_hospital": "<encoded polyline>",
  "leg_to_base": "<encoded polyline>",
  "distances": { "to_incident": 1200, "to_hospital": 3400, "to_base": 2100 },
  "durations": { "to_incident": 180, "to_hospital": 450, "to_base": 270 },
  "base_coords": { "lat": 18.922, "lng": 72.834 },
  "incident_coords": { "lat": 18.995, "lng": 72.827 },
  "hospital_coords": { "lat": 19.056, "lng": 72.836 }
}
```

---

### `POST /api/unit/base`

Saves an ambulance's base location to Redis.

**Body:** `{ unit_id, base_lat, base_lng }`

---

### `GET /api/health`

Health check. Returns `{ status: 'ok', timestamp }`.

---

### `POST /api/incidents/start`

Starts polling TomTom for traffic incidents within a bounding box (polls every 30s).

**Body:** `{ bbox: [minLng, minLat, maxLng, maxLat] }`

---

### `POST /api/incidents/stop`

Stops TomTom polling.

---

## WebSocket Event Protocol

The `websocket-client.js` singleton routes all incoming messages to named event listeners by sniffing payload key signatures — no `type` field required for most events.

### Frontend → Backend

| Event | Key Signature | Payload |
|---|---|---|
| MISSION_START | `leg_to_incident` present | Full mission payload with all 3 legs + distances + durations |
| TELEMETRY_UPDATE | `lat` + `speed` + `mission_id` | `{ mission_id, unit_id, lat, lng, speed }` |
| PHASE_CHANGE | `new_phase` present | `{ mission_id, new_phase }` |
| DRIVER_REGISTERED | `driver_id` + `lat` (no speed) | `{ driver_id, lat, lng }` |
| OBSTRUCTION | `type === 'OBSTRUCTION'` | `{ type, lat, lng, mission_id? }` |
| REMOVE_OBSTRUCTION | `type === 'REMOVE_OBSTRUCTION'` | `{ type, id }` |
| RESET_SIMULATION | `type === 'RESET_SIMULATION'` | `{ type }` |
| STATE_REQUEST | `request_state: true` | Triggers full state replay to this client |

### Backend → Frontend

| Event | When | Payload |
|---|---|---|
| MISSION_START | Mission dispatched / reconnect replay | Full mission data |
| TELEMETRY_UPDATE | Every GPS tick | `{ mission_id, unit_id, lat, lng, speed }` |
| PHASE_CHANGE | Phase switch | `{ mission_id, new_phase }` |
| SIGNAL_PREEMPT | 10s from intersection | `{ intersection_id, phase: 'GREEN' }` |
| SIGNAL_RELEASE | After passing intersection | `{ intersection_id, phase: 'ALL_RED' }` |
| ROUTE_UPDATED | After roadblock reroute | `{ mission_id, new_polyline, distance, duration }` |
| INCIDENT_LOGGED | Roadblock placed | `{ id, lat, lng, type: 'OBSTRUCTION', mission_id, activeRoadblocks[] }` |
| REMOVE_OBSTRUCTION | Roadblock cleared | `{ type, id }` |
| DRIVER_REGISTERED | Driver registered / reconnect replay | `{ driver_id, lat, lng }` |
| RESET_SIMULATION | Stop/Reset triggered | `{ type: 'RESET_SIMULATION' }` |

---

## Deployment

### Backend → Render

`render.yaml` defines a Node.js web service:
- **Start:** `node src/be/server.js`
- Set these env vars in the Render dashboard: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `VITE_MAPBOX_TOKEN`, `TOMTOM_API_KEY`, `FRONTEND_URL`

### Frontend → Vercel

`vercel.json` proxies `/api/*` requests to the Render backend and serves the Vite SPA:
```json
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "https://pulseroute-1waf.onrender.com/api/$1" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

### WebSocket in Production

Set `VITE_BACKEND_WS_URL=wss://your-backend.onrender.com` as a Vercel environment variable. Vercel does not proxy WebSocket connections, so the frontend connects directly to Render for the WS transport.

---

## Sample Coordinates (Mumbai)

These Mumbai coordinates work well for testing the full pipeline:

| Scenario | Origin / Incident | Destination / Hospital |
|---|---|---|
| South to North | `18.9220, 72.8347` (Colaba) | `19.0558, 72.8358` (Bandra) |
| Central route | `18.9953, 72.8273` (Lower Parel) | `19.0176, 72.8437` (Dadar) |
| Coastal route | `19.0069, 72.8157` (Worli) | `18.9451, 72.8277` (Marine Drive) |

Register ambulances at the Origin coordinates in the TMC Dashboard to give them a realistic starting point near the incident.
