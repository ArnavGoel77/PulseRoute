/**
 * Horizon Grid — Frontend WebSocket Client Singleton
 * Implements exponential backoff reconnection as required by .antigravityrules,
 * since the raw `ws` package does not provide native reconnection.
 *
 * Payload routing follows strict key-sniffing (matching backend telemetry.js)
 * instead of a global `type` key, which is forbidden by the WS contract.
 */

const WS_URL = import.meta.env.VITE_BACKEND_WS_URL || 'ws://localhost:3000';

class WebSocketClient {
  constructor() {
    this.ws = null;
    this.listeners = new Map(); // eventName -> Set<callback>
    this.reconnectDelay = 1000;   // start at 1s
    this.maxReconnectDelay = 30000; // cap at 30s
    this.isConnecting = false;
    this._reconnectTimer = null;
  }

  connect() {
    if (this.isConnecting) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    this.isConnecting = true;
    console.log(`[WS Client] Connecting to ${WS_URL}...`);

    try {
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        console.log('[WS Client] Connected.');
        this.isConnecting = false;
        this.reconnectDelay = 1000; // reset backoff on success

        // Register this browser as a TMC client so backend routes
        // SIGNAL_PREEMPT / SIGNAL_RELEASE events to us.
        this.send({ role: 'TMC' });
        this._emit('__connected', null);
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          this._route(payload);
        } catch (e) {
          // Silently drop non-JSON frames
        }
      };

      this.ws.onclose = () => {
        this.isConnecting = false;
        console.warn(`[WS Client] Disconnected. Retrying in ${this.reconnectDelay}ms...`);
        this._emit('__disconnected', null);
        // Exponential backoff
        this._reconnectTimer = setTimeout(() => {
          this.connect();
        }, this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      };

      this.ws.onerror = () => {
        // onerror always precedes onclose, so just force the close
        // to trigger the backoff reconnect logic above.
        this.ws?.close();
      };
    } catch (err) {
      this.isConnecting = false;
      console.error('[WS Client] Failed to create WebSocket:', err);
    }
  }

  /**
   * Send a payload to the backend.
   * @param {Object} payload - Must match the WS contract (snake_case keys).
   */
  send(payload) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    } else {
      console.warn('[WS Client] Cannot send — socket is not open.');
    }
  }

  /**
   * Subscribe to a named event.
   * @param {string} eventName - One of: TELEMETRY_UPDATE, SIGNAL_PREEMPT,
   *   SIGNAL_RELEASE, MISSION_START, ROUTE_UPDATED, INCIDENT_LOGGED,
   *   __connected, __disconnected.
   * @param {Function} callback - Called with the payload object.
   * @returns {Function} Unsubscribe function — call it in useEffect cleanup.
   */
  on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName).add(callback);
    return () => {
      this.listeners.get(eventName)?.delete(callback);
    };
  }

  /**
   * Routes an incoming payload to the correct event listeners
   * by sniffing payload keys — matching the backend's telemetry.js logic.
   * @param {Object} payload
   */
  _route(payload) {
    // TELEMETRY_UPDATE: { mission_id, lat, lng, speed }
    if (payload.lat !== undefined && payload.speed !== undefined) {
      return this._emit('TELEMETRY_UPDATE', payload);
    }
    // SIGNAL_PREEMPT: { intersection_id, phase: 'GREEN' }
    if (payload.phase === 'GREEN') {
      return this._emit('SIGNAL_PREEMPT', payload);
    }
    // SIGNAL_RELEASE: { intersection_id, phase: 'ALL_RED' }
    if (payload.phase === 'ALL_RED') {
      return this._emit('SIGNAL_RELEASE', payload);
    }
    // ROUTE_UPDATED: { mission_id, new_polyline }
    if (payload.new_polyline !== undefined) {
      return this._emit('ROUTE_UPDATED', payload);
    }
    // MISSION_START: { mission_id, path_polyline, priority }
    if (payload.path_polyline !== undefined && payload.priority !== undefined) {
      return this._emit('MISSION_START', payload);
    }
    // INCIDENT_LOGGED: { lat, lng, type: 'OBSTRUCTION' }
    if (payload.type === 'OBSTRUCTION') {
      return this._emit('INCIDENT_LOGGED', payload);
    }
  }

  _emit(eventName, payload) {
    this.listeners.get(eventName)?.forEach((cb) => {
      try { cb(payload); } catch (e) { console.error('[WS Client] Listener error:', e); }
    });
  }
}

// Export a single shared instance — all components share one connection.
const wsClient = new WebSocketClient();
export default wsClient;
