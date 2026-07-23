const { getSQL } = require('../shared/db');
const { sendMail } = require('../shared/email');
const { generateToken, verifyToken, generateOTP } = require('../shared/crypto-helper');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action || req.body.action;

  try {
    const sql = getSQL();

    // ----------------------------------------------------
    // ACTION: REQUEST-OTP
    // ----------------------------------------------------
    if (action === 'request-otp') {
      const { email } = req.body;
      if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Valid email is required' });
      }

      const otp = generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 mins expiry

      await sql`
        INSERT INTO otps (email, code, expires_at)
        VALUES (${email.trim().toLowerCase()}, ${otp}, ${expiresAt})
      `;

      // Send email
      await sendMail({
        to: email.trim().toLowerCase(),
        subject: 'Your ichat Verification Code',
        text: `Your ichat verification code is: ${otp}. It will expire in 10 minutes.`,
        html: `<h3>Welcome to ichat</h3><p>Your secure verification code is: <strong>${otp}</strong></p><p>This code will expire in 10 minutes.</p>`
      });

      return res.status(200).json({ success: true, message: 'OTP sent successfully' });
    }

    // ----------------------------------------------------
    // ACTION: VERIFY-OTP
    // ----------------------------------------------------
    if (action === 'verify-otp') {
      const { email, code, device_id, device_name, public_key, replace_device_id } = req.body;

      if (!email || !code || !device_id || !public_key) {
        return res.status(400).json({ error: 'Email, code, device_id, and public_key are required' });
      }

      const cleanedEmail = email.trim().toLowerCase();

      // Check OTP in DB
      const nowStr = new Date().toISOString();
      const otpRecords = await sql`
        SELECT * FROM otps 
        WHERE email = ${cleanedEmail} AND code = ${code} AND expires_at > ${nowStr}
      `;

      if (otpRecords.length === 0) {
        return res.status(400).json({ error: 'Invalid or expired verification code' });
      }

      // Upsert User
      let userRecords = await sql`SELECT * FROM users WHERE email = ${cleanedEmail}`;
      let user;
      if (userRecords.length === 0) {
        // Create user
        const newUsers = await sql`
          INSERT INTO users (email, created_at, updated_at)
          VALUES (${cleanedEmail}, NOW(), NOW())
          RETURNING *
        `;
        user = newUsers[0];
      } else {
        user = userRecords[0];
      }

      // Manage Devices for E2EE (Limit to 3)
      const activeDevices = await sql`SELECT * FROM devices WHERE user_id = ${user.id}`;
      const deviceExists = activeDevices.some(d => d.device_id === device_id);

      if (!deviceExists && activeDevices.length >= 3) {
        // Check if user requested to replace a specific device
        if (replace_device_id) {
          await sql`
            DELETE FROM devices 
            WHERE user_id = ${user.id} AND device_id = ${replace_device_id}
          `;
        } else {
          // Return limit error and device list so user can choose to de-register one
          return res.status(409).json({
            error: 'MAX_DEVICES_EXCEEDED',
            message: 'You have reached the maximum limit of 3 devices. Please de-register one to continue.',
            devices: activeDevices.map(d => ({ device_id: d.device_id, device_name: d.device_name, last_active: d.last_active }))
          });
        }
      }

      // Save/Update device public key
      const deviceRecord = await sql`
        INSERT INTO devices (user_id, device_id, device_name, public_key, last_active)
        VALUES (${user.id}, ${device_id}, ${device_name || 'Unknown Device'}, ${public_key}, NOW())
        ON CONFLICT (user_id, device_id) DO UPDATE 
        SET public_key = ${public_key}, device_name = ${device_name || 'Unknown Device'}, last_active = NOW()
        RETURNING *
      `;

      // Generate JWT Token
      const token = generateToken({
        userId: user.id,
        email: user.email,
        deviceId: device_id
      });

      return res.status(200).json({
        success: true,
        token,
        username_required: !user.username,
        user: {
          id: user.id,
          email: user.email,
          username: user.username
        },
        device: deviceRecord[0]
      });
    }

    // ----------------------------------------------------
    // AUTHENTICATED ENDPOINTS REQUIRE TOKEN
    // ----------------------------------------------------
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized. Token missing' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ error: 'Unauthorized. Invalid token' });
    }

    // ----------------------------------------------------
    // ACTION: REGISTER-USERNAME
    // ----------------------------------------------------
    if (action === 'register-username') {
      const { username } = req.body;
      const cleanUsername = username ? username.trim().toLowerCase() : '';

      // Validate username regex (alphanumeric and underscores, 3-20 chars)
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(cleanUsername)) {
        return res.status(400).json({ error: 'Username must be 3-20 alphanumeric characters or underscores' });
      }

      // Check uniqueness
      const existingUser = await sql`SELECT * FROM users WHERE username = ${cleanUsername}`;
      if (existingUser.length > 0 && existingUser[0].id !== decoded.userId) {
        return res.status(409).json({ error: 'Username is already taken' });
      }

      // Update User
      const updatedUsers = await sql`
        UPDATE users 
        SET username = ${cleanUsername}, updated_at = NOW() 
        WHERE id = ${decoded.userId}
        RETURNING *
      `;

      if (updatedUsers.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.status(200).json({
        success: true,
        user: {
          id: updatedUsers[0].id,
          email: updatedUsers[0].email,
          username: updatedUsers[0].username
        }
      });
    }

    // ----------------------------------------------------
    // ACTION: ME
    // ----------------------------------------------------
    if (action === 'me') {
      const userRecords = await sql`SELECT * FROM users WHERE id = ${decoded.userId}`;
      if (userRecords.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const activeDevices = await sql`SELECT * FROM devices WHERE user_id = ${decoded.userId}`;

      // Update current device's active status and public_key if provided
      const clientPublicKey = req.body?.public_key || req.query?.public_key;
      if (clientPublicKey) {
        await sql`
          UPDATE devices 
          SET last_active = NOW(), public_key = ${clientPublicKey} 
          WHERE user_id = ${decoded.userId} AND device_id = ${decoded.deviceId}
        `;
      } else {
        await sql`
          UPDATE devices 
          SET last_active = NOW() 
          WHERE user_id = ${decoded.userId} AND device_id = ${decoded.deviceId}
        `;
      }

      return res.status(200).json({
        success: true,
        user: {
          id: userRecords[0].id,
          email: userRecords[0].email,
          username: userRecords[0].username
        },
        devices: activeDevices.map(d => ({
          device_id: d.device_id,
          device_name: d.device_name,
          last_active: d.last_active,
          is_current: d.device_id === decoded.deviceId
        }))
      });
    }

    // ----------------------------------------------------
    // ACTION: DELETE-ACCOUNT
    // ----------------------------------------------------
    if (action === 'delete-account') {
      // De-register entire user and trigger cascade deletes in database
      await sql`DELETE FROM users WHERE id = ${decoded.userId}`;
      return res.status(200).json({ success: true, message: 'Account deleted successfully' });
    }

    // Default: Action not found
    return res.status(404).json({ error: 'Auth action not found' });
  } catch (error) {
    console.error('[AUTH ERROR] Handler failed:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};
