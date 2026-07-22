const fs = require('fs');
const path = require('path');

let neonClient = null;

// Pure JS Local File Database Fallback
const DATA_DIR = path.join(__dirname, '..', '.data');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readTable(tableName) {
  ensureDataDir();
  const filePath = path.join(DATA_DIR, `${tableName}.json`);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return [];
  }
}

function writeTable(tableName, data) {
  ensureDataDir();
  const filePath = path.join(DATA_DIR, `${tableName}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// Simple SQL tag-template emulator for offline local storage
const localSQL = async (strings, ...values) => {
  // Reconstruct full query with markers to analyze
  const query = strings.reduce((acc, str, i) => acc + str + (values[i] !== undefined ? `$${i + 1}` : ''), '').trim();
  const queryLower = query.toLowerCase();

  // 1. Table Creation Emulation
  if (queryLower.includes('create table')) {
    // Just mock success for create table
    return [];
  }

  // 2. ALTER TABLE Emulation
  if (queryLower.includes('alter table')) {
    // Just mock success for migrations
    return [];
  }

  // 3. User operations
  if (queryLower.includes('select * from users where email =')) {
    const email = values[0];
    const users = readTable('users');
    return users.filter(u => u.email === email);
  }

  if (queryLower.includes('select * from users where username =')) {
    const username = values[0];
    const users = readTable('users');
    return users.filter(u => u.username === username);
  }

  if (queryLower.includes('insert into users')) {
    // INSERT INTO users (email, created_at, updated_at) VALUES ($1, NOW(), NOW()) RETURNING *
    const email = values[0];
    const users = readTable('users');
    
    // Check if user already exists
    const existing = users.find(u => u.email === email);
    if (existing) return [existing];

    const newUser = {
      id: users.length + 1,
      email,
      username: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    users.push(newUser);
    writeTable('users', users);
    return [newUser];
  }

  if (queryLower.includes('update users set username =')) {
    // UPDATE users SET username = $1, updated_at = NOW() WHERE id = $2 RETURNING *
    const username = values[0];
    const id = values[1];
    const users = readTable('users');
    const userIndex = users.findIndex(u => u.id === Number(id));
    if (userIndex !== -1) {
      users[userIndex].username = username;
      users[userIndex].updated_at = new Date().toISOString();
      writeTable('users', users);
      return [users[userIndex]];
    }
    return [];
  }

  if (queryLower.includes('delete from users where id =')) {
    const id = values[0];
    let users = readTable('users');
    users = users.filter(u => u.id !== Number(id));
    writeTable('users', users);
    
    // Cascading delete devices, backups, transient queue
    let devices = readTable('devices');
    devices = devices.filter(d => d.user_id !== Number(id));
    writeTable('devices', devices);

    let backups = readTable('backups');
    backups = backups.filter(b => b.user_id !== Number(id));
    writeTable('backups', backups);

    return [];
  }

  // 4. Devices operations
  if (queryLower.includes('select d.*, u.username from devices d')) {
    // Get all device keys for a user's contact by username or email
    // SELECT d.*, u.username FROM devices d JOIN users u ON d.user_id = u.id WHERE u.username = $1 OR u.email = $1
    const identifier = values[0];
    const users = readTable('users');
    const user = users.find(u => u.username === identifier || u.email === identifier);
    if (!user) return [];

    const devices = readTable('devices');
    return devices
      .filter(d => d.user_id === user.id)
      .map(d => ({ ...d, username: user.username }));
  }

  if (queryLower.includes('select * from devices where user_id =') && queryLower.includes('device_id =')) {
    const userId = values[0];
    const deviceId = values[1];
    const devices = readTable('devices');
    return devices.filter(d => d.user_id === Number(userId) && d.device_id === deviceId);
  }

  if (queryLower.includes('select * from devices where user_id =')) {
    const userId = values[0];
    const devices = readTable('devices');
    return devices.filter(d => d.user_id === Number(userId));
  }

  if (queryLower.includes('insert into devices')) {
    // INSERT INTO devices (user_id, device_id, device_name, public_key, last_active) VALUES ($1, $2, $3, $4, NOW()) RETURNING *
    const userId = values[0];
    const deviceId = values[1];
    const deviceName = values[2];
    const publicKey = values[3];

    const devices = readTable('devices');
    const existingIndex = devices.findIndex(d => d.user_id === Number(userId) && d.device_id === deviceId);

    const deviceObj = {
      id: existingIndex !== -1 ? devices[existingIndex].id : devices.length + 1,
      user_id: Number(userId),
      device_id: deviceId,
      device_name: deviceName,
      public_key: publicKey,
      last_active: new Date().toISOString(),
      created_at: existingIndex !== -1 ? devices[existingIndex].created_at : new Date().toISOString()
    };

    if (existingIndex !== -1) {
      devices[existingIndex] = deviceObj;
    } else {
      devices.push(deviceObj);
    }
    writeTable('devices', devices);
    return [deviceObj];
  }

  if (queryLower.includes('update devices set last_active =')) {
    const deviceId = values[1]; // or user_id + device_id
    const devices = readTable('devices');
    const idx = devices.findIndex(d => d.device_id === deviceId);
    if (idx !== -1) {
      devices[idx].last_active = new Date().toISOString();
      writeTable('devices', devices);
      return [devices[idx]];
    }
    return [];
  }

  if (queryLower.includes('delete from devices where user_id =') && queryLower.includes('device_id =')) {
    const userId = values[0];
    const deviceId = values[1];
    let devices = readTable('devices');
    devices = devices.filter(d => !(d.user_id === Number(userId) && d.device_id === deviceId));
    writeTable('devices', devices);
    return [];
  }

  // 5. Backups operations
  if (queryLower.includes('insert into backups')) {
    // INSERT INTO backups (user_id, backup_data, created_at) VALUES ($1, $2, NOW()) RETURNING *
    const userId = values[0];
    const backupData = values[1];
    const backups = readTable('backups');
    const newBackup = {
      id: backups.length + 1,
      user_id: Number(userId),
      backup_data: backupData,
      created_at: new Date().toISOString()
    };
    backups.push(newBackup);
    writeTable('backups', backups);
    return [newBackup];
  }

  if (queryLower.includes('select * from backups where user_id =')) {
    // SELECT * FROM backups WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1
    const userId = values[0];
    const backups = readTable('backups');
    const userBackups = backups.filter(b => b.user_id === Number(userId));
    if (userBackups.length === 0) return [];
    userBackups.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return [userBackups[0]];
  }

  // 6. OTP operations
  if (queryLower.includes('insert into otps')) {
    // INSERT INTO otps (email, code, expires_at) VALUES ($1, $2, $3)
    const email = values[0];
    const code = values[1];
    const expiresAt = values[2];
    const otps = readTable('otps');
    const newOtp = {
      id: otps.length + 1,
      email,
      code,
      expires_at: expiresAt,
      created_at: new Date().toISOString()
    };
    otps.push(newOtp);
    writeTable('otps', otps);
    return [newOtp];
  }

  if (queryLower.includes('select * from otps where email =') && queryLower.includes('code =')) {
    // SELECT * FROM otps WHERE email = $1 AND code = $2 AND expires_at > $3
    const email = values[0];
    const code = values[1];
    const nowStr = values[2];
    const otps = readTable('otps');
    return otps.filter(o => o.email === email && o.code === code && new Date(o.expires_at) > new Date(nowStr));
  }

  // 7. Transient queue operations
  if (queryLower.includes('insert into transient_queue')) {
    // INSERT INTO transient_queue (recipient_device_id, payload) VALUES ($1, $2)
    const recipientDeviceId = values[0];
    const payload = values[1];
    const queue = readTable('transient_queue');
    const newMsg = {
      id: queue.length + 1,
      recipient_device_id: recipientDeviceId,
      payload,
      created_at: new Date().toISOString()
    };
    queue.push(newMsg);
    writeTable('transient_queue', queue);
    return [newMsg];
  }

  if (queryLower.includes('from transient_queue')) {
    const userId = values[0];
    const deviceId = values[1] || values[0];
    const devices = readTable('devices');
    const userDeviceIds = devices.filter(d => d.user_id === Number(userId)).map(d => d.device_id);
    if (deviceId && typeof deviceId === 'string' && !userDeviceIds.includes(deviceId)) {
      userDeviceIds.push(deviceId);
    }

    const queue = readTable('transient_queue');
    return queue.filter(q => userDeviceIds.includes(q.recipient_device_id));
  }

  if (queryLower.includes('delete from transient_queue where recipient_device_id =')) {
    const recipientDeviceId = values[0];
    let queue = readTable('transient_queue');
    queue = queue.filter(q => q.recipient_device_id !== recipientDeviceId);
    writeTable('transient_queue', queue);
    return [];
  }

  if (queryLower.includes('delete from transient_queue where id =')) {
    const id = values[0];
    let queue = readTable('transient_queue');
    queue = queue.filter(q => q.id !== Number(id));
    writeTable('transient_queue', queue);
    return [];
  }

  // 8. Search Users
  if (queryLower.includes('select id, username, email from users where username ilike') || queryLower.includes('select id, username, email from users where username like')) {
    const searchVal = values[0].replace(/%/g, '').toLowerCase();
    const users = readTable('users');
    return users
      .filter(u => u.username && (u.username.toLowerCase().includes(searchVal) || u.email.toLowerCase().includes(searchVal)))
      .map(u => ({ id: u.id, username: u.username, email: u.email }));
  }

  return [];
};

function getSQL() {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== '') {
    if (!neonClient) {
      console.log('[DB] Connecting to Neon serverless database');
      const { neon } = require('@neondatabase/serverless');
      neonClient = neon(process.env.DATABASE_URL);
    }
    return neonClient;
  } else {
    return localSQL;
  }
}

module.exports = { getSQL };
