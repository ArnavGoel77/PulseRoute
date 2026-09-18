const { Redis } = require('@upstash/redis');
require('dotenv').config();

// Fallback logic in case .env isn't fully configured by Dev 4 yet.
const redisUrl = process.env.UPSTASH_REDIS_REST_URL || 'https://dummy.upstash.io';
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || 'dummy-token';

const redis = new Redis({
  url: redisUrl,
  token: redisToken,
});

/**
 * Writes incoming telemetry data to a Redis hash.
 * Strict Snake Case is enforced for keys.
 * 
 * @param {string} missionId
 * @param {number} lat
 * @param {number} lng
 * @param {number} speed
 */
async function updateTelemetry(missionId, lat, lng, speed) {
  const key = `mission:${missionId}:location`;
  const payload = {
    lat,
    lng,
    speed,
    updated_at: Date.now()
  };
  
  try {
    // Write to hash
    await redis.hset(key, payload);
    // Expire in 60 seconds to auto-clean stale data
    await redis.expire(key, 60);
  } catch (error) {
    console.error('Redis Update Error:', error);
  }
}

/**
 * Retrieves the current telemetry state for a mission.
 * 
 * @param {string} missionId 
 */
async function getTelemetry(missionId) {
  const key = `mission:${missionId}:location`;
  return await redis.hgetall(key);
}

module.exports = {
  redis,
  updateTelemetry,
  getTelemetry
};
