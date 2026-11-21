'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  version: () => ipcRenderer.invoke('app-version'),
  hasFfmpeg: () => ipcRenderer.invoke('has-ffmpeg'),
  loadConfig: () => ipcRenderer.invoke('config-load'),
  saveConfig: (cfg) => ipcRenderer.invoke('config-save', cfg),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  scanFolder: (dir, skip) => ipcRenderer.invoke('scan-folder', dir, skip),
  pickWatermark: () => ipcRenderer.invoke('pick-watermark'),
  loadWatermark: (p) => ipcRenderer.invoke('load-watermark', p),
  pickOutput: (def) => ipcRenderer.invoke('pick-output', def),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  previewImage: (item, job) => ipcRenderer.invoke('preview-image', item, job),
  estimateVideo: (item, job) => ipcRenderer.invoke('estimate-video', item, job),
  exportItems: (job) => ipcRenderer.invoke('export', job),
  cancelExport: () => ipcRenderer.invoke('export-cancel'),
  onExportProgress: (cb) => ipcRenderer.on('export-progress', (_e, d) => cb(d)),
  pathForFile: (file) => webUtils.getPathForFile(file),
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  downloadUpdate: () => ipcRenderer.invoke('update-download'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  onUpdate: (cb) => ipcRenderer.on('update-status', (_e, d) => cb(d))
});
