const express = require('express');
const { redis } = require('../services/redis-client');

const router = express.Router();

/**
 * POST /api/unit/base
 * Saves the unit's base location to Redis.
 * Expects body: { unit_id, base_lat, base_lng }
 */
router.post('/base', async (req, res) => {
  try {
    const { unit_id, base_lat, base_lng } = req.body;

    if (!unit_id || !base_lat || !base_lng) {
      return res.status(400).json({ error: 'missing_parameters' });
    }

    const key = `unit:${unit_id}:base`;
    const payload = {
      base_lat: parseFloat(base_lat),
      base_lng: parseFloat(base_lng),
      updated_at: Date.now()
    };

    if (redis && typeof redis.hset === 'function') {
      await redis.hset(key, 'base_lat', String(base_lat), 'base_lng', String(base_lng), 'updated_at', String(Date.now()));
    }

    return res.json({ success: true, unit_id, payload });
  } catch (error) {
    console.error('Unit Base API Error:', error);
    return res.status(500).json({ error: 'internal_server_error' });
  }
});

module.exports = router;
