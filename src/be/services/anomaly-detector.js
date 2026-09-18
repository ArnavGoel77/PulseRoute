/**
 * Spatial Anomaly Detector & Dynamic Rerouting Engine
 * Uses Turf.js to detect spatial overlaps between the active route and traffic incidents.
 */

const turf = require('@turf/turf');
const axios = require('axios');
const EventEmitter = require('events');
const { getTelemetry } = require('./redis-client');

// Export an emitter so Dev 1's WebSocket server can listen for 'ROUTE_UPDATED' broadcasts
const rerouteEmitter = new EventEmitter();

// Export an emitter so Dev 1's WebSocket server can pass 'OBSTRUCTION' events to us
const incidentEmitter = new EventEmitter();

// Core BD2-5 Wire-Up: Catch the manual OBSTRUCTION event and immediately trigger a reroute!
incidentEmitter.on('OBSTRUCTION', async (payload) => {
  console.log(`[Anomaly Detector] Caught manual OBSTRUCTION event! Generating bypass...`);
  
  // The WS payload might just have { mission_id, lat, lng } or similar.
  // We need to fetch current telemetry from Redis to know where the ambulance is right now.
  const telemetry = await getTelemetry(payload.mission_id);
  
  if (telemetry && telemetry.lat) {
    const current_location = { lat: parseFloat(telemetry.lat), lng: parseFloat(telemetry.lng) };
    
    // Extract the actual destination from the active mission telemetry / OSRM cache!
    let destination = payload.destination;
    
    if (!destination) {
      try {
        const { redis } = require('./redis-client');
        const keys = await redis.keys('osrm_route:*');
        if (keys && keys.length > 0) {
          let closestDist = Infinity;
          let bestDest = null;
          
          for (const key of keys) {
            const parts = key.split(':');
            if (parts.length === 3 || parts.length === 5) {
              const isFourPoint = parts.length === 5;
              const startParts = isFourPoint ? parts[2].split(',') : parts[1].split(',');
              const destParts = isFourPoint ? parts[3].split(',') : parts[2].split(',');
              
              const sLat = parseFloat(startParts[0]);
              const sLng = parseFloat(startParts[1]);
              
              const startPt = turf.point([sLng, sLat]);
              const currentPt = turf.point([current_location.lng, current_location.lat]);
              
              const dist = turf.distance(startPt, currentPt);
              if (dist < closestDist) {
                closestDist = dist;
                bestDest = { lat: parseFloat(destParts[0]), lng: parseFloat(destParts[1]) };
              }
            }
          }
          if (bestDest) {
            destination = bestDest;
          }
        }
      } catch (e) {
        console.warn('Failed to extract destination from Redis cache:', e.message);
      }
    }
    
    // Fallback to a central Mumbai location if extraction entirely fails
    if (!destination) {
      destination = { lat: 19.0760, lng: 72.8777 }; 
    }
    
    // Fire the Option A rerouting bypass!
    await triggerReroute(payload.mission_id, current_location, destination);
  } else {
    console.warn(`[Anomaly Detector] Failed to find telemetry in Redis for mission ${payload.mission_id}. Cannot reroute.`);
  }
});

/**
 * Detects if the given route polyline intersects with any TomTom incidents.
 * @param {Array<Array<number>>} routeCoords - Array of [lat, lng] pairs.
 * @param {Array<Object>} incidents - Array of TomTom incident objects.
 * @returns {Array<Object>} - Array of intersecting incidents.
 */
function detectAnomalies(routeCoords, incidents) {
  if (!routeCoords || routeCoords.length < 2) {
    console.warn('[Anomaly Detector] Invalid routeCoords array. Must have at least 2 points.');
    return [];
  }

  if (!incidents || incidents.length === 0) {
    return [];
  }

  const overlapping_incidents = [];

  try {
    // CRITICAL: Turf.js expects coordinates in [longitude, latitude] format!
    // Our backend uses [lat, lng] strictly, so we must map them for Turf.
    const turf_route_coords = routeCoords.map(coord => [coord[1], coord[0]]);
    
    // Create a Turf LineString for the ambulance's active route
    const route_line = turf.lineString(turf_route_coords);

    for (const incident of incidents) {
      if (!incident.geometry || !incident.geometry.coordinates) continue;

      let incident_feature = null;

      try {
        // TomTom returns GeoJSON-like geometry, but we must explicitly wrap it in Turf features
        if (incident.geometry.type === 'Polygon') {
          incident_feature = turf.polygon(incident.geometry.coordinates);
        } else if (incident.geometry.type === 'MultiPolygon') {
          incident_feature = turf.multiPolygon(incident.geometry.coordinates);
        } else if (incident.geometry.type === 'LineString') {
          incident_feature = turf.lineString(incident.geometry.coordinates);
        } else if (incident.geometry.type === 'Point') {
          incident_feature = turf.point(incident.geometry.coordinates);
        }
      } catch (geom_err) {
        console.warn(`[Anomaly Detector] Failed to parse geometry for incident type ${incident.geometry.type}:`, geom_err.message);
        continue;
      }

      if (incident_feature) {
        // Core BD2-4 Task: Use booleanIntersects to detect overlap
        const is_intersecting = turf.booleanIntersects(route_line, incident_feature);
        if (is_intersecting) {
          overlapping_incidents.push(incident);
        }
      }
    }
  } catch (error) {
    console.error('[Anomaly Detector] Spatial mathematics error:', error);
  }

  if (overlapping_incidents.length > 0) {
    console.log(`[Anomaly Detector] 🚨 ALERT! Detected ${overlapping_incidents.length} spatial anomalies intersecting the active route!`);
  }

  return overlapping_incidents;
}

/**
 * BD2-5: Dynamic Rerouting Engine (Option A Implementation)
 * Calculates a detour waypoint to bypass hazards and queries OSRM for a new route.
 * Emits a ROUTE_UPDATED event that the WebSocket server should listen to.
 * 
 * @param {string} mission_id - The active mission ID.
 * @param {Object} current_location - { lat, lng } of the ambulance.
 * @param {Object} destination_coords - { lat, lng } of the hospital.
 */
async function triggerReroute(mission_id, current_location, destination_coords) {
  console.log(`[Rerouting Engine] Initiating Option A reroute for mission ${mission_id}...`);

  try {
    // 1. Calculate a detour waypoint using Turf.js
    // We create a point 500 meters perpendicular to the direct path to force OSRM away from the hazard
    const current_pt = turf.point([current_location.lng, current_location.lat]);
    const dest_pt = turf.point([destination_coords.lng, destination_coords.lat]);
    
    const direct_bearing = turf.bearing(current_pt, dest_pt);
    // Add 90 degrees to steer right (or left) of the incident
    const detour_bearing = direct_bearing + 90; 
    
    // Create a waypoint 0.5km away
    const detour_pt = turf.destination(current_pt, 0.5, detour_bearing, { units: 'kilometers' });
    const detour_lng = detour_pt.geometry.coordinates[0];
    const detour_lat = detour_pt.geometry.coordinates[1];

    console.log(`[Rerouting Engine] Calculated detour waypoint: ${detour_lat}, ${detour_lng}`);

    // 2. Query OSRM with 3 points: Current -> Detour Waypoint -> Destination
    const osrm_url = `http://router.project-osrm.org/route/v1/driving/${current_location.lng},${current_location.lat};${detour_lng},${detour_lat};${destination_coords.lng},${destination_coords.lat}?overview=full&geometries=polyline`;
    
    const response = await axios.get(osrm_url);
    const osrm_data = response.data;

    if (osrm_data.code === 'Ok' && osrm_data.routes.length > 0) {
      const new_polyline = osrm_data.routes[0].geometry;
      
      const payload = {
        mission_id: mission_id,
        new_polyline: new_polyline
      };

      // 3. Broadcast the ROUTE_UPDATED payload via our EventEmitter
      // Dev 1 (Telemetry) will listen to this and pipe it out to the raw WebSocket clients!
      rerouteEmitter.emit('ROUTE_UPDATED', payload);
      console.log(`[Rerouting Engine] Successfully generated and broadcasted new route for mission ${mission_id}!`);
      
      return payload;
    } else {
      console.error('[Rerouting Engine] OSRM failed to find a valid detour.');
    }
  } catch (error) {
    console.error('[Rerouting Engine] Error calculating reroute:', error.message);
  }
}

module.exports = {
  detectAnomalies,
  triggerReroute,
  rerouteEmitter,
  incidentEmitter
};
