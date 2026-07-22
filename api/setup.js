const { getSQL } = require('../shared/db');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  try {
    const sql = getSQL();

    console.log('[SETUP] Initializing database tables...');

    // 1. Create Users Table
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        username VARCHAR(100) UNIQUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // 2. Create Devices Table
    await sql`
      CREATE TABLE IF NOT EXISTS devices (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL,
        device_id VARCHAR(100) NOT NULL,
        device_name VARCHAR(100),
        public_key TEXT NOT NULL,
        last_active TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT uniq_user_device UNIQUE(user_id, device_id)
      )
    `;

    // 3. Create Backups Table
    await sql`
      CREATE TABLE IF NOT EXISTS backups (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL,
        backup_data TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // 4. Create OTPs Table
    await sql`
      CREATE TABLE IF NOT EXISTS otps (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        code VARCHAR(6) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // 5. Create Transient Queue Table
    await sql`
      CREATE TABLE IF NOT EXISTS transient_queue (
        id SERIAL PRIMARY KEY,
        recipient_device_id VARCHAR(100) NOT NULL,
        payload TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    console.log('[SETUP] Database tables initialized successfully.');
    
    return res.status(200).json({
      success: true,
      message: 'Database setup completed successfully. Tables created or verified.'
    });
  } catch (error) {
    console.error('[SETUP ERROR] Setup handler failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Database setup failed',
      details: error.message
    });
  }
};
