/**
 * D4-6: 20 seeded Mumbai intersection nodes as a GeoJSON FeatureCollection.
 * Coordinates cover South Mumbai → Central → Bandra corridor.
 * All nodes start in RED phase; state transitions are managed by the map engine
 * via Map#setFilter on SIGNAL_PREEMPT / SIGNAL_RELEASE WebSocket events.
 */
export const INTERSECTION_NODES_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    // South Mumbai
    { type: 'Feature', properties: { intersection_id: 'node-01', signal_phase: 'RED' }, geometry: { type: 'Point', coordinates: [72.8234, 18.9221] } },
    { type: 'Feature', properties: { intersection_id: 'node-02', signal_phase: 'RED' }, geometry: { type: 'Point', coordinates: [72.8311, 18.9300] } },
    { type: 'Feature', properties: { intersection_id: 'node-03', signal_phase: 'RED' }, geometry: { type: 'Point', coordinates: [72.8347, 18.9388] } },
    { type: 'Feature', properties: { intersection_id: 'node-04', signal_phase: 'RED' }, geometry: { type: 'Point', coordinates: [72.8277, 18.9451] } },
    // Marine Lines → Grant Road
    { type: 'Feature', properties: { intersection_id: 'node-05', signal_phase: 'RED' }, geometry: { type: 'Point', coordinates: [72.8356, 18.9543] } },
    { type: 'Feature', properties: { intersection_id: 'node-06', signal_phase: 'RED' }, geometry: { type: 'Point', coordinates: [72.8245, 18.9634] } },
    { type: 'Feature', properties: { intersection_id: 'node-07', signal_phase: 'RED' }, geometry: { type: 'Point', coordinates: [72.8450, 18.9647] } },
    { type: 'Feature', properties: { intersection_id: 'node-08', signal_phase: 'RED' }, geometry: { type: 'Point', coordinates: [72.8566, 18.9722] } },
    // Mumbai Central → Mahalaxmi
    { type: 'Feature', properties: { intersection_id: 'node-09', signal_phase: 'RED' }, geometry: { type: 'Point', coordinates: [72.8352, 18.9701] } },
    { type: 'Feature', properties: { intersection_id: 'node-10', signal_phase: 'RED' }, geometry: { type: 'Point', coordinates: [72.8483, 18.9820] } },
    { type: 'Feature', properties: { intersection_id: 'node-11', signal_phase: 'RED' }, geometry: { type: 'Point', coordinates: [72.8583, 18.9952] } },
    { type: 'Feature', properties: { intersection_id: 'node-12', signal_phase: 'RED' }, geometry: { type: 'Point', coordinates: [72.8427, 19.0017] } },
    // Lower Parel → Dadar
    { type: 'Feature', properties: { intersection_id: 'node-13', signal_phase: 'RED' }, geometry: { type: 'Point', coordinates: [72.8312, 19.0139] } },
    { type: 'Feature', properties: { intersection_id: 'node-14', signal_phase: 'RED' }, geometry: { type: 'Point', coordinates: [72.8427, 19.0277] } },
    { type: 'Feature', properties: { intersection_id: 'node-15', signal_phase: 'RED' }, geometry: { type: 'Point', coordinates: [72.8427, 19.0400] } },
    // Worli → Bandra
    { type: 'Feature', properties: { intersection_id: 'node-16', signal_phase: 'RED' }, geometry: { type: 'Point', coordinates: [72.8250, 19.0350] } },
    { type: 'Feature', properties: { intersection_id: 'node-17', signal_phase: 'RED' }, geometry: { type: 'Point', coordinates: [72.8200, 19.0540] } },
    { type: 'Feature', properties: { intersection_id: 'node-18', signal_phase: 'RED' }, geometry: { type: 'Point', coordinates: [72.8301, 19.0616] } },
    { type: 'Feature', properties: { intersection_id: 'node-19', signal_phase: 'RED' }, geometry: { type: 'Point', coordinates: [72.8412, 19.0552] } },
    { type: 'Feature', properties: { intersection_id: 'node-20', signal_phase: 'RED' }, geometry: { type: 'Point', coordinates: [72.8553, 19.0460] } },
  ]
};
