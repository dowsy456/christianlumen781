'use strict';

// The shared web app can announce an HTTPS manifest, but only a release signed
// by the offline publisher key may become executable code. No renderer path or
// command is passed to the operating system.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const MAX_EXE_BYTES = 512 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024;
const VERSION = /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/;

function createElectronUpdateFetch(net) {
  if (typeof net?.request !== 'function') throw new Error('The native update network transport is unavailable.');
  // Electron net.fetch rejects redirect:'manual' with "Redirect was cancelled"
  // instead of returning the 3xx response expected by the Fetch API. Adapt the
  // documented ClientRequest redirect event into that response. responseHTTPS
  // then validates each destination before starting the next request, using
  // Chromium's normal proxy/certificate handling throughout.
  return function electronUpdateFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
      let request, controller, responseSettled = false, streamEnded = false;
      const signal = options.signal;
      const clean = () => signal?.removeEventListener('abort', aborted);
      function fail(error) {
        if (!responseSettled) { responseSettled = true; reject(error); }
        else if (controller && !streamEnded) { streamEnded = true; controller.error(error); }
        clean();
      }
      function aborted() {
        fail(signal?.reason instanceof Error ? signal.reason : new Error('The native update request was cancelled.'));
        request?.abort();
      }
      try {
        const current = httpsURL(url);
        if (signal?.aborted) { aborted(); return; }
        request = net.request({ method: 'GET', url: current, redirect: 'manual', cache: 'no-store' });
        for (const [name, value] of new Headers(options.headers || {})) request.setHeader(name, value);
        signal?.addEventListener('abort', aborted, { once: true });
        request.on('redirect', (statusCode, _method, redirectURL, responseHeaders) => {
          if (responseSettled) return;
          try {
            // Cancellation is intentional here: never follow a hop before the
            // caller has checked its scheme, credentials and redirect budget.
            const headers = new Headers(responseHeaders || {});
            headers.set('location', redirectURL);
            const response = new Response(null, { status: statusCode, headers });
            responseSettled = true; clean(); resolve(response);
            request.abort();
          } catch (error) { fail(error); request.abort(); }
        });
        request.on('response', incoming => {
          if (responseSettled) { request.abort(); return; }
          try {
            const headers = new Headers(incoming.headers || {});
            let received = 0;
            const maximum = Number.isSafeInteger(options.maxResponseBytes) && options.maxResponseBytes > 0 ? options.maxResponseBytes : MAX_EXE_BYTES;
            const body = new ReadableStream({
              start(stream) {
                controller = stream;
                // Electron requires end/error listeners before data listeners.
                incoming.on('end', () => { if (!streamEnded) { streamEnded = true; clean(); stream.close(); } });
                incoming.on('error', fail);
                incoming.on('aborted', () => fail(new Error('The native update download was interrupted.')));
                incoming.on('data', chunk => {
                  if (streamEnded) return;
                  received += chunk.length;
                  if (received > maximum) { fail(new Error('The native update exceeds its download size limit.')); request.abort(); return; }
                  stream.enqueue(new Uint8Array(chunk));
                });
              },
              cancel() { streamEnded = true; clean(); request.abort(); }
            });
            const response = new Response(body, { status: incoming.statusCode, statusText: incoming.statusMessage, headers });
            responseSettled = true; resolve(response);
          } catch (error) { fail(error); request.abort(); }
        });
        request.on('error', fail);
        request.on('abort', () => {
          if (!responseSettled || controller && !streamEnded) fail(new Error('The native update request was cancelled.'));
        });
        request.end();
      } catch (error) { fail(error); request?.abort(); }
    });
  };
}

function httpsURL(value) {
  if (typeof value !== 'string' || !value || value.length > 4096) throw new Error('Enter a valid HTTPS native update manifest URL.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a valid HTTPS native update manifest URL.'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash) throw new Error('Native updates require HTTPS without credentials or a fragment.');
  return url.href;
}

function canonicalManifest(value) {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1) throw new Error('The native update manifest has an unsupported format.');
  if (typeof value.version !== 'string' || !VERSION.test(value.version)) throw new Error('The native update version must use the format 1.2.3.');
  const url = httpsURL(value.url);
  if (url !== value.url) throw new Error('The native update download URL is not canonical.');
  if (!/^[a-f0-9]{64}$/.test(value.sha256 || '')) throw new Error('The native update manifest has no valid SHA-256 checksum.');
  if (!Number.isSafeInteger(value.size) || value.size <= 0 || value.size > MAX_EXE_BYTES) throw new Error('The native update has an invalid file size.');
  return JSON.stringify({ schemaVersion: 1, version: value.version, url, sha256: value.sha256, size: value.size });
}

function validateManifest(value, publicKey) {
  const payload = canonicalManifest(value);
  if (typeof value.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(value.signature)) throw new Error('The native update is not signed by its publisher.');
  let valid = false;
  try {
    const key = crypto.createPublicKey(publicKey);
    valid = key.asymmetricKeyType === 'ed25519' && crypto.verify(null, Buffer.from(payload, 'utf8'), key, Buffer.from(value.signature, 'base64'));
  } catch { /* The verifier fails closed if the packaged key is missing/broken. */ }
  if (!valid) throw new Error('The native update signature could not be verified.');
  return Object.freeze({ ...JSON.parse(payload), signature: value.signature });
}

function compareVersions(left, right) {
  if (!VERSION.test(left || '') || !VERSION.test(right || '')) throw new Error('The installed or available native version is invalid.');
  const a = left.split('.').map(Number), b = right.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  return 0;
}

async function responseHTTPS(url, { fetchImpl, signal, accept, maxBytes = MAX_EXE_BYTES }) {
  let current = httpsURL(url);
  // Check every redirect, not just the final response: an HTTPS-to-HTTP hop
  // must never be followed even if it redirects back to HTTPS afterwards.
  for (let count = 0; count <= 8; count++) {
    const response = await fetchImpl(current, { signal, redirect: 'manual', cache: 'no-store', maxResponseBytes: maxBytes, headers: { Accept: accept, 'Cache-Control': 'no-cache' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => {});
      if (!location) throw new Error('The update server returned an empty redirect.');
      current = httpsURL(new URL(location, current).href);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`The native update server returned HTTP ${response.status}.`);
    }
    if (response.url) httpsURL(response.url);
    if (/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type') || '')) {
      await response.body?.cancel().catch(() => {});
      throw new Error('The Update URL opens a webpage. Use the direct signed manifest URL, with a direct EXE URL inside it.');
    }
    return response;
  }
  throw new Error('The native update has too many redirects.');
}

async function readResponse(response, maximum, onChunk) {
  const length = Number(response.headers.get('content-length')) || 0;
  if (length > maximum) { await response.body?.cancel().catch(() => {}); throw new Error('The native update exceeds its download size limit.'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The native update server returned an empty response.');
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maximum) throw new Error('The native update exceeds its download size limit.');
      await onChunk(Buffer.from(value), received);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return received;
}

async function verifyExecutable(file, manifest) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== manifest.size) throw new Error('The downloaded EXE does not match the signed file size.');
  const handle = await fs.open(file, 'r');
  try {
    const header = Buffer.alloc(64);
    if ((await handle.read(header, 0, 64, 0)).bytesRead !== 64 || header.toString('ascii', 0, 2) !== 'MZ') throw new Error('The native update is not a Windows executable.');
    const offset = header.readUInt32LE(60), pe = Buffer.alloc(6);
    if (offset < 64 || offset > stat.size - 6 || (await handle.read(pe, 0, 6, offset)).bytesRead !== 6 || pe.readUInt32LE(0) !== 0x4550 || pe.readUInt16LE(4) !== 0x8664) throw new Error('The native update is not a 64-bit Windows executable.');
    const hash = crypto.createHash('sha256'), bytes = Buffer.alloc(256 * 1024);
    let position = 0, read;
    while ((read = (await handle.read(bytes, 0, bytes.length, position)).bytesRead)) { hash.update(bytes.subarray(0, read)); position += read; }
    if (hash.digest('hex') !== manifest.sha256) throw new Error('The downloaded native update failed its SHA-256 integrity check.');
  } finally { await handle.close(); }
}

async function fileHash(file) {
  const handle = await fs.open(file, 'r');
  try {
    const hash = crypto.createHash('sha256'), bytes = Buffer.alloc(256 * 1024);
    let position = 0, read;
    while ((read = (await handle.read(bytes, 0, bytes.length, position)).bytesRead)) { hash.update(bytes.subarray(0, read)); position += read; }
    return hash.digest('hex');
  } finally { await handle.close(); }
}

function helperLocation() {
  const unpacked = __dirname.replace(/([\\/])app\.asar(?=[\\/]|$)/i, '$1app.asar.unpacked');
  return path.join(unpacked, 'helpers', 'native-update-helper.exe');
}

function handoffToHelper(job, { spawnImpl = spawn, helperPath = helperLocation(), timeout = 60000, beforeCommit = () => true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(helperPath, ['--apply'], { windowsHide: true, detached: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let settled = false, output = '', errors = '', committing = false, preparing = false, cancelled = false;
    let timer = setTimeout(() => finish(new Error('The native update could not prepare its restart in time.')), timeout);
    function finish(error, result = { ready: true }) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) {
        // An uncommitted helper never modifies the original EXE. Closing stdin
        // tells it to remove its private staging files and exit.
        child.stdin?.end(); child.unref?.();
        reject(error);
      } else {
        child.stdout.destroy(); child.stderr.destroy(); child.unref();
        resolve(result);
      }
    }
    child.on('error', error => finish(new Error(`The native updater could not start: ${error.message}`)));
    child.on('exit', code => { if (!settled) cancelled && code === 0 ? finish(null, { ready: false, cancelled: true }) : finish(new Error(errors.trim() || `The native updater stopped before preparing the update (${code}).`)); });
    child.stdin.on('error', error => finish(new Error(`The native updater could not receive its release: ${error.message}`)));
    child.stdout.on('data', value => {
      output += value.toString('utf8');
      if (output.length > 16384) finish(new Error('The native updater returned an invalid response.'));
      else {
        const lines = output.split(/\r?\n/);
        if (!preparing && lines.includes('READY')) {
          preparing = true; clearTimeout(timer);
          Promise.resolve().then(beforeCommit).then(allowed => {
            if (settled) return;
            timer = setTimeout(() => finish(new Error('The native updater did not acknowledge its restart.')), timeout);
            if (allowed !== true) { cancelled = true; child.stdin.end(); return; }
            committing = true;
            // Do not resolve until the helper acknowledges receipt. Quitting
            // immediately after writing COMMIT could drop a buffered pipe write.
            child.stdin.end('COMMIT\n');
          }, finish);
        }
        if (committing && lines.includes('COMMITTED')) finish();
      }
    });
    child.stderr.on('data', value => { errors = (errors + value.toString('utf8')).slice(0, 16384); });
    child.stdin.write(`${JSON.stringify(job)}\n`);
  });
}

function createNativeUpdater({ currentVersion, portablePath = process.env.PORTABLE_EXECUTABLE_FILE || '', userData, fetchImpl = globalThis.fetch, onStatus, publicKey, helperPath, spawnImpl, platform = process.platform, pid = process.pid, requestTimeout = 30000, downloadTimeout = 10 * 60 * 1000 } = {}) {
  compareVersions(currentVersion, currentVersion);
  if (!userData || !path.isAbsolute(userData)) throw new Error('Native updates require an absolute private app data directory.');
  if (publicKey === undefined) {
    try { publicKey = require('./native-update-key.json').publicKey; } catch { publicKey = ''; }
  }
  const supported = platform === 'win32' && path.isAbsolute(portablePath) && /\.exe$/i.test(portablePath) && !/^\\\\/.test(portablePath);
  const cacheRoot = path.join(userData, 'native-updates');
  let candidate = null, staged = null, busy = null;
  let checkJob = null, checkController = null, checkGeneration = 0, sourceURL = '';
  let downloadController = null;
  let state = { supported, status: 'idle', available: false, version: '', currentVersion, progress: 0, error: '', errorPhase: '' };
  function publish(fields) {
    state = { ...state, ...fields, ...(fields.error === '' ? { errorPhase: '' } : {}) };
    try { onStatus?.({ ...state }); } catch { /* UI callbacks cannot interrupt verification. */ }
    return { ...state };
  }
  function fail(error, errorPhase) {
    publish({ status: 'error', available: !!candidate, error: error.message || String(error), errorPhase });
    throw error;
  }
  async function check(manifestURL) {
    const nextURL = manifestURL ? httpsURL(manifestURL) : '';
    if (checkJob && nextURL === sourceURL && !busy) return checkJob;
    const changed = nextURL !== sourceURL;
    if (busy) {
      if (!changed) return { ...state };
      // A policy edit invalidates an earlier request. Let an active download
      // unwind before applying the new policy; never silently drop that edit.
      sourceURL = nextURL;
      const generation = ++checkGeneration;
      checkController?.abort(); downloadController?.abort();
      await busy.catch(() => {});
      if (generation !== checkGeneration) return { ...state };
      candidate = null; staged = null;
      return check(nextURL);
    }
    sourceURL = nextURL;
    const generation = ++checkGeneration;
    checkController?.abort();
    if (changed) { candidate = null; staged = null; }
    if (!nextURL) { candidate = null; staged = null; return publish({ status: 'idle', available: false, version: '', progress: 0, error: '' }); }
    const operation = (async () => {
      publish({ status: 'checking', available: !!candidate, version: candidate?.version || '', error: '' });
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error('The native update check timed out.')), requestTimeout);
      checkController = controller;
      try {
        const response = await responseHTTPS(nextURL, { fetchImpl, signal: controller.signal, accept: 'application/json', maxBytes: MAX_MANIFEST_BYTES });
        const chunks = [];
        await readResponse(response, MAX_MANIFEST_BYTES, chunk => { chunks.push(chunk); });
        let manifest;
        try { manifest = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('The Update URL must return a signed JSON manifest, not a download page or EXE.'); }
        const verified = validateManifest(manifest, publicKey);
        if (generation !== checkGeneration) return { ...state };
        if (compareVersions(verified.version, currentVersion) <= 0) {
          candidate = null; staged = null;
          return publish({ status: 'idle', available: false, version: '', progress: 0, error: '' });
        }
        if (candidate?.sha256 !== verified.sha256 || candidate.version !== verified.version) staged = null;
        candidate = verified;
        return publish({ status: staged ? 'ready' : 'available', available: true, version: verified.version, progress: staged ? 100 : 0, error: '' });
      } catch (error) { if (generation !== checkGeneration) return { ...state }; return fail(error, 'check'); }
      finally { clearTimeout(timer); if (checkController === controller) checkController = null; }
    })();
    checkJob = operation;
    try { return await operation; } finally { if (checkJob === operation) checkJob = null; }
  }
  async function download() {
    if (busy) throw new Error('An update operation is already in progress.');
    if (checkJob) await checkJob;
    if (busy) throw new Error('An update operation is already in progress.');
    if (!supported) throw new Error('Open your portable Chat App.exe from a writable local folder to install native updates.');
    if (!candidate) throw new Error('There is no verified native update to download.');
    const release = candidate;
    const operation = (async () => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error('The native update download timed out. Please try again.')), downloadTimeout);
      downloadController = controller;
      let jobRoot;
      try {
        if (staged) {
          try { await verifyExecutable(staged, release); return publish({ status: 'ready', progress: 100, error: '' }); }
          catch { staged = null; /* A removed/corrupted cache must be downloaded again. */ }
        }
        publish({ status: 'downloading', progress: 0, error: '' });
        await fs.mkdir(cacheRoot, { recursive: true });
        if ((await fs.lstat(cacheRoot)).isSymbolicLink()) throw new Error('The native update cache cannot be a symbolic link.');
        jobRoot = await fs.mkdtemp(path.join(cacheRoot, 'release-'));
        const destination = path.join(jobRoot, 'update.exe');
        const response = await responseHTTPS(release.url, { fetchImpl, signal: controller.signal, accept: 'application/octet-stream', maxBytes: release.size });
        const file = await fs.open(destination, 'wx');
        try {
          const received = await readResponse(response, release.size, async (chunk, count) => {
            await file.writeFile(chunk);
            publish({ status: 'downloading', progress: Math.min(99, Math.floor(count * 100 / release.size)) });
          });
          if (received !== release.size) throw new Error('The native update download was incomplete. Please try again.');
          await file.sync();
        } finally { await file.close(); }
        await verifyExecutable(destination, release);
        staged = destination;
        return publish({ status: 'ready', progress: 100, error: '' });
      } catch (error) {
        if (jobRoot && path.dirname(jobRoot) === cacheRoot && path.basename(jobRoot).startsWith('release-')) await fs.rm(jobRoot, { recursive: true, force: true }).catch(() => {});
        return fail(error, 'download');
      } finally { clearTimeout(timer); if (downloadController === controller) downloadController = null; }
    })();
    busy = operation;
    try { return await operation; } finally { if (busy === operation) busy = null; }
  }
  async function install({ beforeCommit = () => true } = {}) {
    if (busy) throw new Error('An update operation is already in progress.');
    if (checkJob) await checkJob;
    if (busy) throw new Error('An update operation is already in progress.');
    if (!supported || !candidate || !staged) throw new Error('Download and verify the native update before restarting.');
    const release = candidate, stagedFile = staged, generation = checkGeneration;
    const operation = (async () => {
      try {
        try { await verifyExecutable(stagedFile, release); }
        catch (error) { if (staged === stagedFile) staged = null; throw error; }
        const target = path.resolve(portablePath), targetInfo = await fs.lstat(target);
        if (!targetInfo.isFile() || targetInfo.isSymbolicLink()) throw new Error('The original portable EXE is missing or is a symbolic link.');
        publish({ status: 'installing', error: '' });
        const result = await handoffToHelper({ schemaVersion: 1, source: stagedFile, target, sha256: release.sha256, size: release.size, version: release.version, originalSha256: await fileHash(target), pid }, { helperPath, spawnImpl, beforeCommit: async () => {
          if (generation !== checkGeneration || candidate !== release || staged !== stagedFile) return false;
          const allowed = await beforeCommit();
          return allowed === true && generation === checkGeneration && candidate === release && staged === stagedFile;
        } });
        if (!result.ready) publish({ status: 'ready', progress: 100, error: '' });
        return result;
      } catch (error) { return fail(error, 'install'); }
    })();
    busy = operation;
    try { return await operation; } finally { if (busy === operation) busy = null; }
  }
  return Object.freeze({ check, download, install, getState: () => ({ ...state }) });
}

module.exports = { createNativeUpdater, createElectronUpdateFetch, canonicalManifest, validateManifest, compareVersions,
  _test: { httpsURL, responseHTTPS, readResponse, verifyExecutable, handoffToHelper, fileHash, MAX_EXE_BYTES } };
