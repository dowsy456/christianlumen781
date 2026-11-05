'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { once } = require('node:events');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');
const execute = promisify(execFile);
const { createNativeUpdater, canonicalManifest, validateManifest, compareVersions, _test } = require('../native-updater.cjs');

const keys = crypto.generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fakePE() {
  const bytes = Buffer.alloc(256, 0);
  bytes.write('MZ'); bytes.writeUInt32LE(128, 60); bytes.writeUInt32LE(0x4550, 128); bytes.writeUInt16LE(0x8664, 132);
  return bytes;
}
function signed(fields = {}, bytes = fakePE(), privateKey = keys.privateKey) {
  const manifest = { schemaVersion: 1, version: '1.7.8', url: 'https://updates.example.test/Chat%20App.exe', sha256: hash(bytes), size: bytes.length, ...fields };
  manifest.signature = crypto.sign(null, Buffer.from(canonicalManifest(manifest)), privateKey).toString('base64');
  return manifest;
}
async function scratch(t) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const root = await fs.mkdtemp(path.join(temporaryRoot, 'chat-native-update-test-'));
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(temporaryRoot + path.sep));
    assert.ok(path.basename(root).startsWith('chat-native-update-test-'));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  });
  return root;
}
function setup(root, fetchImpl, options = {}) {
  return createNativeUpdater({ currentVersion: '1.7.7', portablePath: path.join(root, 'Chat App.exe'), userData: root, publicKey, fetchImpl, platform: 'win32', ...options });
}

test('signed manifests bind every executable field to the installed publisher key', () => {
  const value = signed();
  assert.equal(validateManifest(value, publicKey).version, '1.7.8');
  for (const patch of [{version:'1.8.0'}, {url:'https://another.example.test/app.exe'}, {sha256:'a'.repeat(64)}, {size:300}, {schemaVersion:2}, {signature:''}]) {
    assert.throws(() => validateManifest({...value,...patch}, publicKey));
  }
  const wrong = crypto.generateKeyPairSync('ed25519');
  assert.throws(() => validateManifest(signed({}, fakePE(), wrong.privateKey), publicKey), /signature/);
  assert.throws(() => validateManifest(value, ''), /signature/);
});

test('release validation rejects non-HTTPS, credentials, malformed versions and unbounded sizes', () => {
  for (const url of ['http://example.test/app.exe','file:///C:/app.exe','https://user:pass@example.test/app.exe','https://example.test/app.exe#download']) assert.throws(() => canonicalManifest({...signed(),url}));
  for (const version of ['1.7','01.7.8','1.7.8-beta','1.7.8.0','100000.0.0']) assert.throws(() => canonicalManifest({...signed(),version}));
  for (const size of [-1,0,1.5,NaN,Infinity,_test.MAX_EXE_BYTES+1,'256']) assert.throws(() => canonicalManifest({...signed(),size}));
  assert.equal(compareVersions('1.10.0','1.9.99'),1);
  assert.equal(compareVersions('1.7.7','1.7.7'),0);
  assert.equal(compareVersions('0.99.99','1.0.0'),-1);
});

test('every redirect must remain HTTPS before it is fetched', async () => {
  const calls = [];
  await assert.rejects(_test.responseHTTPS('https://example.test/feed', { signal: new AbortController().signal, fetchImpl:async url => {
    calls.push(url); return new Response(null, {status:302,headers:{location:'http://example.test/feed'}});
  }}), /HTTPS/);
  assert.deepEqual(calls, ['https://example.test/feed']);
  let count = 0;
  const response = await _test.responseHTTPS('https://example.test/feed', { fetchImpl:async () => ++count === 1 ? new Response(null, {status:302,headers:{location:'/latest.json'}}) : new Response('{}') });
  assert.equal(await response.text(),'{}'); assert.equal(count,2);
  await assert.rejects(_test.responseHTTPS('https://example.test/feed', {fetchImpl:async () => new Response('drive page',{headers:{'content-type':'text/html'}})}), /webpage/);
});

test('check offers only a newer signed release, never a same-version or downgrade', async t => {
  const root = await scratch(t);
  for (const version of ['1.7.6','1.7.7','1.7.8']) {
    const updater = setup(root, async () => new Response(JSON.stringify(signed({version}))));
    const state = await updater.check('https://example.test/native-update.json');
    assert.equal(state.available, version==='1.7.8');
    assert.equal(state.status, version==='1.7.8'?'available':'idle');
  }
});

test('check failures are distinct from installation failures and clear after a successful current-version check', async t => {
  const root = await scratch(t);
  let unavailable = true;
  const updater = setup(root, async () => {
    if (unavailable) throw new Error('temporary network failure');
    return new Response(JSON.stringify(signed({version:'1.7.7'})));
  });
  await assert.rejects(updater.check('https://example.test/native-update.json'), /network failure/);
  assert.equal(updater.getState().errorPhase, 'check');
  assert.equal(updater.getState().available, false);
  unavailable = false;
  const state = await updater.check('https://example.test/native-update.json');
  assert.equal(state.status, 'idle'); assert.equal(state.error, ''); assert.equal(state.errorPhase, '');
});

test('clearing or changing the source prevents an older in-flight response from reviving a release', async t => {
  const root = await scratch(t);
  let release;
  const updater = setup(root, async url => url.includes('/old') ? new Promise(resolve => {release=resolve;}) : new Response(JSON.stringify(signed({version:'1.8.0'}))));
  const old = updater.check('https://example.test/old');
  await updater.check('');
  release(new Response(JSON.stringify(signed()))); await old;
  assert.equal(updater.getState().available,false); assert.equal(updater.getState().status,'idle');
  const delayed = updater.check('https://example.test/old');
  await updater.check('https://example.test/new');
  release(new Response(JSON.stringify(signed()))); await delayed;
  assert.equal(updater.getState().version,'1.8.0');
});

test('download streams exact signed bytes, checks checksum/architecture and can reuse its verified staged file', async t => {
  const root = await scratch(t), bytes = fakePE(), manifest = signed({},bytes), states = [];
  let downloads = 0;
  const updater = setup(root, async url => url.endsWith('.json') ? new Response(JSON.stringify(manifest)) : (downloads++,new Response(bytes)), {onStatus:state => states.push(state)});
  await updater.check('https://example.test/native-update.json');
  await updater.download(); await updater.download();
  assert.equal(downloads,1); assert.equal(updater.getState().status,'ready');
  assert.equal(updater.getState().progress,100);
  assert.ok(states.some(s=>s.status==='downloading'));
  const folders = await fs.readdir(path.join(root,'native-updates'));
  const staged=path.join(root,'native-updates',folders[0],'update.exe');
  assert.deepEqual(await fs.readFile(staged),bytes);
  await fs.writeFile(staged,Buffer.alloc(bytes.length));
  await updater.download();
  assert.equal(downloads,2,'corrupted staging is fetched again rather than trapping every retry');
  assert.equal(updater.getState().status,'ready');
});

test('truncated, oversized, corrupted and wrong-architecture files never become installable', async t => {
  const root = await scratch(t), expected = fakePE();
  const corrupt = Buffer.from(expected); corrupt[200] = 1;
  const x86 = Buffer.from(expected); x86.writeUInt16LE(0x14c,132);
  for (const [data,manifest] of [[expected.subarray(1),signed()], [Buffer.concat([expected,Buffer.from('x')]),signed()], [corrupt,signed()], [x86,signed({},x86)]]) {
    const updater = setup(root, async url => url.endsWith('.json') ? new Response(JSON.stringify(manifest)) : new Response(data));
    await updater.check('https://example.test/native-update.json');
    await assert.rejects(updater.download(), /incomplete|size limit|integrity|64-bit/);
    assert.equal(updater.getState().status,'error');
    assert.equal(updater.getState().errorPhase,'download');
    await assert.rejects(updater.install(),/Download and verify/);
  }
});

test('duplicate downloads cannot start, and an edited policy cancels the active download', async t => {
  const root = await scratch(t);
  let started;
  const downloading = new Promise(resolve=>{started=resolve;});
  const updater = setup(root, async (url,{signal}) => {
    if (url.endsWith('.json')) return new Response(JSON.stringify(signed()));
    started();
    return new Promise((_resolve,reject) => signal.addEventListener('abort',()=>reject(new Error('aborted')), {once:true}));
  });
  await updater.check('https://example.test/native-update.json');
  const first = updater.download(); await downloading;
  await assert.rejects(updater.download(), /already in progress/);
  const clear = updater.check('');
  await assert.rejects(first,/aborted/); await clear;
  assert.equal(updater.getState().status,'idle'); assert.equal(updater.getState().available,false);
});

test('incomplete handshakes do not authorize application exit', async () => {
  let child;
  const spawnImpl = () => {
    child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.unref=()=>{};
    return child;
  };
  let resolved = false;
  const pending = _test.handoffToHelper({pid:1},{spawnImpl,helperPath:'fixed-helper.exe',timeout:2000}).then(value=>{resolved=true;return value;});
  child.stdout.write('READY\n');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(resolved,false);
  child.stdout.write('COMMITTED\n');
  assert.deepEqual(await pending,{ready:true});
});

test('install rechecks user activity and an edited policy after the helper is ready', async t => {
  const root=await scratch(t), original=fakePE(); await fs.writeFile(path.join(root,'Chat App.exe'),original);
  let child, written='', gate, gateStarted;
  const checking=new Promise(resolve=>{gateStarted=resolve;});
  const spawnImpl=()=>{
    child=new EventEmitter(); child.stdin=new PassThrough(); child.stdout=new PassThrough(); child.stderr=new PassThrough(); child.unref=()=>{};
    child.stdin.on('data',value=>{written+=value; if(written.includes('\n')&&!written.includes('COMMIT')) queueMicrotask(()=>child.stdout.write('READY\n'));});
    child.stdin.on('finish',()=>queueMicrotask(()=>child.emit('exit',0)));
    return child;
  };
  const updater=setup(root,async url=>url.endsWith('.json')?new Response(JSON.stringify(signed())):new Response(original),{spawnImpl});
  await updater.check('https://example.test/native-update.json'); await updater.download();
  const install=updater.install({beforeCommit:async()=>{gateStarted(); return new Promise(resolve=>{gate=resolve;});}});
  await checking;
  const clearing=updater.check('');
  gate(true);
  assert.deepEqual(await install,{ready:false,cancelled:true});
  await clearing;
  assert.doesNotMatch(written,/COMMIT/);
  assert.equal(updater.getState().available,false);
  assert.deepEqual(await fs.readFile(path.join(root,'Chat App.exe')),original);
});

test('declining the last activity check leaves the downloaded update ready for retry', async t => {
  const root=await scratch(t), original=fakePE(); await fs.writeFile(path.join(root,'Chat App.exe'),original);
  let written='';
  const spawnImpl=()=>{
    const child=new EventEmitter(); child.stdin=new PassThrough(); child.stdout=new PassThrough(); child.stderr=new PassThrough(); child.unref=()=>{};
    child.stdin.on('data',value=>{written+=value; queueMicrotask(()=>child.stdout.write('READY\n'));});
    child.stdin.on('finish',()=>queueMicrotask(()=>child.emit('exit',0)));
    return child;
  };
  const updater=setup(root,async url=>url.endsWith('.json')?new Response(JSON.stringify(signed())):new Response(original),{spawnImpl});
  await updater.check('https://example.test/native-update.json'); await updater.download();
  assert.deepEqual(await updater.install({beforeCommit:()=>false}),{ready:false,cancelled:true});
  assert.doesNotMatch(written,/COMMIT/);
  assert.equal(updater.getState().status,'ready'); assert.equal(updater.getState().available,true);
});

async function waitFor(predicate, timeout = 10000) {
  const deadline = Date.now()+timeout;
  while (Date.now()<deadline) {
    try { const result=await predicate(); if(result) return result; } catch {}
    await new Promise(resolve=>setTimeout(resolve,40));
  }
  throw new Error('Native helper integration condition timed out.');
}

test('compiled Windows helper verifies, atomically replaces, preserves recovery, and relaunches the same path', {skip:process.platform!=='win32',timeout:60000}, async t => {
  const root = await scratch(t);
  const helper = await require('../scripts/build-native-helper.cjs').buildNativeUpdater();
  const framework = path.join(process.env.SystemRoot||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319');
  const fixtureSource = path.join(root,'Fixture.cs');
  await fs.writeFile(fixtureSource, 'using System; using System.IO; using System.Reflection; class Fixture { static void Main() { File.WriteAllText(Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location), "launched.txt"), Assembly.GetExecutingAssembly().Location); } }');
  const fresh = path.join(root,'fresh.exe');
  await execute(path.join(framework,'csc.exe'),['/nologo','/target:winexe','/platform:x64','/out:'+fresh,fixtureSource],{windowsHide:true});
  const newBytes = await fs.readFile(fresh), oldBytes = fakePE();
  const target = path.join(root,'Chat App.exe');
  await fs.writeFile(target,oldBytes);
  const jobRoot = path.join(root,'native-updates','release-success'); await fs.mkdir(jobRoot,{recursive:true});
  const source = path.join(jobRoot,'update.exe'); await fs.writeFile(source,newBytes);
  const parent = spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
  t.after(()=>{ if(parent.exitCode===null) parent.kill(); });
  const result = await _test.handoffToHelper({schemaVersion:1,source,target,sha256:hash(newBytes),size:newBytes.length,version:'1.7.8',originalSha256:hash(oldBytes),pid:parent.pid},{helperPath:helper});
  assert.deepEqual(result,{ready:true});
  assert.deepEqual(await fs.readFile(target),oldBytes,'original remains intact until parent exits');
  parent.kill();
  await waitFor(async()=>JSON.parse(await fs.readFile(path.join(jobRoot,'result.json'),'utf8')).status==='installed');
  assert.deepEqual(await fs.readFile(target),newBytes);
  assert.deepEqual(await fs.readFile(path.join(jobRoot,'previous.exe')),oldBytes);
  assert.equal(await waitFor(()=>fs.readFile(path.join(root,'launched.txt'),'utf8')),target);
});

test('compiled helper aborts before replacement when handshake is cancelled or source verification fails', {skip:process.platform!=='win32',timeout:30000}, async t => {
  const root = await scratch(t), helper = path.resolve(__dirname,'../helpers/native-update-helper.exe');
  const target = path.join(root,'Chat App.exe'), original = fakePE(); await fs.writeFile(target,original);
  const parent = spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
  t.after(()=>{ if(parent.exitCode===null) parent.kill(); });
  for (const corrupt of [false,true]) {
    const jobRoot=path.join(root,'native-updates','release-'+String(corrupt)); await fs.mkdir(jobRoot,{recursive:true});
    const source=path.join(jobRoot,'update.exe'); await fs.writeFile(source,original);
    const child=spawn(helper,['--apply'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    const exit = once(child,'exit'); let stdout='', stderr='';
    child.stdout.on('data',value=>{stdout+=value; if(stdout.includes('READY\n')||stdout.includes('READY\r\n')) child.stdin.end();});
    child.stderr.on('data',value=>{stderr+=value;});
    child.stdin.write(JSON.stringify({schemaVersion:1,source,target,sha256:corrupt?'a'.repeat(64):hash(original),size:original.length,version:'1.7.8',originalSha256:hash(original),pid:parent.pid})+'\n');
    const [code]=await exit;
    assert.equal(code,corrupt?1:0,stderr);
    assert.deepEqual(await fs.readFile(target),original);
    assert.equal((await fs.readdir(root)).some(name=>name.startsWith('.chat-app-update-')),false);
    await assert.rejects(fs.access(path.join(jobRoot,'previous.exe')));
  }
});

test('compiled helper restores the exact original EXE when Windows cannot launch its replacement', {skip:process.platform!=='win32',timeout:60000}, async t => {
  const root=await scratch(t), helper=path.resolve(__dirname,'../helpers/native-update-helper.exe');
  const framework=path.join(process.env.SystemRoot||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319');
  const fixtureSource=path.join(root,'Original.cs');
  await fs.writeFile(fixtureSource,'using System; using System.IO; using System.Reflection; class Original { static void Main() { File.WriteAllText(Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location), "restored.txt"), "restored"); } }');
  const target=path.join(root,'Chat App.exe');
  await execute(path.join(framework,'csc.exe'),['/nologo','/target:winexe','/platform:x64','/out:'+target,fixtureSource],{windowsHide:true});
  const original=await fs.readFile(target), invalid=fakePE();
  const jobRoot=path.join(root,'native-updates','release-rollback'); await fs.mkdir(jobRoot,{recursive:true});
  const source=path.join(jobRoot,'update.exe'); await fs.writeFile(source,invalid);
  const parent=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
  let helperChild;
  t.after(()=>{if(parent.exitCode===null)parent.kill();if(helperChild?.exitCode===null)helperChild.kill();});
  const result=await _test.handoffToHelper({schemaVersion:1,source,target,sha256:hash(invalid),size:invalid.length,version:'1.7.8',originalSha256:hash(original),pid:parent.pid},{helperPath:helper,spawnImpl:(...args)=>(helperChild=spawn(...args))});
  assert.equal(result.ready,true); parent.kill();
  const receipt=await waitFor(async()=>JSON.parse(await fs.readFile(path.join(jobRoot,'result.json'),'utf8')));
  // Close only this test-owned helper's failure dialog after observing its
  // durable result. Production always leaves that explanation visible.
  helperChild.kill();
  assert.equal(receipt.status,'failed'); assert.match(receipt.message,/previous Chat App.exe was restored/);
  assert.deepEqual(await fs.readFile(target),original);
  assert.equal(await waitFor(()=>fs.readFile(path.join(root,'restored.txt'),'utf8')),'restored');
});
