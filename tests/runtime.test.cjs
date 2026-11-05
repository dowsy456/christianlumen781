const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');

function nativeUpdateModel(globals={}) {
 const app={register(){}};
 vm.runInNewContext(read('js/core/config.js'),{ChatApp:app,URL,AbortController,setTimeout,clearTimeout,...globals});
 return app;
}

test('all platforms retry transient file failures and stop on cancellation', async () => {
 const app = nativeUpdateModel({chatDesktopRings:{version:1}, setTimeout, clearTimeout});
 let attempts=0;
 assert.equal(await app.retryDesktopFileTransfer(async()=>{if(++attempts<3)throw Object.assign(new Error('network'),{transient:true}); return 'stored';}), 'stored');
 assert.equal(attempts,3);
 attempts=0;
 await assert.rejects(app.retryDesktopFileTransfer(async()=>{attempts++;throw Object.assign(new Error('forbidden'),{status:403});}),/forbidden/);
 assert.equal(attempts,1);
 const web = nativeUpdateModel(); attempts=0;
 await assert.rejects(web.retryDesktopFileTransfer(async()=>{attempts++;throw Object.assign(new Error('network'),{transient:true});}),/network/);
 assert.equal(attempts,4);
 const controller = new AbortController(); attempts=0;
 const cancelled = app.retryDesktopFileTransfer(async()=>{attempts++;throw Object.assign(new Error('network'),{transient:true});},controller.signal);
 controller.abort(); await assert.rejects(cancelled, error=>error.name==='AbortError' || controller.signal.aborted);
 assert.equal(attempts,1);
});

test('storage quota responses preserve provider details and never retry terminal caps', async () => {
 let requests=0;
 const app=nativeUpdateModel({CHAT_FILE_CONFIG:{endpoint:'https://files.example'},fetch:async()=>{
  requests++;
  return new Response(JSON.stringify({error:'B2 daily transaction cap reached. Check Backblaze Caps & Alerts.',code:'transaction_cap_exceeded',providerStatus:403,retryable:false,retryAfter:3600}),{status:502,headers:{'Retry-After':'7200'}});
 }});
 await assert.rejects(app.retryDesktopFileTransfer(()=>app.externalFileRequest('/sign',{})), error=>{
  assert.equal(error.message,'B2 daily transaction cap reached. Check Backblaze Caps & Alerts.');
  assert.equal(error.code,'transaction_cap_exceeded');assert.equal(error.providerStatus,403);
  assert.equal(error.status,502);assert.equal(error.retryable,false);assert.equal(error.retryAfter,7200);
  return true;
 });
 assert.equal(requests,1,'terminal provider caps must not cause repeated upstream requests');
});

test('transient storage retries respect Retry-After and surface long provider waits immediately', async () => {
 const delays=[];
 const app=nativeUpdateModel({setTimeout:(fn,ms)=>{delays.push(ms);return setTimeout(fn,0);},clearTimeout});
 let requests=0;
 const result=await app.retryDesktopFileTransfer(async()=>{
  if(++requests===1)throw app.createExternalFileError(429,{error:'Please retry.',retryAfter:2});
  return 'stored';
 });
 assert.equal(result,'stored');assert.equal(requests,2);assert.deepEqual(delays,[2000]);
 requests=0;
 await assert.rejects(app.retryDesktopFileTransfer(async()=>{
  requests++;throw app.createExternalFileError(429,{error:'Provider daily limit reached.'},'3600');
 }),error=>error.retryAfter===3600);
 assert.equal(requests,1,'long retry periods must not hold the upload open or retry prematurely');
 assert.equal(app.createExternalFileError(503,{},'invalid').retryAfter,undefined);
 assert.ok(app.createExternalFileError(503,{},new Date(Date.now()+5000).toUTCString()).retryAfter>=4);
});

test('only backup completion waits through KV propagation and its wait remains cancellable',async()=>{
 const delays=[],app=nativeUpdateModel({setTimeout:(fn,ms)=>{delays.push(ms);return setTimeout(fn,0);},clearTimeout});
 let attempts=0;
 assert.equal(await app.retryDesktopFileTransfer(async()=>{
  if(++attempts<=4)throw app.createExternalFileError(503,{error:'Backup is becoming available.',code:'BACKUP_NOT_READY',retryAfter:60});
  return 'complete';
 },null,{backupConsistency:true}),'complete');
 assert.equal(attempts,5);assert.deepEqual(delays,[60000,60000,60000,60000]);
 attempts=0;
 await assert.rejects(app.retryDesktopFileTransfer(async()=>{
  attempts++;throw app.createExternalFileError(503,{error:'Wait.',code:'BACKUP_NOT_READY',retryAfter:60});
 }),error=>error.code==='BACKUP_NOT_READY');
 assert.equal(attempts,1,'other requests must not acquire long waits');
 const controller=new AbortController();
 let scheduled;
 const waitStarted=new Promise(resolve=>{scheduled=resolve;});
 const cancellable=nativeUpdateModel({setTimeout:(fn,ms)=>{scheduled();return setTimeout(fn,ms);},clearTimeout});
 const waiting=cancellable.retryDesktopFileTransfer(async()=>{throw cancellable.createExternalFileError(503,{code:'BACKUP_NOT_READY',retryAfter:60});},controller.signal,{backupConsistency:true});
 await waitStarted;controller.abort();await assert.rejects(waiting,error=>error.name==='AbortError');
});

test('direct B2 quota XML and relay JSON expose useful errors without signed request details', async () => {
 for(const relay of [false,true]) {
  let uploads=0;
  const app=nativeUpdateModel({CHAT_FILE_CONFIG:{endpoint:'https://files.example'},XMLHttpRequest:class {
   constructor(){this.upload={};}
   open(){} setRequestHeader(){}
   getResponseHeader(name){return name==='Retry-After'?'60':null;}
   send(){uploads++;this.status=relay?502:403;
    this.responseText=relay?JSON.stringify({error:'B2 storage cap reached.',code:'storage_cap_exceeded',retryable:false,providerStatus:403}):'<Error><Code>AccessDenied</Code><Message>storage cap exceeded</Message><Resource>https://private.example?secret=never-display</Resource></Error>';
    queueMicrotask(()=>this.onload());
   }
  }});
  await assert.rejects(app.retryDesktopFileTransfer(()=>app.transferExternalPart(relay?'/transfer?ticket=test':'https://s3.us-west-004.backblazeb2.com/fixture/file',new Blob(['file']),'text/plain',null,null,relay)), error=>{
   assert.equal(error.retryable,false);assert.equal(error.retryAfter,60);
   assert.equal(error.code,relay?'storage_cap_exceeded':'AccessDenied');
   assert.match(error.message,relay ? /storage cap reached/ : /account usage limit reached/);
   assert.equal(error.message.includes('never-display'),false);
   return true;
  });
  assert.equal(uploads,1);
 }
});

function freeBackupClientHarness(options={}) {
 const requests=[],transfers=[],parts=new Map(),stats={complete:0,aborted:0},controller=new AbortController();
 const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
 let primaryKey='',backupKey='',storedBytes=null;
 const app=nativeUpdateModel({CHAT_FILE_CONFIG:{endpoint:'https://files.example'},Blob,AbortController,setTimeout:(fn,ms)=>setTimeout(fn,ms===120000?ms:0),clearTimeout,fetch:async(raw,request)=>{
  const route=new URL(raw).pathname,body=JSON.parse(request.body);requests.push({route,body});
  if(route==='/sign') {
   if(body.fallback) {
    if(options.backupSignError)return json(options.backupSignError,options.backupSignError.status||429);
    backupKey=body.path+'-kv1-11111111-1111-4111-8111-111111111111';
    return json({storageBackend:'kv',relayOnly:true,objectKey:backupKey,ticket:'backup-ticket',uploadId:'kv1',partSize:8*1024*1024,contentType:'application/octet-stream'});
   }
   if(options.primarySignError)return json(options.primarySignError,options.primarySignError.status||503);
   primaryKey=body.path+'-11111111-1111-4111-8111-111111111111';
   return json({objectKey:primaryKey,ticket:'primary-ticket',uploadURL:'https://s3.us-west-004.backblazeb2.com/fixture/file',contentType:'application/octet-stream'});
  }
  if(route==='/part-sign')return json({storageBackend:'kv',relayOnly:true,relayURL:'/transfer?part='+body.partNumber});
  if(route==='/complete') {
   if(body.ticket==='primary-ticket')return options.primarySuccess?json({complete:true}):json({error:'B2 transaction cap reached.',code:'B2_QUOTA',retryable:false,providerStatus:403},403);
   assert.equal(body.parts.length,parts.size);
   assert.ok(body.parts.every(part=>part.etag==='0123456789abcdef0123456789abcdef'));
   storedBytes=Buffer.concat([...parts.entries()].sort(([a],[b])=>a-b).map(([,value])=>value));
   assert.equal(storedBytes.length,body.size);stats.complete++;return json({complete:true});
  }
  if(route==='/abort'){stats.aborted++;return json({aborted:true});}
  if(route==='/delete') {
   if(options.primaryCleanupError && body.prefix===primaryKey)return json({error:'B2 deletion cap reached.',retryable:false,providerStatus:403},403);
   return json({cursor:null});
  }
  throw new Error('Unexpected route '+route);
 },XMLHttpRequest:class {
  constructor(){this.upload={};}
  open(method,url){this.method=method;this.url=url;}
  setRequestHeader(){}
  getResponseHeader(name){return name==='ETag'?'0123456789abcdef0123456789abcdef':null;}
  abort(){this.aborted=true;this.onabort?.();}
  send(blob){void(async()=>{
   transfers.push({method:this.method,url:this.url,size:blob.size});
   if(this.method==='PUT' && options.primaryTransferError) {
    this.status=403;this.responseText='<Error><Code>AccessDenied</Code><Message>storage cap exceeded</Message></Error>';this.onload();return;
   }
   if(this.method==='POST') {
    if(options.abortBackup){controller.abort('cancelled backup');return;}
    parts.set(Number(new URL(this.url).searchParams.get('part')),Buffer.from(await blob.arrayBuffer()));
   }
   if(this.aborted)return;
   this.status=200;this.onload();
  })();}
 }});
 app.fileUploadLimitLoaded=true;
 return {app,requests,transfers,stats,controller,get bytes(){return storedBytes;},get primaryKey(){return primaryKey;}};
}

test('a B2 verification cap falls back once and publishes only complete zero, small, and multipart backups',async()=>{
 for(const size of [0,17,9*1024*1024]) {
  const harness=freeBackupClientHarness({primaryCleanupError:true}),bytes=Buffer.alloc(size,0xa5);
  const result=await harness.app.uploadExternalBlob(new Blob([bytes]),{path:'attachments/room/message/0'});
  assert.equal(result.provider,'b2-worker-v1');assert.match(result.objectKey,/-kv1-/);
  assert.equal(result.size,size);assert.deepEqual(harness.bytes,bytes);assert.equal(harness.stats.complete,1);
  assert.equal(result.cleanupObjectKeys[0],harness.primaryKey,'retain failed primary cleanup until the committed backup is cleared');
  const signs=harness.requests.filter(value=>value.route==='/sign');assert.equal(signs.length,2);
  assert.equal(signs[0].body.fallback,undefined);assert.equal(signs[1].body.fallback,true);
  const relay=harness.transfers.filter(value=>value.method==='POST');assert.equal(relay.length,Math.max(1,Math.ceil(size/(8*1024*1024))));
  assert.ok(relay.every(value=>new URL(value.url).origin==='https://files.example'));
  assert.equal(harness.transfers.filter(value=>value.method==='PUT').length,1,'backup sends no request to B2');
 }
});

test('backup also covers primary signing outages but excludes validation, origin denial and acknowledged primary uploads',async()=>{
 const outage=freeBackupClientHarness({primarySignError:{error:'B2 unavailable.',status:503,retryable:false}});
 assert.match((await outage.app.uploadExternalBlob(new Blob(['file']),{path:'html/item/file'})).objectKey,/-kv1-/);
 for(const status of [400,403]) {
  const denied=freeBackupClientHarness({primarySignError:{error:status===400?'Invalid file size.':'App origin not enabled.',status,retryable:false}});
  await assert.rejects(denied.app.uploadExternalBlob(new Blob(['file']),{path:'html/item/file'}),error=>error.status===status);
  assert.equal(denied.requests.filter(value=>value.route==='/sign').length,1);
 }
 const success=freeBackupClientHarness({primarySuccess:true});
 const result=await success.app.uploadExternalBlob(new Blob(['file']),{path:'html/item/file'});
 assert.equal(result.objectKey.includes('-kv1-'),false);
 assert.equal(success.requests.some(value=>value.body.fallback||value.route==='/delete'),false);
});

test('exhausted primary retries and direct B2 quota failures each switch to backup once',async()=>{
 const outage=freeBackupClientHarness({primarySignError:{error:'B2 temporarily unavailable.',status:503}});
 assert.match((await outage.app.uploadExternalBlob(new Blob(['file']),{path:'html/item/file'})).objectKey,/-kv1-/);
 assert.equal(outage.requests.filter(value=>value.route==='/sign'&&!value.body.fallback).length,4);
 assert.equal(outage.requests.filter(value=>value.route==='/sign'&&value.body.fallback).length,1);
 const direct=freeBackupClientHarness({primaryTransferError:true});
 assert.match((await direct.app.uploadExternalBlob(new Blob(['file']),{path:'html/item/file'})).objectKey,/-kv1-/);
 assert.equal(direct.requests.filter(value=>value.route==='/sign').length,2);
 assert.equal(direct.transfers.filter(value=>value.method==='PUT').length,1,'terminal direct quota must not retry B2');
});

test('cancelled backups abort and clean staged objects; exhausted backup reports both free-provider failures',async()=>{
 const cancelled=freeBackupClientHarness({abortBackup:true});
 await assert.rejects(cancelled.app.uploadExternalBlob(new Blob(['file']),{path:'attachments/room/message/0',signal:cancelled.controller.signal}),error=>error.name==='AbortError');
 assert.equal(cancelled.stats.complete,0);assert.equal(cancelled.stats.aborted,1);
 assert.ok(cancelled.requests.some(value=>value.route==='/delete'&&value.body.prefix.includes('-kv1-')));
 const full=freeBackupClientHarness({backupSignError:{error:'Free backup daily write limit reached. Retry after the daily reset.',code:'KV_WRITE_LIMIT',retryable:false}});
 await assert.rejects(full.app.uploadExternalBlob(new Blob(['file']),{path:'html/item/file'}),error=>{
  assert.equal(error.code,'FILE_STORAGE_UNAVAILABLE');assert.equal(error.retryable,false);
  assert.match(error.message,/B2 transaction cap/);assert.match(error.message,/Free backup daily write limit/);return true;
 });
 assert.equal(full.requests.filter(value=>value.route==='/sign').length,2,'backup quota failure must not restart the provider loop');
});

test('unpublished attachment cleanup retains compact references until a later deletion succeeds',async()=>{
 const app={register(){}};
 vm.runInNewContext(read('js/media/uploads.js'),{ChatApp:app,Blob,TextEncoder,btoa});
 app.isExternalBlobDescriptor=file=>file?.provider==='b2-worker-v1'&&typeof file.objectKey==='string'&&Number.isSafeInteger(file.size);
 const prefix=app.externalAttachmentPrefix('room','message');
 let record=null,removed=0,blocked=true;const exact=[],prefixRequests=[];
 const ref={child:name=>({once:async()=>({val:()=>record?.[name]})}),update:async patch=>{record={...record,...patch};},remove:async()=>{removed++;record=null;}};
 app.db={ref:()=>ref};
 app.deleteExternalBlob=async file=>{exact.push(file.objectKey);if(blocked)throw new Error('Delete quota reached.');};
 app.deleteExternalBlobPrefix=async(key,options)=>{prefixRequests.push({key,options});if(blocked)throw new Error('Delete quota reached.');};
 const file={provider:'b2-worker-v1',objectKey:prefix+'0-kv1-id',size:17,dataURL:'never-store-file-bytes',cleanupObjectKeys:[prefix+'0-primary']};
 assert.equal(await app.cleanupUnpublishedMessageFiles('room','message',[file]),false);
 assert.equal(removed,0);assert.equal(record.cleanupPending,1);assert.equal(record.cleanupObjects[0].objectKey,file.objectKey);
 assert.equal(JSON.stringify(record).includes('never-store-file-bytes'),false);
 blocked=false;
 assert.equal(await app.cleanupUnpublishedMessageFiles('room','message'),true,'outer send cleanup must reuse retained known keys');
 assert.equal(removed,1);assert.equal(record,null);assert.deepEqual(exact,[file.objectKey,file.objectKey]);
 assert.equal(prefixRequests.at(-1).options.objects[0].size,17);
});

test('failed parallel attachment upload hands both provider cleanup references to durable cleanup',async()=>{
 const app={register(){},CHAT_FILE_MAX_COUNT:12,CHAT_FILE_MAX_BYTES:1000,RTDB_CHUNK_UPLOAD_CONCURRENCY:2};
 vm.runInNewContext(read('js/media/uploads.js'),{ChatApp:app,Blob,TextEncoder,btoa});
 app.assertExternalStorageConfigured=()=>{};app.ensureFileUploadLimitLoaded=async()=>{};app.db={ref:()=>({})};
 const prefix=app.externalAttachmentPrefix('room','message');
 const failure=Object.assign(new Error('Both providers unavailable.'),{cleanupObjects:[{provider:'b2-worker-v1',objectKey:prefix+'0-primary',size:4},{provider:'b2-worker-v1',objectKey:prefix+'0-kv1-id',size:4}]});
 app.uploadExternalBlob=async()=>{throw failure;};let retained;
 app.cleanupUnpublishedMessageFiles=async(_room,_message,files)=>{retained=files;return false;};
 await assert.rejects(app.writeMessageAttachmentsToRef({},[{fileObject:new Blob(['file'])}],{roomId:'room',msgKey:'message'}),error=>error===failure);
 assert.equal(retained.length,2);assert.equal(retained[1].objectKey,failure.cleanupObjects[1].objectKey);
});
test('cloak settings normalize aliases without replacing intentional saved bindings', () => {
 const app={register(){},SETTINGS_DEFAULTS:{blackoutCloakKeys:['Shift','Z']}};
 vm.runInNewContext(read('js/core/session.js'),{ChatApp:app});
 const keys=value=>Array.from(app.normalizeCloakKeysSetting(value));
 assert.deepEqual(keys(null),['Shift','Z']);
 assert.deepEqual(keys(['shift','z']),['Shift','Z']);
 assert.deepEqual(keys('s+x'),['S','X']);
 assert.deepEqual(keys('["Esc","Esc"]'),['Escape','Escape']);
 assert.deepEqual(keys(['ctrl','Spacebar']),['Control','Space']);
 assert.deepEqual(keys([' ', 'x']),['Space','X']);
 assert.deepEqual(keys(['Process','Dead','Unidentified']),['Shift','Z']);
});

test('Caden screenshot schedule keeps lunch and Period 1 before homeroom', () => {
 const app={register(_id,init){init();}};
 vm.runInNewContext(read('js/schedules/people-and-data.js'),{ChatApp:app});
 assert.deepEqual(Array.from(app.SCHEDULE_BLOCKS, item=>item.key),['P1','HR','P2','P3','P4','P5','P5A','P6','P7']);
 const expected={M:['Personal Dev/Career Research I','Kara Anthony','A14','Music Appreciation','Adam Burdett','F11'],T:['Art I','Kara Anthony','A14','Gen Ind Arts','Frank Victor','B10'],W:['Study','Cathryn Turner','B15','Study','Holly Homschek','A10'],R:['Physical Ed 9-10','Kyle Turonis','GYM','Study','Holly Homschek','A10'],F:['Study','Amanda Bauman','C07','Study','Holly Homschek','A10']};
 for (const [day, values] of Object.entries(expected)) {
  const schedule=app.SCHEDULES.Caden[day];
  assert.deepEqual([...Object.values(schedule.P1),...Object.values(schedule.P5A)],values);
  assert.equal(schedule.P5.className,'Lunch');
  assert.equal(schedule.P2.className,'Spanish I');
  assert.equal(schedule.P6.className,'English I');
  assert.ok(Object.values(schedule).every(period=>period.className!=='Open Period' && !period.room.startsWith('H')));
 }
});
test('Escape leaves open modals intact and shortcut editing bypasses modal handlers', () => {
 const app={register(){},modalEl:{hidden:false,dataset:{},contains:()=>true},modalClosing:false};
 vm.runInNewContext(read('js/ui/modals.js'),{ChatApp:app});
 let closed=0,collapsed=0,menuClosed=0;
 app.closeModal=()=>closed++;app.collapseTimeDisplay=()=>collapsed++;app.closeHtmlHubContextMenu=()=>menuClosed++;
 const escape={key:'Escape',preventDefault(){},stopPropagation(){}};
 app.handleModalKeydown(escape);assert.equal(closed,0);
 app.htmlHubMenuEl={hidden:false};app.handleModalKeydown(escape);assert.equal(menuClosed,1);assert.equal(closed,0);
 app.cloakHotkeyEditing=true;app.modalEl.dataset.timeDisplayExpanded='1';
 app.handleModalKeydown(escape);assert.equal(collapsed,0);assert.equal(menuClosed,1);assert.equal(closed,0);
});
test('fresh project enables signup by default and preserves explicit disable', () => {
 const app = scheduleModel();
 assert.equal(app._normalizeAccountCreationEnabled(null), true);
 assert.equal(app._normalizeAccountCreationEnabled(undefined), true);
 assert.equal(app._normalizeAccountCreationEnabled(true), true);
 assert.equal(app._normalizeAccountCreationEnabled(false), false);
});
test('Firebase initialization uses only the requested v6 project', () => {
 let config;
 const app = { register(_id, init) { init(); }, startNativeUpdateListener() {} };
 const firebase = { apps: [], initializeApp(value) { config = value; }, database() { return {ref() { return { on() {} }; }}; } };
 vm.runInNewContext(read('js/core/config.js'), {ChatApp:app, firebase, URL, window:{addEventListener(){}}, document:{addEventListener(){}}});
 assert.equal(config.databaseURL, 'https://chatappv6-e9da9-default-rtdb.firebaseio.com');
 assert.equal(config.projectId, 'chatappv6-e9da9');
 assert.equal(config.appId, '1:355141406495:web:78d50a2fca39eae1fb6a2a');
 assert.equal(app.DATABASE_SCHEMA_VERSION, 6);
});
test('admin payload edits retry a cold SDK cache without recreating deleted values', async () => {
 for (const server of ['before', null, 'another edit']) {
  const app = { register() {} }, statuses = [];
  vm.runInNewContext(read('js/admin/panel.js'), {ChatApp:app});
  app.adminDatabase = {}; app.adminDatabaseCurrent = () => true;
  app.adminDatabaseStatus = value => statuses.push(value); app.renderAdminDatabaseNode = () => {};
  let stored = server;
  app.db = {ref: path => ({transaction: async change => {
   assert.equal(path, 'htmlHub/files/example/html');
   assert.equal(change(null), null, 'cold cache must retry at server');
   const result = change(stored);
   if (result !== undefined) stored = result;
   return {committed: result !== undefined, snapshot: {val: () => stored}};
  }})};
  const node = {path:'htmlHub/files/example/html', expected:'before', value:'before'};
  await app.saveAdminDatabaseValue(node, 'after');
  if (server === 'before') { assert.equal(stored, 'after'); assert.equal(statuses.at(-1), 'Saved'); }
  else { assert.equal(stored, server); assert.match(statuses.at(-1), /changed elsewhere/); }
 }
});
test('native update policy distinguishes installed EXEs, current builds and ordinary web browsers',()=>{
 const policy={url:'https://drive.google.com/uc?export=download&id=fixture',minimumVersion:'1.7.0'};
 const web=nativeUpdateModel({location:{protocol:'https:'}});
 assert.equal(web.needsNativeUpdate(policy),false);
 const old=nativeUpdateModel({location:{protocol:'chatapp:'},chatDesktopPreferences:{version:1}});
 assert.equal(old.needsNativeUpdate(policy),true,'known pre-1.7 bridge can be identified conservatively');
 assert.equal(nativeUpdateModel({location:{protocol:'chatapp:'}}).needsNativeUpdate(policy),false,'unknown is not version zero');
 for(const nativeVersion of ['', '0.0.0', 'invalid']) assert.equal(nativeUpdateModel({location:{protocol:'chatapp:'},chatDesktopPreferences:{version:1},chatDesktopBuild:{nativeVersion}}).needsNativeUpdate(policy),false,'a present but invalid bridge is not legacy');
 for(const chatDesktopBuild of [null,undefined]) assert.equal(nativeUpdateModel({location:{protocol:'chatapp:'},chatDesktopPreferences:{version:1},chatDesktopBuild}).needsNativeUpdate(policy),false,'an explicitly pending or failed build bridge is not legacy');
 assert.equal(old.needsNativeUpdate({...policy,minimumVersion:'1.6.0'}),false,'legacy upper bound cannot establish requirements below 1.7');
 for(const version of ['1.7.0','1.7.1','1.10.0','2.0.0']) {
  const current=nativeUpdateModel({location:{protocol:'chatapp:'},chatDesktopBuild:{nativeVersion:version}});
  assert.equal(current.needsNativeUpdate(policy),false,version);
 }
 const current=nativeUpdateModel({location:{protocol:'chatapp:'},chatDesktopBuild:{nativeVersion:'1.7.0'}});
 assert.equal(current.needsNativeUpdate({...policy,minimumVersion:'1.8.0'}),true);
 assert.equal(old.needsNativeUpdate(null),false);
 assert.equal(old.needsNativeUpdate({...policy,url:''}),false);
});
test('native update URL validation rejects executable URL schemes and malformed versions',()=>{
 const app=nativeUpdateModel();
 for(const url of ['javascript:alert(1)','file:///app.exe','http://example.test/app.exe','https://user:pass@example.test/app.exe','not a url']) {
  assert.throws(()=>app.normalizeNativeUpdateURL(url));
  assert.equal(app.normalizeNativeUpdatePolicy({url,minimumVersion:'1.7.0'}),null);
 }
 assert.equal(app.normalizeNativeUpdatePolicy({url:'https://example.test',minimumVersion:'latest'}),null);
 assert.equal(app.normalizeNativeUpdateURL('  https://example.test/app.exe  '),'https://example.test/app.exe');
});
test('only Vinny can save native download URLs; the same URL retains its binary identity and clearing disables it',async()=>{
 const app=nativeUpdateModel();let stored=null,writes=0;
 app.db={ref:key=>{assert.equal(key,'admin/desktopUpdate');return {transaction:async change=>{
  const next=change(stored);if(next!==undefined){stored=next;writes++;}return {committed:next!==undefined};
 }}}};
 app.nativeUpdatePolicyLoaded=true;app.isVinny=()=>false;
 await assert.rejects(app.setNativeUpdateURL('https://example.test/app.exe'),/Only Vinny/);assert.equal(writes,0);
 app.isVinny=()=>true;app.nativeUpdatePolicyLoaded=false;
 await assert.rejects(app.setNativeUpdateURL('https://example.test/app.exe'),/still loading/);assert.equal(writes,0);
 app.nativeUpdatePolicyLoaded=true;
 await app.setNativeUpdateURL('https://example.test/app.exe');assert.equal(stored.minimumVersion,app.NATIVE_RELEASE_VERSION);
 stored.minimumVersion='1.7.0';await app.setNativeUpdateURL('https://example.test/app.exe');assert.equal(stored.minimumVersion,'1.7.0','same URL keeps its binary identity');
 stored.minimumVersion='1.8.0';await app.setNativeUpdateURL('https://example.test/new.exe');assert.equal(stored.minimumVersion,app.NATIVE_RELEASE_VERSION,'a new URL uses this actual native release');
 await app.setNativeUpdateURL('');assert.equal(stored,null);
});
test('file upload policy defaults to 100 MB and supports positive decimal limits above or below it',()=>{
 const app=nativeUpdateModel();
 assert.equal(app.FILE_UPLOAD_LIMIT_PATH,'admin/fileUploadLimitMB');
 assert.equal(app.FILE_UPLOAD_LIMIT_DEFAULT_MB,100);
 assert.equal(app.fileUploadLimitMB,100);
 for(const value of [null,undefined,'',false,{},0,-1,'-1','junk','Infinity',Infinity,NaN,'0x10',Number.MAX_SAFE_INTEGER]) {
  assert.equal(app.parseFileUploadLimitMB(value),null, String(value));
  assert.equal(app.normalizeFileUploadLimitMB(value),100, String(value));
 }
 for(const value of [0.5,100,250.25,' 512 ','1e3']) {
  const amount=Number(value);
  assert.equal(app.parseFileUploadLimitMB(value),amount);
  app.applyFileUploadLimitMB(value);
  assert.equal(app.fileUploadLimitMB,amount);
  assert.equal(app.CHAT_FILE_MAX_BYTES,Math.floor(amount*1024*1024));
  assert.equal(app.CHAT_FILE_MAX_LABEL,`${amount} MB`);
 }
 app.applyFileUploadLimitMB(null);assert.equal(app.CHAT_FILE_MAX_BYTES,100*1024*1024);
});
test('only Vinny saves a numeric upload limit after policy load; invalid values and failed writes do not replace it',async()=>{
 const app=nativeUpdateModel();const writes=[];
 app.db={ref:key=>{assert.equal(key,app.FILE_UPLOAD_LIMIT_PATH);return {set:async value=>{writes.push(value);}};}};
 app.fileUploadLimitLoaded=true;app.isVinny=()=>false;
 await assert.rejects(app.setFileUploadLimitMB(250),/Only Vinny/);assert.deepEqual(writes,[]);
 app.isVinny=()=>true;app.fileUploadLimitLoaded=false;
 await assert.rejects(app.setFileUploadLimitMB(250),/loading/i);assert.deepEqual(writes,[]);
 app.fileUploadLimitLoaded=true;
 for(const value of ['',0,-1,'ten',Infinity]) await assert.rejects(app.setFileUploadLimitMB(value));
 assert.deepEqual(writes,[]);
 await app.setFileUploadLimitMB('250.25');assert.deepEqual(writes,[250.25]);
 const before=app.fileUploadLimitMB;
 app.db.ref=()=>({set:async()=>{throw new Error('permission denied');}});
 await assert.rejects(app.setFileUploadLimitMB(50),/permission denied/);
 assert.equal(app.fileUploadLimitMB,before,'failed writes must not apply the unsaved limit');
});
test('upload policy streams Firebase changes to clients and resolves initial loading once',async()=>{
 const app=nativeUpdateModel();let listener,errorListener,subscriptions=0,syncs=0;
 app.syncFileUploadLimitInput=()=>syncs++;
 app.db={ref:key=>{assert.equal(key,app.FILE_UPLOAD_LIMIT_PATH);return {on(event,callback,onError){assert.equal(event,'value');subscriptions++;listener=callback;errorListener=onError;}};}};
 app.startFileUploadLimitListener();app.startFileUploadLimitListener();
 assert.equal(subscriptions,1,'one shared realtime listener per client');
 let ready=false;const loading=app.ensureFileUploadLimitLoaded().then(()=>{ready=true;});
 await Promise.resolve();assert.equal(ready,false,'uploads wait for first server value');
 listener({val:()=>null});await loading;
 assert.equal(app.fileUploadLimitLoaded,true);assert.equal(app.fileUploadLimitMB,100);
 listener({val:()=>512.5});assert.equal(app.fileUploadLimitMB,512.5);assert.equal(app.CHAT_FILE_MAX_BYTES,512.5*1024*1024);
 listener({val:()=>1});assert.equal(app.CHAT_FILE_MAX_BYTES,1024*1024);
 listener({val:()=>({invalid:true})});assert.equal(app.fileUploadLimitMB,100);
 assert.ok(syncs>=4,'an open admin input is refreshed with each policy value');
 errorListener(new Error('realtime denied'));assert.match(app.fileUploadLimitError,/realtime denied/);
});
test('initial upload policy read errors reject waiting uploads and stored larger files remain readable after lowering',async()=>{
 const app=nativeUpdateModel({CHAT_FILE_CONFIG:{endpoint:'https://files.example'}});let rejectListener;
 app.db={ref:()=>({on(_event,_callback,onError){rejectListener=onError;}})};
 const loaded=app.ensureFileUploadLimitLoaded();rejectListener(new Error('policy unavailable'));
 await assert.rejects(loaded,/policy unavailable/);
 app.applyFileUploadLimitMB(1);
 const record={provider:'b2-worker-v1',objectKey:'attachments/room/message/file',size:250*1024*1024};
 assert.equal(app.isExternalBlobDescriptor(record),true);
 assert.equal(app.getExternalBlobURL(record),'https://files.example/objects/attachments/room/message/file');
 for(const size of [-1,0.5,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.equal(app.isExternalBlobDescriptor({...record,size}),false);
});
test('cancelled upload policy subscriptions retry with fresh readiness and ignore stale callbacks',async()=>{
 const app=nativeUpdateModel(),subscriptions=[],ui=[];
 app.syncFileUploadLimitInput=()=>ui.push({loaded:app.fileUploadLimitLoaded,error:app.fileUploadLimitError});
 app.db={ref:()=>({on(_event,callback,onError){
  subscriptions.push({callback,onError});
  if(subscriptions.length===2)callback({val:()=>250});
 }})};
 const original=app.ensureFileUploadLimitLoaded(),firstReady=app.fileUploadLimitReady;
 subscriptions[0].onError(new Error('permission denied'));
 await assert.rejects(original,/permission denied/);
 assert.equal(app.fileUploadLimitListener,null);assert.equal(app.fileUploadLimitLoaded,false);
 assert.equal(app.CHAT_FILE_MAX_BYTES,100*1024*1024,'failed initial load preserves the default');
 assert.deepEqual(ui.at(-1),{loaded:false,error:'permission denied'});
 app.startFileUploadLimitListener();
 assert.notEqual(app.fileUploadLimitReady,firstReady,'panel reopen replaces the rejected readiness promise');
 assert.equal(await app.ensureFileUploadLimitLoaded(),250,'synchronous recovery snapshots settle the fresh readiness');
 subscriptions[0].callback({val:()=>1});subscriptions[0].onError(new Error('stale cancellation'));
 assert.equal(app.fileUploadLimitMB,250);assert.equal(app.fileUploadLimitError,'');
 subscriptions[1].onError(new Error('permission revoked'));
 assert.equal(app.fileUploadLimitLoaded,false);
 assert.equal(app.CHAT_FILE_MAX_BYTES,250*1024*1024,'cancellation preserves the last effective limit');
 let resolved=false;const retry=app.ensureFileUploadLimitLoaded().then(value=>{resolved=true;return value;});
 assert.equal(subscriptions.length,3);await Promise.resolve();assert.equal(resolved,false);
 assert.deepEqual(ui.at(-1),{loaded:false,error:''},'an explicit retry keeps the input disabled while loading');
 subscriptions[1].callback({val:()=>1000});assert.equal(app.fileUploadLimitMB,250);
 subscriptions[2].callback({val:()=>2.5});assert.equal(await retry,2.5);
 assert.equal(app.fileUploadLimitLoaded,true);assert.equal(app.CHAT_FILE_MAX_BYTES,2.5*1024*1024);
});
test('each source folder fits one GitHub browser upload', () => {
 const generated = new Set(['node_modules', '.git', 'dist', 'test-results']);
 function files(dir) {
  return fs.readdirSync(dir, {withFileTypes:true}).reduce((count, entry) =>
   count + (entry.isDirectory() ? (generated.has(entry.name) ? 0 : files(path.join(dir,entry.name))) : 1), 0);
 }
 for (const entry of fs.readdirSync(root, {withFileTypes:true})) {
  if (entry.isDirectory() && !generated.has(entry.name)) {
   assert.ok(files(path.join(root,entry.name)) <= 100, `${entry.name} exceeds GitHub's 100-file upload limit`);
  }
 }
});
function context(){
 const events=[];
 const ctx=vm.createContext({document:{documentElement:{dataset:{}}},window:{dispatchEvent:e=>events.push(e.type)},Event:class{constructor(type){this.type=type;}}});
 vm.runInContext(read('js/runtime/application.js'),ctx);
 return {ctx,events};
}

function scheduleModel() {
 const app = {register(_id, initialize) { initialize(); }, getAccurateNow:()=>new Date('2026-10-05T12:15:00Z'),
   getESTParts:()=>({year:2026,month:10,day:5,hour:8,minute:15,second:0}),
   _getESTWeekdayIndexAt:()=>1, currentUser:{code:'ADMIN',username:'Vinny'},
   isVinny:()=>true, refreshSchedulesPeople(){}, updateClockClassUI(){}, refreshOnlineIndicatorStatusTexts(){}};
 const ctx=vm.createContext({ChatApp:app,document:{querySelector:()=>null},console,Date});
 for(const file of ['js/schedules/people-and-data.js','js/schedules/admin.js','js/schedules/render.js','js/ui/clock.js']) {
   if(file.endsWith('clock.js')) app.register=()=>{};
   vm.runInContext(read(file),ctx);
 }
 app.refreshSchedulesPeople=()=>{};app.scheduleRenderSchedulesUI=()=>{};app.updateClockClassUI=()=>{};
 return app;
}
test('schedule overrides preserve all shipped defaults and do not resurrect removed schedules',()=>{
 const app=scheduleModel(),defaults=JSON.stringify(app.SCHEDULES);
 const rows=app.getScheduleRows('full','Vinny','M');assert.equal(rows.length,9);assert.equal(rows[0].className,'Geometry HN');
 app.applyScheduleOverrides(null);assert.equal(JSON.stringify(app.SCHEDULES),defaults);
 const days=Object.fromEntries(app.SCHEDULE_WEEKDAYS.map(({key})=>[key,app.getScheduleRows('full','Vinny',key).map(row=>({...row}))]));
 days.M[0].time='8:00 AM - 9:00 AM';days.M[0].className='Edited class';
 app.applyScheduleOverrides({vinny:{username:'Vinny',days,revision:1}});
 assert.equal(app.getScheduleRows('full','vinny','M')[0].className,'Edited class');
 assert.equal(app.getScheduleRows('full','Vinny','M')[0].duration,'60 minutes');
 for(const [name,record] of Object.entries(JSON.parse(defaults))) if(name!=='Vinny') assert.equal(JSON.stringify(app.SCHEDULES[name]),JSON.stringify(record));
 app.applyScheduleOverrides({vinny:{username:'Vinny',removed:true,revision:2}});
 assert.equal(app._findConfiguredScheduleUsername('Vinny'),null);assert.equal(app.getScheduleRows('full','Vinny','M').length,0);
 app.applyScheduleOverrides(null);assert.equal(JSON.stringify(app.SCHEDULES),defaults);
});
test('schedule validation rejects invalid periods, clamps text and resolves duplicate keys',()=>{
 const app=scheduleModel();
 assert.throws(()=>app.normalizeScheduleDays({M:[{time:'13:99 AM - 2:00 PM'}]}),/valid start and end/);
 assert.throws(()=>app.normalizeScheduleDays({M:[{time:'9:00 AM - 8:00 AM'}]}),/valid start and end/);
 assert.throws(()=>app.normalizeScheduleDays({M:Array.from({length:25},()=>({}))}),/at most 24/);
 const rows=app.normalizeScheduleDays({M:[{key:'P1',className:'x'.repeat(300)},{key:'P1'},{key:'bad/key'}]}).M;
 assert.equal(rows[0].className.length,180);assert.equal(new Set(rows.map(row=>row.key)).size,3);
 assert.ok(rows.every(row=>!row.key.includes('/')));
});

test('grade 9-10 half-day and two-hour delay bell times preserve every class mapping',()=>{
 const app=scheduleModel();
 const expected={full:[[465,510],[513,525],[528,573],[576,621],[624,669],[672,709],[712,757],[760,805],[808,853]],
  half:[[465,492],[495,504],[507,532],[535,562],[565,592],[592,629],[629,660],[663,690],[693,720]],
  delay2:[[585,613],[616,624],[627,655],[658,686],[689,717],[717,754],[754,791],[794,822],[825,853]]};
 for(const [type,ranges] of Object.entries(expected)){
  const rows=app.getScheduleRows(type,'Vinny','M');assert.equal(rows.length,9);
  rows.forEach((row,index)=>{const range=app._parseRangeMinutes(row.time);assert.deepEqual([range.start,range.end],ranges[index]);assert.equal(row.duration,`${range.end-range.start} minutes`);});
  assert.equal(rows[5].label,'Lunch');assert.equal(rows[5].className,'Lunch');
  assert.equal(rows[6].label,'Period 5');assert.equal(rows[6].className,'Art');
 }
});

test('legacy schedule edits keep full-day times and derive alternate times without mutating saved classes',()=>{
 const app=scheduleModel();
 const days=Object.fromEntries(app.SCHEDULE_WEEKDAYS.map(({key})=>[key,app.getScheduleRows('full','Vinny',key).map(row=>({...row}))]));
 days.M[0].time='8:00 AM - 9:00 AM';days.M[0].className='Custom class';
 const raw={vinny:{username:'Vinny',days,revision:1}},before=JSON.stringify(raw);
 app.applyScheduleOverrides(raw);
 assert.equal(app.getScheduleRows('full','Vinny','M')[0].time,'8:00 AM - 9:00 AM');
 assert.equal(app.getScheduleRows('half','Vinny','M')[0].time,'7:45 AM - 8:12 AM');
 assert.equal(app.getScheduleRows('delay2','Vinny','M')[0].time,'9:45 AM - 10:13 AM');
 assert.equal(app.getScheduleRows('half','Vinny','M')[0].className,'Custom class');
 assert.equal(JSON.stringify(raw),before);
});

test('schedule variants save atomically, remain independent and drive class lookup',async()=>{
 const app=scheduleModel(),weeks=Object.fromEntries(['full','half','delay2'].map(type=>[type,
  Object.fromEntries(app.SCHEDULE_WEEKDAYS.map(({key})=>[key,app.getScheduleRows(type,'Vinny',key).map(row=>({...row}))]))]));
 weeks.half.M[0].time='7:50 AM - 8:15 AM';weeks.half.M[0].className='Half-day class';
 weeks.delay2.M[0].time='9:50 AM - 10:20 AM';weeks.delay2.M[0].className='Delayed class';
 let record=null;app.scheduleDataLoaded=true;
 app.db={ref:()=>({transaction:async fn=>{const next=fn(record);if(next!==undefined)record=next;return {committed:next!==undefined};}})};
 await app.savePersonSchedule('Vinny',weeks.full,{variants:{half:weeks.half,delay2:weeks.delay2}});
 assert.equal(record.revision,1);app.applyScheduleOverrides({vinny:record});
 assert.equal(app.getScheduleRows('full','Vinny','M')[0].time,'7:45 AM - 8:30 AM');
 assert.equal(app.getScheduleRows('half','Vinny','M')[0].duration,'25 minutes');
 assert.equal(app.getScheduleRows('delay2','Vinny','M')[0].duration,'30 minutes');
 assert.equal(app._getClassForBlock('half','Vinny','P1','M').className,'Half-day class');
 assert.equal(app._getClassForBlock('delay2','Vinny','P1','M').className,'Delayed class');
 await app.savePersonSchedule('Vinny',weeks.full,{expectedRevision:1});
 assert.equal(record.variants.half.M[0].className,'Half-day class','legacy full-day saves preserve variants');
 await assert.rejects(app.savePersonSchedule('Vinny',weeks.full,{expectedRevision:1,variants:{half:weeks.half}}),/changed elsewhere/);
 assert.equal(record.revision,2);
});
test('schedule writes reject non-admin sessions and concurrent edits without replacing stored data',async()=>{
 const app=scheduleModel();let writes=0,current={username:'Vinny',revision:3,days:{}};
 app.scheduleDataLoaded=true;app.db={ref:()=>({transaction:async fn=>{const next=fn(current);if(next!==undefined){writes++;current=next;}return {committed:next!==undefined};}})};
 app.isVinny=()=>false;await assert.rejects(app.savePersonSchedule('Vinny',{}),/Only Vinny/);assert.equal(writes,0);
 app.isVinny=()=>true;await assert.rejects(app.savePersonSchedule('Vinny',{}, {expectedRevision:2}),/changed elsewhere/);assert.equal(writes,0);
 await app.savePersonSchedule('Vinny',{}, {expectedRevision:3});assert.equal(writes,1);assert.equal(current.revision,4);
});
test('No School displays no active classes without erasing schedules or the copied full week',()=>{
 const app=scheduleModel(), before=JSON.stringify(app.SCHEDULES);
 app.scheduleType='noschool';
 assert.equal(app._normalizeScheduleType('noschool'),'noschool');
 assert.equal(app._scheduleTypeLabel('noschool'),'No School');
 assert.equal(app.getScheduleRows('noschool','Vinny','M').length,0);
 assert.equal(app._getActiveScheduleBlockKey('noschool','Vinny'),null);
 assert.match(app.scheduleAsText('Vinny'),/Geometry HN/);
 assert.equal(JSON.stringify(app.SCHEDULES),before);
 assert.equal(app.getScheduleRows('full','Vinny','M').length,9);
});
test('database explorer accepts direct child paths and rejects ambiguous or invalid keys',()=>{
 const app={register(){}};
 vm.runInNewContext(read('js/admin/panel.js'),{ChatApp:app});
 assert.equal(app.normalizeDatabasePath('/messages/test/'),'messages/test');
 assert.equal(app.normalizeDatabasePath('/'),'');
 for(const value of ['users//test','users/a.b','users/a#b','users/a$b','users/[a]','users/a\u0000b']) assert.throws(()=>app.normalizeDatabasePath(value),/valid database path/);
});
test('all editable scripts parse and every declared module exists',()=>{
 let count=0;
 function walk(dir){for(const file of fs.readdirSync(dir,{withFileTypes:true})){
  const full=path.join(dir,file.name);
  if(file.isDirectory()){if(!['node_modules','.git'].includes(file.name))walk(full);}
  else if(file.name.endsWith('.js')){new vm.Script(fs.readFileSync(full,'utf8'),{filename:full});count++;}
 }}walk(root);
 assert.ok(count>80);
 const {ctx}=context();vm.runInContext(read('js/module-manifest.js'),ctx);
 assert.equal(new Set(ctx.ChatAppModules.map(e=>e.id)).size,ctx.ChatAppModules.length);
 for(const item of ctx.ChatAppModules)assert.ok(fs.existsSync(path.join(root,item.src)),item.src);
 assert.ok(read('app.js').split('\n').length<100,'entry script must remain a small bootstrap');
});
test('runtime defers side effects, initializes in manifest order, and starts once',()=>{
 const {ctx,events}=context();ctx.order=[];
 vm.runInContext(`ChatApp.register('second',()=>order.push(2));ChatApp.register('first',()=>order.push(1));`,ctx);
 assert.equal(ctx.order.length,0);
 ctx.ChatApp.initialize([{id:'first'},{id:'second'}]);ctx.ChatApp.initialize([{id:'first'},{id:'second'}]);
 assert.equal(JSON.stringify(ctx.order),'[1,2]');assert.deepEqual(events,['chatapp:ready']);
});
test('missing or duplicate modules fail before startup side effects',()=>{
 const {ctx}=context();ctx.touched=false;
 vm.runInContext(`ChatApp.register('first',()=>touched=true)`,ctx);
 assert.throws(()=>ctx.ChatApp.initialize([{id:'first'},{id:'missing'}]),/did not register/);
 assert.equal(ctx.touched,false);
 assert.throws(()=>ctx.ChatApp.register('first',()=>{}),/Duplicate/);
});
test('formatter reuse preserves timezone and DST output with a bounded cache',()=>{
 const {ctx}=context();vm.runInContext(read('js/core/formatters.js'),ctx);
 ctx.ChatApp.initialize([{id:'core/formatters'}]);
 const app=ctx.ChatApp;
 const opts={timeZone:'America/New_York',hour:'numeric',minute:'2-digit',hour12:true};
 const first=app.getDateTimeFormatter('en-US',opts);
 assert.equal(first,app.getDateTimeFormatter('en-US',{...opts}));
 for(const ts of ['2026-03-08T06:59:00Z','2026-03-08T07:01:00Z','2026-11-01T05:59:00Z','2026-11-01T06:01:00Z']){
  assert.equal(first.format(new Date(ts)),new Intl.DateTimeFormat('en-US',opts).format(new Date(ts)));
 }
 const zones=Intl.supportedValuesOf('timeZone').slice(0,80);
 for(const timeZone of zones)app.getDateTimeFormatter('en-US',{timeZone});
 assert.equal(app.dateTimeFormatterCache.size,64);
});
test('stable message timestamps avoid repeated DOM work and update at midnight',()=>{
 const {ctx}=context();
 vm.runInContext(read('js/core/formatters.js'),ctx);ctx.ChatApp.initialize([{id:'core/formatters'}]);
 vm.runInContext(read('js/rooms/home.js'),ctx);
 let refreshes=0;let date={year:2026,month:9,day:7};
 ctx.document.visibilityState='visible';ctx.document.querySelectorAll=()=>[{_refreshTimestamp:()=>refreshes++}];
 ctx.ChatApp.getAccurateNow=()=>new Date();ctx.ChatApp.getESTParts=()=>date;
 ctx.ChatApp.updateLiveMessageTimestamps();
 for(let i=0;i<1800;i++)ctx.ChatApp.updateLiveMessageTimestamps();
 assert.equal(refreshes,1);
 date={year:2026,month:9,day:8};ctx.ChatApp.updateLiveMessageTimestamps();assert.equal(refreshes,2);
 ctx.document.visibilityState='hidden';date.day=9;ctx.ChatApp.updateLiveMessageTimestamps();assert.equal(refreshes,2);
 ctx.document.visibilityState='visible';ctx.ChatApp.updateLiveMessageTimestamps();assert.equal(refreshes,3);
});

function searchApp() {
 const App={register(){},currentUser:{code:'SELF'},liveUserCache:new Map([
  ['SELF',{username:'Tester',displayName:'Current User'}],
  ['ALICE',{username:'alice',displayName:'Alice Jones'}],
  ['REGEX',{username:'a+b',displayName:'Regex User'}]
 ])};
 vm.runInNewContext(read('js/chat/header.js'),{ChatApp:App,Date,Map,Set,setTimeout,clearTimeout,performance});
 return App;
}
test('room search combines quoted sender, date and attachment filters using real message records',()=>{
 const App=searchApp(),match=(message,query)=>App.roomSearchMatches(message,App.parseRoomSearch(query));
 const message={userCode:'ALICE',username:'alice',text:'A map for @Tester',createdAt:+new Date('2026-10-05T12:00:00'),files:[null,{fileName:'World map.png',mimeType:'image/png'}]};
 assert.equal(match(message,'from:"Alice Jones" has:image mentions:me during:2026-10-05 "world map"'),true);
 assert.equal(match(message,'from:me'),false);
 assert.equal(match(message,'during:2026-02-31'),false,'invalid dates must not silently normalize to March');
 assert.equal(match({...message,t:'file',files:undefined,fileName:'Archive.zip'},'has:file archive.zip'),true);
 assert.equal(match({...message,text:'@a+b',files:[]},'mentions:a+b'),true,'mention names are escaped as text');
 assert.equal(match({...message,text:'@ab',files:[]},'mentions:a+b'),false);
 assert.equal(match({...message,text:'',mentions:{SELF:true}},'mentions:me'),true);
 App.liveUserCache.set('QUOTED',{username:'The "Quote" User'});
 assert.equal(match({userCode:'QUOTED',text:'Hello'},'from:'+JSON.stringify('The "Quote" User')),true,'autocomplete safely represents usernames containing spaces and quotes');
});
test('room search builds member lookup once per query instead of scanning members for each message',()=>{
 const App=searchApp(),cache=App.liveUserCache,entries=cache.entries.bind(cache);let scans=0;
 cache.entries=()=>{scans++;return entries();};
 const query=App.parseRoomSearch('from:Alice mentions:me');
 for(let i=0;i<2000;i++) assert.equal(App.roomSearchMatches({userCode:'ALICE',text:'Hello @{SELF}'},query),true);
 assert.equal(scans,1);
 App.liveUserCache.get('ALICE').displayName='New Display Name';
 assert.equal(App.roomSearchMatches({userCode:'ALICE',text:'Hello'},App.parseRoomSearch('from:"New Display Name"')),true,'a new render picks up live identity changes');
});
test('room search sees delayed older-key additions, edits and deletions, then releases its listeners',async()=>{
 const App=searchApp(),listeners=[],records=new Map([['z-latest',{text:'Newest message'}]]);
 const child=key=>({key,val:()=>records.get(key)});
 const node={hidden:true,classList:{contains:()=>false,add(){},remove(){}},setAttribute(){},replaceChildren(){}};
 App.$=()=>node;App.currentRoomId='test';App.msgDataByKey=new Map();
 let scheduled=0;App.renderRoomSearch=()=>{};App.scheduleRoomSearchRender=()=>{scheduled++;};
 const ref=(query={})=>({
  orderByKey(){return ref(query);},endAt(key){return ref({...query,endAt:key});},startAt(key){return ref({...query,startAt:key});},limitToLast(limit){return ref({...query,limit});},child(key){return {once:async()=>({...child(key),exists:()=>records.has(key)})};},
  on(event,callback){listeners.push({event,callback,query});},
  off(event,callback){const index=listeners.findIndex(item=>item.event===event&&item.callback===callback);if(index>=0)listeners.splice(index,1);},
  once:async()=>({forEach(callback){const keys=[...records.keys()].sort().filter(key=>!query.endAt||key<=query.endAt).slice(-(query.limit||records.size));keys.forEach(key=>callback(child(key)));}})
 });
 App.db={ref:()=>ref()};App.openRoomSearch();assert.equal(listeners.length,0,"focusing empty search does not download room history");App.loadRoomSearchHistory(App.roomSearchState);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(App.roomSearchState.loading,false);assert.equal(App.roomSearchState.messages.has('z-latest'),true);
 function emit(event,key){for(const item of [...listeners])if(item.event===event){const inQuery=!item.query.limit||[...records.keys()].sort().slice(-item.query.limit).includes(key);if(inQuery)item.callback(child(key));}}
 records.set('a-delayed',{text:'Offline message committed later'});emit('child_added','a-delayed');
 assert.equal(App.roomSearchState.messages.get('a-delayed')?.text,'Offline message committed later');
 records.set('a-delayed',{text:'Edited after reconnect'});emit('child_changed','a-delayed');
 assert.equal(App.roomSearchState.messages.get('a-delayed')?.text,'Edited after reconnect');
 records.delete('a-delayed');emit('child_removed','a-delayed');assert.equal(App.roomSearchState.messages.has('a-delayed'),false);
 assert.ok(scheduled>=3);App.closeRoomSearch();await new Promise(resolve=>setTimeout(resolve,20));assert.equal(listeners.length,0);assert.equal(App.roomSearchState,null);
});

// External provider contract and the exact deployable Worker embedded in README.
function externalWorkerFixture(fetchImpl,policyFetch=async()=>new Response('null',{headers:{'Content-Type':'application/json'}}),globals={}) {
 const source=read('README.md').split('<!-- BEGIN STORAGE WORKER -->')[1].split('<!-- END STORAGE WORKER -->')[0].replace(/^\s*```javascript\s*\n/,'').replace(/\n```\s*$/,'');
 const fetch=(url,options)=>new URL(url).pathname==='/admin/fileUploadLimitMB.json'?policyFetch(url,options):fetchImpl(url,options);
 const scope={crypto:require('node:crypto').webcrypto,TextEncoder,TextDecoder,URL,Response,Request,Headers,AbortController,fetch,...globals};
 vm.runInNewContext(source.replace('export default {','globalThis.worker = {'),scope);
 return scope.worker;
}
const externalTestEnv={B2_KEY_ID:'test-key-id',B2_APP_KEY:'test-secret-not-published',B2_REGION:'us-west-004',B2_BUCKET:'fixture-bucket',ALLOWED_ORIGINS:'https://chat.example,null'};
const externalWorkerRequest=(route,body,origin='https://chat.example')=>new Request('https://files.example'+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});

test('shared uploader integrates with the actual Worker for B2-cap fallback, KV reads and exact deletion',async()=>{
 for(const size of [0,17,9*1024*1024]) {
  const values=new Map(),routes=[];
  const kv={
   async put(key,value,options={}){values.set(key,{bytes:Buffer.from(await new Response(value).arrayBuffer()),metadata:options.metadata});},
   async get(key,type){const item=values.get(key);return !item?null:type==='json'?JSON.parse(item.bytes):item.bytes.toString();},
   async getWithMetadata(key){const item=values.get(key);return item?{value:new Response(item.bytes).body,metadata:item.metadata}:{value:null,metadata:null};},
   async delete(key){values.delete(key);},
   async list(){return {keys:[],list_complete:true};}
  };
  const backend=async(raw,options={})=>{
   const url=new URL(raw);
   if(options.method==='HEAD')return new Response('',{status:403});
   if(options.method==='POST'&&url.searchParams.has('uploads'))return new Response('<InitiateMultipartUploadResult><UploadId>primary-id</UploadId></InitiateMultipartUploadResult>');
   if(options.method==='GET'&&url.searchParams.has('versions'))return new Response('<ListVersionsResult><IsTruncated>false</IsTruncated></ListVersionsResult>');
   if(options.method==='DELETE')return new Response(null,{status:204});
   if(options.method==='PUT')return new Response(null,{headers:{ETag:'0123456789abcdef0123456789abcdef'}});
   throw new Error('Unexpected primary storage request '+options.method);
  };
  const worker=externalWorkerFixture(backend,async()=>Response.json(100),{ReadableStream});
  const env={...externalTestEnv,FILE_BACKUP:kv};
  const clientFetch=async(raw,options)=>{
   routes.push(new URL(raw).pathname);
   return worker.fetch(new Request(raw,{...options,headers:{...options.headers,Origin:'https://chat.example'}}),env);
  };
  const app=nativeUpdateModel({CHAT_FILE_CONFIG:{endpoint:'https://files.example'},Blob,fetch:clientFetch,XMLHttpRequest:class {
   constructor(){this.upload={};this.headers={};}
   open(method,url){this.method=method;this.url=url;}
   setRequestHeader(name,value){this.headers[name]=value;}
   getResponseHeader(name){return this.response?.headers.get(name);}
   abort(){this.aborted=true;this.onabort?.();}
   send(body){void(async()=>{
    const options={method:this.method,headers:this.headers,body};
    const response=this.method==='POST'?await clientFetch(this.url,options):await backend(this.url,options);
    if(this.aborted)return;
    this.response=response;this.status=response.status;this.responseText=await response.text();this.onload();
   })().catch(error=>{this.failure=error;this.onerror();});}
  }});
  app.fileUploadLimitLoaded=true;
  const bytes=Buffer.alloc(size,0x5a),descriptor=await app.uploadExternalBlob(new Blob([bytes]),{path:'attachments/room/message/0'});
  assert.match(descriptor.objectKey,/-kv1-/);assert.equal(descriptor.size,size);
  let response=await worker.fetch(new Request(app.getExternalBlobURL(descriptor)),env);
  assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  if(size>1){response=await worker.fetch(new Request(app.getExternalBlobURL(descriptor),{headers:{Range:'bytes=1-2'}}),env);assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes.subarray(1,3));}
  await app.deleteExternalBlob(descriptor);
  assert.equal([...values.keys()].some(key=>key.startsWith(descriptor.objectKey+'/')),false,'known-size deletion must work despite an empty stale listing');
  response=await worker.fetch(new Request(app.getExternalBlobURL(descriptor)),env);assert.equal(response.status,404);
  assert.equal(routes.filter(route=>route==='/sign').length,2);
 }
});

test('external Worker signs 100 MiB binary PUT, rejects oversize/invalid origins, and verifies persisted bytes',async()=>{
 const network=[];
 const worker=externalWorkerFixture(async(url,options)=>{network.push({url,options});return new Response(null,{status:200,headers:{'Content-Length':'17'}});});
 const signed=await worker.fetch(externalWorkerRequest('/sign',{path:'attachments/cm9vbQ/bXNn/0',size:100*1024*1024,mimeType:'video/mp4'}),externalTestEnv);
 assert.equal(signed.status,200); const plan=await signed.json(),url=new URL(plan.uploadURL);
 assert.equal(url.hostname,'s3.us-west-004.backblazeb2.com');
 assert.equal(plan.contentType,'video/mp4'); assert.match(plan.objectKey,/^attachments\/cm9vbQ\/bXNn\/0-/);
 assert.equal(url.searchParams.get('X-Amz-SignedHeaders'),'content-type;host');
 assert.equal(url.searchParams.get('X-Amz-Expires'),'7200'); assert.match(url.searchParams.get('X-Amz-Signature'),/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(plan).includes(externalTestEnv.B2_APP_KEY),false); assert.equal(network.length,0,'file bodies never pass through the signing request');
 for(const body of [{path:'attachments/room/msg/0',size:100*1024*1024+1},{path:'attachments/../other/0',size:17}]) assert.equal((await worker.fetch(externalWorkerRequest('/sign',body),externalTestEnv)).status,400);
 assert.equal((await worker.fetch(externalWorkerRequest('/sign',{path:'html/item/content',size:17},'https://unlisted.example'),externalTestEnv)).status,403);
 assert.equal((await worker.fetch(externalWorkerRequest('/sign',{path:'html/item/content',size:17},'null'),externalTestEnv)).status,200,'file-origin uploads supported when explicitly enabled');
 assert.equal((await worker.fetch(externalWorkerRequest('/complete',{objectKey:plan.objectKey,size:17}),externalTestEnv)).status,200);
 assert.equal(network.at(-1).options.method,'HEAD');
 assert.equal((await worker.fetch(externalWorkerRequest('/complete',{objectKey:plan.objectKey,size:18}),externalTestEnv)).status,409);
});
test('external Worker enforces the live Firebase upload limit for health, signing and completion',async()=>{
 let policy=null,policyFailure=false,storedSize=0;const policyRequests=[],storageRequests=[];
 const worker=externalWorkerFixture(async(url,options)=>{
  storageRequests.push({url,options});return new Response(null,{headers:{'Content-Length':String(storedSize)}});
 },async(url,options)=>{
  policyRequests.push({url,options});
  if(policyFailure)throw new Error('Firebase unavailable');
  return new Response(JSON.stringify(policy),{headers:{'Content-Type':'application/json'}});
 });
 const health=()=>worker.fetch(new Request('https://files.example/health'),externalTestEnv);
 assert.equal((await (await health()).json()).maxFileBytes,100*1024*1024);
 for(const invalid of [0,-1,{},'bad']) {
  policy=invalid;assert.equal((await (await health()).json()).maxFileBytes,100*1024*1024);
 }
 policy=250.5;storedSize=200*1024*1024;
 assert.equal((await (await health()).json()).maxFileBytes,250.5*1024*1024);
 const signed=await worker.fetch(externalWorkerRequest('/sign',{path:'attachments/room/message/file',size:storedSize}),externalTestEnv);
 assert.equal(signed.status,200);const plan=await signed.json();
 assert.equal((await worker.fetch(externalWorkerRequest('/complete',{objectKey:plan.objectKey,size:storedSize}),externalTestEnv)).status,200);
 policy=1.5;
 assert.equal((await worker.fetch(externalWorkerRequest('/sign',{path:'attachments/room/message/file',size:2*1024*1024}),externalTestEnv)).status,400);
 const storageCount=storageRequests.length;
 assert.equal((await worker.fetch(externalWorkerRequest('/complete',{objectKey:plan.objectKey,size:storedSize}),externalTestEnv)).status,400);
 assert.equal(storageRequests.length,storageCount,'oversized completion is rejected before reading storage');
 assert.equal((await (await health()).json()).maxFileBytes,1.5*1024*1024,'policy changes are read on the next request');
 assert.equal(policyRequests.length,11,'each upload/health request reads the current policy');
 for(const request of policyRequests) {
  assert.equal(new URL(request.url).origin,'https://chatappv6-e9da9-default-rtdb.firebaseio.com');
  assert.equal(request.options.cache,'no-store','Firebase policy bypasses intermediary caches');
 }
 policyFailure=true;
 assert.equal((await health()).status,503);
 assert.equal((await worker.fetch(externalWorkerRequest('/sign',{path:'attachments/room/message/file',size:1}),externalTestEnv)).status,503);
});

test('external Worker streams video ranges without exposing B2 secrets',async()=>{
 let upstream;
 const worker=externalWorkerFixture(async(url,options)=>{upstream={url,options};return new Response(new Uint8Array([2,3]),{status:206,headers:{'Content-Type':'video/mp4','Content-Range':'bytes 1-2/4','Content-Length':'2','Accept-Ranges':'bytes'}});});
 const response=await worker.fetch(new Request('https://files.example/objects/attachments/room/msg/file',{headers:{Range:'bytes=1-2'}}),externalTestEnv);
 assert.equal(response.status,206); assert.equal(upstream.options.headers.Range,'bytes=1-2');
 assert.equal(response.headers.get('Content-Type'),'video/mp4'); assert.equal(response.headers.get('Content-Range'),'bytes 1-2/4');
 assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*'); assert.equal(response.headers.has('Authorization'),false);
 assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[2,3]);
});

test('external Worker permanently deletes all object versions with bounded pages and preserves pins',async()=>{
 const versions=[];const removed=[];let requests=0;
 for(let i=0;i<42;i++)versions.push({key:'attachments/room/removed/file'+String(i).padStart(2,'0'),version:'v'+i});
 versions.push({key:'attachments/room/pinned/file',version:'keep'});
 versions.push({key:'attachments/other/msg/file',version:'other'});
 const worker=externalWorkerFixture(async(raw,options)=>{
  requests++; const url=new URL(raw),key=decodeURIComponent(url.pathname.slice('/fixture-bucket/'.length));
  if(options.method==='DELETE'){
   const version=url.searchParams.get('versionId'); assert.ok(version,'delete markers alone do not free storage');
   const index=versions.findIndex(value=>value.key===key&&value.version===version);assert.notEqual(index,-1);
   removed.push(versions.splice(index,1)[0]); return new Response(null,{status:204});
  }
  const marker=url.searchParams.get('key-marker');
  const matching=versions.filter(value=>value.key.startsWith(url.searchParams.get('prefix'))&&(!marker||value.key>marker)).sort((a,b)=>a.key.localeCompare(b.key));
  const page=matching.slice(0,16),last=page.at(-1);
  return new Response('<ListVersionsResult>'+page.map(value=>`<Version><Key>${value.key}</Key><VersionId>${value.version}</VersionId></Version>`).join('')+`<IsTruncated>${matching.length>16}</IsTruncated>`+(matching.length>16?`<NextKeyMarker>${last.key}</NextKeyMarker><NextVersionIdMarker>${last.version}</NextVersionIdMarker>`:'')+'</ListVersionsResult>');
 });
 let cursor=null,pages=0;
 do{
  requests=0;
  const response=await worker.fetch(externalWorkerRequest('/delete',{prefix:'attachments/room/',keepPrefixes:['attachments/room/pinned/'],cursor}),externalTestEnv);
  assert.equal(response.status,200);cursor=(await response.json()).cursor; assert.ok(requests<=17);assert.ok(++pages<8);
 }while(cursor);
 assert.equal(removed.length,42); assert.deepEqual(versions.map(value=>value.version).sort(),['keep','other']);
});

test('external browser uploader sends raw Blob, waits for completion, and cleans failed uploads without RTDB fallback',async()=>{
 for(const failure of [false,true]) {
  const requests=[],puts=[];let completed=false;
  const app=nativeUpdateModel({CHAT_FILE_CONFIG:{endpoint:'https://files.example'},Blob,AbortController,
   fetch:async(url,options)=>{
    const body=JSON.parse(options.body);requests.push({url,body});
    if(url.endsWith('/sign'))return new Response(JSON.stringify({objectKey:'attachments/room/msg/0-uuid',contentType:'video/mp4',uploadURL:'https://s3.us-west-004.backblazeb2.com/fixture-bucket/file?signed=fixture'}));
    if(url.endsWith('/complete')){completed=true;return new Response(JSON.stringify(failure?{error:'size mismatch'}:{complete:true}),{status:failure?409:200});}
    if(url.endsWith('/delete'))return new Response(JSON.stringify({cursor:null}));
    throw new Error('Unexpected network request');
   },
   XMLHttpRequest:class{
    constructor(){this.upload={};this.headers={};}
    open(method,url){this.method=method;this.url=url;}
    setRequestHeader(name,value){this.headers[name]=value;}
    send(body){puts.push({body,method:this.method,headers:this.headers});this.status=200;queueMicrotask(()=>this.onload());}
    abort(){this.onabort?.();}
   }
  });
  app.fileUploadLimitLoaded=true;
  const file=new Blob([new Uint8Array([0,1,2,3])],{type:'video/mp4'});
  if(failure)await assert.rejects(app.uploadExternalBlob(file,{path:'attachments/room/msg/0'}),/size mismatch/);
  else {const descriptor=await app.uploadExternalBlob(file,{path:'attachments/room/msg/0'});assert.equal(app.isExternalBlobDescriptor(descriptor),true);assert.equal(descriptor.downloadURL,'https://files.example/objects/attachments/room/msg/0-uuid');}
  assert.equal(puts[0].body,file,'no base64 conversion or full-file JS buffer');assert.equal(puts[0].method,'PUT');assert.equal(puts[0].headers['Content-Type'],'video/mp4');assert.equal(completed,true);
  assert.equal(requests.some(value=>value.url.endsWith('/delete')),failure);
  await assert.rejects(app.uploadExternalBlob({size:100*1024*1024+1},{path:'attachments/room/msg/0'}),/100 MB/);
  if(!failure) {
   app.applyFileUploadLimitMB(250);
   const large={size:200*1024*1024,type:'video/mp4'};
   assert.equal((await app.uploadExternalBlob(large,{path:'attachments/room/msg/0'})).size,large.size,'raising the live limit removes the former 100 MB upload cap');
   assert.equal(puts.at(-1).body,large);
   app.applyFileUploadLimitMB(1.5);const before=requests.length;
   await assert.rejects(app.uploadExternalBlob({size:2*1024*1024},{path:'attachments/room/msg/0'}),/1.5 MB/);
   assert.equal(requests.length,before,'lowered limits stop an upload before signing');
  }
 }
 const unconfigured=nativeUpdateModel();assert.throws(()=>unconfigured.assertExternalStorageConfigured(),/needs setup/);
});

test('Android HTTPS asset origin is required on preflight and receives readable multipart ETags',async()=>{
 const worker=externalWorkerFixture(async()=>{throw new Error('Preflight must not contact storage');});
 const origin='https://appassets.androidplatform.net';
 const request=()=>new Request('https://files.example/transfer',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});
 assert.equal((await worker.fetch(request(),externalTestEnv)).status,403);
 const response=await worker.fetch(request(),{...externalTestEnv,ALLOWED_ORIGINS:externalTestEnv.ALLOWED_ORIGINS+','+origin});
 assert.equal(response.status,204);assert.match(response.headers.get('Access-Control-Expose-Headers'),/ETag/);
});

function multipartHarness({relay=false,failPart=0,loseCompletion=false,completeError=false,streaming=false}={}) {
 const crypto=require('node:crypto'), parts=new Map(),attempts=new Map(),requests=[],stats={active:0,maxActive:0,completionCalls:0,abortCalls:0,deleteCalls:0,relayCalls:0};
 let finalObject=null,finalHash='',objectKey='',uploadId='fixture-multipart-id';
 const env={...externalTestEnv,ALLOWED_ORIGINS:externalTestEnv.ALLOWED_ORIGINS+',https://appassets.androidplatform.net'};
 const backend=async(raw,options={})=>{
  const url=new URL(raw),key=decodeURIComponent(url.pathname.slice('/fixture-bucket/'.length));
  requests.push({method:options.method,key,query:Object.fromEntries(url.searchParams)});
  if(url.searchParams.has('uploads')) {objectKey=key;return new Response(`<InitiateMultipartUploadResult><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`);}
  if(options.method==='HEAD') return finalObject===null?new Response('',{status:404}):new Response(null,{headers:{'Content-Length':String(finalObject)}});
  if(options.method==='PUT') {
   const number=Number(url.searchParams.get('partNumber')||1),bytes=Buffer.from(await new Response(options.body).arrayBuffer());
   stats.active++;stats.maxActive=Math.max(stats.maxActive,stats.active);
   await new Promise(resolve=>setTimeout(resolve,2));stats.active--;
   const etag='"'+crypto.createHash('md5').update(bytes).digest('hex')+'"';
   parts.set(number,{bytes,etag});attempts.set(number,(attempts.get(number)||0)+1);
   if(number===failPart&&attempts.get(number)===1)return new Response('Temporary upstream outage',{status:503});
   if(!url.searchParams.has('uploadId')){finalObject=bytes.length;objectKey=key;finalHash=crypto.createHash('sha256').update(bytes).digest('hex');}
   return new Response(null,{headers:{ETag:etag}});
  }
  if(options.method==='POST'&&url.searchParams.has('uploadId')) {
   stats.completionCalls++;
   if(completeError)return new Response('<Error><Code>InvalidPart</Code></Error>',{status:200});
   const receipts=[...String(options.body).matchAll(/<Part><PartNumber>(\d+)<\/PartNumber><ETag>(.*?)<\/ETag><\/Part>/g)];
   assert.equal(receipts.length,parts.size);
   const hash=crypto.createHash('sha256');finalObject=0;
   for(const receipt of receipts){const part=parts.get(Number(receipt[1]));assert.equal(receipt[2].replace(/&quot;/g,'"'),part.etag);hash.update(part.bytes);finalObject+=part.bytes.length;}
   finalHash=hash.digest('hex');
   if(loseCompletion&&stats.completionCalls===1)return new Response('Lost completion reply',{status:502});
   return new Response('<CompleteMultipartUploadResult><Key>'+key+'</Key></CompleteMultipartUploadResult>');
  }
  if(options.method==='DELETE'&&url.searchParams.has('uploadId')) {stats.abortCalls++;parts.clear();return new Response(null,{status:204});}
  if(options.method==='GET'&&url.searchParams.has('versions'))return new Response('<ListVersionsResult>'+(finalObject===null?'':`<Version><Key>${objectKey}</Key><VersionId>v1</VersionId></Version>` )+'<IsTruncated>false</IsTruncated></ListVersionsResult>');
  if(options.method==='DELETE'){stats.deleteCalls++;finalObject=null;return new Response(null,{status:204});}
  throw new Error('Unexpected storage request: '+options.method+' '+url.pathname);
 };
 const worker=externalWorkerFixture(backend,async()=>new Response('200'),streaming?{FixedLengthStream:class extends TransformStream {
  constructor(expected){let length=0;super({transform(value,controller){length+=value.length;if(length>expected)throw new Error('Too many bytes');controller.enqueue(value);},flush(){if(length!==expected)throw new Error('Too few bytes');}});}
 }}:{});
 const clientFetch=async(url,options)=>worker.fetch(new Request(url,{...options,headers:{...options.headers,Origin:'https://appassets.androidplatform.net'}}),env);
 const app=nativeUpdateModel({CHAT_FILE_CONFIG:{endpoint:'https://files.example'},Blob,AbortController,setTimeout:(fn,ms)=>setTimeout(fn,ms===120000?ms:1),clearTimeout,
  fetch:clientFetch,
  XMLHttpRequest:class {
   constructor(){this.upload={};this.headers={};}
   open(method,url){this.method=method;this.url=url;}
   setRequestHeader(name,value){this.headers[name]=value;}
   getResponseHeader(name){return this.response?.headers.get(name);}
   abort(){this.aborted=true;this.onabort?.();}
   send(body){void (async()=>{
    if(relay&&this.method==='PUT'){this.onerror();return;}
    let response;
    if(this.method==='POST'){stats.relayCalls++;response=await clientFetch(this.url,{method:this.method,headers:this.headers,body});}
    else response=await backend(this.url,{method:this.method,headers:this.headers,body});
    if(this.aborted)return;
    this.response=response;this.status=response.status;this.responseText=await response.text();
    this.upload.onprogress?.({lengthComputable:true,loaded:body.size,total:body.size});this.onload();
   })().catch(error=>{this.failure=error;this.onerror();});}
  }
 });
 app.fileUploadLimitLoaded=true;app.applyFileUploadLimitMB(200);
 return {app,worker,env,parts,attempts,requests,stats,get size(){return finalObject;},get hash(){return finalHash;}};
}

test('185 MiB file uses bounded parallel multipart, retries only its failed part and preserves exact bytes after lost completion response',async()=>{
 const crypto=require('node:crypto'),bytes=Buffer.alloc(185*1024*1024);
 for(let offset=0;offset<bytes.length;offset+=4096)bytes.fill((offset/4096)%251,offset,Math.min(bytes.length,offset+4096));
 const expected=crypto.createHash('sha256').update(bytes).digest('hex');
 const harness=multipartHarness({failPart:3,loseCompletion:true}),progress=[];
 const file=new Blob([bytes],{type:'application/octet-stream'});
 const descriptor=await harness.app.uploadExternalBlob(file,{path:'attachments/room/message/file',onProgress:value=>progress.push(value)});
 assert.equal(descriptor.size,file.size);assert.equal(harness.size,file.size);assert.equal(harness.hash,expected);
 assert.equal(harness.parts.size,24);assert.equal(harness.parts.get(24).bytes.length,1024*1024);
 assert.ok([...harness.parts.values()].every(part=>part.bytes.length<=8*1024*1024));
 assert.equal(harness.attempts.get(3),2);assert.ok([...harness.attempts.entries()].every(([n,count])=>n===3||count===1));
 assert.ok(harness.stats.maxActive>1&&harness.stats.maxActive<=3);
 assert.equal(harness.stats.completionCalls,1,'completion retry HEAD recovers a successful assembly');
 assert.equal(harness.stats.deleteCalls,0);assert.equal(harness.stats.abortCalls,0);assert.equal(progress.at(-1),1);
});

test('APK multipart CORS fallback preserves bytes and the Worker rejects tampered transfer tickets',async()=>{
 const crypto=require('node:crypto'),bytes=Buffer.alloc(9*1024*1024,0xa5),harness=multipartHarness({relay:true,streaming:true});
 await harness.app.uploadExternalBlob(new Blob([bytes]),{path:'html/item/file'});
 assert.equal(harness.hash,crypto.createHash('sha256').update(bytes).digest('hex'));assert.equal(harness.stats.relayCalls,2);
 const signed=await harness.worker.fetch(externalWorkerRequest('/sign',{path:'html/item/second',size:3,multipart:true}),harness.env),plan=await signed.json();
 const token=new URL(plan.relayURL,'https://files.example').searchParams.get('ticket');
 const request=new Request('https://files.example/transfer?ticket='+encodeURIComponent(token.slice(0,-1)+(token.endsWith('0')?'1':'0')),{method:'POST',headers:{Origin:'https://chat.example'},body:new Uint8Array([1,2,3])});
 assert.equal((await harness.worker.fetch(request,harness.env)).status,403);
 const incomplete=new Request('https://files.example'+plan.relayURL,{method:'POST',headers:{Origin:'https://chat.example'},body:new Uint8Array([1,2])});
 assert.notEqual((await harness.worker.fetch(incomplete,harness.env)).status,200,'streamed relay enforces exact signed length');
});

test('file API timeout is retryable and a terminal part error cancels sibling transfers before cleanup', {timeout:2000}, async()=>{
 let triggerTimeout;
 const stalled=nativeUpdateModel({CHAT_FILE_CONFIG:{endpoint:'https://files.example'},setTimeout:fn=>{triggerTimeout=fn;return 1;},clearTimeout(){},fetch:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'}))))});
 const waiting=stalled.externalFileRequest('/sign',{});triggerTimeout();
 await assert.rejects(waiting,error=>error.transient===true&&/respond in time/.test(error.message));
 const harness=multipartHarness();let aborted=0,started=0,cleaned=false;
 harness.app.externalFileRequest=async(route,body)=>{
  if(route==='/sign')return{objectKey:'attachments/room/message/file',contentType:'application/octet-stream',ticket:'ticket',uploadId:'id',partSize:8*1024*1024};
  if(route==='/part-sign')return{uploadURL:'https://s3.us-west-004.backblazeb2.com/bucket/file?part='+body.partNumber};
  if(route==='/abort'){cleaned=true;return{aborted:true};}
  if(route==='/delete')return{cursor:null};
  throw new Error('Unexpected route');
 };
 harness.app.transferExternalPart=(_url,_blob,_contentType,signal)=>new Promise((_resolve,reject)=>{
  started++;signal.addEventListener('abort',()=>{aborted++;reject(Object.assign(new Error('aborted'),{name:'AbortError'}));},{once:true});
  if(started===1)queueMicrotask(()=>reject(Object.assign(new Error('permanent failure'),{status:403})));
 });
 await assert.rejects(harness.app.uploadExternalBlob(new Blob([new Uint8Array(9*1024*1024)]),{path:'attachments/room/message/file'}),/permanent failure/);
 assert.equal(started,2);assert.ok(aborted>=1);assert.equal(cleaned,true);
});

test('Worker rejects provider-oversized uploads before allocating a multipart session',async()=>{
 let called=false;
 const worker=externalWorkerFixture(async()=>{called=true;throw new Error('Must not allocate');},async()=>new Response('20000000'));
 const response=await worker.fetch(externalWorkerRequest('/sign',{path:'html/item/file',size:10000000000001,multipart:true}),externalTestEnv);
 assert.equal(response.status,400);assert.match((await response.json()).error,/10 TB/);assert.equal(called,false);
});

test('multipart assembly error in a 200 response never publishes a descriptor and aborts unfinished parts',async()=>{
 const harness=multipartHarness({completeError:true});
 await assert.rejects(harness.app.uploadExternalBlob(new Blob([new Uint8Array(9*1024*1024)]),{path:'attachments/room/message/file'}),/finish assembling/);
 assert.equal(harness.size,null);assert.equal(harness.stats.abortCalls,1);assert.equal(harness.parts.size,0);
});

test('external upload scopes survive Firebase reconnect and never clean an acknowledged commit',async()=>{
 const app={register(){},activeFirebaseUploads:new Map(),activeFirebaseUploadSeq:0},callbacks=[];
 vm.runInNewContext(read('js/media/uploads.js'),{ChatApp:app,AbortController,TextEncoder,Blob,URL});
 app.db={ref(){return{on(event,callback){callbacks.push(callback);}};}};
 let removed=0,armed=0;
 const scope=app.createFirebaseUploadScope({externalStorage:true,cleanup:async()=>{removed++;},disconnectRefs:[{onDisconnect(){return{remove:async()=>{armed++;}};}}]});
 await app.armFirebaseUploadDisconnect(scope);assert.equal(armed,0);
 callbacks[0]({val:()=>true});callbacks[0]({val:()=>false});assert.equal(scope.signal.aborted,false);
 app.abortFirebaseUploadsForPlaceChange('another-room');assert.equal(scope.signal.aborted,false,'room navigation keeps an external upload running');
 scope.committed=true;scope.abort('late navigation');await app.finishFirebaseUploadScope(scope);await app.cleanupFirebaseUploadScope(scope);
 assert.equal(removed,0);assert.equal(scope.done,true);assert.equal(app.activeFirebaseUploads.size,0);
});

test('late cancellation after attachment transaction acknowledgment preserves B2 objects',async()=>{
 const controller=new AbortController(),app={register(){},CHAT_FILE_MAX_COUNT:10,CHAT_FILE_MAX_BYTES:200*1024*1024,RTDB_CHUNK_UPLOAD_CONCURRENCY:3};
 vm.runInNewContext(read('js/media/uploads.js'),{ChatApp:app,AbortController,TextEncoder,Blob,URL,btoa});
 let deletes=0,commits=0;
 app.assertExternalStorageConfigured=()=>{};app.ensureFileUploadLimitLoaded=async()=>{};app.firebase={database:{ServerValue:{TIMESTAMP:1}}};
 app.db={ref:()=>({set:async()=>{},remove:async()=>{deletes++;}})};
 app.uploadExternalBlob=async blob=>({provider:'b2-worker-v1',objectKey:'attachments/room/message/file',size:blob.size});
 app.deleteExternalBlob=app.deleteExternalBlobPrefix=async()=>{deletes++;};
 const messageRef={transaction:async update=>{const result=update({userCode:'TEST'});controller.abort('navigation after server commit');return{committed:true,snapshot:{val:()=>result}};}};
 const manifest=await app.writeMessageAttachmentsToRef(messageRef,[{fileObject:new Blob(['unchanged']),kind:'file'}],{roomId:'room',msgKey:'message',signal:controller.signal,onCommitted:()=>{commits++;}});
 assert.equal(manifest.files[0].size,9);assert.equal(deletes,0);assert.equal(commits,1);
});

test('HTML commit survives late cancellation; failed database publication cleans the unreferenced object',async()=>{
 for(const fail of [false,true]) {
  let scope,cleanups=0;const app={register(){},currentUser:{code:'TEST',username:'tester'},CHAT_FILE_MAX_BYTES:1024,HTML_HUB_BY_OWNER_NODE:'owners',firebase:{database:{ServerValue:{TIMESTAMP:1}}}};
  vm.runInNewContext(read('activity-modules/library-storage.js'),{ChatApp:app,Blob,File,AbortController});
  app.assertExternalStorageConfigured=()=>{};app.ensureFileUploadLimitLoaded=async()=>{};app.makeHtmlHubId=()=> 'id';app.htmlHubPath=()=> 'html';app.htmlHubMetaPath=()=> 'meta';app.getStoredPlace=()=> 'home';
  app.createFirebaseUploadScope=value=>{const controller=new AbortController();scope={...value,controller,signal:controller.signal,abort:()=>controller.abort()};return scope;};
  app.armFirebaseUploadDisconnect=async()=>{};app.throwIfUploadAborted=signal=>{if(signal.aborted)throw new Error('aborted');};
  app.uploadExternalBlob=async()=>({provider:'b2-worker-v1',objectKey:'html/id/file',size:3});
  app.isExternalBlobDescriptor=value=>value?.provider==='b2-worker-v1'&&typeof value.objectKey==='string'&&Number.isSafeInteger(value.size);
  app.finishFirebaseUploadScope=async value=>{assert.equal(value.committed,true);};
  app.cleanupFirebaseUploadScope=async value=>{if(!value.committed){cleanups++;await value.cleanup();}};
  app.deleteExternalBlobPrefix=async()=>{};
  app.db={ref:()=>({remove:async()=>{},update:async()=>{if(fail)throw new Error('permission denied');scope.controller.abort('late cancellation');}})};
  if(fail)await assert.rejects(app.createHtmlHubItem({title:'Test',html:'abc'}),/permission denied/);
  else assert.equal(await app.createHtmlHubItem({title:'Test',html:'abc'}),'id');
  assert.equal(cleanups,fail?1:0);
 }
});

