'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const installFirebaseMock = require('../../tests/firebase-mock.js');
const captureRoot = process.env.CHAT_UPDATE_CAPTURE_DIR || path.resolve(__dirname, '../../../qa/native-updates');

(async () => {
  await fs.mkdir(captureRoot, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  try {
    const shell = await browser.newPage({ viewport: { width: 1280, height: 80 } });
    const shellErrors = [];
    shell.on('pageerror', error => shellErrors.push(error.message));
    await shell.addInitScript(() => {
      window.desktop = { applyUpdate() { window.__applied = (window.__applied || 0) + 1; }, onUpdate(cb) { window.__update = cb; }, onStatus() {}, onMaximized() {} };
    });
    await shell.goto(pathToFileURL(path.resolve(__dirname, '../ui/shell.html')).href);
    const button = shell.locator('#apply-update');
    await shell.evaluate(() => __update({ available: true, webAvailable: true, nativeAvailable: true, version: '1.8.0' }));
    assert.equal(await button.textContent().then(s => s.trim()), '');
    assert.match(await button.getAttribute('aria-label'), /1\.8\.0.*web update.*restart/);
    await shell.screenshot({ path: path.join(captureRoot, 'combined-update-icon.png'), clip: { x: 0, y: 0, width: 1280, height: 40 } });
    await button.click(); assert.equal(await shell.evaluate(() => __applied), 1);
    assert.equal(await button.isDisabled(), true);
    assert.equal(await shell.locator('#update-detail').textContent(), 'Checking…');
    await shell.evaluate(() => __update({ available: true, status: 'downloading', progress: 38 }));
    assert.equal(await button.isDisabled(), true);
    assert.equal(await shell.locator('#update-detail').textContent(), '38%');
    assert.equal(await shell.locator('#update-progress-fill').evaluate(e => e.style.width), '38%');
    await shell.screenshot({ path: path.join(captureRoot, 'native-download-progress.png'), clip: { x: 0, y: 0, width: 1280, height: 40 } });
    await shell.evaluate(() => __update({ status: 'error', error: 'The release signature did not match.' }));
    assert.equal(await button.isDisabled(), false);
    assert.match(await button.getAttribute('title'), /signature.*retry/);
    assert.equal(await shell.locator('#update-detail').textContent(), 'Update failed');
    await shell.evaluate(() => __update({ available: false, status: 'check-error', error: 'The update server could not be reached.' }));
    assert.equal(await shell.locator('#update-detail').textContent(), 'Check unavailable');
    assert.equal(await shell.locator('.update-dot').isVisible(), false, 'a failed check cannot claim a new release');
    await shell.screenshot({ path: path.join(captureRoot, 'native-check-unavailable.png'), clip: { x: 0, y: 0, width: 1280, height: 40 } });
    await button.click(); assert.equal(await shell.evaluate(() => __applied), 2);
    assert.equal(await shell.locator('#update-detail').textContent(), 'Checking…');
    assert.equal(await button.isDisabled(), true);
    await shell.screenshot({ path: path.join(captureRoot, 'native-retry-checking.png'), clip: { x: 0, y: 0, width: 1280, height: 40 } });
    await shell.evaluate(() => __update({ available: false, status: 'current', version: '1.7.8' }));
    assert.equal(await button.isVisible(), false);
    assert.equal(await shell.locator('#update-detail').isVisible(), false);
    assert.match(await shell.locator('#update-announcement').textContent(), /up to date/);
    await shell.evaluate(() => __update({ available: true, webAvailable: true }));
    assert.equal(await shell.locator('#update-detail').isVisible(), false);
    assert.deepEqual(shellErrors, []);
    await shell.close();

    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      await context.addInitScript(installFirebaseMock);
      await context.addInitScript(() => {
        window.__configuredNativeUpdates = [];
        window.chatDesktopPreferences = { version: 1, setBackgroundRunning() {}, getState: async () => ({ backgroundRunning: true }) };
        window.chatDesktopBuild = { nativeVersion: '1.7.8', nativeUpdates: true, configureNativeUpdate: async url => __configuredNativeUpdates.push(url) };
        __testDatabase.values.admin.desktopUpdate = { url: 'https://example.test/legacy.exe', minimumVersion: '9.0.0', manifestUrl: 'https://example.test/first.json' };
      });
      await context.route(/^https?:\/\//, route => route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(pathToFileURL(path.resolve(__dirname, '../../index.html')).href);
      await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
      await page.waitForFunction(() => __configuredNativeUpdates.includes('https://example.test/first.json'));
      assert.equal(await page.locator('#native-update-gate[open]').count(), 0, 'in-app updater never opens the old external-download gate');
      await page.click('#btn-go-login'); await page.fill('#login-code', 'TEST-USER'); await page.click('#btn-login');
      await page.waitForFunction(() => ChatApp.currentUser);
      await page.evaluate(async () => {
        await ChatApp.openRoom('test', { quiet: true }); ChatApp.closeToast(); ChatApp.closeMobileDrawers();
        await __testDatabase.ref('users/TEST-USER/username').set('Vinny'); ChatApp.currentUser.username = 'Vinny';
        ChatApp.bindAdminDatabase = () => {};
        ChatApp.openAdminPanel();
      });
      await page.waitForFunction(() => getComputedStyle(document.getElementById('modal')).opacity === '1' && getComputedStyle(document.querySelector('#modal .modal-card')).opacity === '1');
      assert.equal(await page.locator('label[for="panel-update-manifest-url"]').textContent(), 'Native update manifest URL');
      assert.equal(await page.inputValue('#panel-update-url'), 'https://example.test/legacy.exe');
      await page.fill('#panel-update-manifest-url', 'https://example.test/next.json'); await page.press('#panel-update-manifest-url', 'Enter');
      await page.waitForFunction(() => __testDatabase.get('admin/desktopUpdate')?.manifestUrl === 'https://example.test/next.json');
      assert.equal(await page.evaluate(() => __testDatabase.get('admin/desktopUpdate').url), 'https://example.test/legacy.exe');
      assert.equal(await page.evaluate(() => __testDatabase.get('admin/desktopUpdate').minimumVersion), '9.0.0');
      await page.waitForFunction(() => __configuredNativeUpdates.at(-1) === 'https://example.test/next.json');
      await page.screenshot({ path: path.join(captureRoot, `admin-updates-${viewport.width}.png`) });
      const inputBounds = await page.locator('#panel-update-manifest-url').boundingBox();
      assert.ok(inputBounds.x >= 0 && inputBounds.x + inputBounds.width <= viewport.width, 'native settings fit this viewport');
      await page.fill('#panel-update-manifest-url', 'javascript:bad'); await page.press('#panel-update-manifest-url', 'Enter');
      await page.waitForFunction(() => document.getElementById('panel-update-manifest-status').textContent.includes('HTTPS'));
      assert.equal(await page.evaluate(() => __testDatabase.get('admin/desktopUpdate').manifestUrl), 'https://example.test/next.json');
      await page.fill('#panel-update-manifest-url', ''); await page.press('#panel-update-manifest-url', 'Enter');
      await page.waitForFunction(() => !__testDatabase.get('admin/desktopUpdate')?.manifestUrl && __configuredNativeUpdates.at(-1) === '');
      assert.equal(await page.evaluate(() => __testDatabase.get('admin/desktopUpdate').url), 'https://example.test/legacy.exe');
      await page.fill('#panel-update-url', ''); await page.press('#panel-update-url', 'Enter');
      await page.waitForFunction(() => __testDatabase.get('admin/desktopUpdate') === null);
      assert.deepEqual(errors, []);
      await context.close();
    }
    const repairContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    await repairContext.addInitScript(installFirebaseMock);
    await repairContext.addInitScript(() => {
      window.chatDesktopPreferences = { version: 1, setBackgroundRunning() {}, getState: async () => ({ backgroundRunning: true }) };
      window.chatDesktopBuild = {
        nativeVersion: '1.7.7', nativeUpdates: true, configureNativeUpdate: async () => true,
        openUpdateAndQuit: async url => { window.__repairOpened = url; return true; },
      };
      __testDatabase.values.admin.desktopUpdate = { manifestUrl: 'https://example.test/native-update.json', url: 'https://example.test/1.7.7.exe', minimumVersion: '1.7.7' };
    });
    await repairContext.route(/^https?:\/\//, route => route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
    const repairPage = await repairContext.newPage();
    const repairErrors = []; repairPage.on('pageerror', error => repairErrors.push(error.message));
    await repairPage.goto(pathToFileURL(path.resolve(__dirname, '../../index.html')).href);
    await repairPage.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    assert.equal(await repairPage.locator('#native-update-gate[open]').count(), 0, 'the same installed version does not prompt for migration');
    await repairPage.evaluate(() => __testDatabase.ref('admin/desktopUpdate').update({ url: 'https://example.test/1.7.8.exe', minimumVersion: '1.7.8' }));
    await repairPage.locator('#native-update-gate[open]').waitFor();
    assert.equal(await repairPage.locator('#native-update-title').textContent(), 'One-time updater repair');
    assert.match(await repairPage.locator('#native-update-description').textContent(), /one-time.*repair native updates.*update icon/);
    assert.equal(await repairPage.locator('#native-update-download').getAttribute('href'), 'https://example.test/1.7.8.exe');
    await repairPage.screenshot({ path: path.join(captureRoot, 'native-177-repair.png') });
    await repairPage.locator('#native-update-download').click();
    assert.equal(await repairPage.evaluate(() => __repairOpened), 'https://example.test/1.7.8.exe');
    assert.deepEqual(repairErrors, []);
    await repairContext.close();
    console.log('Combined update icon, truthful check errors, visible retry, current-version clearing, stable manifest settings, 1.7.7 one-time repair, and desktop/mobile layouts: PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
