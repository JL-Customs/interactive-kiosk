const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { pathToFileURL } = require('url');

let mainWindow;
let cacheDir;

function setupCache() {
  cacheDir = path.join(app.getPath('userData'), 'photo-cache');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    fullscreen: false // Set to true for production kiosk mode
  });

  mainWindow.removeMenu();
  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools(); // Uncomment for development
}

ipcMain.handle('window:toggle-fullscreen', () => {
  if (!mainWindow) return false;
  const nextState = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(nextState);
  return nextState;
});

ipcMain.handle('window:get-fullscreen', () => {
  if (!mainWindow) return false;
  return mainWindow.isFullScreen();
});

ipcMain.handle('cache:save-metadata', (event, photos) => {
  const metadataPath = path.join(cacheDir, 'metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify(photos, null, 2));
});

ipcMain.handle('cache:load-metadata', () => {
  const metadataPath = path.join(cacheDir, 'metadata.json');
  if (!fs.existsSync(metadataPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch {
    return null;
  }
});

ipcMain.handle('cache:download-photo', (event, { url, filename }) => {
  return new Promise((resolve) => {
    const localPath = path.join(cacheDir, filename);
    if (fs.existsSync(localPath)) {
      resolve(pathToFileURL(localPath).href);
      return;
    }

    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(localPath);
    proto.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => file.close(() => resolve(pathToFileURL(localPath).href)));
    }).on('error', () => {
      fs.unlink(localPath, () => {});
      resolve(null);
    });
  });
});

ipcMain.handle('cache:get-local-path', (event, filename) => {
  const localPath = path.join(cacheDir, filename);
  if (fs.existsSync(localPath)) {
    return pathToFileURL(localPath).href;
  }
  return null;
});

app.on('ready', () => {
  setupCache();
  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
