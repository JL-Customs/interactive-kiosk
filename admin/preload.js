const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('localStore', {
  savePhoto:    (buffer, localFilename, metadata) => ipcRenderer.invoke('store:save-photo', { buffer, localFilename, metadata }),
  loadMetadata: ()           => ipcRenderer.invoke('store:load-metadata'),
  saveMetadata: (photos)     => ipcRenderer.invoke('store:save-metadata', photos),
  deletePhoto:  (localId)    => ipcRenderer.invoke('store:delete-photo', localId),
  getFileData:  (localFilename) => ipcRenderer.invoke('store:get-file-data', localFilename),
  saveSettings: (settings)   => ipcRenderer.invoke('store:save-settings', settings),
  loadSettings: ()           => ipcRenderer.invoke('store:load-settings'),
});
