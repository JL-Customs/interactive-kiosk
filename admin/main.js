const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let storeDir;
let storeFilesDir;
let storeMetadataFile;
let storeSettingsFile;

function setupStore() {
  storeDir = path.join(app.getPath('userData'), 'photo-store');
  storeFilesDir = path.join(storeDir, 'files');
  storeMetadataFile = path.join(storeDir, 'metadata.json');
  storeSettingsFile = path.join(storeDir, 'settings.json');
  fs.mkdirSync(storeFilesDir, { recursive: true });
}

function readMetadata() {
  if (!fs.existsSync(storeMetadataFile)) return [];
  try { return JSON.parse(fs.readFileSync(storeMetadataFile, 'utf8')); }
  catch { return []; }
}

function writeMetadata(photos) {
  fs.writeFileSync(storeMetadataFile, JSON.stringify(photos, null, 2));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile('index.html');
}

// ── Store IPC ──────────────────────────────────────────────────

ipcMain.handle('store:save-photo', (event, { buffer, localFilename, metadata }) => {
  const filePath = path.join(storeFilesDir, localFilename);
  fs.writeFileSync(filePath, Buffer.from(buffer));
  const photos = readMetadata();
  const idx = photos.findIndex(p => p.localId === metadata.localId);
  if (idx >= 0) photos[idx] = metadata;
  else photos.push(metadata);
  writeMetadata(photos);
});

ipcMain.handle('store:load-metadata', () => readMetadata());

ipcMain.handle('store:save-metadata', (event, photos) => writeMetadata(photos));

ipcMain.handle('store:delete-photo', (event, localId) => {
  const photos = readMetadata();
  const photo = photos.find(p => p.localId === localId);
  if (photo) {
    const filePath = path.join(storeFilesDir, photo.localFilename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  writeMetadata(photos.filter(p => p.localId !== localId));
});

ipcMain.handle('store:get-file-data', (event, localFilename) => {
  const filePath = path.join(storeFilesDir, localFilename);
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  // Return a copy of the underlying ArrayBuffer (avoid shared pool issues)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return { buffer: ab, filename: localFilename };
});

ipcMain.handle('store:save-settings', (event, settings) => {
  fs.writeFileSync(storeSettingsFile, JSON.stringify(settings, null, 2));
});

ipcMain.handle('store:load-settings', () => {
  if (!fs.existsSync(storeSettingsFile)) return null;
  try { return JSON.parse(fs.readFileSync(storeSettingsFile, 'utf8')); }
  catch { return null; }
});

// ── App lifecycle ──────────────────────────────────────────────

app.on('ready', () => {
  setupStore();
  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
