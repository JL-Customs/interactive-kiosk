const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('windowControls', {
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
  getFullscreenState: () => ipcRenderer.invoke('window:get-fullscreen')
});

contextBridge.exposeInMainWorld('photoCache', {
  saveMetadata: (photos) => ipcRenderer.invoke('cache:save-metadata', photos),
  loadMetadata: () => ipcRenderer.invoke('cache:load-metadata'),
  downloadPhoto: (url, filename) => ipcRenderer.invoke('cache:download-photo', { url, filename }),
  getLocalPath: (filename) => ipcRenderer.invoke('cache:get-local-path', filename)
});
