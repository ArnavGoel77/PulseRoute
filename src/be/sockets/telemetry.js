const { updateTelemetry } = require('../services/redis-client');
const { processTelemetryUpdate } = require('../services/eta-calculator');

// --- Dev 3 Placeholder Dependencies ---
// Dev 2 depends on these to extract intersection nodes and handle hazard rerouting.
const anomalyDetector = require('../services/anomaly-detector');
const osrmHelper = require('../routes/osrm');
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
        return;
      }

      // We must determine the event type by strictly sniffing payload keys, 
      // as the spec forbids adding or removing keys (like a global 'type' key)

      // 1. MISSION_START: { "mission_id": string, "path_polyline": string, "priority": string }
      if (parsed.path_polyline !== undefined && parsed.priority !== undefined) {
        const { mission_id, path_polyline, priority } = parsed;
        
        activeMissions[mission_id] = {
          path_polyline,
          priority,
          // Placeholder call to Dev 3's OSRM proxy helper to decode the polyline and return intersection nodes
          // upcomingNodes: osrmHelper.extractNodesFromPolyline(path_polyline)
          upcomingNodes: [
             // Example dummy node: { id: "node-1", coord: [-122.4194, 37.7749], preempted: false, passed: false }
          ]
        };
        
        // Broadcast to TMC so they can see the new mission
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
