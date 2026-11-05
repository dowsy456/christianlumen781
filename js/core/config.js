/* core/config: methods register before ordered initialization. */
(function (App) {
  "use strict";

App.FILE_UPLOAD_LIMIT_DEFAULT_MB = 100;
App.FILE_UPLOAD_LIMIT_PATH = "admin/fileUploadLimitMB";
App.parseFileUploadLimitMB = function (value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const text = String(value).trim();
  if (!/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
  const megabytes = Number(text);
  const bytes = Math.floor(megabytes * 1024 * 1024);
  return Number.isFinite(megabytes) && megabytes > 0 && Number.isSafeInteger(bytes) && bytes >= 1 ? megabytes : null;
};
App.normalizeFileUploadLimitMB = function (value) {
  return App.parseFileUploadLimitMB(value) ?? App.FILE_UPLOAD_LIMIT_DEFAULT_MB;
};
App.applyFileUploadLimitMB = function (value) {
  const megabytes = App.normalizeFileUploadLimitMB(value);
  App.fileUploadLimitMB = megabytes;
  App.CHAT_FILE_MAX_BYTES = Math.floor(megabytes * 1024 * 1024);
  App.CHAT_FILE_MAX_LABEL = `${megabytes} MB`;
  App.syncFileUploadLimitInput?.();
  return megabytes;
};
App.applyFileUploadLimitMB(App.FILE_UPLOAD_LIMIT_DEFAULT_MB);
App.startFileUploadLimitListener = function () {
  if (App.fileUploadLimitListener || !App.db) return;
  App.fileUploadLimitLoaded = false;
  App.fileUploadLimitError = "";
  let resolveReady, rejectReady;
  App.fileUploadLimitReady = new Promise((resolve, reject) => {
    resolveReady = resolve; rejectReady = reject;
  });
  // The listener starts before anyone uploads. Retain the failure for callers
  // without producing an unhandled rejection while the app is idle.
  App.fileUploadLimitReady.catch(() => {});
  const listener = { ref: null, cb: null };
  App.fileUploadLimitListener = listener;
  listener.cb = snapshot => {
    if (App.fileUploadLimitListener !== listener) return;
    App.fileUploadLimitLoaded = true;
    App.fileUploadLimitError = "";
    resolveReady(App.applyFileUploadLimitMB(snapshot.val()));
  };
  const cancelled = error => {
    if (App.fileUploadLimitListener !== listener) return;
    // Firebase cancels a denied subscription. A panel reopen or the next
    // upload can subscribe again after permissions/connectivity recover.
    App.fileUploadLimitListener = null;
    App.fileUploadLimitLoaded = false;
    App.fileUploadLimitError = error?.message || "Could not load the File Upload Limit.";
    rejectReady(new Error(App.fileUploadLimitError));
    App.syncFileUploadLimitInput?.();
  };
  App.syncFileUploadLimitInput?.();
  try {
    listener.ref = App.db.ref(App.FILE_UPLOAD_LIMIT_PATH);
    listener.ref.on("value", listener.cb, cancelled);
  } catch (error) { cancelled(error); }
};
App.ensureFileUploadLimitLoaded = async function () {
  App.startFileUploadLimitListener();
  if (App.fileUploadLimitError) throw new Error(App.fileUploadLimitError);
  if (App.fileUploadLimitLoaded) return App.fileUploadLimitMB;
  if (!App.fileUploadLimitReady) throw new Error("The File Upload Limit is still loading. Please try again.");
  return App.fileUploadLimitReady;
};
App.setFileUploadLimitMB = async function (value) {
  if (!App.isVinny?.()) throw new Error("Only Vinny can change the File Upload Limit.");
  if (!App.fileUploadLimitLoaded || App.fileUploadLimitError) throw new Error(App.fileUploadLimitError || "The File Upload Limit is still loading. Please try again.");
  const megabytes = App.parseFileUploadLimitMB(value);
  if (megabytes === null) throw new Error("Enter a positive file size in MB.");
  await App.db.ref(App.FILE_UPLOAD_LIMIT_PATH).set(megabytes);
};

// Native releases and GitHub web revisions are independent. Bump this only
// when publishing a new EXE; the Admin Panel saves it alongside the URL.
App.NATIVE_RELEASE_VERSION = "1.7.8";
App.NATIVE_UPDATE_PATH = "admin/desktopUpdate";
App.NATIVE_UPDATE_CACHE = "chatapp_native_update_policy_v2";
App.isNativeDesktop = function () {
  return globalThis.location?.protocol === "chatapp:" || !!globalThis.chatDesktopPreferences || !!globalThis.chatDesktopGames;
};
App.compareNativeVersions = function (left, right) {
  const parts = value => /^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(String(value || "")) ? String(value).split(".").map(Number) : [0, 0, 0];
  const a = parts(left), b = parts(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
};
App.getInstalledNativeVersion = function () {
  const value = App.nativeBuildInfo?.nativeVersion || globalThis.chatDesktopBuild?.nativeVersion;
  return /^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(String(value || "")) && value !== "0.0.0" ? String(value) : null;
};
App.supportsNativeUpdates = function () {
  return globalThis.chatDesktopBuild?.nativeUpdates === true && typeof globalThis.chatDesktopBuild.configureNativeUpdate === "function";
};
App.normalizeNativeUpdateURL = function (value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length > 4096) throw new Error("The Update URL is too long.");
  let url;
  try { url = new URL(text); } catch { throw new Error("Enter a valid HTTPS download URL."); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) throw new Error("Enter a valid HTTPS download URL without a username or password.");
  return text;
};
App.normalizeNativeUpdateManifestURL = function (value) {
  const text = App.normalizeNativeUpdateURL(value);
  if (text && new URL(text).hash) throw new Error("Enter an HTTPS manifest URL without a # fragment.");
  return text;
};
App.normalizeNativeUpdatePolicy = function (value) {
  if (!value || typeof value !== "object") return null;
  const policy = {};
  try {
    const url = App.normalizeNativeUpdateURL(value.url);
    if (url && /^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(String(value.minimumVersion || ""))) {
      policy.url = url; policy.minimumVersion = String(value.minimumVersion);
    }
  } catch {}
  try {
    const manifestUrl = App.normalizeNativeUpdateManifestURL(value.manifestUrl);
    if (manifestUrl) policy.manifestUrl = manifestUrl;
  } catch {}
  return Object.keys(policy).length ? policy : null;
};
App.needsNativeUpdate = function (policy = App.nativeUpdatePolicy) {
  const clean = App.normalizeNativeUpdatePolicy(policy);
  const installed = App.getInstalledNativeVersion();
  // An absent/late bridge is unknown, not version zero. Only native binary
  // identity can require replacing an EXE; web/GitHub revisions never can.
  // In-app update capable binaries use signed manifests through the titlebar
  // icon. Version 1.7.7 has a confirmed redirect bug in its native updater;
  // only that exact build may need the administrator's one-time repair link.
  // A manifest alone never forces migration, and unknown versions stay unknown.
  if (!App.isNativeDesktop() || !clean?.url) return false;
  if (App.supportsNativeUpdates() && installed !== '1.7.7') return false;
  if (installed) return App.compareNativeVersions(installed, clean.minimumVersion) < 0;
  // Verified 1.6.x preloads expose Preferences v1 without Build. From 1.7.0
  // onward Build is exposed synchronously BEFORE Preferences. This exact
  // legacy signature establishes an upper bound, not an invented version.
  const knownLegacy = !Object.prototype.hasOwnProperty.call(globalThis, 'chatDesktopBuild') && globalThis.chatDesktopPreferences?.version === 1;
  return knownLegacy && App.compareNativeVersions(clean.minimumVersion, '1.7.0') >= 0;
};
App.configureNativeUpdates = function () {
  if (!App.supportsNativeUpdates() || !App.nativeUpdatePolicyLoaded) return;
  const manifestUrl = App.nativeUpdatePolicy?.manifestUrl || "";
  if (App.nativeUpdateConfiguredURL === manifestUrl) return;
  App.nativeUpdateConfiguredURL = manifestUrl;
  // Native code owns signature verification, progress, and installation. The
  // web app provides only the administrator's manifest location, never an EXE.
  Promise.resolve().then(() => globalThis.chatDesktopBuild.configureNativeUpdate(manifestUrl)).then(accepted => {
    if (accepted === false) throw new Error("Native update configuration was not accepted.");
  }).catch(() => {
    if (App.nativeUpdateConfiguredURL === manifestUrl) delete App.nativeUpdateConfiguredURL;
  });
};
App.renderNativeUpdateGate = function () {
  const required = App.needsNativeUpdate();
  App.nativeUpdateRequired = required;
  document.documentElement.toggleAttribute("data-native-update-required", required);
  let gate = document.getElementById("native-update-gate");
  if (!required) {
    if (gate?.open) gate.close();
    return;
  }
  if (!gate) {
    gate = document.createElement("dialog");
    gate.id = "native-update-gate";
    gate.setAttribute("aria-labelledby", "native-update-title");
    gate.setAttribute("aria-describedby", "native-update-description");
    gate.setAttribute("closedby", "none");
    const content = document.createElement("section");
    const title = document.createElement("h1");
    const repairsUpdater = App.getInstalledNativeVersion() === '1.7.7';
    title.id = "native-update-title"; title.textContent = repairsUpdater ? "One-time updater repair" : "Update required";
    const description = document.createElement("p");
    description.id = "native-update-description"; description.textContent = repairsUpdater
      ? "Install this one-time Chat App update to repair native updates. After this, newer desktop versions install from the update icon inside the app."
      : "Download the latest Chat App to continue.";
    const link = document.createElement("a");
    link.id = "native-update-download"; link.target = "_blank"; link.rel = "noopener noreferrer";
    link.style.textDecoration = "none";
    link.addEventListener("click", async event => {
      const open = globalThis.chatDesktopBuild?.openUpdateAndQuit;
      if (!open) {
        // Older binaries have no exit bridge. Let their existing external-link
        // handler open the browser, and make their next Close actually quit.
        globalThis.chatDesktopPreferences?.setBackgroundRunning?.(false);
        if (App.accidentalCloseBeforeUnload) window.removeEventListener('beforeunload', App.accidentalCloseBeforeUnload);
        window.onbeforeunload = null;
        description.textContent = 'Your browser is opening the download. Close Chat App before opening the new EXE.';
        return;
      }
      event.preventDefault();
      if (link.dataset.opening === "1") return;
      link.dataset.opening = "1";
      try {
        if (!await open(App.nativeUpdatePolicy.url)) throw new Error("The download could not be opened. Try again.");
      } catch (error) {
        description.textContent = error?.message || "The download could not be opened. Try again.";
      } finally { delete link.dataset.opening; }
    });
    content.append(title, description, link); gate.append(content); document.body.append(gate);
    gate.addEventListener("cancel", event => event.preventDefault());
    gate.addEventListener("close", () => { if (App.nativeUpdateRequired && !gate.open) gate.showModal(); });
  }
  const link = gate.querySelector("a");
  link.href = App.nativeUpdatePolicy.url; link.textContent = App.nativeUpdatePolicy.url;
  // A modal dialog is in the browser's top layer, above the cloak's maximum
  // z-index. Exiting element fullscreen also keeps it above games and videos.
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  if (!gate.open) gate.showModal();
};
App.startNativeUpdateListener = function () {
  if (App.nativeUpdateListener || !App.db) return;
  if (App.isNativeDesktop()) {
    // Retain offline metadata, but never lock the app using an obsolete cached
    // policy before Firebase has supplied the current requirement.
    if (globalThis.chatDesktopBuild?.getInfo) void globalThis.chatDesktopBuild.getInfo().then(info => {
      App.nativeBuildInfo = info;
      if (App.nativeUpdatePolicyLoaded) { App.renderNativeUpdateGate(); App.configureNativeUpdates(); }
    }).catch(() => {});
  }
  if (!App.nativeUpdateKeysBound) {
    App.nativeUpdateKeysBound = true;
    // Capture before document hotkeys (including cloak and modal shortcuts).
    for (const name of ["keydown", "keyup", "keypress"]) window.addEventListener(name, event => {
      if (!App.nativeUpdateRequired) return;
      event.stopImmediatePropagation();
      if (event.key === "Escape") event.preventDefault();
    }, true);
    document.addEventListener("fullscreenchange", () => {
      if (App.nativeUpdateRequired && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    });
  }
  const ref = App.db.ref(App.NATIVE_UPDATE_PATH);
  const cb = snapshot => {
    App.nativeUpdatePolicy = App.normalizeNativeUpdatePolicy(snapshot.val());
    App.nativeUpdatePolicyLoaded = true; App.nativeUpdatePolicyError = "";
    if (App.isNativeDesktop()) {
      try {
        if (App.nativeUpdatePolicy) localStorage.setItem(App.NATIVE_UPDATE_CACHE, JSON.stringify({ nativeVersion: App.getInstalledNativeVersion(), policy: App.nativeUpdatePolicy }));
        else localStorage.removeItem(App.NATIVE_UPDATE_CACHE);
      } catch {}
      App.renderNativeUpdateGate();
      App.configureNativeUpdates();
    }
    const input = document.getElementById("panel-update-url");
    if (input && input.dataset.dirty !== "1") input.value = App.nativeUpdatePolicy?.url || "";
    const manifestInput = document.getElementById("panel-update-manifest-url");
    if (manifestInput && manifestInput.dataset.dirty !== "1") manifestInput.value = App.nativeUpdatePolicy?.manifestUrl || "";
  };
  App.nativeUpdateListener = { ref, cb };
  ref.on("value", cb, error => {
    App.nativeUpdatePolicyError = error?.message || "Could not load the Update URL.";
    for (const id of ["panel-update-status", "panel-update-manifest-status"]) {
      const status = document.getElementById(id);
      if (status) status.textContent = App.nativeUpdatePolicyError;
    }
  });
};
App.setNativeUpdateURL = async function (value) {
  if (!App.isVinny?.()) throw new Error("Only Vinny can change the Update URL.");
  if (!App.nativeUpdatePolicyLoaded) throw new Error("The Update URL is still loading. Please try again.");
  const url = App.normalizeNativeUpdateURL(value);
  // The download URL targets a native release, independent of web revisions.
  // Re-saving the same URL must not retroactively require a newly published
  // binary that is not yet available at that URL.
  await App.db.ref(App.NATIVE_UPDATE_PATH).transaction(current => {
    if (!App.isVinny?.()) return;
    const previous = App.normalizeNativeUpdatePolicy(current);
    const manifest = previous?.manifestUrl ? { manifestUrl: previous.manifestUrl } : {};
    if (!url) return Object.keys(manifest).length ? manifest : null;
    const minimumVersion = previous?.url === url ? previous.minimumVersion : App.NATIVE_RELEASE_VERSION;
    return { url, minimumVersion, ...manifest };
  }, undefined, false).then(result => {
    if (!result.committed) throw new Error("The Update URL could not be saved.");
  });
};
App.setNativeUpdateManifestURL = async function (value) {
  if (!App.isVinny?.()) throw new Error("Only Vinny can change the native update manifest URL.");
  if (!App.nativeUpdatePolicyLoaded) throw new Error("The native update settings are still loading. Please try again.");
  const manifestUrl = App.normalizeNativeUpdateManifestURL(value);
  await App.db.ref(App.NATIVE_UPDATE_PATH).transaction(current => {
    if (!App.isVinny?.()) return;
    const previous = App.normalizeNativeUpdatePolicy(current);
    const next = previous?.url ? { url: previous.url, minimumVersion: previous.minimumVersion } : {};
    if (manifestUrl) next.manifestUrl = manifestUrl;
    return Object.keys(next).length ? next : null;
  }, undefined, false).then(result => {
    if (!result.committed) throw new Error("The native update manifest URL could not be saved.");
  });
};

// Binary objects live outside RTDB. Only committed descriptors enter messages
// and HTML Hub. Legacy RTDB readers remain available in their feature modules.
App.assertExternalStorageConfigured = function () {
  const value = String(globalThis.CHAT_FILE_CONFIG?.endpoint || '').trim();
  let url;
  try { url = new URL(value); } catch {}
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('File storage needs setup: set CHAT_FILE_CONFIG.endpoint in call-config.js using the README instructions.');
  }
  return url.origin;
};
App.isExternalBlobDescriptor = function (record) {
  return !!record && record.provider === 'b2-worker-v1' &&
    /^(attachments|html)\/[A-Za-z0-9_/-]+$/.test(String(record.objectKey || '')) &&
    !String(record.objectKey).includes('//') && String(record.objectKey).length <= 400 &&
    Number.isSafeInteger(record.size) && record.size >= 0;
};
App.getExternalBlobURL = function (record) {
  if (!App.isExternalBlobDescriptor(record)) throw new Error('Invalid stored file reference.');
  return `${App.assertExternalStorageConfigured()}/objects/${record.objectKey}`;
};
App.createExternalFileError = function (status, result = {}, retryAfter = '') {
  if (!result || typeof result !== 'object') result = {};
  const code = /^[A-Za-z0-9_.-]{1,100}$/.test(String(result.code || '')) ? String(result.code) : '';
  const error = Object.assign(new Error(typeof result.error === 'string' && result.error ? result.error : `File storage returned ${status}. Check its quota and setup.`), { status });
  if (code) error.code = code;
  if (Number.isInteger(result.providerStatus)) error.providerStatus = result.providerStatus;
  if (result.retryable === false) error.retryable = false;
  if (typeof result.backupEligible === 'boolean') error.backupEligible = result.backupEligible;
  const suppliedDelay = retryAfter || result.retryAfter;
  const seconds = typeof suppliedDelay === 'number' || /^\d+(?:\.\d+)?$/.test(String(suppliedDelay || '')) ? Number(suppliedDelay) : (Date.parse(String(suppliedDelay || '')) - Date.now()) / 1000;
  if (Number.isFinite(seconds) && seconds > 0) error.retryAfter = Math.ceil(seconds);
  return error;
};
App.externalFileRequest = async function (route, body, signal) {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, {once:true});
  if (signal?.aborted) abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 120000);
  try {
    const response = await fetch(`${App.assertExternalStorageConfigured()}${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal:controller.signal, credentials: 'omit', cache: 'no-store'
    });
    let result;
    try { result = await response.json(); }
    catch (error) {
      if (controller.signal.aborted) throw error;
      throw Object.assign(new Error('File storage returned an incomplete response. Please retry.'), {transient:true});
    }
    if (!response.ok) throw App.createExternalFileError(response.status, result, response.headers?.get('Retry-After'));
    return result;
  } catch (error) {
    if (timedOut && !signal?.aborted) throw Object.assign(new Error('File storage did not respond in time. Please retry.'), {transient:true});
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    if (error?.status || error?.transient) throw error;
    throw Object.assign(new Error('File storage could not be reached. Check your connection and the Worker ALLOWED_ORIGINS setting for this app.'), { transient: true });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
};
// Retain this exported name for existing callers. Retries now cover web and APK too.
App.retryDesktopFileTransfer = async function (operation, signal, options = {}) {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw Object.assign(new Error('Upload cancelled.'), { name: 'AbortError' });
    try { return await operation(attempt); }
    catch (error) {
      const transient = error?.name === 'TypeError' || error?.transient === true ||
        [408, 429, 500, 502, 503, 504].includes(Number(error?.status));
      // Only backup finalization may wait for newly uploaded KV parts to
      // propagate. Daily caps never enter this longer, cancellable retry path.
      const backupConsistency = options.backupConsistency === true && error?.code === 'BACKUP_NOT_READY';
      // A provider cap will not recover in a few seconds. Retain the Worker's
      // terminal classification, even when an older proxy uses a 5xx status.
      if (!transient || error?.retryable === false || Number(error?.retryAfter) > (backupConsistency ? 60 : 30) || error?.name === 'AbortError' || signal?.aborted || attempt >= (backupConsistency ? 5 : 3)) throw error;
      await new Promise((resolve, reject) => {
        const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
        const timer = setTimeout(finish, Math.max(350 * 2 ** attempt, (Number(error?.retryAfter) || 0) * 1000));
        const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(Object.assign(new Error('Upload cancelled.'), { name: 'AbortError' })); };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
    }
  }
};
App.deleteExternalBlob = async function (record) {
  if (!App.isExternalBlobDescriptor(record)) return;
  await App.deleteExternalBlobPrefix(record.objectKey, { exact: true, objects:[{objectKey:record.objectKey,size:record.size}], objectKeys:[record.objectKey] });
  // A primary upload can finish writing just before its verification hits a
  // cap. Preserve its cleanup reference when the backup becomes the file.
  const prefix = record.objectKey.slice(0, record.objectKey.lastIndexOf('/') + 1);
  for (const objectKey of Array.isArray(record.cleanupObjectKeys) ? record.cleanupObjectKeys.slice(0, 4) : []) {
    if (typeof objectKey === 'string' && objectKey !== record.objectKey && objectKey.startsWith(prefix) && App.isExternalBlobDescriptor({provider:'b2-worker-v1',objectKey,size:0})) {
      await App.deleteExternalBlobPrefix(objectKey, { exact: true, objectKeys:[objectKey] });
    }
  }
};
App.deleteExternalBlobPrefix = async function (prefix, options = {}) {
  let cursor = null;
  do {
    const result = await App.retryDesktopFileTransfer(() => App.externalFileRequest('/delete', {
      prefix, exact: options.exact === true, keepPrefixes: options.keepPrefixes || [], cursor,
      ...(Array.isArray(options.objectKeys) ? {objectKeys:options.objectKeys} : {}),
      ...(Array.isArray(options.objects) ? {objects:options.objects.map(value => ({objectKey:value?.objectKey,size:value?.size}))} : {}),
      ...(options.backupOnly === true ? {backupOnly:true} : {})
    }));
    cursor = result.cursor || null;
  } while (cursor);
};
App.transferExternalPart = function (url, blob, contentType, signal, onProgress, relay = false) {
  const endpoint = App.assertExternalStorageConfigured();
  let parsed;
  try { parsed = new URL(url, endpoint); } catch {}
  if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      (relay ? parsed.origin !== endpoint || parsed.pathname !== '/transfer' : !/^s3\.[a-z0-9-]+\.backblazeb2\.com$/.test(parsed.hostname))) {
    return Promise.reject(new Error('File storage returned an invalid upload server.'));
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abortError = () => Object.assign(new Error('Upload cancelled.'), { name: 'AbortError' });
    const clean = () => signal?.removeEventListener('abort', abort);
    const abort = () => { xhr.abort(); clean(); reject(abortError()); };
    xhr.open(relay ? 'POST' : 'PUT', parsed.href, true);
    // The timeout applies to a bounded part, never the complete large file.
    xhr.timeout = 30 * 60 * 1000;
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(event.loaded); };
    xhr.onload = () => {
      clean();
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(blob.size);
        resolve(xhr.getResponseHeader?.('ETag') || '');
      } else {
        let detail = {};
        try { detail = JSON.parse(xhr.responseText); } catch {}
        if (!detail || typeof detail !== 'object') detail = {};
        if (!relay) {
          // Direct S3 failures are XML. Read only the error classification;
          // never display its signed request URL, request ID, or raw body.
          const xml = String(xhr.responseText || '').slice(0, 16384);
          const code = xml.match(/<Code>\s*([A-Za-z0-9_.-]{1,100})\s*<\/Code>/)?.[1] || String(detail.code || '');
          const providerMessage = xml.match(/<Message>([\s\S]*?)<\/Message>/)?.[1] || String(detail.message || '');
          const quota = /(?:cap|quota|limit)[_ -]?(?:exceeded|reached)|(?:exceeded|reached)[\s\S]{0,40}(?:cap|quota|limit)/i.test(code + ' ' + providerMessage);
          detail = {code, providerStatus:xhr.status, ...(quota ? {retryable:false, error:'B2 account usage limit reached. Check Backblaze Caps & Alerts.'} : {})};
        }
        if (!detail.error) detail.error = `Upload failed (${xhr.status}${detail.code ? '; ' + String(detail.code).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 100) : ''}). Check file-storage quota and permissions.`;
        reject(Object.assign(App.createExternalFileError(xhr.status, detail, xhr.getResponseHeader?.('Retry-After')), { transient: xhr.status === 0 }));
      }
    };
    xhr.onerror = () => { clean(); reject(Object.assign(new Error('Upload connection failed. Check your connection and file-storage CORS settings.'), { transient: true, cors: true })); };
    xhr.ontimeout = () => { clean(); reject(Object.assign(new Error('An upload part timed out. Please retry on a stronger connection.'), { transient: true })); };
    xhr.onabort = () => { clean(); reject(abortError()); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    xhr.send(blob);
  });
};
App.uploadExternalBlob = async function (blob, options = {}) {
  App.assertExternalStorageConfigured();
  await App.ensureFileUploadLimitLoaded();
  if (!blob || !Number.isSafeInteger(blob.size) || blob.size < 0 || blob.size > App.CHAT_FILE_MAX_BYTES) {
    throw new Error(`Each attachment must be ${App.CHAT_FILE_MAX_LABEL} or smaller.`);
  }
  if (!/^(attachments|html)\/[A-Za-z0-9_/-]+$/.test(String(options.path || '')) || String(options.path).includes('//')) throw new Error('Invalid upload location.');
  try {
    return await App.uploadExternalBlobAttempt(blob, options, false);
  } catch (primaryError) {
    const providerStatus = Number(primaryError?.providerStatus);
    const status = Number(primaryError?.status);
    const eligible = primaryError?.backupEligible === true || primaryError?.transient === true || primaryError?.name === 'TypeError' ||
      [408, 429, 500, 502, 503, 504].includes(status) || [401, 403, 408, 429, 500, 502, 503, 504].includes(providerStatus);
    if (options.signal?.aborted || primaryError?.name === 'AbortError' || primaryError?.code === 'UPLOAD_ABORTED' || primaryError?.backupEligible === false || !eligible) throw primaryError;
    try { options.onProgress?.(0); } catch {}
    try {
      const descriptor = await App.uploadExternalBlobAttempt(blob, options, true);
      if (primaryError?.cleanupObjectKey) descriptor.cleanupObjectKeys = [primaryError.cleanupObjectKey];
      return descriptor;
    } catch (backupError) {
      const cleanupObjects = [...(Array.isArray(primaryError?.cleanupObjects) ? primaryError.cleanupObjects : []), ...(Array.isArray(backupError?.cleanupObjects) ? backupError.cleanupObjects : [])];
      if (options.signal?.aborted || backupError?.name === 'AbortError' || backupError?.code === 'UPLOAD_ABORTED') {
        if (cleanupObjects.length && backupError && typeof backupError === 'object') backupError.cleanupObjects = cleanupObjects;
        throw backupError;
      }
      const error = new Error(`${primaryError?.message || 'Primary file storage is unavailable.'} Free backup: ${backupError?.message || 'unavailable; retry later or clear unneeded files.'}`);
      error.code = 'FILE_STORAGE_UNAVAILABLE';
      error.retryable = false;
      error.primaryCode = primaryError?.code || '';
      error.backupCode = backupError?.code || '';
      if (cleanupObjects.length) error.cleanupObjects = cleanupObjects;
      throw error;
    }
  }
};
App.uploadExternalBlobAttempt = async function (blob, options, fallback) {
  const signal = options.signal;
  const request = (route, body, requestSignal = signal) => App.retryDesktopFileTransfer(() => App.externalFileRequest(route, body, requestSignal), requestSignal, {backupConsistency:fallback && route === '/complete'});
  const plan = await request('/sign', {path:options.path, size:blob.size, mimeType:blob.type || 'application/octet-stream', multipart:true,...(fallback ? {fallback:true} : {})});
  if (fallback && plan.storageBackend !== 'kv') throw new Error('The independent free backup is not configured. Update the storage Worker and its FILE_BACKUP binding.');
  const descriptor = {provider:'b2-worker-v1', objectKey:plan.objectKey, size:blob.size, mimeType:blob.type || 'application/octet-stream'};
  if (!App.isExternalBlobDescriptor(descriptor)) throw new Error('File storage returned an invalid upload location.');
  descriptor.downloadURL = App.getExternalBlobURL(descriptor);
  const contentType = /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(plan.contentType || '') ? plan.contentType : 'application/octet-stream';
  const progress = [];
  const report = (index, loaded) => {
    progress[index] = loaded;
    // Completion, not the browser sending its last byte, advances to 100%.
    try { options.onProgress?.(Math.min(0.99, progress.reduce((a, b) => a + (b || 0), 0) / Math.max(1, blob.size))); } catch {}
  };
  let relayOnly = plan.relayOnly === true;
  let transferSignal = signal;
  const transfer = async (partPlan, part, index) => {
    if (relayOnly || partPlan.relayOnly === true) {
      if (!partPlan.relayURL) throw new Error('File storage returned an invalid backup upload location.');
      return App.transferExternalPart(partPlan.relayURL, part, contentType, transferSignal, bytes => report(index, bytes), true);
    }
    try {
      const etag = await App.transferExternalPart(partPlan.uploadURL, part, contentType, transferSignal, bytes => report(index, bytes));
      if (plan.uploadId && !etag) throw Object.assign(new Error('B2 CORS must expose ETag for multipart uploads.'), {cors:true});
      return etag;
    } catch (error) {
      if (!error?.cors || !partPlan.relayURL || transferSignal?.aborted) throw error;
      relayOnly = true;
      return App.transferExternalPart(partPlan.relayURL, part, contentType, transferSignal, bytes => report(index, bytes), true);
    }
  };
  try {
    if (plan.uploadId) {
      if (!plan.ticket || !Number.isSafeInteger(plan.partSize) || plan.partSize < 5 * 1024 * 1024 || typeof blob.slice !== 'function') throw new Error('File storage returned an invalid multipart plan.');
      const count = plan.storageBackend === 'kv' ? Math.max(1, Math.ceil(blob.size / plan.partSize)) : Math.ceil(blob.size / plan.partSize);
      if (count > 10000 || count < 1) throw new Error('File storage returned an invalid part count.');
      const parts = new Array(count);
      const groupController = new AbortController();
      const abortGroup = () => groupController.abort();
      transferSignal = groupController.signal;
      signal?.addEventListener('abort', abortGroup, {once:true});
      if (signal?.aborted) abortGroup();
      let next = 0, failure = null;
      const upload = async () => {
        while (!failure && next < count) {
          const index = next++, part = blob.slice(index * plan.partSize, Math.min(blob.size, (index + 1) * plan.partSize));
          try {
            const etag = await App.retryDesktopFileTransfer(async () => {
              const partPlan = await request('/part-sign', {ticket:plan.ticket, partNumber:index + 1}, transferSignal);
              return transfer(partPlan, part, index);
            }, transferSignal);
            if (!etag) throw new Error('File storage did not return an upload receipt. Check the Worker version and B2 CORS.');
            parts[index] = {partNumber:index + 1, etag};
          } catch (error) { failure ||= error; abortGroup(); }
        }
      };
      try { await Promise.all(Array.from({length:Math.min(3, count)}, upload)); }
      finally { signal?.removeEventListener('abort', abortGroup); }
      if (failure) throw failure;
      await request('/complete', {objectKey:descriptor.objectKey, size:blob.size, ticket:plan.ticket, parts});
    } else {
      // Older Workers remain compatible while the new Worker is deployed.
      await App.retryDesktopFileTransfer(() => transfer(plan, blob, 0), signal);
      await request('/complete', {objectKey:descriptor.objectKey, size:blob.size, ticket:plan.ticket});
    }
    try { options.onProgress?.(1); } catch {}
    return descriptor;
  } catch (error) {
    if (plan.uploadId && plan.ticket) {
      try { await request('/abort', {ticket:plan.ticket}, null); } catch {}
    }
    try { await App.deleteExternalBlob(descriptor); }
    catch {
      if (error && typeof error === 'object') {
        error.cleanupObjectKey = descriptor.objectKey;
        error.cleanupObjects = [{provider:descriptor.provider,objectKey:descriptor.objectKey,size:descriptor.size}];
      }
    }
    throw error;
  }
};


App.register("core/config", function initializeFeature() {
App.DATABASE_SCHEMA_VERSION = 6;
App.firebaseConfig = Object.freeze({
  apiKey: "AIzaSyDDoTlac99Bhlki-aPJtzcSpQeb8KLbguQ",
  authDomain: "chatappv6-e9da9.firebaseapp.com",
  databaseURL: "https://chatappv6-e9da9-default-rtdb.firebaseio.com",
  projectId: "chatappv6-e9da9",
  storageBucket: "chatappv6-e9da9.firebasestorage.app",
  messagingSenderId: "355141406495",
  appId: "1:355141406495:web:78d50a2fca39eae1fb6a2a",
  measurementId: "G-BHWJP24Q2B"
});
App.firebase = globalThis.firebase || null;
if (!App.firebase?.initializeApp || !App.firebase?.database) {
  throw new Error("Firebase failed to load before app.js. Make sure firebase-app-compat.js and firebase-database-compat.js are loaded first.");
}
if (!App.firebase.apps.length) {
  App.firebase.initializeApp(App.firebaseConfig);
}
App.db = App.firebase.database();
App.startFileUploadLimitListener();
App.startNativeUpdateListener();
});
})(globalThis.ChatApp);
