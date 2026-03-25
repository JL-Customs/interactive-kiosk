require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Only accept image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB max
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('uploads'));

// File-based photo storage
const photosDataFile = path.join(__dirname, 'photos-data.json');
const settingsDataFile = path.join(__dirname, 'settings-data.json');
let photos = [];
let settings = {
  rotationInterval: 5
};

function getBaseUrl(req) {
  const configuredBaseUrl = process.env.PUBLIC_BASE_URL;
  if (configuredBaseUrl) {
    return String(configuredBaseUrl).trim().replace(/\/+$/, '');
  }
  return `${req.protocol}://${req.get('host')}`;
}

function resolvePhotoUrl(photo, req) {
  const baseUrl = getBaseUrl(req);

  if (photo.filename) {
    return `${baseUrl}/${photo.filename}`;
  }

  if (photo.url) {
    try {
      const parsedUrl = new URL(photo.url);
      const filename = path.basename(parsedUrl.pathname);
      return `${baseUrl}/${filename}`;
    } catch {
      if (String(photo.url).startsWith('/')) {
        return `${baseUrl}${photo.url}`;
      }
      return photo.url;
    }
  }

  return photo.url;
}

// Load photos from disk
function loadPhotos() {
  if (fs.existsSync(photosDataFile)) {
    try {
      const data = fs.readFileSync(photosDataFile, 'utf8');
      photos = JSON.parse(data);
      console.log(`Loaded ${photos.length} photos from storage`);
    } catch (error) {
      console.error('Error loading photos:', error);
      photos = [];
    }
  }
}

// Save photos to disk
function savePhotos() {
  try {
    fs.writeFileSync(photosDataFile, JSON.stringify(photos, null, 2));
  } catch (error) {
    console.error('Error saving photos:', error);
  }
}

function loadSettings() {
  if (fs.existsSync(settingsDataFile)) {
    try {
      const data = fs.readFileSync(settingsDataFile, 'utf8');
      const parsed = JSON.parse(data);
      settings = {
        ...settings,
        ...parsed
      };
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsDataFile, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('Error saving settings:', error);
  }
}

// Initialize photos
loadPhotos();
loadSettings();

// Routes

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Get all photos
 */
app.get('/api/photos', (req, res) => {
  try {
    const photosWithResolvedUrls = photos.map((photo) => ({
      ...photo,
      url: resolvePhotoUrl(photo, req)
    }));
    res.json(photosWithResolvedUrls);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve photos' });
  }
});

/**
 * Get shared app settings
 */
app.get('/api/settings', (req, res) => {
  res.json(settings);
});

/**
 * Update shared app settings
 */
app.patch('/api/settings', express.json(), (req, res) => {
  const { rotationInterval } = req.body;

  if (rotationInterval !== undefined) {
    const parsed = Number(rotationInterval);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return res.status(400).json({ error: 'rotationInterval must be a number >= 1' });
    }
    settings.rotationInterval = parsed;
  }

  saveSettings();
  res.json({ success: true, settings });
});

/**
 * Get a single photo by ID
 */
app.get('/api/photos/:id', (req, res) => {
  const photo = photos.find(p => p.id === req.params.id);
  if (photo) {
    res.json({
      ...photo,
      url: resolvePhotoUrl(photo, req)
    });
  } else {
    res.status(404).json({ error: 'Photo not found' });
  }
});

/**
 * Upload a photo
 */
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const photo = {
    id: Date.now().toString(),
    name: req.file.originalname,
    filename: req.file.filename,
    url: `${getBaseUrl(req)}/${req.file.filename}`,
    size: req.file.size,
    uploadedAt: new Date().toISOString(),
    active: true,
    order: photos.length
  };

  photos.push(photo);
  savePhotos();
  res.json({ success: true, photo });
});

/**
 * Delete a photo by ID
 */
app.delete('/api/photos/:id', (req, res) => {
  const index = photos.findIndex(p => p.id === req.params.id);
  if (index !== -1) {
    const photo = photos[index];
    // Delete the file from disk
    const filePath = path.join(uploadsDir, photo.filename);
    fs.unlink(filePath, (err) => {
      if (err) console.error('Error deleting file:', err);
    });
    photos.splice(index, 1);
    savePhotos();
    res.json({ success: true, message: 'Photo deleted' });
  } else {
    res.status(404).json({ error: 'Photo not found' });
  }
});

/**
 * Reorder photos
 */
app.post('/api/photos/reorder', express.json(), (req, res) => {
  const { order } = req.body; // array of photo IDs in desired order
  if (!Array.isArray(order)) {
    return res.status(400).json({ error: 'Order must be an array' });
  }

  const reorderedPhotos = [];
  for (const id of order) {
    const photo = photos.find(p => p.id === id);
    if (photo) {
      reorderedPhotos.push(photo);
    }
  }

  if (reorderedPhotos.length === order.length) {
    photos = reorderedPhotos;
    // Update order property for each photo
    photos.forEach((photo, index) => {
      photo.order = index;
    });
    savePhotos();
    res.json({ success: true, photos });
  } else {
    res.status(400).json({ error: 'Some photo IDs were not found' });
  }
});

/**
 * Update photo active status
 */
app.patch('/api/photos/:id', express.json(), (req, res) => {
  const { active } = req.body;
  const photo = photos.find(p => p.id === req.params.id);
  
  if (!photo) {
    return res.status(404).json({ error: 'Photo not found' });
  }
  
  if (active !== undefined) {
    photo.active = Boolean(active);
    savePhotos();
    res.json({ success: true, photo });
  } else {
    res.status(400).json({ error: 'No update fields provided' });
  }
});

/**
 * Error handling middleware
 */
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({
    error: err.message || 'Internal server error'
  });
});

/**
 * Start server
 */
app.listen(PORT, () => {
  const localBaseUrl = `http://localhost:${PORT}`;
  const advertisedBaseUrl = process.env.PUBLIC_BASE_URL || localBaseUrl;
  console.log(`\nPhoto Gallery Server running at ${advertisedBaseUrl}`);
  console.log(`Upload endpoint: ${advertisedBaseUrl}/api/upload`);
  console.log(`Photos list: ${advertisedBaseUrl}/api/photos`);
  console.log(`\nReady to serve photos to your Electron apps!\n`);
});
