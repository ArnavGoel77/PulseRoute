/**
 * D4-6: 20 seeded Mumbai intersection nodes as a GeoJSON FeatureCollection.
 * Coordinates cover South Mumbai → Central → Bandra corridor.
 * All nodes start in RED phase; state transitions are managed by the map engine
 * via Map#setFilter on SIGNAL_PREEMPT / SIGNAL_RELEASE WebSocket events.
 */
export const INTERSECTION_NODES_GEOJSON = {
  type: 'FeatureCollection',
  features: []
};
