const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dockterm', {
  isElectron: true,
  platform: process.platform,
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  pickIdentityFile: () => ipcRenderer.invoke('dialog:pickIdentityFile'),
  clipboardWrite: (text) => ipcRenderer.invoke('clipboard:writeText', text),
  clipboardRead: () => ipcRenderer.invoke('clipboard:readText'),
});
