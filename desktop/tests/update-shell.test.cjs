'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function fixture() {
  let update, clicks = 0;
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { hidden: false, disabled: false, title: '', textContent: '', style: {}, dataset: {}, attributes: {}, handlers: {}, classList: { toggle() {} },
      addEventListener(name, callback) { this.handlers[name] = callback; }, setAttribute(name, value) { this.attributes[name] = value; } });
    return nodes.get(id);
  };
  const desktop = { applyUpdate() { clicks++; }, onUpdate(callback) { update = callback; }, onStatus() {}, onMaximized() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../ui/shell.js'), 'utf8'), { window: { desktop }, document: { getElementById: node } });
  return { node, update: value => update(value), clicks: () => clicks };
}

test('one icon represents shared web, native, and combined releases with an accessible action', () => {
  const f = fixture(), button = f.node('apply-update');
  f.update({ available: false }); assert.equal(button.hidden, true);
  f.update({ available: true, webAvailable: true });
  assert.equal(button.hidden, false); assert.match(button.attributes['aria-label'], /web update.*refresh/);
  f.update({ available: true, nativeAvailable: true, version: '1.8.0' });
  assert.match(button.title, /1\.8\.0.*restart/);
  f.update({ available: true, webAvailable: true, nativeAvailable: true, version: '1.8.0' });
  assert.match(button.title, /web update/);
  assert.equal(button.textContent, '', 'the action remains an icon');
  button.handlers.click(); assert.equal(f.clicks(), 1);
  assert.equal(button.disabled, true); assert.equal(f.node('update-detail').textContent, 'Checking…');
});

test('download progress, install lock, and retry errors stay visible and accessible', () => {
  const f = fixture(), button = f.node('apply-update'), detail = f.node('update-detail');
  f.update({ status: 'downloading', progress: 45.4 });
  assert.equal(button.hidden, false); assert.equal(button.disabled, true);
  assert.equal(detail.textContent, '45%'); assert.equal(f.node('update-progress-fill').style.width, '45%');
  assert.equal(button.attributes['aria-busy'], 'true');
  f.update({ status: 'installing' });
  assert.equal(button.disabled, true); assert.match(button.title, /restart/);
  f.update({ status: 'error', error: 'Connection interrupted.' });
  assert.equal(button.disabled, false); assert.equal(button.hidden, false);
  assert.match(button.title, /Connection interrupted.*retry/);
  assert.match(f.node('update-announcement').textContent, /Connection interrupted/);
  f.update({ available: true, status: 'checking' }); assert.equal(button.disabled, true);
  f.update({ available: false, status: 'available' });
  assert.equal(button.hidden, true); assert.equal(detail.hidden, true);
});

test('failed discovery is distinct from failed installation and explicit retry paints immediately', () => {
  const f = fixture(), button = f.node('apply-update'), detail = f.node('update-detail');
  f.update({ available: false, status: 'check-error', error: 'The native update manifest is not valid JSON.' });
  assert.equal(button.hidden, false); assert.equal(button.disabled, false);
  assert.equal(button.dataset.available, 'false', 'no update badge is claimed before a release is found');
  assert.equal(detail.textContent, 'Check unavailable');
  assert.match(button.title, /Could not check.*not valid JSON.*retry/);
  assert.doesNotMatch(detail.textContent, /Update failed/);
  button.handlers.click();
  assert.equal(f.clicks(), 1); assert.equal(button.disabled, true);
  assert.equal(button.hidden, false); assert.equal(detail.textContent, 'Checking…');
  button.handlers.click(); assert.equal(f.clicks(), 1, 'the visible retry cannot be sent twice');
  f.update({ available: false, status: 'current', version: '1.7.8' });
  assert.equal(button.hidden, true); assert.equal(detail.hidden, true);
  assert.equal(button.attributes['aria-busy'], 'false');
  assert.match(f.node('update-announcement').textContent, /up to date/);
});

test('same native version clears its status while a web update remains actionable', () => {
  const f = fixture(), button = f.node('apply-update');
  f.update({ available: true, webAvailable: true, nativeAvailable: false, status: 'current', version: '1.7.8' });
  assert.equal(button.hidden, false); assert.equal(button.disabled, false);
  assert.match(button.title, /web update.*refresh/); assert.doesNotMatch(button.title, /up to date/);
  f.update({ available: false, status: 'checking' });
  assert.equal(button.hidden, false); assert.equal(button.disabled, true);
  assert.equal(f.node('update-detail').textContent, 'Checking…');
});
