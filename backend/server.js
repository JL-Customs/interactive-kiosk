require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const nodemailer = require('nodemailer');

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
const estimateOptionsFile = path.join(__dirname, 'estimate-options.json');
const leadsDataFile = path.join(__dirname, 'leads-data.json');
let photos = [];
let settings = {
  rotationInterval: 5
};
let estimateOptions = {}; // keyed by company name
let leads = [];

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

function loadEstimateOptions() {
  if (fs.existsSync(estimateOptionsFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(estimateOptionsFile, 'utf8'));
      // Migrate: if stored as a flat array (old format), ignore it
      estimateOptions = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    } catch (error) {
      console.error('Error loading estimate options:', error);
      estimateOptions = {};
    }
  }
}

function sendMailWithTimeout(transporter, options, ms = 30000) {
  return Promise.race([
    transporter.sendMail(options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Email timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function saveEstimateOptions() {
  try {
    fs.writeFileSync(estimateOptionsFile, JSON.stringify(estimateOptions, null, 2));
  } catch (error) {
    console.error('Error saving estimate options:', error);
  }
}

function loadLeads() {
  if (fs.existsSync(leadsDataFile)) {
    try {
      leads = JSON.parse(fs.readFileSync(leadsDataFile, 'utf8'));
    } catch (e) {
      console.error('Error loading leads:', e);
      leads = [];
    }
  }
}

function saveLeads() {
  try {
    fs.writeFileSync(leadsDataFile, JSON.stringify(leads, null, 2));
  } catch (e) {
    console.error('Error saving leads:', e);
  }
}

// Initialize photos
loadPhotos();
loadSettings();
loadEstimateOptions();
loadLeads();

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
 * Get all companies (returns object keyed by company name)
 */
app.get('/api/estimate-options', (req, res) => {
  res.json(estimateOptions);
});

/**
 * Get estimate options for a specific company
 */
app.get('/api/estimate-options/:company', (req, res) => {
  const company = req.params.company;
  res.json(estimateOptions[company] || []);
});

/**
 * Save estimate options for a specific company
 */
app.post('/api/estimate-options/:company', express.json(), (req, res) => {
  const company = req.params.company;
  const { options } = req.body;
  if (!Array.isArray(options)) {
    return res.status(400).json({ error: 'options must be an array' });
  }
  estimateOptions[company] = options;
  saveEstimateOptions();
  res.json({ success: true });
});

/**
 * Get all leads
 */
app.get('/api/leads', (req, res) => {
  res.json(leads);
});

/**
 * Create a new lead
 */
app.post('/api/leads', express.json(), (req, res) => {
  const { name, phone, source } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ error: 'name and phone are required' });
  }
  const lead = {
    id: Date.now().toString(),
    name,
    phone,
    source: source || 'unknown',
    createdAt: new Date().toISOString(),
  };
  leads.push(lead);
  saveLeads();
  res.json({ success: true, lead });
});

/**
 * Update a lead (attach email/items/total after action taken)
 */
app.patch('/api/leads/:id', express.json(), (req, res) => {
  const lead = leads.find(l => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  const { email, items, total } = req.body;
  if (email !== undefined) lead.email = email;
  if (items !== undefined) lead.items = items;
  if (total !== undefined) lead.total = total;
  saveLeads();
  res.json({ success: true, lead });
});

/**
 * Delete a lead
 */
app.delete('/api/leads/:id', (req, res) => {
  const index = leads.findIndex(l => l.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Lead not found' });
  leads.splice(index, 1);
  saveLeads();
  res.json({ success: true });
});

/**
 * Send estimate via email
 */
app.post('/api/send-estimate', express.json(), async (req, res) => {
  const { email, items, total } = req.body;

  if (!email || !Array.isArray(items)) {
    return res.status(400).json({ error: 'email and items are required' });
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return res.status(503).json({ error: 'Email is not configured on the server.' });
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const rows = items.map(i =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #ddd;">${i.label}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #ddd;color:#666;">${i.partNumber || ''}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #ddd;text-align:right;">$${Number(i.price).toLocaleString('en-US')}</td>
    </tr>`
  ).join('');

  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#222;">
      <h2 style="background:#c0392b;color:#fff;padding:20px 24px;margin:0;border-radius:8px 8px 0 0;">
        JL Customs - Your Estimate
      </h2>
      <div style="border:1px solid #ddd;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#f5f5f5;">
              <th style="padding:8px 12px;text-align:left;">Item</th>
              <th style="padding:8px 12px;text-align:left;">Part #</th>
              <th style="padding:8px 12px;text-align:right;">Price</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr>
              <td style="padding:12px;font-weight:bold;">Estimated Total</td>
              <td style="padding:12px;font-weight:bold;text-align:right;">$${Number(total).toLocaleString('en-US')}</td>
            </tr>
          </tfoot>
        </table>
        <p style="margin-top:20px;color:#666;font-size:0.9rem;">
          This is an estimate only. Final pricing may vary. Contact us to confirm your order.
        </p>
      </div>
    </div>
  `;

  try {
    await sendMailWithTimeout(transporter, {
      from: SMTP_FROM || SMTP_USER,
      to: email,
      subject: 'Your JL Customs Estimate',
      html,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Estimate email error:', err.message);
    res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }
});

/**
 * Send contact info via email
 */
app.post('/api/send-contact', express.json(), async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'email is required' });
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return res.status(503).json({ error: 'Email is not configured on the server.' });
  }

  console.log(`Contact email: attempting send to ${email} via ${SMTP_HOST}:${SMTP_PORT || 587}`);

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#222;">
      <h2 style="background:#c0392b;color:#fff;padding:20px 24px;margin:0;border-radius:8px 8px 0 0;">
        JL Customs - Contact an Expert
      </h2>
      <div style="border:1px solid #ddd;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
        <p style="margin:0 0 20px;color:#444;">
          Thanks for your interest! Here's how to reach us:
        </p>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:12px;font-weight:bold;width:80px;">Phone</td>
            <td style="padding:12px;">(555) 123-4567</td>
          </tr>
          <tr style="background:#f5f5f5;">
            <td style="padding:12px;font-weight:bold;">Email</td>
            <td style="padding:12px;">info@jlcustoms.com</td>
          </tr>
        </table>
        <p style="margin-top:20px;color:#666;font-size:0.9rem;">
          We look forward to hearing from you.
        </p>
      </div>
    </div>
  `;

  try {
    await sendMailWithTimeout(transporter, {
      from: SMTP_FROM || SMTP_USER,
      to: email,
      subject: 'JL Customs - Contact Information',
      html,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Contact email error:', err.message);
    res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }
});

/**
 * Notify boss via push notification when a customer starts a video call
 */
app.post('/api/notify-boss', async (req, res) => {
  // Trim and strip stray surrounding quotes so a sloppy env var value still maps
  // to the right topic (e.g. NTFY_TOPIC="my-topic" or a trailing newline/space).
  const topic = (process.env.NTFY_TOPIC || '').trim().replace(/^["']|["']$/g, '');
  if (!topic) {
    return res.status(503).json({ error: 'Notifications not configured.' });
  }

  try {
    const headers = {
      'Title': 'Customer Waiting',
      'Priority': 'high',
      'Tags': 'video_camera',
    };
    // Authenticate so ntfy.sh rate-limits us per-account, not by source IP.
    // Render's outbound IP is shared across tenants, so anonymous publishes get
    // 429'd once that shared IP hits the free-tier cap. A token sidesteps that.
    const token = (process.env.NTFY_TOKEN || '').trim();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const ntfyRes = await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers,
      body: 'A customer at the kiosk wants to video call. Tap to join: https://meet.jit.si/jlcustoms-expert-kiosk',
    });
    // fetch() does not reject on HTTP error responses, so check explicitly —
    // otherwise a rejected publish looks like success and the failure is invisible.
    if (!ntfyRes.ok) {
      const detail = await ntfyRes.text().catch(() => '');
      console.error(`Notify boss: ntfy returned ${ntfyRes.status} for topic "${topic}": ${detail}`);
      return res.status(502).json({ error: `Notification service rejected the message (${ntfyRes.status}).` });
    }
    console.log(`Notify boss: published to ntfy topic "${topic}"`);
    res.json({ success: true });
  } catch (err) {
    console.error('Notify boss error:', err.message);
    res.status(500).json({ error: 'Failed to send notification.' });
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
