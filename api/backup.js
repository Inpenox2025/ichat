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
    // UPLOAD BACKUP
    // ----------------------------------------------------
    if (req.method === 'POST') {
      const { backup_data } = req.body;
      if (!backup_data) {
        return res.status(400).json({ error: 'backup_data field is required' });
      }

      // Store backup in database (overwrites or appends, here we append and retrieve the latest one)
      const inserted = await sql`
        INSERT INTO backups (user_id, backup_data, created_at)
        VALUES (${decoded.userId}, ${backup_data}, NOW())
        RETURNING id, created_at
      `;

      return res.status(200).json({
        success: true,
        message: 'Backup uploaded and secured successfully.',
        backup: inserted[0]
      });
    }

    // ----------------------------------------------------
    // DOWNLOAD BACKUP
    // ----------------------------------------------------
    if (req.method === 'GET') {
      const latestBackup = await sql`
        SELECT backup_data, created_at 
        FROM backups 
        WHERE user_id = ${decoded.userId} 
        ORDER BY created_at DESC 
        LIMIT 1
      `;

      if (latestBackup.length === 0) {
        return res.status(404).json({ error: 'No backups found for this account' });
      }

      return res.status(200).json({
        success: true,
        backup_data: latestBackup[0].backup_data,
        created_at: latestBackup[0].created_at
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[BACKUP API ERROR] Handler failed:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};
