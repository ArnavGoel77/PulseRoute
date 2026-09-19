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
    
    // Extract the actual destination from the active mission telemetry (passed by telemetry.js)
    let destination = payload.destination;
    
    // Fallback to a central Mumbai location if extraction entirely fails
    if (!destination) {
      console.warn(`[Anomaly Detector] Missing destination in payload for mission ${payload.mission_id}, using fallback.`);
      destination = { lat: 19.0760, lng: 72.8777 }; 
    }
    
    // Fire the Option A rerouting bypass, passing the roadblock payload!
    await triggerReroute(payload.mission_id, current_location, destination, payload);
  } else {
    console.warn(`[Anomaly Detector] Failed to find telemetry in Redis for mission ${payload.mission_id}. Cannot reroute.`);
  }
});

/**
 * Polyline Decoder (Precision 5)
 */
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
    coords.push([lat / 1e5, lng / 1e5]); 
  }
  return coords;
}

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

async function triggerReroute(mission_id, current_location, destination_coords, obstruction) {
  console.log(`[Rerouting Engine] Initiating Mapbox detour reroute for mission ${mission_id}...`);

  try {
    const mapboxToken = process.env.VITE_MAPBOX_TOKEN;
    if (!mapboxToken) {
      console.error('[Rerouting Engine] Missing VITE_MAPBOX_TOKEN. Cannot use Mapbox API.');
      return null;
    }

    // Mapbox Directions API does NOT natively support point exclusions (exclude=point).
    // It silently ignores them, returning the exact same route. 
    // Instead, we calculate a detour waypoint 500m perpendicular to the roadblock!
    
    let obstacle_coords = current_location;
    if (obstruction && obstruction.lat) {
       obstacle_coords = { lat: obstruction.lat, lng: obstruction.lng };
    } else if (obstruction && obstruction.activeRoadblocks && obstruction.activeRoadblocks.length > 0) {
       obstacle_coords = obstruction.activeRoadblocks[0];
    }
    
    const current_pt = turf.point([current_location.lng, current_location.lat]);
    const dest_pt = turf.point([destination_coords.lng, destination_coords.lat]);
    const obstacle_pt = turf.point([obstacle_coords.lng, obstacle_coords.lat]);
    
    // Base bearing on the path from current to destination
    const direct_bearing = turf.bearing(current_pt, dest_pt);
    
    // Create a detour waypoint 500m perpendicular to the path, originating from the obstacle
    // (We add 90 degrees to steer right)
    const detour_bearing = direct_bearing + 90; 
    const detour_pt = turf.destination(obstacle_pt, 0.5, detour_bearing, { units: 'kilometers' });
    const detour_lng = detour_pt.geometry.coordinates[0];
    const detour_lat = detour_pt.geometry.coordinates[1];

    console.log(`[Rerouting Engine] Calculated Turf.js detour waypoint: ${detour_lat}, ${detour_lng}`);

    // Call Mapbox Directions v5 API routing THROUGH the detour waypoint
    const mapbox_url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${current_location.lng},${current_location.lat};${detour_lng},${detour_lat};${destination_coords.lng},${destination_coords.lat}?overview=full&geometries=polyline&access_token=${mapboxToken}`;
    
    const response = await axios.get(mapbox_url);
    const mapbox_data = response.data;
    
    if (mapbox_data.code === 'Ok' && mapbox_data.routes.length > 0) {
      const best_route = mapbox_data.routes[0];
      const best_polyline = best_route.geometry;
      
      const payload = {
        mission_id: mission_id,
        new_polyline: best_polyline,
        distance: best_route.distance,
        duration: best_route.duration
      };
      
      // Broadcast the ROUTE_UPDATED payload
      rerouteEmitter.emit('ROUTE_UPDATED', payload);
      console.log(`[Rerouting Engine] Successfully generated and broadcasted new Mapbox detour route for mission ${mission_id}!`);
      return payload;
    } else {
      console.error('[Rerouting Engine] Mapbox failed to find a valid detour.');
    }
  } catch (error) {
    console.error('[Rerouting Engine] Error calculating reroute:', error.response?.data?.message || error.message);
  }
}

module.exports = {
  detectAnomalies,
  triggerReroute,
  rerouteEmitter,
  incidentEmitter
};
