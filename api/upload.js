const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { verifyToken } = require('../shared/crypto-helper');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// Ensure uploads folder exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    // Save with a random hex string to obscure names
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, 'file-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
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

    // Generate public file url
    const fileUrl = `/uploads/${req.file.filename}`;
    
    return res.status(200).json({
      success: true,
      url: fileUrl,
      filename: req.file.filename,
      size: req.file.size
    });
  });
};
