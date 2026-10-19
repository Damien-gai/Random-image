const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('api', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  scanPaths: (p) => ipcRenderer.invoke('scan-paths', p),
  importZip: () => ipcRenderer.invoke('import-zip'),
  importIcloud: (link) => ipcRenderer.invoke('import-icloud', link),
  prepareMedia: (o) => ipcRenderer.invoke('prepare-media', o),
  openVlc: (p) => ipcRenderer.invoke('open-vlc', p),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  pathFor: (file) => webUtils.getPathForFile(file),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  exitFullscreen: () => ipcRenderer.invoke('exit-fullscreen')
});
