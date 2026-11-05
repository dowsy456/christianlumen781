'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { createUnreadBadge, CHANNEL } = require('../unread-badge.cjs');
test('badge displays total unread messages, renders live counts without image files, and clears at zero', () => {
  const calls = [], ipcMain = new EventEmitter();
  const mainWindow = Object.assign(new EventEmitter(), { isDestroyed: () => false, setOverlayIcon: (...args) => calls.push(args) });
  const nativeImage = { createFromBitmap(bytes, size) { assert.equal(bytes.length, 32*32*4); assert.equal(size.width, 32); return {bytes,size}; } };
  const badge = createUnreadBadge({ ipcMain, mainWindow, nativeImage, platform: 'win32' });
  const contents = { mainFrame: {}, isDestroyed: () => false };
  badge.bindContents(contents);
  const event = { sender: contents, senderFrame: contents.mainFrame };
  ipcMain.emit(CHANNEL, event, 3);
  assert.equal(calls.at(-1)[0].size.height, 32); assert.equal(calls.at(-1)[1], '3 unread messages');
  const length = calls.length; ipcMain.emit(CHANNEL, event, 3); assert.equal(calls.length, length);
  ipcMain.emit(CHANNEL, { sender: contents, senderFrame: {} }, 9); assert.equal(calls.length, length);
  ipcMain.emit(CHANNEL, event, 120);
  assert.equal(calls.at(-1)[0].size.width, 32); assert.equal(calls.at(-1)[1], '120 unread messages');
  mainWindow.emit('restore'); assert.equal(calls.length, length + 2);
  ipcMain.emit(CHANNEL, event, 0); assert.equal(calls.at(-1)[0], null);
  ipcMain.emit(CHANNEL, event, { count: 1 }); assert.equal(calls.at(-1)[0], null);
  badge.bindContents(null); ipcMain.emit(CHANNEL, event, 4); assert.equal(calls.at(-1)[0], null);
  mainWindow.emit('closed'); assert.equal(ipcMain.listenerCount(CHANNEL), 0);
});
test('renderer reload or failure clears a native badge instead of leaving an orphaned count', () => {
  const calls = [], ipcMain = new EventEmitter();
  const mainWindow = Object.assign(new EventEmitter(), { isDestroyed: () => false, setOverlayIcon: (...args) => calls.push(args) });
  const badge = createUnreadBadge({ ipcMain, mainWindow, nativeImage: { createFromBitmap: bytes => bytes }, platform: 'win32' });
  const contents = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false });
  badge.bindContents(contents);
  for (const name of ['did-start-navigation', 'render-process-gone', 'destroyed']) {
    ipcMain.emit(CHANNEL, { sender: contents, senderFrame: contents.mainFrame }, 3);
    contents.emit(name, {}, 'chatapp://app/index.html', false, true); assert.equal(calls.at(-1)[0], null);
  }
  badge.destroy(); assert.equal(contents.listenerCount('did-start-navigation'), 0);
});
