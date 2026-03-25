// Preload script for security isolation
// This file runs in a secure context and can safely expose limited APIs to the renderer process
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('windowControls', {
	toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
	getFullscreenState: () => ipcRenderer.invoke('window:get-fullscreen')
});
