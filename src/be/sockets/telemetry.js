const { updateTelemetry, getTelemetry } = require('../services/redis-client');
const { processTelemetryUpdate } = require('../services/eta-calculator');

// --- Dev 3 Placeholder Dependencies ---
// Dev 2 depends on these to extract intersection nodes and handle hazard rerouting.
let anomalyDetector, osrmHelper, incidentEmitter;
try {
  anomalyDetector = require('../services/anomaly-detector');
  incidentEmitter = anomalyDetector.incidentEmitter;
  osrmHelper = require('../routes/osrm');
} catch (e) {
  // Dev 3 files missing on this branch, ignoring.
}
// --------------------------------------

const tmcClients = new Set();
const hudClients = new Set();

// Polyline decoder to extract intersection nodes dynamically from the route
function decodePolyline(encoded) {
  const coords = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let shift = 0, result = 0, b;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;
    coords.push([lng / 1e5, lat / 1e5]);
  }
  return coords;
}

function extractNodesFromPolyline(polyline) {
  const coords = decodePolyline(polyline);
  const nodes = [];
  const step = Math.max(1, Math.floor(coords.length / 6));
  let nodeId = 1;
  for (let i = step; i < coords.length - 1; i += step) {
    nodes.push({
      id: `node-${nodeId++}`,
      coord: coords[i], // [lng, lat]
      preempted: false,
      passed: false
    });
  }
  return nodes;
}

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
            upcomingNodes: extractNodesFromPolyline(m.path_polyline)
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
        
        // Trigger Dev 3's dynamic rerouting logic
        if (incidentEmitter) {
          incidentEmitter.emit('OBSTRUCTION', parsed);
        }
        
        return;
      }

      // 4. ROUTE_UPDATED: { "mission_id": string, "new_polyline": string }
      if (parsed.new_polyline !== undefined) {
        const { mission_id, new_polyline } = parsed;
        if (mission_id && activeMissions[mission_id]) {
          // Persist the detour polyline to memory for State Recovery
          activeMissions[mission_id].path_polyline = new_polyline;
          // Recalculate dynamic nodes along the new route
          activeMissions[mission_id].upcomingNodes = extractNodesFromPolyline(new_polyline);
        }
        broadcast(hudClients, parsed);
        broadcast(tmcClients, parsed);
        return;
      }

      // 5. DEMO_SPEED_CONTROL: { "speedMult": number, "paused": boolean }
      if (parsed.speedMult !== undefined && parsed.paused !== undefined) {
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
