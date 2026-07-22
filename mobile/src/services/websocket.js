let socket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
const listeners = new Set();

export function addSocketListener(callback) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function notifyListeners(event) {
  listeners.forEach((callback) => {
    try {
      callback(event);
    } catch (err) {
      console.error('[WS Listener Error]', err);
    }
  });
}

export function connectWebSocket(serverUrl, token) {
  if (socket) {
    socket.close();
  }

  const wsUrl = serverUrl.replace('http', 'ws');
  console.log('[WS Mobile] Connecting to ' + wsUrl);
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log('[WS Mobile] Connection open. Authenticating...');
    reconnectAttempts = 0;
    
    // Auth
    socket.send(JSON.stringify({
      type: 'auth',
      token
    }));

    notifyListeners({ type: 'open' });
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      notifyListeners(data);
    } catch (err) {
      console.error('[WS Mobile] Message parsing failed:', err);
    }
  };

  socket.onclose = () => {
    console.log('[WS Mobile] Disconnected.');
    notifyListeners({ type: 'close' });

    // Auto reconnect
    clearTimeout(reconnectTimer);
    const delay = Math.min(30000, Math.pow(2, reconnectAttempts) * 1000);
    reconnectAttempts++;
    reconnectTimer = setTimeout(() => {
      connectWebSocket(serverUrl, token);
    }, delay);
  };
}

export function sendSocketMessage(packet) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(packet));
    return true;
  }
  return false; // Socket offline
}

export function disconnectWebSocket() {
  clearTimeout(reconnectTimer);
  if (socket) {
    socket.onclose = null; // Prevent reconnect loop
    socket.close();
    socket = null;
  }
}

export function getSocketState() {
  return socket ? socket.readyState : WebSocket.CLOSED;
}
