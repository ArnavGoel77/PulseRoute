/**
 * Horizon Grid — Frontend WebSocket Client Singleton
 * Implements exponential backoff reconnection.
 * Routes incoming payloads to named events by sniffing payload keys.
 */

const WS_URL = import.meta.env.VITE_BACKEND_WS_URL || 'ws://localhost:3000';

class WebSocketClient {
  constructor() {
    this.ws = null;
    this.listeners = new Map(); // eventName -> Set<callback>
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.isConnecting = false;
    this._reconnectTimer = null;
  }

  connect(requestState = false) {
    if (this.isConnecting) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Already connected — request full state replay from backend
      if (requestState) {
        this.send({ request_state: true });
      }
      return;
    }

    this.isConnecting = true;
    console.log(`[WS Client] Connecting to ${WS_URL}...`);

    try {
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        console.log('[WS Client] Connected.');
        this.isConnecting = false;
        this.reconnectDelay = 1000;
        // Always request full state on connect so any tab gets the current mission
        this.send({ request_state: true });
        this._emit('__connected', null);
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          this._route(payload);
        } catch (e) { /* drop non-JSON */ }
      };

      this.ws.onclose = () => {
        this.isConnecting = false;
        console.warn(`[WS Client] Disconnected. Retrying in ${this.reconnectDelay}ms...`);
        this._emit('__disconnected', null);
        this._reconnectTimer = setTimeout(() => { this.connect(); }, this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      };

      this.ws.onerror = () => { this.ws?.close(); };
    } catch (err) {
      this.isConnecting = false;
      console.error('[WS Client] Failed to create WebSocket:', err);
    }
  }

  send(payload) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    } else {
      console.warn('[WS Client] Cannot send — socket is not open.');
    }
  }

  on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName).add(callback);
    return () => { this.listeners.get(eventName)?.delete(callback); };
  }

  /**
   * Routes incoming payload to the correct event listeners by sniffing keys.
   *
   * Event types:
   *  MISSION_START   — { mission_id, priority, leg_to_incident, leg_to_hospital, leg_to_base,
   *                      incident_coords, hospital_coords, base_coords, current_phase }
   *  TELEMETRY_UPDATE — { mission_id, lat, lng, speed }
   *  PHASE_CHANGE    — { mission_id, new_phase }
   *  SIGNAL_PREEMPT  — { intersection_id, phase: 'GREEN' }
   *  SIGNAL_RELEASE  — { intersection_id, phase: 'ALL_RED' }
   *  ROUTE_UPDATED   — { mission_id, new_polyline }
   *  INCIDENT_LOGGED — { lat, lng, type: 'OBSTRUCTION' }
   *  DEMO_SPEED_CONTROL — { speedMult, paused }
   *  DRIVER_REGISTERED — { driver_id, lat, lng }
   *  DRIVER_UPDATE   — { driver_id, lat, lng, status, mission_id }
   */
  _route(payload) {
    // DRIVER_REGISTERED — identified by driver_id + lat + lng (no speed)
    if (payload.driver_id !== undefined) {
      return this._emit('DRIVER_REGISTERED', payload);
    }
    // MISSION_START — identified by presence of leg_to_incident
    if (payload.leg_to_incident !== undefined) {
      return this._emit('MISSION_START', payload);
    }
    // PHASE_CHANGE
    if (payload.new_phase !== undefined) {
      return this._emit('PHASE_CHANGE', payload);
    }
    // TELEMETRY_UPDATE
    if (payload.lat !== undefined && payload.speed !== undefined) {
      return this._emit('TELEMETRY_UPDATE', payload);
    }
    // SIGNAL_PREEMPT
    if (payload.phase === 'GREEN') {
      return this._emit('SIGNAL_PREEMPT', payload);
    }
    // SIGNAL_RELEASE
    if (payload.phase === 'ALL_RED') {
      return this._emit('SIGNAL_RELEASE', payload);
    }
    // ROUTE_UPDATED
    if (payload.new_polyline !== undefined) {
      return this._emit('ROUTE_UPDATED', payload);
    }
    // INCIDENT_LOGGED
    if (payload.type === 'OBSTRUCTION') {
      return this._emit('INCIDENT_LOGGED', payload);
    }
    // REMOVE_OBSTRUCTION
    if (payload.type === 'REMOVE_OBSTRUCTION') {
      return this._emit('REMOVE_OBSTRUCTION', payload);
    }
    // REMOVE_DRIVER
    if (payload.type === 'REMOVE_DRIVER') {
      return this._emit('REMOVE_DRIVER', payload);
    }
    // DEMO_SPEED_CONTROL
    if (payload.speedMult !== undefined) {
      return this._emit('DEMO_SPEED_CONTROL', payload);
    }
    // RESET_SIMULATION
    if (payload.type === 'RESET_SIMULATION') {
      return this._emit('RESET_SIMULATION', payload);
    }
  }

  _emit(eventName, payload) {
    this.listeners.get(eventName)?.forEach((cb) => {
      try { cb(payload); } catch (e) { console.error('[WS Client] Listener error:', e); }
    });
  }
}

const wsClient = new WebSocketClient();
export default wsClient;
