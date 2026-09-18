/**
 * TomTom Traffic Incidents Polling Service
 * Periodically queries TomTom API for traffic anomalies within a bounding box.
 */

const express = require('express');
const axios = require('axios');

const router = express.Router();

let polling_interval_id = null;
let current_bbox = null;
let latest_incidents = [];

/**
 * Fetch incidents from TomTom API
 */
async function fetchIncidents() {
  if (!current_bbox) return;

  // We assume Dev 4 adds this to .env, fallback to a dummy string to prevent crashes
  const TOMTOM_API_KEY = process.env.TOMTOM_API_KEY || 'missing_key';

  try {
    const [minLng, minLat, maxLng, maxLat] = current_bbox;
    
    // TomTom Incident Details API Endpoint
    // Format: bbox=minLon,minLat,maxLon,maxLat
    const url = `https://api.tomtom.com/traffic/services/5/incidentDetails?bbox=${minLng},${minLat},${maxLng},${maxLat}&fields={incidents{type,geometry{type,coordinates}}}&key=${TOMTOM_API_KEY}`;
    
    const response = await axios.get(url);
    
    if (response.data && response.data.incidents) {
      latest_incidents = response.data.incidents;
      console.log(`[TomTom Service] Fetched ${latest_incidents.length} traffic incidents.`);
    } else {
      latest_incidents = [];
    }
  } catch (error) {
    console.error('[TomTom Service] Error fetching incidents. (Check API Key / Rate Limits):', error.message);
  }
}

/**
 * POST /start
 * Body: { "bbox": [minLng, minLat, maxLng, maxLat] }
 * Starts the polling loop for a specific bounding box.
 */
router.post('/start', (req, res) => {
  const { bbox } = req.body;

  if (!bbox || !Array.isArray(bbox) || bbox.length !== 4) {
    return res.status(400).json({ error: 'invalid_bbox_array_expected_4_floats' });
  }

  current_bbox = bbox;

  // Clear existing polling if any (e.g., mission updated)
  if (polling_interval_id) {
    clearInterval(polling_interval_id);
  }

  // Poll every 30 seconds
  polling_interval_id = setInterval(fetchIncidents, 30000);
  
  // Do an immediate fetch so we don't wait 30s for the first result
  fetchIncidents();

  return res.json({ status: 'polling_started', bbox: current_bbox });
});

/**
 * POST /stop
 * Halts the polling loop.
 */
router.post('/stop', (req, res) => {
  if (polling_interval_id) {
    clearInterval(polling_interval_id);
    polling_interval_id = null;
  }
  current_bbox = null;
  latest_incidents = [];

  return res.json({ status: 'polling_stopped' });
});

/**
 * GET /
 * Returns the latest incidents fetched from TomTom (strict snake_case).
 */
router.get('/', (req, res) => {
  return res.json({ 
    incidents_count: latest_incidents.length,
    incidents: latest_incidents 
  });
});

module.exports = router;
