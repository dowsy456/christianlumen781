const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const captures = path.resolve(__dirname, '../../definition-checks');
fs.mkdirSync(captures,{recursive:true});
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const mock = require('./firebase-mock.js');
(async()=>{
  const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});
  try {
    for (const viewport of [{width:1440,height:900},{width:390,height:844}]) {
      const context=await browser.newContext({viewport});
      await context.addInitScript(mock);
      let requests=0, mode='ready';
      await context.route(/^https?:\/\//,async route=>{
        const url=route.request().url();
        if(url.includes('dictionaryapi.dev')) {
          requests++;
          if(mode==='offline') return route.abort();
          if(url.endsWith('break%20a%20leg')) return route.fulfill({status:404,contentType:'application/json',body:'{}'});
          await new Promise(resolve=>setTimeout(resolve,100));
          return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{meanings:[{partOfSpeech:'noun',definitions:[{definition:'A greeting.'},...Array.from({length:20},(_,index)=>({definition:`Extra noun sense ${index}`}))]},{partOfSpeech:'verb',definitions:[{definition:'To greet someone.'}]},{partOfSpeech:'interjection',definitions:[{definition:'Used as a greeting.'}]}]}])});
        }
        if(url.includes('wiktionary.org/api/')) {
          if(mode==='offline') return route.abort();
          return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({en:[{partOfSpeech:'Interjection',definitions:[{definition:'<a href="/wiki/good_luck">Good luck</a>! <img src="bad" onerror="window.__unsafe=true">',examples:['Perform <b>well</b>!']}]}]})});
        }
        return route.fulfill({status:200,contentType:'application/json',body:'null'});
      });
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
      await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
      await page.click('#btn-go-login');await page.fill('#login-code','TEST-USER');await page.click('#btn-login');await page.waitForFunction(()=>ChatApp.currentUser);
      await page.evaluate(async()=>{
        await __testDatabase.ref('messages/test/definitions').set({userCode:'TEST-USER',username:'Tester',text:'hello ice cream break a leg',createdAt:Date.now()});
        await ChatApp.openRoom('test',{quiet:true});ChatApp.closeToast();ChatApp.closeMobileDrawers();
      });
      await page.locator('[data-msgkey="definitions"] .bubble-text').waitFor();
      const target=async(start,end,select=false)=>page.locator('[data-msgkey="definitions"] .bubble-text').evaluate((bubble,{start,end,select})=>{
        const node=[...bubble.childNodes].find(n=>n.nodeType===3);
        const range=document.createRange();range.setStart(node,start);range.setEnd(node,end);
        const selection=getSelection();selection.removeAllRanges();if(select)selection.addRange(range);
        const rect=range.getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};
      },{start,end,select});
      let point=await target(0,5);await page.mouse.click(point.x,point.y,{button:'right'});
      await page.locator('#msg-menu [data-act="defineWord"]').waitFor({state:'visible'});
      assert.equal(requests,0,'Right-clicking does not wait on a remote dictionary to offer Define');
      assert.ok(await page.locator('#msg-menu [data-act="reply"]').isVisible(),'Normal message actions stay available');
      await page.click('#msg-menu [data-act="defineWord"]');
      await page.waitForFunction(()=>document.querySelectorAll('.msg-text-menu-definition-row').length===4);
      await page.screenshot({path:path.join(captures,`${viewport.width}-define.png`)});
      const parts=await page.locator('.msg-text-menu-part').allTextContents();assert.deepEqual(parts.slice(0,3),['noun','verb','interjection']);
      assert.equal(await page.locator('.msg-text-menu-source').getAttribute('href'),'https://en.wiktionary.org/wiki/hello#English');
      await page.evaluate(()=>ChatApp.closeMsgTextMenu(true));
      point=await target(6,15,true);await page.mouse.click(point.x,point.y,{button:'right'});
      await page.locator('#msg-text-menu [data-msg-text-act="define"]').waitFor({state:'visible'});
      assert.equal(await page.evaluate(()=>ChatApp.msgTextMenuCtx.word),'ice cream');
      await page.click('#msg-text-menu [data-msg-text-act="define"]');
      await page.waitForFunction(()=>ChatApp.msgTextMenuCtx.definitionStatus==='ready');
      await page.evaluate(()=>ChatApp.closeMsgTextMenu(true));
      point=await target(16,27,true);await page.mouse.click(point.x,point.y,{button:'right'});
      await page.click('#msg-text-menu [data-msg-text-act="define"]');
      await page.waitForFunction(()=>document.querySelector('.msg-text-menu-definition-copy')?.textContent.includes('Good luck'));
      assert.equal(await page.locator('.msg-text-menu-definition img').count(),0,'Provider markup is never inserted as active HTML');
      assert.equal(await page.evaluate(()=>window.__unsafe),undefined);
      await page.evaluate(()=>ChatApp.closeMsgTextMenu(true));
      mode='offline';
      await page.evaluate(()=>{ChatApp.msgTextDefinitionCache.clear();ChatApp.openMsgTextMenu({x:20,y:100,text:'hello',word:'hello'});});
      await page.click('#msg-text-menu [data-msg-text-act="define"]');
      await page.waitForFunction(()=>ChatApp.msgTextMenuCtx.definitionStatus==='error');
      assert.ok(await page.locator('[data-msg-text-act="define"]').isVisible(),'Outages keep the retry action visible');
      mode='ready';await page.click('#msg-text-menu [data-msg-text-act="define"]');
      await page.waitForFunction(()=>ChatApp.msgTextMenuCtx.definitionStatus==='ready');
      // Interrupted closes cannot dismiss a newly opened menu; reduced motion closes synchronously.
      await page.evaluate(()=>{ChatApp.closeMsgTextMenu();ChatApp.openMsgTextMenu({x:20,y:100,text:'ice cream',word:'ice cream'});});
      await page.waitForTimeout(170);assert.equal(await page.locator('#msg-text-menu').isVisible(),true);
      await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>ChatApp.closeMsgTextMenu());
      assert.equal(await page.locator('#msg-text-menu').isVisible(),false);
      assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${viewport.width}: pointed word, highlighted phrases, compact senses, fallback safety, retry, interrupted/reduced motion`);
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
