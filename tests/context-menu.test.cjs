const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function model(fetch) {
  const app = { register() {}, msgTextDefinitionCache: new Map() };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/chat/text-context-menu.js'), 'utf8'), { ChatApp: app, AbortController, DOMException, setTimeout, clearTimeout, fetch });
  return app;
}
test('dictionary lookup accepts punctuation, contractions and phrases without accepting sentences, URLs or numbers', () => {
  const app = model();
  for (const [text, expected] of [['“Hello!”','hello'],['by   the way','by the way'],['ice cream','ice cream'],['DON’T',"don't"],['café','café'],['mother-in-law','mother-in-law'],['a','a'],['', ''],['https://example.com',''],['1 + 2',''],['hello, how are you?',''],['one two three four five six seven eight nine','']]) assert.equal(app.getMessageDefinitionLookupWord(text), expected, text);
});
test('main senses keep all three distinct meanings, deduplicate and represent parts of speech', () => {
  const app = model();
  const main = [{ partOfSpeech:'noun', definition:'A greeting.' },{ partOfSpeech:'verb', definition:'To greet someone.' },{ partOfSpeech:'interjection', definition:'Used when greeting someone.' }];
  assert.equal(app.selectMessageDefinitionSenses(main).length,3);
  const many = [...main.slice(0,1), ...Array.from({length:20}, (_,i)=>({partOfSpeech:'noun',definition:`Additional meaning ${i}.`})), ...main.slice(1), main[0], {partOfSpeech:'noun',definition:'(obsolete) An old meaning.'}];
  const result = app.selectMessageDefinitionSenses(many);
  assert.equal(result.length,4);
  assert.deepEqual(Array.from(result.slice(0,3), item=>item.partOfSpeech), ['noun','verb','interjection']);
  assert.ok(result.every(item=>!item.definition.includes('obsolete')));
  assert.equal(app.selectMessageDefinitionSenses([{definition:'First sense'},{definition:'Second sense'},{definition:'Third sense'}]).length,3);
});
test('transient failures and absent entries are retryable while successful results are cached', async () => {
  let mode = 'failure', calls = 0;
  const app = model(async () => {
    calls++;
    if (mode==='failure') throw new TypeError('offline');
    if (mode==='missing') return {ok:false,status:404};
    return {ok:true,json:async()=>[{meanings:[{partOfSpeech:'noun',definitions:[{definition:'A greeting.'}]}]}]};
  });
  await assert.rejects(app.fetchMessageDefinitions('hello'),/offline/);
  assert.equal(app.msgTextDefinitionCache.size,0);
  mode='missing'; assert.equal((await app.fetchMessageDefinitions('hello')).length,0);
  assert.equal(app.msgTextDefinitionCache.size,0);
  mode='ready'; assert.equal((await app.fetchMessageDefinitions('hello')).length,1);
  const before=calls; await app.fetchMessageDefinitions('hello'); assert.equal(calls,before);
});
test('cancellation cannot fall through to another provider', async () => {
  let calls=0;
  const app=model(async(_url,{signal})=>{calls++; return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('canceled','AbortError'))));});
  const controller=new AbortController(); const lookup=app.fetchMessageDefinitions('hello',controller.signal); controller.abort();
  await assert.rejects(lookup,{name:'AbortError'}); assert.equal(calls,1); assert.equal(app.msgTextDefinitionCache.size,0);
});
