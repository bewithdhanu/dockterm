const { contextBridge, ipcRenderer } = require('electron');

function computeEditFocus(target) {
  const el =
    target instanceof Element
      ? target
      : target && target.parentElement
        ? target.parentElement
        : null;
  if (!el) return 'dom';
  if (el.closest('.xterm') || el.closest('.terminal-host')) return 'term';
  return 'dom';
}

function publishEditFocus(kind) {
  try {
    ipcRenderer.send('dockterm:edit-focus', kind);
  } catch {
    /* ignore */
  }
}

function onFocusIn(e) {
  publishEditFocus(computeEditFocus(e.target));
}

window.addEventListener('focusin', onFocusIn, true);
window.addEventListener('DOMContentLoaded', () => {
  publishEditFocus(computeEditFocus(document.activeElement));
});

ipcRenderer.on('dockterm:clipboard', (_event, action) => {
  try {
    window.dispatchEvent(
      new CustomEvent('dockterm:clipboard', { detail: { action } })
    );
  } catch {
    /* ignore */
  }
});

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
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
});
