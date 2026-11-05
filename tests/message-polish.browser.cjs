const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const mock=require('./firebase-mock.js');
(async()=>{
 const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});
 try { for(const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:940},isMobile:width<600,hasTouch:width<600});
  await context.addInitScript(mock);
  await context.route(/^https?:\/\//,r=>r.fulfill({status:200,contentType:'application/json',body:'null'}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
  await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
  await page.click('#btn-go-login');await page.fill('#login-code','TEST-USER');await page.click('#btn-login');
  await page.waitForFunction(()=>ChatApp.currentUser?.code==='TEST-USER');
  await page.evaluate(async()=>{
   Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});
   const now=Date.now();
   await __testDatabase.ref('users/PEER').set({username:'Mira',displayName:'Mira'});
   await __testDatabase.ref('messages/test/old-sticker').set({userCode:'PEER',username:'Mira',createdAt:now-2000,text:'Original message to jump to.'});
   await __testDatabase.ref('messages/test/a-reply').set({userCode:'PEER',username:'Mira',createdAt:now-1000,text:'Here is the reply.',replyTo:{key:'old-sticker',username:'Caden',previewText:'Sticker: Caden’s phone slap',attachmentCount:1}});
   await __testDatabase.ref('messages/test/b-url').set({userCode:'PEER',username:'Mira',createdAt:now,text:'Before https://example.com/'+('long-url-'.repeat(35))+' after the link.'});
   ChatApp.closeToast();await ChatApp.openRoom('test',{quiet:true});ChatApp.closeMobileDrawers();
  });
  await page.waitForSelector('.reply-preview-attachment-icon');
  await page.waitForFunction(()=>ChatApp.readReceiptState?.receipts?.['TEST-USER']);
  const geometry=await page.evaluate(()=>{
   const root=ChatApp.msgElByKey.get('a-reply');
   const snippet=root.querySelector('.reply-preview-snippet').getBoundingClientRect();
   const icon=root.querySelector('.reply-preview-attachment-icon').getBoundingClientRect();
   const link=document.querySelector('a.message-url');
   return {gap:icon.x-snippet.right,display:getComputedStyle(link).display,fragments:link.getClientRects().length,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  assert(geometry.gap>=0&&geometry.gap<=9,JSON.stringify(geometry));assert.equal(geometry.display,'inline');assert(geometry.fragments>1);assert.equal(geometry.overflow,false);
  await page.waitForFunction(()=>document.querySelector('a.message-url')?.classList.contains('url-wrap-connected'));
  const wrapping=await page.locator('a.message-url').evaluate(link=>{
   const r=[...link.getClientRects()];return {joined:link.classList.contains('url-wrap-connected'),gaps:r.slice(1).map((v,i)=>v.top-r[i].bottom)};
  });
  assert(wrapping.gaps.every(gap=>gap<=.2),JSON.stringify(wrapping));
  const single=await page.evaluate(()=>{
   const fixture=document.createElement('div');fixture.className='bubble-text';fixture.style.cssText='position:fixed;left:0;top:100px;width:280px;font:16px monospace;z-index:-1';
   fixture.innerHTML=ChatApp.formatTextWithMentions('https://one.co\nhttps://two.co');document.body.append(fixture);ChatApp.syncMessageURLWrapping();
   const short=[...fixture.querySelectorAll('.message-url')].every(link=>!link.classList.contains('url-wrap-connected'));
   fixture.innerHTML=ChatApp.formatTextWithMentions('https://example.com/'+'long'.repeat(15));
   fixture.style.width='200px';ChatApp.syncMessageURLWrapping();const narrow=fixture.querySelector('.message-url').classList.contains('url-wrap-connected');
   const padding=fixture.querySelector('.message-url').style.getPropertyValue('--url-wrap-padding');
   for(let i=0;i<12;i++)ChatApp.syncMessageURLWrapping();
   const stable=padding===fixture.querySelector('.message-url').style.getPropertyValue('--url-wrap-padding');
   fixture.style.width='1600px';ChatApp.syncMessageURLWrapping();const wide=!fixture.querySelector('.message-url').classList.contains('url-wrap-connected');
   fixture.remove();return {short,narrow,wide,stable};
  });assert.deepEqual(single,{short:true,narrow:true,wide:true,stable:true});
  await page.locator('.reply-preview').click();
  await page.waitForFunction(()=>ChatApp.msgElByKey.get('old-sticker')?.querySelector('.reply-flash'));
  const cue=await page.evaluate(()=>{
   const bubble=ChatApp.msgElByKey.get('old-sticker').querySelector('.bubble'),style=getComputedStyle(bubble,'::after');
   const rect=bubble.getBoundingClientRect().toJSON();
   return {shadow:style.boxShadow,top:style.borderTopWidth,left:style.borderLeftWidth,background:style.backgroundImage,rect};
  });assert.equal(cue.shadow,'none');assert.equal(cue.top,'0px');assert.equal(cue.left,'3px');assert(cue.background.includes('linear-gradient'));
  if(process.env.QA_SCREENSHOTS){fs.mkdirSync(process.env.QA_SCREENSHOTS,{recursive:true});await page.waitForTimeout(170);await page.screenshot({path:path.join(process.env.QA_SCREENSHOTS,`jump-cue-${width}.png`)});}
  await page.waitForTimeout(600);
  await page.evaluate(()=>ChatApp.flashMessage(ChatApp.msgElByKey.get('old-sticker')));
  await page.waitForTimeout(600);
  assert.equal(await page.locator('.reply-flash').count(),1,'a repeat jump gets its full cue lifetime');
  await page.evaluate(()=>ChatApp.flashMessage(ChatApp.msgElByKey.get('a-reply')));
  assert.equal(await page.locator('.reply-flash').count(),1,'only the most recently jumped-to message is highlighted');
  await page.waitForFunction(()=>!document.querySelector('.reply-flash'));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>ChatApp.flashMessage(ChatApp.msgElByKey.get('a-reply')));
  assert.equal(await page.locator('.reply-flash').evaluate(el=>getComputedStyle(el,'::after').animationName),'none');
  await page.emulateMedia({reducedMotion:'no-preference'});
  const results=await page.evaluate(()=>{
   const message={t:'sticker',sticker:{id:'rage',name:'Caden’s rage'},createdAt:Date.now()};
   return ["Caden's rage",'caden’s RAGE','has:sticker rage','"Caden\'s rage"'].map(q=>ChatApp.roomSearchMatches(message,ChatApp.parseRoomSearch(q)));
  });assert.deepEqual(results,[true,true,true,true]);
  assert.equal(await page.evaluate(()=>{
   ChatApp.stickerLibraryMeta.set('legacy-rage',{name:'Caden’s rage'});
   return ChatApp.roomSearchMatches({t:'sticker',stickerId:'legacy-rage'},ChatApp.parseRoomSearch("Caden's rage"));
  }),true,'legacy sticker IDs search their known library metadata');
  await page.locator('a.message-url').click();await page.waitForSelector('.message-url-popup');
  assert.equal(await page.locator('.message-url-popup [data-url-open]').getAttribute('target'),'_blank');
  assert.equal(await page.locator('.message-url-popup [data-url-open]').textContent(),'Open URL');
  assert.equal(await page.locator('.message-url-content p').evaluate(el=>getComputedStyle(el).fontFamily),await page.locator('body').evaluate(el=>getComputedStyle(el).fontFamily));
  if(process.env.QA_SCREENSHOTS)await page.screenshot({path:path.join(process.env.QA_SCREENSHOTS,`open-url-${width}.png`)});
  await page.evaluate(()=>ChatApp.closeMessageURL());
  await page.evaluate(async()=>{
   await __testDatabase.ref('.info/connected').set(false);
   await __testDatabase.ref('messages/test/c-offline').set({userCode:'PEER',text:'Do not mark this seen while disconnected.',createdAt:Date.now()+1});
   ChatApp.messagesEl.scrollTop=ChatApp.messagesEl.scrollHeight;
  });
  await page.waitForFunction(()=>ChatApp.readReceiptState?.key==='c-offline');await page.waitForTimeout(650);
  assert.equal(await page.evaluate(()=>__testDatabase.values.readReceipts.test['c-offline']?.['TEST-USER']),undefined,'offline content cannot accrue a receipt');
  assert.equal(await page.locator('.message-seen').count(),0,'new owner retires old readers');
  await page.evaluate(()=>__testDatabase.ref('.info/connected').set(true));
  await page.waitForFunction(()=>!!__testDatabase.values.readReceipts.test['c-offline']?.['TEST-USER']);
  assert.equal(await page.evaluate(()=>__testDatabase.values.readReceipts.test['b-url']),undefined,'previous readers are pruned from Firebase');
  await page.evaluate(async()=>{
   await __testDatabase.ref('readReceipts/test/c-offline/PEER2').set(Date.now());
   await __testDatabase.ref('.info/connected').set(false);
  });
  await page.waitForSelector('.message-seen-avatar[data-usercode="PEER2"]');
  assert.equal(await page.locator('.message-seen').count(),1,'a historical read remains after disconnect');
  await page.evaluate(()=>__testDatabase.ref('readReceipts/test').set({_latest:{key:'not-loaded-yet',createdAt:Date.now()+5000}}));
  await page.waitForFunction(()=>document.querySelectorAll('.message-seen').length===0);
  assert.equal(await page.evaluate(()=>ChatApp.canSeeLatestMessage()),false,'a cached tail cannot own a newer server receipt');
  await page.evaluate(async()=>{
   const now=Date.now();
   await __testDatabase.ref('rooms/unviewed').set({name:'Unviewed',messageCount:1});
   await __testDatabase.ref('messages/unviewed/older').set({userCode:'PEER',text:'Earlier',createdAt:now-1000});
   await __testDatabase.ref('readReceipts/unviewed').set({_latest:{key:'older',createdAt:now-1000},older:{PEER:now-900}});
   await ChatApp.commitRoomSystemMessage('unviewed',{type:'call_ended',createdAt:now},'fixture-ended');
  });
  await page.waitForFunction(()=>__testDatabase.values.readReceipts.unviewed._latest.key!=='older');
  assert.equal(await page.evaluate(()=>__testDatabase.values.readReceipts.unviewed.older),undefined,'system events also prune receipts without opening their room');
  if(process.env.QA_SCREENSHOTS){fs.mkdirSync(process.env.QA_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.QA_SCREENSHOTS,`message-polish-${width}.png`)});}
  assert.deepEqual(errors,[]);console.log(`${width}: connected wrapped URLs, Open URL, shared jump cue, reply attachment, sticker names, offline/reconnect receipts and latest owner passed`);
  await context.close();
 }} finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
