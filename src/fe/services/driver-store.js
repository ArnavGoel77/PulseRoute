/**
 * Driver Store — Shared Fleet Registry Singleton
 * Holds the list of all registered drivers (AMB-1, AMB-2, etc.)
 * and their current locations/status. Uses a pub/sub pattern so
 * any React component can subscribe for real-time updates.
 *
 * Driver shape:
 *   { id: 'AMB-1', lat: 19.01, lng: 72.85, status: 'AVAILABLE' | 'ON_MISSION', mission_id: null }
 */

const drivers = new Map(); // id -> driver object
const subscribers = new Set();

function notify() {
  const list = Array.from(drivers.values());
  for (const cb of subscribers) {
    try { cb(list); } catch (e) { /* noop */ }
  }
}

export const driverStore = {
  /** Returns all drivers as a plain array */
  getAll() {
    return Array.from(drivers.values());
  },

  /** Register a new driver or update position if already exists */
  addOrUpdate(id, lat, lng) {
    const existing = drivers.get(id) || { id, status: 'AVAILABLE', mission_id: null };
    drivers.set(id, { ...existing, id, lat: parseFloat(lat), lng: parseFloat(lng) });
    notify();
  },

  /** Mark a driver as ON_MISSION */
  setOnMission(id, mission_id) {
    if (drivers.has(id)) {
      drivers.set(id, { ...drivers.get(id), status: 'ON_MISSION', mission_id });
      notify();
    }
  },

  /** Mark a driver as AVAILABLE again */
  setAvailable(id) {
    if (drivers.has(id)) {
      drivers.set(id, { ...drivers.get(id), status: 'AVAILABLE', mission_id: null });
      notify();
    }
  },

  /**
   * Find the closest AVAILABLE driver to a given lat/lng.
   * Returns { driver, distanceKm } or null if none available.
   */
  findClosest(lat, lng) {
    let closest = null;
    let minDist = Infinity;

    for (const driver of drivers.values()) {
      if (driver.status !== 'AVAILABLE') continue;
      const dLat = driver.lat - lat;
      const dLng = driver.lng - lng;
      const dist = Math.sqrt(dLat * dLat + dLng * dLng) * 111; // rough km
      if (dist < minDist) {
        minDist = dist;
        closest = driver;
      }
    }

    return closest ? { driver: closest, distanceKm: minDist } : null;
  },

  /** Subscribe to store changes. Returns unsubscribe fn. */
  subscribe(cb) {
    subscribers.add(cb);
    // Immediately call with current data
    cb(Array.from(drivers.values()));
    return () => subscribers.delete(cb);
  }
};
