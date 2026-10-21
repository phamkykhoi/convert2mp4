'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  initialFiles: () => ipcRenderer.invoke('initial-files'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  expandPaths: (paths) => ipcRenderer.invoke('expand-paths', paths),
  probe: (file) => ipcRenderer.invoke('probe', file),
  convert: (id, input, opts) => ipcRenderer.invoke('convert', id, input, opts),
  cancel: (ids) => ipcRenderer.invoke('cancel', ids),
  pause: (ids) => ipcRenderer.invoke('pause', ids),
  resume: (ids) => ipcRenderer.invoke('resume', ids),
  openFile: (p) => ipcRenderer.invoke('open-file', p),
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  setProgress: (fraction, paused, title) => ipcRenderer.send('set-progress', fraction, paused, title),
  notify: (title, body) => ipcRenderer.send('notify', title, body),
  // Đường dẫn thật của file được kéo thả vào cửa sổ.
  pathForFile: (file) => webUtils.getPathForFile(file),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, p) => cb(p)),
  onOpenFiles: (cb) => ipcRenderer.on('open-files', (_e, files) => cb(files))
});
