'use strict';
// Draw the live unread badge in memory; no numbered icon assets or icon swap.
const DIGITS = {
  '0':['111','101','101','101','111'], '1':['010','110','010','010','111'],
  '2':['111','001','111','100','111'], '3':['111','001','111','001','111'],
  '4':['101','101','111','001','001'], '5':['111','100','111','001','111'],
  '6':['111','100','111','101','111'], '7':['111','001','010','010','010'],
  '8':['111','101','111','101','111'], '9':['111','101','111','001','111'],
  '+':['000','010','111','010','000']
};
function renderBadge(nativeImage, count) {
  const label = count > 99 ? '99+' : String(count);
  const size = 32, pixels = Buffer.alloc(size * size * 4);
  // Electron bitmaps use premultiplied BGRA. All painted pixels are opaque.
  const paint = (x,y,b,g,r) => { const i = (y*size+x)*4; pixels[i]=b; pixels[i+1]=g; pixels[i+2]=r; pixels[i+3]=255; };
  for (let y=0;y<size;y++) for(let x=0;x<size;x++) {
    if ((x-15.5)**2+(y-15.5)**2 <= 15.5**2) paint(x,y,82,74,226);
  }
  const scale=2, width=(label.length*4-1)*scale, start=Math.floor((size-width)/2);
  [...label].forEach((digit,index) => DIGITS[digit].forEach((row,y) => [...row].forEach((bit,x) => {
    if(bit !== '1') return;
    for(let dy=0;dy<scale;dy++) for(let dx=0;dx<scale;dx++) paint(start+(index*4+x)*scale+dx,11+y*scale+dy,255,255,255);
  })));
  return nativeImage.createFromBitmap(pixels, { width:size, height:size, scaleFactor:1 });
}
const CHANNEL = 'chat-unread:count';
function normalizeCount(value) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 999999999) : 0;
}
function createUnreadBadge({ ipcMain, mainWindow, nativeImage, platform = process.platform }) {
  let contents = null, count = 0, rendered = null, subscriptions = [];
  const icons = new Map();
  function update(value, force = false) {
    count = normalizeCount(value);
    if (platform !== 'win32' || mainWindow.isDestroyed() || (!force && rendered === count)) return;
    const label = count > 99 ? '99+' : String(count);
    if (count && !icons.has(label)) icons.set(label, renderBadge(nativeImage, count));
    try {
      mainWindow.setOverlayIcon(count ? icons.get(label) : null, count ? `${count} unread message${count === 1 ? '' : 's'}` : 'No unread messages');
      rendered = count;
    } catch { rendered = null; }
  }
  function publish(event, value) {
    if (!contents || contents.isDestroyed() || event.sender !== contents || event.senderFrame !== contents.mainFrame) return;
    update(value);
  }
  const refresh = () => update(count, true);
  ipcMain.on(CHANNEL, publish);
  for (const event of ['show', 'restore', 'focus']) mainWindow.on(event, refresh);
  mainWindow.once('closed', destroy);
  function bindContents(next) {
    for (const unsubscribe of subscriptions) unsubscribe(); subscriptions = [];
    contents = next; update(0, true);
    if (!next?.on) return;
    const navigation = (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) update(0, true); };
    next.on('did-start-navigation', navigation); subscriptions.push(() => next.removeListener('did-start-navigation', navigation));
    for (const name of ['render-process-gone', 'destroyed']) {
      const reset = () => update(0, true);
      next.on(name, reset); subscriptions.push(() => next.removeListener(name, reset));
    }
  }
  function destroy() {
    ipcMain.removeListener(CHANNEL, publish);
    for (const event of ['show', 'restore', 'focus']) mainWindow.removeListener(event, refresh);
    for (const unsubscribe of subscriptions) unsubscribe(); subscriptions = [];
    contents = null; icons.clear();
  }
  return { bindContents, update, destroy };
}
module.exports = { createUnreadBadge, normalizeCount, CHANNEL, renderBadge };
