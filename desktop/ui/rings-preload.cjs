'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const mode = new URLSearchParams(window.location.search).get('mode') === 'pings' ? 'pings' : 'rings';
contextBridge.exposeInMainWorld('ringPopup', Object.freeze({
  mode,
  onState(callback) { const listener = (_event, state) => callback(state); ipcRenderer.on(`chat-${mode}:state`, listener); return () => ipcRenderer.removeListener(`chat-${mode}:state`, listener); },
  command: command => ipcRenderer.invoke(mode === 'pings' ? 'chat-pings:command' : 'chat-rings:answer', command),
}));
