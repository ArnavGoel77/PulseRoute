/**
 * Horizon Grid — Backend Server
 * Dev 4 (D4-3): Fuses Express REST routes and the raw WebSocket server
 * onto a single HTTP server instance for unified cloud deployment.
 */

'use strict';
require('dotenv').config();

const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

// --- Route Imports (Dev 3 Domain) ---
const osrmRouter = require('./routes/osrm');
const tomtomRouter = require('./routes/tomtom');
const unitRouter = require('./routes/unit');

// --- WebSocket / Telemetry Init (Dev 2 Domain) ---
const { initTelemetry } = require('./sockets/telemetry');

// --- Anomaly Detector EventEmitter (Dev 3 Domain) ---
// We listen here so the rerouting engine can broadcast ROUTE_UPDATED
// back out to WebSocket clients without creating a circular dependency.
const { rerouteEmitter } = require('./services/anomaly-detector');

// ── Express App Setup ──────────────────────────────────────────────────────────
const app = express();

// Parse JSON bodies on all routes
app.use(express.json());

// CORS — allow the Vite dev server and Vercel frontend to call the API
app.use((req, res, next) => {
  const allowed_origins = [
    'http://localhost:5173',
    process.env.FRONTEND_URL // Set this on Render to your Vercel URL
  ].filter(Boolean);

  const origin = req.headers.origin;
  if (allowed_origins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── REST Route Mounting ────────────────────────────────────────────────────────
// snake_case routes per the .antigravityrules domain contract
app.use('/api/route', osrmRouter);
app.use('/api/incidents', tomtomRouter);
app.use('/api/unit', unitRouter);

// Health check — used by Render to confirm the service is alive
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Horizon Grid Backend',
    timestamp: new Date().toISOString()
  });
});

// Catch-all 404 for unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// ── HTTP + WebSocket Server Fusion ────────────────────────────────────────────
// CRITICAL: Both Express and ws must share the same http.Server instance.
// This is what allows a single Render service (one port) to handle both
// REST (HTTP) and real-time telemetry (WebSocket) traffic simultaneously.
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Bind all WebSocket event handling (client registry, telemetry, preemption)
initTelemetry(wss);

// ── Reroute EventEmitter Bridge ───────────────────────────────────────────────
// When Dev 3's anomaly detector triggers a ROUTE_UPDATED event, we need
// to broadcast it out to all connected WebSocket clients. We do this here
// to avoid circular imports between telemetry.js and anomaly-detector.js.
rerouteEmitter.on('ROUTE_UPDATED', (payload) => {
  // Also update the telemetry module's in-memory mission state so the phase
  // polylines stay in sync for future state replays and preemption node generation.
  const { updateMissionPolyline } = require('./sockets/telemetry');
  updateMissionPolyline(payload);

  const message = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(message);
    }
  });
  console.log(`[Server] ROUTE_UPDATED broadcast for mission: ${payload.mission_id}`);
});

// ── Start Listening ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Server] Horizon Grid backend running on port ${PORT}`);
  console.log(`[Server] REST API:  http://localhost:${PORT}/api/health`);
  console.log(`[Server] WebSocket: ws://localhost:${PORT}`);
});
