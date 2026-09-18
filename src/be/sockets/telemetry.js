const { updateTelemetry, getTelemetry } = require('../services/redis-client');
const { processTelemetryUpdate } = require('../services/eta-calculator');

// --- Dev 3 Placeholder Dependencies ---
// Dev 2 depends on these to extract intersection nodes and handle hazard rerouting.
let anomalyDetector, osrmHelper;
try {
  anomalyDetector = require('../services/anomaly-detector');
  osrmHelper = require('../routes/osrm');
} catch (e) {
  // Dev 3 files missing on this branch, ignoring.
}
// --------------------------------------

const tmcClients = new Set();
const hudClients = new Set();

// Active mission state (in-memory for fast access during WS events)
const activeMissions = {};

/**
 * Binds WebSocket message handling for telemetry, preemption, and general routing events.
 * 
 * @param {import('ws').Server} wss 
 */
function initTelemetry(wss) {
  wss.on('connection', (ws) => {
    
    ws.on('message', async (data) => {
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch (e) {
        return; // Ignore invalid JSON
      }

      // Registration handling (custom role implementation to satisfy HUD vs TMC tracking requirement)
      if (parsed.role) {
        if (parsed.role === 'TMC') tmcClients.add(ws);
        if (parsed.role === 'HUD') hudClients.add(ws);

        // State Recovery Fix: When a client connects, instantly transmit all active missions
        for (const [missionId, missionData] of Object.entries(activeMissions)) {
          // 1. Send the route details
          ws.send(JSON.stringify({
            mission_id: missionId,
            path_polyline: missionData.path_polyline,
            priority: missionData.priority
          }));

          // 2. Fetch the absolute latest GPS state from Redis
          const latestState = await getTelemetry(missionId);
          if (latestState && Object.keys(latestState).length > 0) {
            ws.send(JSON.stringify({
              mission_id: missionId,
              lat: parseFloat(latestState.lat),
              lng: parseFloat(latestState.lng),
              speed: parseFloat(latestState.speed)
            }));
          }
        }
        return;
      }

      // We must determine the event type by strictly sniffing payload keys, 
      // as the spec forbids adding or removing keys (like a global 'type' key)

      // 1. MISSION_START: Can be a single object or an array of objects
      const isMissionStart = (p) => p.path_polyline !== undefined && p.priority !== undefined;
      
      if (Array.isArray(parsed) ? parsed.length > 0 && isMissionStart(parsed[0]) : isMissionStart(parsed)) {
        const missions = Array.isArray(parsed) ? parsed : [parsed];
        
        for (const m of missions) {
          activeMissions[m.mission_id] = {
            path_polyline: m.path_polyline,
            priority: m.priority,
            upcomingNodes: osrmHelper && osrmHelper.extractNodesFromPolyline ? osrmHelper.extractNodesFromPolyline(m.path_polyline) : [
               { id: "node-1", coord: [-122.4194, 37.7749], preempted: false, passed: false }
            ]
          };
        }
        
        broadcast(tmcClients, parsed);
        return;
      }

      // 2. TELEMETRY_UPDATE: { "mission_id": string, "lat": number, "lng": number, "speed": number }
      if (parsed.lat !== undefined && parsed.speed !== undefined && parsed.mission_id !== undefined) {
        const { mission_id, lat, lng, speed } = parsed;
        
        // Save to Redis (instant hash update)
        await updateTelemetry(mission_id, lat, lng, speed);

        // Process ETA and Preemption (Queue Clearance Buffer)
        const mission = activeMissions[mission_id];
        if (mission) {
          processTelemetryUpdate(mission_id, lat, lng, speed, mission.upcomingNodes, (eventPayload) => {
            // eventPayload is strictly SIGNAL_PREEMPT or SIGNAL_RELEASE
            // Broadcast to both TMC (for map viz) and HUD (for banner)
            broadcast(tmcClients, eventPayload);
            broadcast(hudClients, eventPayload);
          });
        }
        
        // Broadcast telemetry to TMC so map can move the ambulance
        broadcast(tmcClients, parsed);
        return;
      }
      
      // 3. INCIDENT_LOGGED: { "lat": number, "lng": number, "type": "OBSTRUCTION" }
      if (parsed.type === 'OBSTRUCTION') {
        broadcast(tmcClients, parsed);
        
        // Placeholder call to Dev 3's anomaly detector to trigger dynamic rerouting
        // if (anomalyDetector && anomalyDetector.handleIncident) {
        //   anomalyDetector.handleIncident(parsed.lat, parsed.lng, parsed.type);
        // }
        
        return;
      }

      // 4. ROUTE_UPDATED: { "mission_id": string, "new_polyline": string }
      if (parsed.new_polyline !== undefined) {
        broadcast(hudClients, parsed);
        broadcast(tmcClients, parsed);
        return;
      }
    });

    ws.on('close', () => {
      tmcClients.delete(ws);
      hudClients.delete(ws);
    });
  });
}

function broadcast(clients, payload) {
  const message = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === 1) { // OPEN
      client.send(message);
    }
  }
}

module.exports = { initTelemetry };
