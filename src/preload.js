'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  version: () => ipcRenderer.invoke('app-version'),
  loadConfig: () => ipcRenderer.invoke('config-load'),
  saveConfig: (cfg) => ipcRenderer.invoke('config-save', cfg),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  scanFolder: (dir) => ipcRenderer.invoke('scan-folder', dir),
  pickWatermark: () => ipcRenderer.invoke('pick-watermark'),
  loadWatermark: (p) => ipcRenderer.invoke('load-watermark', p),
  pickOutput: (def) => ipcRenderer.invoke('pick-output', def),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  exportImages: (job) => ipcRenderer.invoke('export', job),
  onExportProgress: (cb) => ipcRenderer.on('export-progress', (_e, d) => cb(d)),
  pathForFile: (file) => webUtils.getPathForFile(file),
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  downloadUpdate: () => ipcRenderer.invoke('update-download'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  onUpdate: (cb) => ipcRenderer.on('update-status', (_e, d) => cb(d))
});
