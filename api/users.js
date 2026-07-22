const { getSQL } = require('../shared/db');
const { verifyToken } = require('../shared/crypto-helper');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Validate Token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized. Token missing' });
  }
  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Unauthorized. Invalid token' });
  }

  try {
    const sql = getSQL();

    // ----------------------------------------------------
    // ACTION: SEARCH
    // ----------------------------------------------------
    if (req.query.action === 'search') {
      const query = req.query.q;
      if (!query || query.trim().length < 2) {
        return res.status(400).json({ error: 'Search query must be at least 2 characters' });
      }

      const cleanQuery = `%${query.trim()}%`;
      const matches = await sql`
        SELECT id, username, email 
        FROM users 
        WHERE (username ILIKE ${cleanQuery} OR email ILIKE ${cleanQuery}) 
          AND id != ${decoded.userId}
          AND username IS NOT NULL
        LIMIT 20
      `;

      return res.status(200).json({ success: true, users: matches });
    }

    // ----------------------------------------------------
    // ACTION: GET PUBLIC KEYS OF USER DEVICES
    // ----------------------------------------------------
    if (req.query.action === 'keys') {
      const { username } = req.query;
      if (!username) {
        return res.status(400).json({ error: 'Username query parameter is required' });
      }

      // Query Bob's devices + Alice's OTHER devices (to ensure Alice can sync messages sent to Bob)
      // First, get Bob's devices
      const bobDevices = await sql`
        SELECT d.device_id, d.device_name, d.public_key, u.username
        FROM devices d 
        JOIN users u ON d.user_id = u.id 
        WHERE u.username = ${username.trim().toLowerCase()} OR u.email = ${username.trim().toLowerCase()}
      `;

      // Next, get Alice's other devices
      const aliceDevices = await sql`
        SELECT d.device_id, d.device_name, d.public_key, u.username
        FROM devices d
        JOIN users u ON d.user_id = u.id
        WHERE u.id = ${decoded.userId} AND d.device_id != ${decoded.deviceId}
      `;

      return res.status(200).json({
        success: true,
        recipient_devices: bobDevices,
        sender_other_devices: aliceDevices
      });
    }

    return res.status(404).json({ error: 'Action not found' });
  } catch (error) {
    console.error('[USERS API ERROR] Handler failed:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};
