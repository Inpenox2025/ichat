import { Platform } from 'react-native';

let socket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let pollingTimer = null;
let httpFallbackActive = false;
let currentServerUrl = null;
let currentToken = null;
const listeners = new Set();

// Max WebSocket attempts before switching to HTTP polling
const MAX_WS_ATTEMPTS = 3;

export function addSocketListener(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notifyListeners(event) {
  listeners.forEach(cb => {
    try { cb(event); } catch (err) { console.error('[WS Listener Error]', err); }
  });
}

// ── HTTP POLLING FALLBACK ──
function startHttpPolling(serverUrl, token) {
  if (pollingTimer) return; // Already polling
  console.log('[WS] WebSocket unavailable. Switching to HTTP polling fallback...');
  httpFallbackActive = true;

  // Notify listeners that we're "connected" via HTTP
  notifyListeners({ type: 'auth-success' });

  pollingTimer = setInterval(async () => {
    try {
      const res = await fetch(`${serverUrl}/api/messages`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.messages && data.messages.length > 0) {
        data.messages.forEach(msg => notifyListeners(msg));
      }
    } catch (e) {
      // Silently continue polling
    }
  }, 2500); // Poll every 2.5 seconds
}

function stopHttpPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
  httpFallbackActive = false;
}

export function connectWebSocket(serverUrl, token) {
  currentServerUrl = serverUrl;
  currentToken = token;

  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }

  // On Vercel deployments (*.vercel.app or *.inspenox.in), WebSockets are not supported by serverless functions.
  // Switch to HTTP polling directly to avoid console WebSocket handshake errors.
  const isVercelHost = serverUrl.includes('inspenox.in') || serverUrl.includes('vercel.app');
  if (isVercelHost || reconnectAttempts >= MAX_WS_ATTEMPTS) {
    startHttpPolling(serverUrl, token);
    return;
  }

  stopHttpPolling();

  const wsUrl = serverUrl.replace(/^http/, 'ws');
  console.log('[WS Mobile] Connecting to ' + wsUrl);

  try {
    socket = new WebSocket(wsUrl);
  } catch (e) {
    console.log('[WS Mobile] WebSocket constructor failed, using HTTP polling.');
    reconnectAttempts = MAX_WS_ATTEMPTS;
    startHttpPolling(serverUrl, token);
    return;
  }

  // Connection timeout — if not opened in 5s, count as failure
  const connectionTimeout = setTimeout(() => {
    if (socket && socket.readyState !== WebSocket.OPEN) {
      console.log('[WS Mobile] Connection timed out.');
      socket.onclose = null;
      socket.close();
      socket = null;
      reconnectAttempts++;
      if (reconnectAttempts >= MAX_WS_ATTEMPTS) {
        startHttpPolling(serverUrl, token);
      } else {
        connectWebSocket(serverUrl, token);
      }
    }
  }, 5000);

  socket.onopen = () => {
    clearTimeout(connectionTimeout);
    console.log('[WS Mobile] Connected. Authenticating...');
    reconnectAttempts = 0;
    stopHttpPolling(); // Stop polling if WS connects
    socket.send(JSON.stringify({ type: 'auth', token }));
    notifyListeners({ type: 'open' });
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      notifyListeners(data);
    } catch (err) {
      console.error('[WS Mobile] Message parse failed:', err);
    }
  };

  socket.onerror = () => {
    clearTimeout(connectionTimeout);
  };

  socket.onclose = () => {
    clearTimeout(connectionTimeout);
    console.log('[WS Mobile] Disconnected.');
    notifyListeners({ type: 'close' });

    reconnectAttempts++;
    if (reconnectAttempts >= MAX_WS_ATTEMPTS) {
      console.log(`[WS Mobile] Failed ${reconnectAttempts} times. Switching to HTTP polling.`);
      startHttpPolling(serverUrl, token);
      return;
    }

    // Exponential backoff retry
    clearTimeout(reconnectTimer);
    const delay = Math.min(10000, Math.pow(2, reconnectAttempts) * 1000);
    reconnectTimer = setTimeout(() => connectWebSocket(serverUrl, token), delay);
  };
}

// ── SEND ──
export function sendSocketMessage(packet) {
  // Try WebSocket first
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(packet));
    return true;
  }

  // HTTP fallback — for messages, use POST /api/messages
  if (httpFallbackActive && currentServerUrl && currentToken) {
    if (packet.type === 'message') {
      const recipient = packet.recipient;
      fetch(`${currentServerUrl}/api/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`
        },
        body: JSON.stringify({ recipient, packet })
      }).then(r => {
        if (r.ok) console.log('[HTTP Fallback] Message queued via HTTP.');
        else console.error('[HTTP Fallback] Failed to queue message.');
      }).catch(e => console.error('[HTTP Fallback] Error:', e));
      return true; // Optimistically return true
    }

    if (packet.type === 'typing') {
      // Best-effort — don't queue typing events
      return true;
    }

    // For acks, try HTTP too
    if (packet.type === 'ack-delivered' || packet.type === 'ack-read') {
      fetch(`${currentServerUrl}/api/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`
        },
        body: JSON.stringify({ recipient: packet.senderOfMessage, packet })
      }).catch(() => {});
      return true;
    }
  }

  return false;
}

export function isHttpFallback() {
  return httpFallbackActive;
}

export function disconnectWebSocket() {
  clearTimeout(reconnectTimer);
  stopHttpPolling();
  if (socket) {
    socket.onclose = null;
    socket.onerror = null;
    socket.close();
    socket = null;
  }
  reconnectAttempts = 0;
}
