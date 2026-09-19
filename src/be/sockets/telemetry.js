const { updateTelemetry, getTelemetry } = require('../services/redis-client');
const { processTelemetryUpdate } = require('../services/eta-calculator');

let anomalyDetector, incidentEmitter;
try {
  anomalyDetector = require('../services/anomaly-detector');
  incidentEmitter = anomalyDetector.incidentEmitter;
} catch (e) { /* Dev 3 files missing */ }

// Single set — broadcast everything to ALL connected clients.
// No TMC/HUD split: the frontend's wsClient._route() decides what to do with each payload.
const allClients = new Set();

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
    coords.push([lng / 1e5, lat / 1e5]); // [lng, lat] for Mapbox/Turf
  }
  return coords;
}

function extractNodesFromPolyline(polyline, mission_id = 'unknown') {
  const coords = decodePolyline(polyline);
  const nodes = [];
  const step = Math.max(1, Math.floor(coords.length / 10));
  let nodeId = 1;
  for (let i = step; i < coords.length - 1; i += step) {
    nodes.push({ id: `${mission_id}-node-${nodeId++}`, coord: coords[i], preempted: false, passed: false });
  }
  return nodes;
}

/**
 * activeMissions stores the full state for each mission:
 * {
 *   mission_id, priority, unit_id,
 *   leg_to_incident, leg_to_hospital, leg_to_base,  // encoded polylines
 *   incident_coords, hospital_coords, base_coords,
 *   current_phase: 'to_incident' | 'to_hospital' | 'to_base' | 'complete',
 *   upcomingNodes: []  // nodes for current active leg
 * }
 */
const activeMissions = {};

/**
 * registeredDrivers stores unit positions for state replay:
 * { driver_id: { driver_id, lat, lng } }
 */
const registeredDrivers = {};

/**
 * activeRoadblocks stores all obstruction positions for replay to new clients.
 * Format: [{ id, lat, lng, type: 'OBSTRUCTION' }]
 */
let activeRoadblocks = [];

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of allClients) {
    if (client.readyState === 1) client.send(message);
  }
}

function sendToClient(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function updateMissionPolyline({ mission_id, new_polyline }) {
  if (!mission_id || !new_polyline || !activeMissions[mission_id]) return;
  const phase = activeMissions[mission_id].current_phase;
  if (phase === 'to_incident') activeMissions[mission_id].leg_to_incident = new_polyline;
  else if (phase === 'to_hospital') activeMissions[mission_id].leg_to_hospital = new_polyline;
  else if (phase === 'to_base') activeMissions[mission_id].leg_to_base = new_polyline;
  activeMissions[mission_id].upcomingNodes = extractNodesFromPolyline(new_polyline, mission_id);
}

function initTelemetry(wss) {
  // NOTE: ROUTE_UPDATED broadcasting is handled exclusively in server.js
  // to avoid double-sending to clients. The anomalyDetector.rerouteEmitter
  // listener lives there, not here.

  wss.on('connection', (ws) => {
    allClients.add(ws);

    ws.on('message', async (data) => {
      let parsed;
      try { parsed = JSON.parse(data); } catch (e) { return; }

      // ── MISSION_START: { mission_id, priority, leg_to_incident, leg_to_hospital, leg_to_base,
      //                     incident_coords, hospital_coords, base_coords }
      if (parsed.leg_to_incident !== undefined && parsed.priority !== undefined) {
        const m = parsed;
        activeMissions[m.mission_id] = {
          mission_id: m.mission_id,
          priority: m.priority,
          unit_id: m.unit_id,
          leg_to_incident: m.leg_to_incident,
          leg_to_hospital: m.leg_to_hospital,
          leg_to_base: m.leg_to_base,
          incident_coords: m.incident_coords,
          hospital_coords: m.hospital_coords,
          base_coords: m.base_coords,
          current_phase: 'to_incident',
          upcomingNodes: extractNodesFromPolyline(m.leg_to_incident, m.mission_id)
        };
        console.log(`[Telemetry] MISSION_START: ${m.mission_id} — unit: ${m.unit_id} — phase: to_incident`);
        broadcast(m);
        return;
      }

      // ── DRIVER_REGISTERED: { driver_id, lat, lng }
      if (parsed.driver_id !== undefined && parsed.lat !== undefined && parsed.speed === undefined) {
        registeredDrivers[parsed.driver_id] = { driver_id: parsed.driver_id, lat: parsed.lat, lng: parsed.lng };
        console.log(`[Telemetry] DRIVER_REGISTERED: ${parsed.driver_id} @ ${parsed.lat}, ${parsed.lng}`);
        broadcast(parsed); // broadcast to all clients so map updates
        return;
      }

      // ── TELEMETRY_UPDATE: { mission_id, lat, lng, speed, unit_id }
      if (parsed.lat !== undefined && parsed.speed !== undefined && parsed.mission_id) {
        const { mission_id, unit_id, lat, lng, speed } = parsed;
        await updateTelemetry(mission_id, lat, lng, speed);

        const mission = activeMissions[mission_id];
        if (mission) {
          processTelemetryUpdate(mission_id, lat, lng, speed, mission.upcomingNodes, (eventPayload) => {
            broadcast(eventPayload);
          });
        }
        broadcast({ type: 'TELEMETRY_UPDATE', mission_id, unit_id, lat, lng, speed });
        return;
      }

      // ── PHASE_CHANGE: { mission_id, new_phase: 'to_hospital' | 'to_base' | 'complete' }
      if (parsed.new_phase !== undefined && parsed.mission_id) {
        const { mission_id, new_phase } = parsed;
        if (activeMissions[mission_id]) {
          activeMissions[mission_id].current_phase = new_phase;
          
          if (new_phase === 'complete') {
            delete activeMissions[mission_id];
          }
          
          let new_polyline;
          let dest_coords;
          
          if (new_phase === 'to_hospital') {
            new_polyline = activeMissions[mission_id].leg_to_hospital;
            dest_coords = activeMissions[mission_id].hospital_coords;
            if (new_polyline) activeMissions[mission_id].upcomingNodes = extractNodesFromPolyline(new_polyline, mission_id);
          } else if (new_phase === 'to_base') {
            new_polyline = activeMissions[mission_id].leg_to_base;
            dest_coords = activeMissions[mission_id].base_coords;
            if (new_polyline) activeMissions[mission_id].upcomingNodes = extractNodesFromPolyline(new_polyline, mission_id);
          }
          console.log(`[Telemetry] PHASE_CHANGE: ${mission_id} → ${new_phase}`);
          
          if (new_polyline) {
            broadcast({ type: 'ROUTE_UPDATED', mission_id, new_polyline });
          }
          if (dest_coords) {
            broadcast({ type: 'DESTINATION_UPDATED', mission_id, dest_coords });
          }
        }
        broadcast(parsed); // tell all clients to update displayed route
        return;
      }

      // ── INCIDENT_LOGGED: { lat, lng, type: 'OBSTRUCTION', mission_id }
      if (parsed.type === 'OBSTRUCTION') {
        const roadblockId = parsed.id || `rb-${Date.now()}`;
        // Store the roadblock so new/reconnecting clients see it
        activeRoadblocks.push({ id: roadblockId, lat: parsed.lat, lng: parsed.lng, type: 'OBSTRUCTION' });

        // If no mission_id supplied (e.g. TMC map click), find the closest active mission
        // by comparing to each mission's last known telemetry position in Redis.
        let resolvedMissionId = parsed.mission_id;
        if (!resolvedMissionId) {
          const missionIds = Object.keys(activeMissions);
          if (missionIds.length === 1) {
            // Only one active mission — trivial assignment
            resolvedMissionId = missionIds[0];
          } else if (missionIds.length > 1) {
            // Multiple missions: find the one with telemetry closest to the roadblock
            let minDist = Infinity;
            for (const mid of missionIds) {
              try {
                const t = await getTelemetry(mid);
                if (t && t.lat && t.lng) {
                  const dLat = parseFloat(t.lat) - parsed.lat;
                  const dLng = parseFloat(t.lng) - parsed.lng;
                  const dist = Math.sqrt(dLat * dLat + dLng * dLng);
                  if (dist < minDist) { minDist = dist; resolvedMissionId = mid; }
                }
              } catch (_) { /* skip */ }
            }
          }
        }

        let destination = undefined;
        if (resolvedMissionId && activeMissions[resolvedMissionId]) {
          const mission = activeMissions[resolvedMissionId];
          const phase = mission.current_phase;
          if (phase === 'to_incident') destination = mission.incident_coords;
          else if (phase === 'to_hospital') destination = mission.hospital_coords;
          else if (phase === 'to_base') destination = mission.base_coords;
        }

        const enriched = { ...parsed, id: roadblockId, mission_id: resolvedMissionId, destination, activeRoadblocks };
        broadcast(enriched);
        if (incidentEmitter) incidentEmitter.emit('OBSTRUCTION', enriched);
        return;
      }

      // ── REMOVE_OBSTRUCTION: { id, type: 'REMOVE_OBSTRUCTION' }
      if (parsed.type === 'REMOVE_OBSTRUCTION') {
        activeRoadblocks = activeRoadblocks.filter(rb => rb.id !== parsed.id);
        broadcast(parsed);
        // We could also emit to the anomaly detector if we want to cancel reroutes,
        // but for now just removing it from the map is enough.
        return;
      }

      // ── REMOVE_DRIVER: { driver_id, type: 'REMOVE_DRIVER' }
      if (parsed.type === 'REMOVE_DRIVER') {
        delete registeredDrivers[parsed.driver_id];
        broadcast(parsed);
        return;
      }

      // ── ROUTE_UPDATED (manual detour): { mission_id, new_polyline }
      if (parsed.new_polyline !== undefined) {
        const { mission_id, new_polyline } = parsed;
        if (mission_id && activeMissions[mission_id]) {
          const phase = activeMissions[mission_id].current_phase;
          if (phase === 'to_incident') activeMissions[mission_id].leg_to_incident = new_polyline;
          else if (phase === 'to_hospital') activeMissions[mission_id].leg_to_hospital = new_polyline;
          else if (phase === 'to_base') activeMissions[mission_id].leg_to_base = new_polyline;
          activeMissions[mission_id].upcomingNodes = extractNodesFromPolyline(new_polyline, mission_id);
        }
        broadcast(parsed);
        return;
      }

      // ── DEMO_SPEED_CONTROL: { speedMult, paused }
      if (parsed.speedMult !== undefined) {
        broadcast(parsed);
        return;
      }

      // ── STATE_REQUEST: any client can request full state replay
      if (parsed.request_state) {
        // Replay all active missions
        for (const [missionId, missionData] of Object.entries(activeMissions)) {
          // Send TELEMETRY_UPDATE first so frontend simulator knows where to start
          const latestState = await getTelemetry(missionId);
          if (latestState && Object.keys(latestState).length > 0) {
            sendToClient(ws, {
              type: 'TELEMETRY_UPDATE',
              mission_id: missionId,
              unit_id: missionData.unit_id,
              is_recovery: true,
              lat: parseFloat(latestState.lat),
              lng: parseFloat(latestState.lng),
              speed: parseFloat(latestState.speed)
            });
          }

          sendToClient(ws, {
            type: 'MISSION_START',
            ...missionData
          });
        }
        // Replay all registered drivers
        for (const driver of Object.values(registeredDrivers)) {
          sendToClient(ws, driver);
        }
        // Replay all roadblocks
        for (const rb of activeRoadblocks) {
          sendToClient(ws, rb);
        }
        return;
      }
      // ── RESET_SIMULATION: clear all missions
      if (parsed.type === 'RESET_SIMULATION') {
        for (const key in activeMissions) delete activeMissions[key];
        broadcast({ type: 'RESET_SIMULATION' });
        console.log(`[Telemetry] RESET_SIMULATION triggered. All missions cleared.`);
        return;
      }
    });

    ws.on('close', () => {
      allClients.delete(ws);
    });

    // Immediately replay all active missions and drivers to the new client
    (async () => {
      for (const [missionId, missionData] of Object.entries(activeMissions)) {
        const latestState = await getTelemetry(missionId);
        if (latestState && Object.keys(latestState).length > 0) {
          sendToClient(ws, {
            type: 'TELEMETRY_UPDATE',
            mission_id: missionId,
            unit_id: missionData.unit_id,
            is_recovery: true,
            lat: parseFloat(latestState.lat),
            lng: parseFloat(latestState.lng),
            speed: parseFloat(latestState.speed)
          });
        }

        sendToClient(ws, {
          type: 'MISSION_START',
          ...missionData
        });
      }

      // Replay registered drivers
      for (const driver of Object.values(registeredDrivers)) {
        sendToClient(ws, driver);
      }
      // Replay all roadblocks
      for (const rb of activeRoadblocks) {
        sendToClient(ws, rb);
      }
    })();
  });
}

module.exports = { initTelemetry, updateMissionPolyline };
