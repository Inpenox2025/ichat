const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { verifyToken } = require('../shared/crypto-helper');

// Memory storage to support Vercel serverless read-only filesystem environments
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit
}).single('file');

module.exports = function handler(req, res) {
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

  // Parse upload
  upload(req, res, (err) => {
    if (err) {
      console.error('[UPLOAD ERROR] Multer upload failed:', err);
      return res.status(400).json({ error: 'File upload failed', details: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Convert file buffer to base64 data URL payload
    const mimeType = req.file.mimetype || 'application/octet-stream';
    const base64Data = req.file.buffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64Data}`;

    return res.status(200).json({
      success: true,
      url: dataUrl,
      filename: req.file.originalname,
      size: req.file.size
    });
  });
};
