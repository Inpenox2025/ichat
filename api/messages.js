const { getSQL } = require('../shared/db');
const { verifyToken } = require('../shared/crypto-helper');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized. Token missing' });
  }
  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Unauthorized. Invalid token' });
  }

  const sql = getSQL();

  try {
    // POST: Send message packet via transient_queue
    if (req.method === 'POST') {
      const { recipient, packet } = req.body;
      if (!recipient || !packet) {
        return res.status(400).json({ error: 'Missing recipient or message packet' });
      }

      const cleanRecipient = recipient.replace(/^@/, '').trim().toLowerCase();

      // Find recipient user
      const users = await sql`SELECT id FROM users WHERE username = ${cleanRecipient}`;
      if (users.length === 0) {
        return res.status(404).json({ error: 'Recipient user not found' });
      }
      const recipientUser = users[0];

      // Find all target devices of recipient
      const recipientDevices = await sql`
        SELECT device_id FROM devices WHERE user_id = ${recipientUser.id}
      `;

      // Also get sender's other devices for cross-device sync
      const senderDevices = await sql`
        SELECT device_id FROM devices WHERE user_id = ${decoded.userId} AND device_id != ${decoded.deviceId}
      `;

      const allTargetDevices = [
        ...recipientDevices.map(d => ({ device_id: d.device_id, isSenderSync: false })),
        ...senderDevices.map(d => ({ device_id: d.device_id, isSenderSync: true }))
      ];

      // Fetch sender's username
      const senderUsers = await sql`SELECT username FROM users WHERE id = ${decoded.userId}`;
      const senderUsername = senderUsers.length > 0 && senderUsers[0].username 
        ? senderUsers[0].username 
        : (packet.sender || decoded.username || '');

      for (const dev of allTargetDevices) {
        const payloadWithSync = {
          ...packet,
          sender: senderUsername,
          isSenderSync: dev.isSenderSync
        };

        await sql`
          INSERT INTO transient_queue (recipient_device_id, payload)
          VALUES (${dev.device_id}, ${JSON.stringify(payloadWithSync)})
        `;
      }

      return res.status(200).json({ success: true, queued: allTargetDevices.length });
    }

    // GET: Poll transient_queue for pending messages destined for this user/device
    if (req.method === 'GET') {
      const currentDeviceId = decoded.deviceId || decoded.device_id || '';
      
      const rows = await sql`
        SELECT id, payload FROM transient_queue 
        WHERE recipient_device_id IN (SELECT device_id FROM devices WHERE user_id = ${decoded.userId})
           OR recipient_device_id = ${currentDeviceId}
      `;

      if (rows.length > 0) {
        const ids = rows.map(r => r.id);
        for (const id of ids) {
          await sql`DELETE FROM transient_queue WHERE id = ${id}`;
        }
      }

      const messages = rows.map(r => typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload);
      return res.status(200).json({ success: true, messages });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[MESSAGES API ERROR]', error);
    return res.status(500).json({ error: 'Messaging handler failed', details: error.message });
  }
};
