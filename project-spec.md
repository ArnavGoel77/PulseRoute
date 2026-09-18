# Horizon Grid: Predictive Cloud Preemption - Master Project Specification

## 1. Final Technology Stack
*   **Frontend UI:** React.js initialized with Vite (eliminates SSR hydration latency, ensuring max performance for real-time telemetry).
*   **Styling:** Tailwind CSS + lucide-react icons.
*   **Map Rendering Engine:** Mapbox GL JS with CartoDB Dark Matter vector tiles (hardware-accelerated WebGL rendering handles thousands of nodes and 10Hz GPS updates without frame drops).
*   **Backend Hub:** Node.js + Express.
*   **Real-Time Transport:** Raw WebSockets via the ws package (guarantees sub-100ms latency and handles massive concurrent connections vastly better than Socket.io).
*   **State Database:** Upstash Redis (serverless, in-memory datastore with sub-millisecond read/writes; vastly outperforms disk-based Firestore for high-frequency GPS state).
*   **Routing & Geospatial APIs:** OSRM Public API (for polyline snapping and ETA base weights) and TomTom Traffic Incidents API (for anomaly detection).

## 2. Master Task Distribution (4-Person Team)

### Dev 1: Frontend (Dispatcher CAD & Driver HUD)

| Task ID | Component/Target | Detailed Execution Steps |
| :--- | :--- | :--- |
| **FD1-1** | `src/fe/features/dispatcher/` | Build the CAD form UI with inputs for Origin, Destination, and Priority (ALS/BLS). Implement client-side validation to ensure coordinates are within the city bounding box. |
| **FD1-2** | `src/fe/services/api-client.js` | Create Axios/Fetch wrappers to call the backend OSRM proxy. Decode the returned precision-5 polyline into a raw array of [lat, lng] pairs. |
| **FD1-3** | `src/fe/features/dispatcher/` | Integrate a static Mapbox preview showing the generated route before the dispatcher hits "Start Mission". Hook the start button to emit the `MISSION_START` WebSocket event. |
| **FD1-4** | `src/fe/features/driver-hud/` | Build a mobile-first UI for the ambulance dashboard. Create a `useGPSimulator` React hook that traverses the polyline array at a simulated 25m/s, emitting `TELEMETRY_UPDATE` WS events at 1 Hz. |
| **FD1-5 / FD1-6** | `src/fe/features/driver-hud/` | Build the Preemption Dynamic Banner. Listen for `SIGNAL_PREEMPT` and `SIGNAL_RELEASE` events to flash "Green in 10s" or "Clearing Intersection" on the driver's screen. Implement the manual "Route Blocked" panic button. On click, emit an `INCIDENT_LOGGED` payload with the vehicle's current coordinates to force a backend reroute. |

### Dev 2: Backend Core (Telemetry, Redis & Traffic Math)

| Task ID | Component/Target | Detailed Execution Steps |
| :--- | :--- | :--- |
| **BD1-1** | `src/be/sockets/telemetry.js` | Mount the ws server. Implement a client registry (using Maps/Sets) to track which socket belongs to the HUD vs the TMC. |
| **BD1-2** | `src/be/services/redis-client.js` | Initialize Upstash Redis. Create functions to instantly write incoming `TELEMETRY_UPDATE` payloads to a Redis hash (`mission:id:location`) with an expiration TTL. |
| **BD1-3** | `src/be/services/eta-calculator.js` | Build the rolling horizon math engine. Calculate the distance from the current Redis GPS coordinate to the next intersection node on the polyline. |
| **BD1-4** | `src/be/services/eta-calculator.js` | Implement the Queue Clearance Buffer logic. When the temporal distance to a node hits exactly 10 seconds, broadcast the `SIGNAL_PREEMPT` (Phase: GREEN) event to the TMC socket. |
| **BD1-5** | `src/be/services/eta-calculator.js` | Implement the All-Red Recovery logic. Use Turf.js to detect when the telemetry passes the intersection node. Broadcast the `SIGNAL_RELEASE` (Phase: ALL_RED) event. |

### Dev 3: Backend Routing (OSRM, TomTom & Incidents)

| Task ID | Component/Target | Detailed Execution Steps |
| :--- | :--- | :--- |
| **BD2-1** | `src/be/routes/osrm.js` | Build an Express GET route `/api/route`. Abstract the `router.project-osrm.org` API call. Implement a Redis caching layer for identical Origin/Destination pairs to avoid API rate limits. |
| **BD2-2** | `src/be/routes/osrm.js` | Implement server-side Polyline decoding (precision 5). The backend needs the raw coordinate array to perform spatial mathematics before sending the route to the frontend. |
| **BD2-3** | `src/be/routes/tomtom.js` | Build a service that periodically queries the TomTom Incidents API using a bounding box encompassing the current active route. |
| **BD2-4** | `src/be/services/anomaly-detector.js` | Use Turf.js (`booleanIntersects`) to check if any returned TomTom incident polygons overlap with the decoded OSRM route polyline array. |
| **BD2-5** | `src/be/services/anomaly-detector.js` | Build the dynamic rerouting engine. If an intersection is detected (or the manual `INCIDENT_LOGGED` WS event fires), query OSRM with waypoint blocks to bypass the hazard and broadcast `ROUTE_UPDATED`. |

### Dev 4 (You): Lead Integrator (Figma, DevOps & TMC Frontend)

| Task ID | Component/Target | Detailed Execution Steps |
| :--- | :--- | :--- |
| **D4-1** | Figma (Pre-Coding) | Design wireframes for the CAD Dispatch intake, the Mobile Driver HUD, and the dark-mode TMC Command Center. Define the precise Tailwind color palette (e.g., slate-900 backgrounds, emerald-500 signals). |
| **D4-2** | Repository Root | Initialize the Vite project and backend directory. Lock all dependency versions in `package.json` (React, Vite, Express, ws, Redis) to prevent Antigravity agents from hallucinating mismatched tools. |
| **D4-3** | `src/be/server.js` | Fuse the backend. Mount Express REST routes and the ws server onto a single HTTP server instance (vital for smooth cloud deployment on Render/Heroku). Distribute `.env` keys. |
| **D4-4** | `src/fe/features/map-engine/` | Initialize the main Mapbox GL JS instance for the TMC. Hardcode the pitch and zoom to maintain a fixed macro-city perspective. Apply the Dark Matter vector tile style. |
| **D4-5** | `src/fe/features/map-engine/` | Visualize the Telemetry. Create a GeoJSON point source for the ambulance. Write a `requestAnimationFrame` loop using `Map#setData` to smoothly move the icon between 1Hz telemetry updates. |
| **D4-6** | `src/fe/components/digital-twin/` | Seed 20 dummy intersection nodes as a GeoJSON layer. Listen for `SIGNAL_PREEMPT` and `SIGNAL_RELEASE` WebSockets, and use `Map#setFilter` to instantly snap node colors (Red -> Green -> Flashing Orange) without re-rendering the map. |
| **D4-7** | `src/fe/features/tmc-dashboard/` | Build the "Chaos Control Panel." Add a map click listener for hackathon judges to click a street segment, drop a roadblock marker, and fire `INCIDENT_LOGGED` to test your rerouting engine. |