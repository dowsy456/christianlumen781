/* Isolated UI regressions; all application data remains in the in-memory fixture. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const mock = require('./firebase-mock.js');
const appURL = pathToFileURL(path.resolve(__dirname,'../index.html')).href;
const searchStyle = page => page.evaluate(() => {
  const el=document.querySelector('#room-search-input'), input=getComputedStyle(el), field=getComputedStyle(el.parentElement);
  return {height:field.height,radius:field.borderRadius,background:field.backgroundImage,color:field.backgroundColor,border:field.border,padding:input.padding,font:input.font,fontColor:input.color};
});
const compareSearch = async (page,selector,expected) => {
  await page.locator(selector).blur();
  await page.waitForTimeout(200);
  const actual=await page.locator(selector).evaluate(el => {
    const input=getComputedStyle(el),field=getComputedStyle(el.parentElement);
    return {height:field.height,radius:field.borderRadius,background:field.backgroundImage,color:field.backgroundColor,border:field.border,padding:input.padding,font:input.font,fontColor:input.color};
  });
  assert.deepEqual(actual,expected,`${selector} shares the room search appearance`);
};
(async()=>{
  const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});
  try {
    for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:740,height:390}]) {
      const mobile=viewport.width<821;
      const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile});
      await context.addInitScript({content:`(${mock.toString()})();
        localStorage.setItem('chatapp_sidebar_position','right');
        __testDatabase.values.users['TEST-USER'].settings={sidebarPosition:'right'};`});
      await context.route(/^https?:\/\//,route=>route.fulfill({status:200,contentType:'application/json',body:'null'}));
      const page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(appURL);
      await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
      assert.equal(await page.locator('body').getAttribute('data-sidebar-position'),'left','legacy local preference cannot move the initial sidebar');
      assert.equal(await page.evaluate(()=>localStorage.getItem('chatapp_sidebar_position')),null,'retired cache is removed');
      await page.click('#btn-go-login');await page.fill('#login-code','TEST-USER');await page.click('#btn-login');
      await page.waitForFunction(()=>ChatApp.currentUser?.code==='TEST-USER');
      assert.equal(await page.evaluate(()=>Object.hasOwn(ChatApp.currentSettings,'sidebarPosition')),false,'legacy remote position is excluded from settings');
      assert.equal(await page.evaluate(()=>ChatApp.applySidebarPosition('right')),'left','legacy callers cannot restore right navigation');
      await page.evaluate(()=>ChatApp.openRoom('test',{quiet:true}));
      await page.waitForSelector('#room-search-input');
      await page.evaluate(()=>ChatApp.closeToast());
      const expected=await searchStyle(page);
      assert.equal(await page.locator('#rooms-mode-toggle').evaluate(el=>getComputedStyle(el).display),'none','no private memberships means no room toggle');
      assert.equal(await page.locator('#rooms-head').evaluate(el=>getComputedStyle(el).cursor),'default');
      assert.equal(await page.locator('#btn-side-panel').evaluate(el=>getComputedStyle(el).display),'none','admin remains owner-only');
      await page.evaluate(async()=>{
        await __testDatabase.ref('rooms/private-test').set({name:'Private test',private:true,createdBy:'TEST-USER'});
        await __testDatabase.ref('memberships/TEST-USER/private-test').set(true);
        ChatApp.currentUser.username='Vinny';ChatApp.syncPanelButtonVisibility();
      });
      await page.waitForFunction(()=>!document.querySelector('#rooms-mode-toggle').hidden);
      if(mobile) await page.evaluate(()=>ChatApp.setMobileDrawer('navigation'));
      await page.waitForTimeout(230);
      const roomHeading=await page.locator('#rooms-title').evaluate(el=>{
        const style=getComputedStyle(el),rect=el.getBoundingClientRect(),plus=document.querySelector('#btn-room-plus').getBoundingClientRect();
        return {font:style.fontFamily,uiFont:getComputedStyle(document.body).fontFamily,weight:Number(style.fontWeight),transform:style.textTransform,centerDelta:Math.abs(rect.y+rect.height/2-plus.y-plus.height/2)};
      });
      assert.equal(roomHeading.font,roomHeading.uiFont);assert.ok(roomHeading.weight>=700);assert.equal(roomHeading.transform,'none');
      assert.ok(roomHeading.centerDelta<1,'room section heading aligns with its action buttons');
      for(const id of ['btn-side-home','btn-side-calendar','btn-side-notepad','btn-side-panel','btn-side-settings','btn-room-plus','rooms-mode-toggle','btn-time-display']) {
        await page.locator(`#${id}`).scrollIntoViewIfNeeded();
        await page.waitForTimeout(60);
        const icon=page.locator(`#${id} svg`).first();
        const before=await icon.boundingBox();
        await page.locator(`#${id}`).hover();await page.waitForTimeout(230);
        const after=await icon.boundingBox();
        assert.ok(Math.abs(before.x-after.x)<.2&&Math.abs(before.y-after.y)<.2&&Math.abs(before.width-after.width)<.2&&Math.abs(before.height-after.height)<.2,`${id} hover keeps the icon still`);
      }
      if(mobile) await page.evaluate(()=>ChatApp.closeMobileDrawers());
      const admin=await page.evaluate(()=>{
        const a=document.querySelector('#btn-side-panel'),s=document.querySelector('#btn-side-settings');
        const ar=a.getBoundingClientRect(),sr=s.getBoundingClientRect();
        return {sameParent:a.parentElement===s.parentElement,before:a.nextElementSibling===s,w:ar.width,h:ar.height,sw:sr.width,sh:sr.height};
      });
      assert(admin.sameParent&&admin.before,'admin is directly left of settings');
      assert.equal(admin.w,admin.sw);assert.equal(admin.h,admin.sh);
      await page.evaluate(()=>ChatApp.toggleSidebarRoomsMode());
      assert(await page.locator('[data-room-row="private-test"]').count(),'private room appears in All Rooms');
      assert.equal(await page.locator('#rooms-title').textContent(),'All Rooms');
      assert.equal(await page.locator('#rooms-title').evaluate(el=>getComputedStyle(el).fontWeight),'700','All Rooms retains the same bold UI heading');
      assert.equal(await page.locator('#rooms-subtitle').evaluate(el=>getComputedStyle(el).display),'none','redundant subtitle cannot shift the All Rooms heading');
      await page.evaluate(async()=>{await __testDatabase.ref('memberships/TEST-USER/private-test').remove();});
      await page.waitForFunction(()=>document.querySelector('#rooms-mode-toggle').hidden);
      assert.equal(await page.locator('#rooms-mode-toggle').evaluate(el=>getComputedStyle(el).display),'none','removing last private membership hides toggle');
      const gray=await page.evaluate(()=>{
        const d=document.createElement('span');d.className='member-status-dot';d.dataset.state='offline';document.body.append(d);
        const s=getComputedStyle(d),out={background:s.backgroundColor,shadow:s.boxShadow};d.remove();return out;
      });
      assert.deepEqual(gray,{background:'rgb(128, 132, 142)',shadow:'none'});
      if(process.env.QA_SCREENSHOTS) {
        await page.evaluate(async()=>{
          for(const [id,name,preview] of [['school','School','Alice: Is the test tomorrow?'],['study','Study','Ben: Notes are ready'],['progress','Progression','No recent messages']]) {
            await __testDatabase.ref('rooms/'+id).set({name,createdBy:'TEST-USER',lastMessagePreview:preview});
            await __testDatabase.ref('memberships/TEST-USER/'+id).set(true);
          }
        });
        fs.mkdirSync(process.env.QA_SCREENSHOTS,{recursive:true});
        if(mobile) await page.evaluate(()=>ChatApp.setMobileDrawer('navigation'));
        await page.waitForTimeout(400);
        await page.screenshot({path:path.join(process.env.QA_SCREENSHOTS,`interface-rooms-${viewport.width}.png`)});
        await page.evaluate(()=>ChatApp.closeMobileDrawers?.());
      }
      await page.evaluate(()=>document.querySelector('#btn-side-settings').click());
      assert.equal(await page.locator('#btn-sidebar-left,#btn-sidebar-right').count(),0,'Sidebar Position controls are removed');
      assert.equal(await page.locator('#modal-body').evaluate(el=>el.textContent.includes('Sidebar Position')),false);
      await compareSearch(page,'#settings-search-input',expected);
      await page.fill('#settings-search-input','Auto Scroll');
      assert(await page.locator('.settings-toggle-card:has(#settings-autoscroll)').isVisible());
      if(process.env.QA_SCREENSHOTS) await page.screenshot({path:path.join(process.env.QA_SCREENSHOTS,`interface-settings-${viewport.width}.png`)});
      await page.evaluate(()=>ChatApp.closeModal());
      await page.evaluate(()=>ChatApp.openNotepadModal());
      await compareSearch(page,'#notepad-search-input',expected);
      const arrows=await page.locator('.notepad-searchbar > button').evaluateAll(buttons=>buttons.map(button=>{
        const rect=button.getBoundingClientRect(),icon=button.querySelector('svg').getBoundingClientRect();
        return {width:rect.width,height:rect.height,dx:Math.abs(rect.x+rect.width/2-icon.x-icon.width/2),dy:Math.abs(rect.y+rect.height/2-icon.y-icon.height/2)};
      }));
      assert.equal(arrows.length,2);assert.equal(arrows[0].width,arrows[1].width);assert.equal(arrows[0].height,arrows[1].height);
      assert.ok(arrows.every(arrow=>arrow.dx<.2&&arrow.dy<.2),'both Notepad arrows are centered in equal buttons');
      await page.fill('#notepad-editor','hello first\nhello second\nhello third');
      await page.fill('#notepad-search-input','hello');
      await page.press('#notepad-search-input','Enter');
      assert.equal(await page.locator('#notepad-search-status').textContent(),'1 of 3');
      await page.click('#btn-notepad-prev');
      assert.equal(await page.locator('#notepad-search-status').textContent(),'3 of 3 · wrapped');
      await page.click('#btn-notepad-next');
      assert.equal(await page.locator('#notepad-search-status').textContent(),'1 of 3 · wrapped');
      assert.equal(await page.locator('#notepad-document-stats').textContent(),'6 words · 3 lines');
      const editor=await page.locator('#notepad-editor').boundingBox();
      assert(editor.height>60&&editor.width>200,'notepad preserves usable editing space');
      assert(editor.x>=0&&editor.x+editor.width<=viewport.width+1,'editor fits viewport');
      if(process.env.QA_SCREENSHOTS) await page.screenshot({path:path.join(process.env.QA_SCREENSHOTS,`interface-notepad-${viewport.width}.png`)});
      await page.fill('#notepad-editor','İ 🧠 café CAFÉ [x] [x]');
      await page.fill('#notepad-search-input','café');
      await page.press('#notepad-search-input','Enter');
      assert.equal(await page.locator('#notepad-editor').evaluate(el=>el.value.slice(el.selectionStart,el.selectionEnd)),'café','Unicode search selects original text offsets');
      await page.click('#btn-notepad-next');
      assert.equal(await page.locator('#notepad-editor').evaluate(el=>el.value.slice(el.selectionStart,el.selectionEnd)),'CAFÉ','case-insensitive matching preserves original text');
      await page.fill('#notepad-editor','İ 🧠 [x] '.repeat(5000));
      await page.fill('#notepad-search-input','[x]');
      await page.press('#notepad-search-input','Enter');
      assert.equal(await page.locator('#notepad-search-status').textContent(),'1 of 5000','regex punctuation is matched literally');
      await page.evaluate(()=>{for(let i=0;i<99;i++) document.querySelector('#btn-notepad-next').click();});
      assert.equal(await page.locator('#notepad-search-status').textContent(),'100 of 5000','cached navigation advances through a large note');
      assert.equal(await page.locator('#notepad-editor').evaluate(el=>el.value.slice(el.selectionStart,el.selectionEnd)),'[x]');
      await page.evaluate(()=>ChatApp.closeModal());
      await page.evaluate(async()=>{
        const url='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" rx="25" fill="#458cc4"/><circle cx="50" cy="50" r="25" fill="#b8dfed"/></svg>');
        for(let i=0;i<8;i++) {
          const id='ui-sticker-'+i;
          await __testDatabase.ref('stickers/meta/'+id).set({id,name:i?'A sticker with a longer readable name '+i:"Caden's rage",kind:'image',mimeType:'image/svg+xml',state:'ready',creatorCode:'TEST-USER',creatorUsername:'Tester',createdAt:i+1});
          await __testDatabase.ref('stickers/assets/'+id).set({dataURL:url});
          await __testDatabase.ref('stickerCollections/TEST-USER/'+id).set({savedAt:i+1});
        }
        ChatApp.prepareStickerPicker();ChatApp.openStickerPopover();
      });
      await page.waitForFunction(()=>document.querySelectorAll('.sticker-tile').length===8);
      await compareSearch(page,'#sticker-search',expected);
      if(process.env.QA_SCREENSHOTS) await page.screenshot({path:path.join(process.env.QA_SCREENSHOTS,`interface-stickers-${viewport.width}.png`)});
      await page.fill('#sticker-search',"Caden's rage");
      await page.waitForFunction(()=>document.querySelectorAll('.sticker-tile').length===1);
      assert.deepEqual(errors,[]);
      console.log(`${viewport.width}x${viewport.height}: matching search inputs, owner dock, room toggle, solid offline indicator, notepad navigation/count/layout, sticker filtering passed`);
      await context.close();
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
