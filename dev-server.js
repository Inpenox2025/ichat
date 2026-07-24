const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

// 1. Custom lightweight .env loader (matching inducare dev-server.js)
function loadEnv() {
  const envPath = path.join(__dirname, '.env.local');
  const fallbackPath = path.join(__dirname, '.env');
  let envFile = null;

  if (fs.existsSync(envPath)) {
    envFile = envPath;
  } else if (fs.existsSync(fallbackPath)) {
    envFile = fallbackPath;
  }

  if (envFile) {
    console.log(`[INFO] Loading environment variables from ${path.basename(envFile)}`);
    const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (line.trim().startsWith('#') || !line.trim()) continue;
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.substring(1, value.length - 1);
        } else if (value.startsWith("'") && value.endsWith("'")) {
          value = value.substring(1, value.length - 1);
        }
        process.env[key] = value.trim();
      }
    }
  } else {
    console.log('[WARNING] No .env.local or .env file found. Ensure environment variables are set.');
  }
}

loadEnv();

const app = express();
app.use(express.json());

// Enable CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// Serve static uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Helper wrapper to translate Express req/res into Vercel-style handlers
function runHandler(handlerPath) {
  return async (req, res) => {
    try {
      const handler = require(handlerPath);
      await handler(req, res);
    } catch (err) {
      console.error(`[ERROR] In handler ${handlerPath}:`, err);
      res.status(500).json({ error: 'Server handler execution failed', details: err.message });
    }
  };
}

// Map REST API Endpoints
app.all('/api/setup', runHandler('./api/setup'));

// Auth Actions
app.all('/api/auth/request-otp', (req, res, next) => {
  req.query.action = 'request-otp';
  next();
}, runHandler('./api/auth'));

app.all('/api/auth/verify-otp', (req, res, next) => {
  req.query.action = 'verify-otp';
  next();
}, runHandler('./api/auth'));

app.all('/api/auth/register-username', (req, res, next) => {
  req.query.action = 'register-username';
  next();
}, runHandler('./api/auth'));

app.all('/api/auth/me', (req, res, next) => {
  req.query.action = 'me';
  next();
}, runHandler('./api/auth'));

app.all('/api/auth/logout-all-devices', (req, res, next) => {
  req.query.action = 'logout-all-devices';
  next();
}, runHandler('./api/auth'));

app.all('/api/auth/delete-account', (req, res, next) => {
  req.query.action = 'delete-account';
  next();
}, runHandler('./api/auth'));

// Users Lookup Actions
app.all('/api/users/search', (req, res, next) => {
  req.query.action = 'search';
  next();
}, runHandler('./api/users'));

app.all('/api/users/keys', (req, res, next) => {
  req.query.action = 'keys';
  next();
}, runHandler('./api/users'));

// Backups Actions
app.all('/api/backup/upload', runHandler('./api/backup'));
app.all('/api/backup/download', runHandler('./api/backup'));

// Media Upload Action
app.all('/api/upload', runHandler('./api/upload'));

// Transient Messaging Action
app.all('/api/messages', runHandler('./api/messages'));

// Serve Web Frontend Static Files
app.use(express.static(__dirname));

// Create HTTP Server
const server = http.createServer(app);

// Initialize WebSocket Server
const wss = new WebSocket.Server({ noServer: true });

// Map to track active connections: deviceId -> WebSocket Client Instance
const clients = new Map();
// Map to track active usernames to a set of their deviceIds: username -> Set(deviceId)
const userDevices = new Map();

const { verifyToken } = require('./shared/crypto-helper');
const { getSQL } = require('./shared/db');

wss.on('connection', (ws) => {
  let authenticated = false;
  let clientUser = null; // { userId, email, username, deviceId }

  // Heartbeat setup
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async (messageStr) => {
    try {
      const data = JSON.parse(messageStr);

      // Handle Authentication Message
      if (data.type === 'auth') {
        const decoded = verifyToken(data.token);
        if (!decoded) {
          ws.send(JSON.stringify({ type: 'error', error: 'Authentication failed' }));
          return ws.close();
        }

        // Retrieve latest user details (username)
        const sql = getSQL();
        const users = await sql`SELECT * FROM users WHERE id = ${decoded.userId}`;
        if (users.length === 0 || !users[0].username) {
          ws.send(JSON.stringify({ type: 'error', error: 'User profile incomplete' }));
          return ws.close();
        }

        clientUser = {
          userId: users[0].id,
          email: users[0].email,
          username: users[0].username,
          deviceId: decoded.deviceId
        };

        authenticated = true;

        // Register client
        clients.set(clientUser.deviceId, ws);
        if (!userDevices.has(clientUser.username)) {
          userDevices.set(clientUser.username, new Set());
        }
        userDevices.get(clientUser.username).add(clientUser.deviceId);

        console.log(`[WS] Authenticated device ${clientUser.deviceId} for user @${clientUser.username}`);

        // Acknowledge connection
        ws.send(JSON.stringify({ type: 'auth-success', username: clientUser.username }));

        // Check and deliver any transient queue (offline buffered messages)
        const pending = await sql`
          SELECT * FROM transient_queue 
          WHERE recipient_device_id = ${clientUser.deviceId}
          ORDER BY id ASC
        `;

        if (pending.length > 0) {
          console.log(`[WS] Delivering ${pending.length} offline messages to device ${clientUser.deviceId}`);
          for (const item of pending) {
            ws.send(item.payload);
          }
          // Delete from queue immediately (Zero retention)
          await sql`
            DELETE FROM transient_queue 
            WHERE recipient_device_id = ${clientUser.deviceId}
          `;
        }
        return;
      }

      // Safeguard: Drop unauthenticated messages
      if (!authenticated || !clientUser) {
        return ws.close();
      }

      // Handle Messaging Payload (E2EE Message dispatch)
      if (data.type === 'message') {
        const { recipient, keys, payload, messageId, timestamp, media } = data;
        const sql = getSQL();

        // 1. Resolve all target devices for recipient
        const targetDevices = await sql`
          SELECT d.device_id 
          FROM devices d 
          JOIN users u ON d.user_id = u.id 
          WHERE u.username = ${recipient.trim().toLowerCase()}
        `;

        // 2. Resolve sender's other devices (excluding current sender)
        const senderOtherDevices = await sql`
          SELECT device_id FROM devices 
          WHERE user_id = ${clientUser.userId} AND device_id != ${clientUser.deviceId}
        `;

        // Acknowledge receipt to the sender (Sent status ✓)
        ws.send(JSON.stringify({
          type: 'ack',
          messageId,
          recipient,
          status: 'sent',
          timestamp: new Date().toISOString()
        }));

        // Dispatch helper to send packet or queue it
        const dispatchToDevice = async (targetDeviceId, isSenderSync = false) => {
          const encryptedKey = keys[targetDeviceId];
          if (!encryptedKey) return; // No encrypted key for this device

          const outgoingPayload = JSON.stringify({
            type: 'message',
            messageId,
            sender: clientUser.username,
            recipient,
            key: encryptedKey,
            payload,
            timestamp,
            media,
            isSenderSync
          });

          const targetSocket = clients.get(targetDeviceId);
          if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
            // Target is online: deliver instantly
            targetSocket.send(outgoingPayload);
            
            // Send delivered receipt back to sender (not applicable for sender self-syncs)
            if (!isSenderSync) {
              const deliverAck = JSON.stringify({
                type: 'ack',
                messageId,
                recipient,
                status: 'delivered',
                device_id: targetDeviceId,
                timestamp: new Date().toISOString()
              });
              // Forward delivery check back to all sender's devices
              const cleanSenderName = (clientUser.username || '').replace(/^@/, '').trim().toLowerCase();
              let senderSet = userDevices.get(cleanSenderName);
              if (!senderSet) {
                for (const [uname, devSet] of userDevices.entries()) {
                  if (uname.toLowerCase() === cleanSenderName) {
                    senderSet = devSet;
                    break;
                  }
                }
              }
              if (senderSet) {
                for (const dId of senderSet) {
                  const sWs = clients.get(dId);
                  if (sWs && sWs.readyState === WebSocket.OPEN) {
                    sWs.send(deliverAck);
                  }
                }
              }
            }
          } else {
            // Target is offline: buffer in transient queue database table
            await sql`
              INSERT INTO transient_queue (recipient_device_id, payload)
              VALUES (${targetDeviceId}, ${outgoingPayload})
            `;
          }
        };

        // Dispatch to recipient devices
        for (const device of targetDevices) {
          await dispatchToDevice(device.device_id, false);
        }

        // Dispatch to sender's other devices for synchronization
        for (const device of senderOtherDevices) {
          await dispatchToDevice(device.device_id, true);
        }
        return;
      }

      // Handle Typing Status Events
      if (data.type === 'typing') {
        const { recipient, status } = data;
        const devices = userDevices.get(recipient);
        if (devices) {
          const typingPayload = JSON.stringify({
            type: 'typing',
            sender: clientUser.username,
            status
          });
          for (const dId of devices) {
            const clientWs = clients.get(dId);
            if (clientWs && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(typingPayload);
            }
          }
        }
        return;
      }

      // Handle Message Acknowledgements (Delivered and Read checks)
      if (data.type === 'ack-delivered' || data.type === 'ack-read') {
        const { messageId, senderOfMessage } = data;
        const status = data.type === 'ack-delivered' ? 'delivered' : 'read';

        const cleanSenderName = (senderOfMessage || '').replace(/^@/, '').trim().toLowerCase();

        // Forward this receipt to all devices of the original sender
        let devices = userDevices.get(cleanSenderName);
        if (!devices) {
          for (const [uname, devSet] of userDevices.entries()) {
            if (uname.toLowerCase() === cleanSenderName) {
              devices = devSet;
              break;
            }
          }
        }

        if (devices) {
          const ackPayload = JSON.stringify({
            type: 'ack',
            messageId,
            recipient: clientUser.username,
            status,
            timestamp: new Date().toISOString()
          });
          for (const dId of devices) {
            const clientWs = clients.get(dId);
            if (clientWs && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(ackPayload);
            }
          }
        }
        return;
      }

      // Handle WebRTC Call Signaling (Offers, Answers, Candidates, Busy, Hangup)
      if (['call-offer', 'call-answer', 'ice-candidate', 'call-hangup', 'call-busy'].includes(data.type)) {
        const { recipient } = data;
        const devices = userDevices.get(recipient);
        if (devices) {
          // Add sender identification
          data.sender = clientUser.username;
          const signalingPayload = JSON.stringify(data);
          
          for (const dId of devices) {
            const clientWs = clients.get(dId);
            if (clientWs && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(signalingPayload);
            }
          }
        }
        return;
      }

    } catch (err) {
      console.error('[WS ERROR] Failed to process message:', err);
    }
  });

  ws.on('close', () => {
    if (clientUser) {
      // Clear socket maps
      clients.delete(clientUser.deviceId);
      const devicesSet = userDevices.get(clientUser.username);
      if (devicesSet) {
        devicesSet.delete(clientUser.deviceId);
        if (devicesSet.size === 0) {
          userDevices.delete(clientUser.username);
        }
      }
      console.log(`[WS] Connection closed for device ${clientUser.deviceId} (@${clientUser.username})`);
    }
  });
});

// WebSocket upgrade hook
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Periodic ping-pong monitoring (low network optimization)
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`[READY] E2EE Chat Web Portal running at http://localhost:${PORT}`);
  console.log(`[INFO] Run DB setup by visiting http://localhost:${PORT}/api/setup`);
  console.log(`==================================================\n`);
});
