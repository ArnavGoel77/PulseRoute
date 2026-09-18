/**
 * OSRM Routing Proxy and Caching Layer
 * Handles fetching optimized routes from OSRM and caching them in Redis.
 */

const express = require('express');
const axios = require('axios');
const redis = require('../services/redis-client');

const router = express.Router();

/**
 * PLACEHOLDER: Polyline Decoder (Precision 5)
 * TODO: Implement actual decoding algorithm or use @mapbox/polyline later.
 */
function decodePolyline(polylineStr, startLat, startLng, endLat, endLng) {
  // Returning a mock raw coordinate array [lat, lng] for spatial mathematics
  return [
    [parseFloat(startLat), parseFloat(startLng)],
    [parseFloat(endLat), parseFloat(endLng)]
  ];
}
/**
 * GET /
 * Expects query parameters: start_lat, start_lng, end_lat, end_lng
 * Returns strict snake_case JSON payload.
 */
router.get('/', async (req, res) => {
  try {
    const { start_lat, start_lng, end_lat, end_lng } = req.query;

    if (!start_lat || !start_lng || !end_lat || !end_lng) {
      return res.status(400).json({ error: 'missing_coordinates' });
    }

    // Strict snake_case namespace for Redis key
    const cache_key = `osrm_route:${start_lat},${start_lng}:${end_lat},${end_lng}`;

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
    const osrm_url = `http://router.project-osrm.org/route/v1/driving/${start_lng},${start_lat};${end_lng},${end_lat}?overview=full&geometries=polyline`;
    
    const osrm_response = await axios.get(osrm_url);
    const osrm_data = osrm_response.data;

    if (osrm_data.code !== 'Ok' || !osrm_data.routes || osrm_data.routes.length === 0) {
      return res.status(404).json({ error: 'route_not_found' });
    }

    const primary_route = osrm_data.routes[0];

    // 3. Format Response Payload (Strict snake_case)
    const route_payload = {
      path_polyline: primary_route.geometry,
      decoded_path: decodePolyline(primary_route.geometry, start_lat, start_lng, end_lat, end_lng),
      distance_meters: primary_route.distance,
      duration_seconds: primary_route.duration
    };

    // 4. Save to Redis Cache (Expire after 1 hour / 3600 seconds)
    try {
      if (redis && typeof redis.set === 'function') {
        // Upstash Redis automatically handles JSON serialization
        await redis.set(cache_key, route_payload, { ex: 3600 });
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

module.exports = router;
