'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
const applySource = source.slice(source.indexOf('async function applyPendingUpdate()'), source.indexOf('async function boot()'));
function fixture(state = {}, draft = '') {
  const loaded = [], notices = [], nativeEvents = [];
  const renderer = vm.createContext({ ChatApp:state, document:{querySelector:() => ({value:draft})} }); renderer.window = renderer;
  const context = vm.createContext({ pendingCandidate:{dir:'new'}, currentCandidate:{dir:'old'}, booting:false, mainWindow:{},
    nativeUpdateState:{available:false}, nativeManifestURL:'', updateFailure:'', publishUpdateState:()=>{}, checkNativeUpdate:async()=>{},
    nativeUpdater:{download:async()=>nativeEvents.push('download'), install:async()=>{nativeEvents.push('install');return{ready:true};}},
    stageForRestart:async()=>nativeEvents.push('stage-web'),
    app:{quit:()=>nativeEvents.push('quit'),getVersion:()=> '1.7.8'}, quitting:false, quittingForUpdate:false, backgroundRunning:true,
    appView:{webContents:{isDestroyed:() => false, executeJavaScript: async text => vm.runInContext(text,renderer)}},
    loadCandidate:async candidate => loaded.push(candidate.dir), dialog:{showMessageBox:async (_win, value) => notices.push(value)}, writeLog:() => {} });
  vm.runInContext(applySource,context);
  return {context,loaded,notices,nativeEvents};
}
test('update protects active and paused recordings, unsent preview audio, calls, drafts and queued sends', async () => {
  for (const state of [{voiceRecorder:{state:'recording'}},{voiceRecorder:{state:'paused'}},{voicePreviewBlob:{}},{voiceRecorderStream:{}},{currentCallRoomId:'room'},{pendingSendCount:1},{pendingPoll:{question:'Unsent poll'}},{activeFirebaseUploads:new Map([['one',{}]])},{pendingFiles:[{}]}]) {
    const h = fixture(state); await h.context.applyPendingUpdate(); assert.equal(h.loaded.length,0); assert.equal(h.notices.length,1); assert.equal(h.context.booting,false);
  }
  const draft = fixture({},'unsent text'); await draft.context.applyPendingUpdate(); assert.equal(draft.loaded.length,0);
  const ready = fixture(); await ready.context.applyPendingUpdate(); assert.deepEqual(ready.loaded,['new']);
});
test('rapid update clicks perform only one renderer replacement while its busy check is pending', async () => {
  const h = fixture(); let release;
  let firstCheck=true;
  h.context.appView.webContents.executeJavaScript = () => { if(!firstCheck)return Promise.resolve(false);firstCheck=false;return new Promise(resolve => {release=resolve;}); };
  const first = h.context.applyPendingUpdate(), second = h.context.applyPendingUpdate();
  assert.equal(h.context.booting,true); release(false); await Promise.all([first,second]);
  assert.deepEqual(h.loaded,['new']); assert.equal(h.context.booting,false);
});
test('one update action supports web-only, native-only and both without duplicate installs', async () => {
  for (const web of [false,true]) {
    const h=fixture(); h.context.nativeUpdateState={available:true};
    if (!web) h.context.pendingCandidate=null;
    await h.context.applyPendingUpdate();
    assert.deepEqual(h.nativeEvents,web?['download','stage-web','install','quit']:['download','install','quit']);
    assert.deepEqual(h.loaded,[],'pending web code runs after restart under the new native host');
    assert.equal(h.context.quittingForUpdate,true);
    assert.equal(h.context.backgroundRunning,false);
  }
});
test('native download rechecks unsaved work before replacing either app version', async () => {
  const state={}, h=fixture(state); h.context.nativeUpdateState={available:true};
  h.context.nativeUpdater.download=async()=>{h.nativeEvents.push('download');state.pendingFiles=[{}];};
  await h.context.applyPendingUpdate();
  assert.deepEqual(h.nativeEvents,['download']); assert.deepEqual(h.loaded,[]);
  assert.equal(h.notices.length,1); assert.equal(h.context.quittingForUpdate,false);
});
test('download or helper readiness failure leaves the app open with a retryable error', async () => {
  for (const failed of ['download','install']) {
    const h=fixture(); h.context.nativeUpdateState={available:true};
    h.context.nativeUpdater[failed]=async()=>{throw Error('Expected update failure');};
    await h.context.applyPendingUpdate();
    assert.equal(h.nativeEvents.includes('quit'),false);
    assert.equal(h.context.updateFailure,'Expected update failure');
    assert.equal(h.context.booting,false);
    assert.equal(h.context.quittingForUpdate,false);
    if (failed === 'download') { assert.deepEqual(h.loaded,[]); assert.equal(h.context.pendingCandidate.dir,'new'); }
  }
});
test('the final helper commit guard catches work started during native staging', async () => {
  const state={}, h=fixture(state);h.context.pendingCandidate=null;h.context.nativeUpdateState={available:true};
  h.context.nativeUpdater.install=async options=>{state.currentCallRoomId='new-call';return {ready:await options.beforeCommit()};};
  await h.context.applyPendingUpdate();
  assert.deepEqual(h.nativeEvents,['download']);assert.equal(h.notices.length,1);assert.equal(h.context.quittingForUpdate,false);
});
test('a cancelled helper handoff never quits the app', async () => {
  const h=fixture();h.context.nativeUpdateState={available:true};h.context.nativeUpdater.install=async()=>({ready:false,cancelled:true});
  await h.context.applyPendingUpdate();assert.equal(h.nativeEvents.includes('quit'),false);assert.equal(h.context.quittingForUpdate,false);
});
test('native retry discovery still permits an available shared-web update', async () => {
  const h=fixture();h.context.nativeManifestURL='https://example.test/latest.json';
  h.context.checkNativeUpdate=async()=>h.nativeEvents.push('check');
  await h.context.applyPendingUpdate();assert.deepEqual(h.loaded,['new']);assert.deepEqual(h.nativeEvents,['check']);
});
test('explicit failed check explains the problem without treating a draft as an install request', async () => {
  const h=fixture({pendingFiles:[{}]});h.context.pendingCandidate=null;h.context.nativeManifestURL='https://example.test/feed';
  h.context.checkNativeUpdate=async()=>({status:'error',errorPhase:'check',error:'HTTP 404'});
  await h.context.applyPendingUpdate();
  assert.deepEqual(h.loaded,[]);assert.equal(h.notices.length,1);
  assert.equal(h.notices[0].message,'Could not check for updates');assert.match(h.notices[0].detail,/HTTP 404/);
});
test('explicit same-version retry confirms current native version and does not restart', async () => {
  const h=fixture();h.context.pendingCandidate=null;h.context.nativeManifestURL='https://example.test/feed';
  h.context.checkNativeUpdate=async()=>({status:'idle',available:false});
  await h.context.applyPendingUpdate();
  assert.equal(h.notices[0].message,'No new native update is available');assert.match(h.notices[0].detail,/1\.7\.8/);
  assert.deepEqual(h.nativeEvents,[]);assert.deepEqual(h.loaded,[]);
});
test('a failed latest check is retried even when an earlier verified candidate remains', async () => {
  const h=fixture();h.context.pendingCandidate=null;h.context.nativeManifestURL='https://example.test/feed';
  h.context.nativeUpdateState={available:true,status:'error',errorPhase:'check'};
  h.context.checkNativeUpdate=async()=>{h.nativeEvents.push('check');h.context.nativeUpdateState={available:false,status:'idle'};return h.context.nativeUpdateState;};
  await h.context.applyPendingUpdate();assert.deepEqual(h.nativeEvents,['check']);assert.equal(h.notices[0].message,'No new native update is available');
});
test('background discovery errors are returned without showing disruptive dialogs', async () => {
  const context=vm.createContext({nativeUpdater:{check:async()=>{throw Error('Offline server');}},nativeManifestURL:'https://example.test/feed',process:{env:{}},writeLog:()=>{}});
  vm.runInContext(source.slice(source.indexOf('async function checkNativeUpdate()'),source.indexOf('async function configureNativeUpdate(')),context);
  const result=await context.checkNativeUpdate();assert.equal(result.errorPhase,'check');assert.equal(result.error,'Offline server');
});
test('web-only refresh protects work started during a slow native discovery check', async () => {
  const state={},h=fixture(state);h.context.nativeManifestURL='https://example.test/latest.json';
  h.context.checkNativeUpdate=async()=>{state.pendingFiles=[{}];};
  await h.context.applyPendingUpdate();assert.deepEqual(h.loaded,[]);assert.equal(h.notices.length,1);
});
test('native policy clearing invalidates a slow request immediately and persists the last URL', async () => {
  const checked=[],writes=[];let finishFirst;
  const context=vm.createContext({captureCaller:event=>event.trusted, URL, nativeManifestURL:'',nativePersistedURL:'',nativeConfigGeneration:0,
    configuringNative:null,updateFailure:'',process:{env:{}},path,app:{getPath:()=>'/profile'},
    fsp:{writeFile:async(file,body)=>writes.push(JSON.parse(body).manifestUrl),rename:async()=>{}},writeLog:()=>{},publishUpdateState:()=>{},
    nativeUpdater:{check:url=>{checked.push(url);return url?new Promise(resolve=>{finishFirst=resolve;}):Promise.resolve();}}});
  vm.runInContext(source.slice(source.indexOf('async function configureNativeUpdate('),source.indexOf('async function checkForUpdate()')),context);
  assert.equal(await context.configureNativeUpdate({},'https://example.test/feed'),false);
  assert.equal(await context.configureNativeUpdate({trusted:true},'http://example.test/feed'),false);
  const first=context.configureNativeUpdate({trusted:true},'https://example.test/feed');
  const clear=context.configureNativeUpdate({trusted:true},'');
  assert.deepEqual(checked,['https://example.test/feed','']);
  await clear;finishFirst();await first;
  assert.equal(writes.at(-1),'');assert.equal(context.nativePersistedURL,'');
});
test('portable production packaging closes native debug entry points while retaining shared web updates', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')).build;
  assert.equal(config.asar, true);
  assert.deepEqual(config.win.target, [{ target: 'dir', arch: ['x64'] }]);
  assert.equal(config.portable.artifactName, 'Chat App.exe');
  const launcher = require('../scripts/benchmark-games.cjs').PORTABLE_SOURCE;
  assert.match(launcher, /Environment\.Is64BitProcess/);
  assert.match(launcher, /ZipArchive\(payload, ZipArchiveMode.Read\)/);
  assert.match(launcher, /UseShellExecute = false/);
  assert.doesNotMatch(launcher, /powershell|cmd\.exe|Process\.Start\([^s]|VirtualAlloc|CreateRemoteThread|ReadProcessMemory/i);
  assert.deepEqual(config.electronFuses, {
    runAsNode:false, enableNodeOptionsEnvironmentVariable:false, enableNodeCliInspectArguments:false,
    enableEmbeddedAsarIntegrityValidation:true, onlyLoadAppFromAsar:true
  });
  assert.ok(config.asarUnpack.includes('helpers/*.exe'), 'fixed native helpers remain executable without extracting JavaScript');
  assert.ok(config.extraResources.some(resource => resource.to === 'bundled-app'), 'shared web source keeps its normal external bundle and GitHub update path');
  assert.match(source, /createContentHandler\(\(\) => activeRoot, net\)/);
  const games = fs.readFileSync(path.join(__dirname, '../games.cjs'), 'utf8');
  assert.match(games, /node:worker_threads/);
  for (const entry of fs.readdirSync(path.join(__dirname, '..'))) {
    if (!entry.endsWith('.cjs')) continue;
    const runtime = fs.readFileSync(path.join(__dirname, '..', entry), 'utf8');
    assert.doesNotMatch(runtime, /(?:child_process\.fork|\bfork\s*\(|ELECTRON_RUN_AS_NODE|NODE_OPTIONS|--inspect(?:-brk)?)/, entry + ' must not depend on disabled production debug entry points');
    assert.doesNotMatch(runtime, /nodeIntegration:\s*true|contextIsolation:\s*false|sandbox:\s*false|webSecurity:\s*false/, entry + ' must retain sandboxed renderers');
  }
});
test('inspector-based native QA refuses shipping executables before loading Playwright', () => {
  const integration = fs.readFileSync(path.join(__dirname, 'release-native.electron.cjs'), 'utf8');
  for (const option of ['CHAT_APP_TEST_EXECUTABLE', 'CHAT_APP_TEST_EXE']) {
    assert.throws(() => vm.runInNewContext(integration, { process:{env:{[option]:'Chat App.exe'}} }), /Packaged Chat App must use an ordinary launch smoke check/);
  }
});
test('required native download opens HTTPS then exits without tray or unload prevention', async () => {
  const events = [], context = vm.createContext({ captureCaller: event => event.trusted, quittingForUpdate: false, quitting: false, backgroundRunning: true, URL,
    shell: { openExternal: async url => events.push(['open', url]) }, tray: { destroy: () => events.push(['tray']) },
    spotifyConnection: null, gameActivity: null, ringPopups: null, callOverlay: null, app: { exit: code => events.push(['exit', code]) } });
  vm.runInContext(source.slice(source.indexOf('async function openUpdateAndQuit('), source.indexOf('function fitContent()')), context);
  assert.equal(await context.openUpdateAndQuit({}, 'https://example.test/update'), false);
  assert.equal(await context.openUpdateAndQuit({ trusted: true }, 'file:///app.exe'), false);
  assert.deepEqual(events, []);
  await context.openUpdateAndQuit({ trusted: true }, 'https://example.test/update');
  assert.deepEqual(events, [['open', 'https://example.test/update'], ['tray'], ['exit', 0]]);
  assert.equal(context.backgroundRunning, false); assert.equal(context.quittingForUpdate, true);
});
