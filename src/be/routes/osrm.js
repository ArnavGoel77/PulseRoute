/**
 * OSRM Routing Proxy and Caching Layer
 * Handles fetching optimized routes from OSRM and caching them in Redis.
 */

const express = require('express');
const axios = require('axios');
const { redis } = require('../services/redis-client');

const router = express.Router();

/**
 * Polyline Decoder (Precision 5)
 * Decodes standard OSRM polyline strings into an array of [lat, lng] pairs.
 */
function decodePolyline(encoded) {
  const coords = [];
  let index = 0, lat = 0, lng = 0;

  while (index < encoded.length) {
    let shift = 0, result = 0, b;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;

    shift = 0; result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;

    // Push as [lat, lng]
    coords.push([lat / 1e5, lng / 1e5]);
  }
  return coords;
}
/**
 * GET /
 * Expects query parameters: start_lat, start_lng, end_lat, end_lng
 * Returns strict snake_case JSON payload.
 */
router.get('/', async (req, res) => {
  try {
    const { start_lat, start_lng, end_lat, end_lng, detour_lat, detour_lng, unit_id } = req.query;

    if (!start_lat || !start_lng || !end_lat || !end_lng) {
      return res.status(400).json({ error: 'missing_coordinates' });
    }

    let base_lat, base_lng;
    
    // Fetch base coordinates from Redis if unit_id is provided
    if (unit_id && redis && typeof redis.hgetall === 'function') {
      try {
        const baseData = await redis.hgetall(`unit:${unit_id}:base`);
        if (baseData && baseData.base_lat && baseData.base_lng) {
          base_lat = baseData.base_lat;
          base_lng = baseData.base_lng;
        }
      } catch (err) {
        console.warn('Failed to fetch unit base from Redis:', err);
      }
    }

    // Strict snake_case namespace for Redis key
    // Support 4-point routing cache key format
    let cache_key = `osrm_route:${start_lat},${start_lng}:${end_lat},${end_lng}`;
    if (base_lat && base_lng) {
      cache_key += `:base_${base_lat},${base_lng}`;
    }
    if (detour_lat && detour_lng) {
      cache_key += `:${detour_lat},${detour_lng}`;
    }

    // 1. Check Redis Cache
    let cached_route = null;
    try {
      // Safe check in case redis-client is not yet fully implemented by Dev 1
      if (redis && typeof redis.get === 'function') {
        cached_route = await redis.get(cache_key);
      }
    } catch (cache_err) {
      console.warn('Redis cache read error:', cache_err);
    }

    if (cached_route) {
      console.log(`Cache hit for route: ${cache_key}`);
      return res.json(cached_route);
    }

    console.log(`Cache miss for route: ${cache_key}. Fetching from OSRM...`);

    // 2. Fetch from OSRM Public API
    // Note: OSRM expects coordinates in {longitude},{latitude} order
    let coords_str = '';
    
    if (base_lat && base_lng) {
      coords_str += `${base_lng},${base_lat};`; // Start at Base
    }
    
    coords_str += `${start_lng},${start_lat}`; // Incident (Origin)

    if (detour_lat && detour_lng) {
      coords_str += `;${detour_lng},${detour_lat}`; // Detour (if any)
    }
    
    coords_str += `;${end_lng},${end_lat}`; // Hospital (Destination)
    
    if (base_lat && base_lng) {
      coords_str += `;${base_lng},${base_lat}`; // Return to Base
    }
    
    const osrm_url = `http://router.project-osrm.org/route/v1/driving/${coords_str}?overview=full&geometries=polyline`;
    
    const osrm_response = await axios.get(osrm_url);
    const osrm_data = osrm_response.data;

    if (osrm_data.code !== 'Ok' || !osrm_data.routes || osrm_data.routes.length === 0) {
      return res.status(404).json({ error: 'route_not_found' });
    }

    const primary_route = osrm_data.routes[0];

    // 3. Format Response Payload (Strict snake_case)
    const route_payload = {
      path_polyline: primary_route.geometry,
      decoded_path: decodePolyline(primary_route.geometry),
      distance_meters: primary_route.distance,
      duration_seconds: primary_route.duration,
      route_legs: primary_route.legs // Provide phase lengths to Dev 1
    };

    // 4. Save to Redis Cache (Expire after 30 seconds)
    try {
      if (redis && typeof redis.set === 'function') {
        // Upstash Redis automatically handles JSON serialization
        await redis.set(cache_key, route_payload, { ex: 30 });
      }
    } catch (cache_err) {
      console.warn('Redis cache write error:', cache_err);
    }

    return res.json(route_payload);

  } catch (error) {
    console.error('OSRM Route Proxy Error:', error);
    return res.status(500).json({ error: 'internal_server_error' });
  }
});

/**
 * GET /legs
 * Returns 3 separate route legs for 3-phase ambulance routing:
 *   leg_1: base → incident (ambulance drives to scene)
 *   leg_2: incident → hospital (transport patient)
 *   leg_3: hospital → base (return to standby)
 *
 * Query params: incident_lat, incident_lng, hospital_lat, hospital_lng, unit_id
 * base_lat/base_lng auto-fetched from Redis using unit_id (set in Driver HUD)
 */
router.get('/legs', async (req, res) => {
  try {
    const { incident_lat, incident_lng, hospital_lat, hospital_lng, unit_id, base_lat: query_base_lat, base_lng: query_base_lng } = req.query;

    if (!incident_lat || !incident_lng || !hospital_lat || !hospital_lng) {
      return res.status(400).json({ error: 'missing_coordinates', required: 'incident_lat, incident_lng, hospital_lat, hospital_lng' });
    }

    // Fetch base location from query params, or fallback to Redis
    let base_lat = query_base_lat || null;
    let base_lng = query_base_lng || null;
    if (!base_lat && !base_lng && unit_id && redis && typeof redis.hgetall === 'function') {
      try {
        const baseData = await redis.hgetall(`unit:${unit_id}:base`);
        if (baseData && baseData.base_lat && baseData.base_lng) {
          base_lat = baseData.base_lat;
          base_lng = baseData.base_lng;
        }
      } catch (err) {
        console.warn('Failed to fetch unit base from Redis:', err);
      }
    }

    // If no base in Redis, use a Mumbai default (Colaba)
    if (!base_lat || !base_lng) {
      base_lat = '18.9220';
      base_lng = '72.8347';
      console.log('[OSRM Legs] No base in Redis, using Mumbai default');
    }

    const fetchLeg = async (fromLng, fromLat, toLng, toLat, legName) => {
      const url = `http://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=polyline`;
      try {
        const resp = await axios.get(url, { timeout: 8000 });
        if (resp.data.code === 'Ok' && resp.data.routes.length > 0) {
          const route = resp.data.routes[0];
          return {
            polyline: route.geometry,
            distance_meters: Math.round(route.distance),
            duration_seconds: Math.round(route.duration)
          };
        }
      } catch (e) {
        console.error(`[OSRM Legs] Failed to fetch ${legName}:`, e.message);
      }
      return null;
    };

    // Fetch all 3 legs in parallel
    const [leg1, leg2, leg3] = await Promise.all([
      fetchLeg(base_lng, base_lat, incident_lng, incident_lat, 'leg1: base→incident'),
      fetchLeg(incident_lng, incident_lat, hospital_lng, hospital_lat, 'leg2: incident→hospital'),
      fetchLeg(hospital_lng, hospital_lat, base_lng, base_lat, 'leg3: hospital→base'),
    ]);

    if (!leg1 || !leg2 || !leg3) {
      return res.status(502).json({ error: 'osrm_failed', message: 'One or more route legs could not be fetched from OSRM' });
    }

    return res.json({
      leg_to_incident: leg1.polyline,
      leg_to_hospital: leg2.polyline,
      leg_to_base: leg3.polyline,
      distances: {
        to_incident: leg1.distance_meters,
        to_hospital: leg2.distance_meters,
        to_base: leg3.distance_meters
      },
      durations: {
        to_incident: leg1.duration_seconds,
        to_hospital: leg2.duration_seconds,
        to_base: leg3.duration_seconds
      },
      base_coords: { lat: parseFloat(base_lat), lng: parseFloat(base_lng) },
      incident_coords: { lat: parseFloat(incident_lat), lng: parseFloat(incident_lng) },
      hospital_coords: { lat: parseFloat(hospital_lat), lng: parseFloat(hospital_lng) }
    });

  } catch (error) {
    console.error('OSRM Legs Error:', error);
    return res.status(500).json({ error: 'internal_server_error' });
  }
});

module.exports = router;
