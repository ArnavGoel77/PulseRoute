const turf = require('@turf/turf');

// We need to keep track of the previous distance to accurately detect "passing" a node
// Structure: { [missionId]: { [nodeId]: previousDistance } }
const distanceState = {};

/**
 * Calculates temporal distance to the next intersection node and triggers preemption or release events.
 * 
 * @param {string} missionId 
 * @param {number} lat 
 * @param {number} lng 
 * @param {number} speed - Speed in meters per second
 * @param {Array<Object>} upcomingNodes - Array of nodes { id: string, coord: [lng, lat], preempted: boolean, passed: boolean }
 * @param {Function} broadcastCallback - Callback to broadcast WS events
 */
function processTelemetryUpdate(missionId, lat, lng, speed, upcomingNodes, broadcastCallback) {
  if (!upcomingNodes || upcomingNodes.length === 0) return;

  if (!distanceState[missionId]) {
    distanceState[missionId] = {};
  }

  const currentPoint = turf.point([lng, lat]);
  // To avoid division by zero when stopped
  const safeSpeed = speed > 0 ? speed : 1; 

  // We only look at the very next node in the array that hasn't been passed
  const nextNodeIndex = upcomingNodes.findIndex(node => !node.passed);
  if (nextNodeIndex === -1) return; // All nodes passed

  const nextNode = upcomingNodes[nextNodeIndex];
  const nodePoint = turf.point(nextNode.coord);
  
  // Calculate distance in meters
  const distanceKm = turf.distance(currentPoint, nodePoint, { units: 'kilometers' });
  const distanceMeters = distanceKm * 1000;

  // Calculate ETA in seconds
  const etaSeconds = distanceMeters / safeSpeed;
  const prevDistance = distanceState[missionId][nextNode.id];

  // 1. Queue Clearance Buffer Logic
  // If ETA <= 10 seconds and not yet preempted, broadcast SIGNAL_PREEMPT
  if (etaSeconds <= 10 && !nextNode.preempted) {
    nextNode.preempted = true;
    
    // Strict Snake Case & specific payload keys required by spec
    broadcastCallback({
      intersection_id: nextNode.id,
      phase: 'GREEN'
    });
  }

  // 2. All-Red Recovery Logic
  // We have passed the node if distance starts increasing AND we were already close, OR we are extremely close.
  const passedByRadius = distanceMeters <= 15;
  const passedByTrajectory = prevDistance !== undefined && distanceMeters > prevDistance && prevDistance < 50;

  if ((passedByRadius || passedByTrajectory) && nextNode.preempted && !nextNode.passed) {
    nextNode.passed = true;
    
    broadcastCallback({
      intersection_id: nextNode.id,
      phase: 'ALL_RED'
    });
  }

  // Update distance state
  distanceState[missionId][nextNode.id] = distanceMeters;
}

module.exports = {
  processTelemetryUpdate
};
