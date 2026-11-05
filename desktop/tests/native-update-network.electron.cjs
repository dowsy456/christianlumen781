'use strict';
// Real Chromium-network regression coverage. Run with Node after npm ci in
// desktop. --live also verifies the public signed feed and downloads its EXE
// into an isolated temporary profile; it never installs or launches that EXE.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);

async function run() {
  if (!process.versions.electron) {
    const executable = require('electron');
    const temporaryRoot = path.resolve(os.tmpdir());
    const root = await fs.mkdtemp(path.join(temporaryRoot, 'chat-native-network-test-'));
    const environment = { ...process.env, CHAT_NATIVE_NETWORK_ROOT: root }; delete environment.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, [__filename, ...process.argv.slice(2)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: environment });
    child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
    child.on('error', error => { console.error(error); process.exitCode = 1; });
    child.on('exit', async code => {
      process.exitCode = Number.isInteger(code) ? code : 1;
      assert.ok(path.resolve(root).startsWith(temporaryRoot + path.sep) && path.basename(root).startsWith('chat-native-network-test-'));
      await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(error => { console.error(error); process.exitCode = 1; });
    });
    return;
  }
  const { app, net, session } = require('electron');
  const root = process.env.CHAT_NATIVE_NETWORK_ROOT;
  assert.ok(root && path.isAbsolute(root), 'Run this regression through Node so the isolated profile is cleaned after Electron closes.');
  app.setPath('userData', path.join(root, 'profile'));
  let httpsServer, httpServer, completed = false;
  let deadline = setTimeout(() => { console.error('The isolated native network checks exceeded 60 seconds.'); app.exit(1); }, 60000);
  try {
    await app.whenReady();
    console.log('Checking isolated Chromium update redirects...');
    const openssl = process.env.CHAT_TEST_OPENSSL || (process.platform === 'win32' ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'usr', 'bin', 'openssl.exe') : 'openssl');
    const keyFile = path.join(root, 'test-tls-key.pem'), certFile = path.join(root, 'test-tls-cert.pem');
    await execute(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '1', '-subj', '/CN=localhost'], { windowsHide: true, timeout: 30000 });
    const tlsKey = await fs.readFile(keyFile), tlsCert = await fs.readFile(certFile);
    const isolated = session.fromPartition('native-update-network-test-' + crypto.randomUUID());
    isolated.setCertificateVerifyProc((request, callback) => {
      // This isolated test session connects only to the loopback fixture.
      // Local HTTPS inspection can replace its ephemeral self-signed cert, so
      // allow that fixture hostname here. Production and public-feed requests
      // use a different session with normal OS certificate verification.
      callback(request.hostname === '127.0.0.1' ? 0 : -3);
    });
    const { createNativeUpdater, createElectronUpdateFetch, canonicalManifest, _test } = require('../native-updater.cjs');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const fakeExe = Buffer.alloc(1024, 0); fakeExe.write('MZ'); fakeExe.writeUInt32LE(128, 60); fakeExe.writeUInt32LE(0x4550, 128); fakeExe.writeUInt16LE(0x8664, 132);
    let forbiddenHits = 0, slowClosed = false, origin;
    httpServer = require('node:http').createServer((_request, response) => { forbiddenHits++; response.end('must not reach HTTP'); });
    await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    const sign = fields => {
      const value = { schemaVersion: 1, version: '1.7.9', url: origin + '/download', sha256: crypto.createHash('sha256').update(fakeExe).digest('hex'), size: fakeExe.length, ...fields };
      return { ...value, signature: crypto.sign(null, Buffer.from(canonicalManifest(value)), privateKey).toString('base64') };
    };
    httpsServer = require('node:https').createServer({ key: tlsKey, cert: tlsCert }, (request, response) => {
      const route = new URL(request.url, origin).pathname;
      if (route === '/latest' || route === '/download') { response.writeHead(302, { location: route === '/latest' ? '/manifest.json' : '/app.exe' }); response.end(); }
      else if (route === '/manifest.json') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(sign())); }
      else if (route === '/app.exe') { response.setHeader('content-length', fakeExe.length); response.end(fakeExe); }
      else if (route === '/downgrade') { response.writeHead(302, { location: `http://127.0.0.1:${httpServer.address().port}/forbidden` }); response.end(); }
      else if (route === '/loop') { response.writeHead(302, { location: '/loop' }); response.end(); }
      else if (route === '/slow') { response.writeHead(200); response.write('first'); response.on('close', () => { slowClosed = true; }); }
      else if (route === '/oversize') { response.end(Buffer.alloc(20000)); }
      else { response.writeHead(404); response.end(); }
    });
    await new Promise(resolve => httpsServer.listen(0, '127.0.0.1', resolve));
    origin = `https://127.0.0.1:${httpsServer.address().port}`;
    const localFetch = createElectronUpdateFetch({ request: options => net.request({ ...options, session: isolated }) });
    await assert.rejects(isolated.fetch(origin + '/latest', { redirect: 'manual' }), /Redirect was cancelled/);
    console.log('PASS reproduced Electron manual redirect failure.');
    const updater = createNativeUpdater({ currentVersion: '1.7.8', portablePath: path.join(root, 'Chat App.exe'), userData: root, publicKey: publicKey.export({ type: 'spki', format: 'pem' }), fetchImpl: localFetch });
    assert.equal((await updater.check(origin + '/latest')).available, true);
    assert.equal((await updater.download()).status, 'ready');
    console.log('PASS signed local manifest and executable redirects.');
    await assert.rejects(_test.responseHTTPS(origin + '/downgrade', { fetchImpl: localFetch }), /HTTPS/);
    assert.equal(forbiddenHits, 0, 'HTTPS downgrade destination was never contacted');
    await assert.rejects(_test.responseHTTPS(origin + '/loop', { fetchImpl: localFetch }), /too many redirects/);
    console.log('PASS HTTPS downgrade and redirect limit.');
    const abort = new AbortController();
    const slow = _test.responseHTTPS(origin + '/slow', { fetchImpl: localFetch, signal: abort.signal }).then(response => _test.readResponse(response, 1024, () => {}));
    const abortTimer = setTimeout(() => abort.abort(new Error('test stop')), 200);
    await assert.rejects(slow, /test stop/); clearTimeout(abortTimer);
    for (let tries = 0; tries < 50 && !slowClosed; tries++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(slowClosed, true, 'cancellation closes the Chromium request');
    const oversize = await _test.responseHTTPS(origin + '/oversize', { fetchImpl: localFetch, maxBytes: 16384 });
    await assert.rejects(_test.readResponse(oversize, 16384, () => {}), /size limit/);
    console.log('PASS real Electron: manual-redirect reproduction; signed manifest and EXE redirects; HTTPS downgrade blocked before network; redirect budget; body cancellation; response size bound.');
    if (process.argv.includes('--live')) {
      clearTimeout(deadline);
      deadline = setTimeout(() => { console.error('The live native update checks exceeded ten minutes.'); app.exit(1); }, 10 * 60 * 1000);
      const feed = 'https://github.com/dowsy456/chat-app-desktop/releases/latest/download/native-update.json';
      const fetchImpl = createElectronUpdateFetch(net);
      for (const currentVersion of ['1.7.7', '1.7.8']) {
        const live = createNativeUpdater({ currentVersion, userData: root, fetchImpl });
        const state = await live.check(feed);
        assert.equal(state.status, 'idle'); assert.equal(state.available, false); assert.equal(state.error, '');
      }
      const download = createNativeUpdater({ currentVersion: '1.7.6', portablePath: path.join(root, 'Chat App.exe'), userData: path.join(root, 'public-download'), fetchImpl });
      assert.equal((await download.check(feed)).version, '1.7.7');
      assert.equal((await download.download()).status, 'ready');
      console.log('PASS live GitHub: preserved publisher key verifies feed1.7.7; installed1.7.7/1.7.8 stay idle; native1.7.7 full EXE download verifies size, SHA-256 and AMD64.');
    }
    completed = true;
  } catch (error) {
    console.error('Network regression failed:', error);
    throw error;
  } finally {
    clearTimeout(deadline);
    if (httpsServer) { httpsServer.closeAllConnections(); await new Promise(resolve => httpsServer.close(resolve)); }
    if (httpServer) { httpServer.closeAllConnections(); await new Promise(resolve => httpServer.close(resolve)); }
    if (completed) app.exit(0);
  }
}
run().catch(error => {
  console.error(error);
  if (process.versions.electron) require('electron').app.exit(1);
  else process.exitCode = 1;
});
