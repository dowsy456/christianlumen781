/* Exact chat-bottom anchoring with real layout and local Firebase fixtures only. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const installFirebaseMock = require("./firebase-mock.js");
const root = path.resolve(__dirname, "..");
const mime = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const file = path.resolve(root, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (error, data) => { res.writeHead(error ? 404 : 200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" }); res.end(error ? "Not found" : data); });
});
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(installFirebaseMock);
  await context.addInitScript(() => {
    const now = Date.now() - 100000;
    const messages = Object.fromEntries(Array.from({ length: 90 }, (_, i) => [`fixture-${String(i).padStart(4, "0")}`, { t: "text", text: `Message ${i + 1}. ` + "This room message wraps when its chat moves into a narrow companion view. ".repeat(3), userCode: "TEST-USER", username: "Tester", displayName: "Tester", createdAt: now + i * 100 }]));
    __testDatabase.values.messages = { test: messages, second: { ...messages } };
    __testDatabase.values.rooms.second = { name: "Second Room", createdBy: "TEST-USER", messageCount: 90 };
    __testDatabase.values.memberships["TEST-USER"].second = true;
    __testDatabase.values.roomMembers.second = { "TEST-USER": true };
  });
  await context.route(/^https?:\/\//, route => route.request().url().startsWith(origin) ? route.continue() : route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "null" }));
  const page = await context.newPage();
  const errors = [];
  const checks = [];
  page.on("pageerror", error => errors.push(error.message));
  const layout = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function bottom(label) {
    await page.waitForFunction(() => {
      const el = document.getElementById("messages");
      return el.clientHeight > 0 && el.scrollHeight - el.clientHeight - el.scrollTop <= 1;
    }, null, { timeout: 3000 }).catch(async error => {
      const metrics = await page.evaluate(() => ({ top: ChatApp.messagesEl.scrollTop, height: ChatApp.messagesEl.clientHeight, content: ChatApp.messagesEl.scrollHeight, following: ChatApp.chatScrollFollowing, reading: ChatApp.chatScrollUserReading, anchor: ChatApp.chatScrollReadingAnchor?.key }));
      throw new Error(`${label}: ${JSON.stringify(metrics)}: ${error.message}`);
    });
    checks.push(label);
  }
  async function openRoom(room) {
    await page.evaluate(id => ChatApp.openRoom(id, { quiet: true }), room);
    await page.waitForFunction(id => ChatApp.currentRoomId === id && !ChatApp.bulkLoading && document.querySelectorAll(".msg-row").length >= 90, room);
    await bottom(`room ${room} loaded`);
  }
  async function resizeAndSend(mode) {
    for (const side of ["left"]) {
      await page.evaluate(position => ChatApp.applySidebarPosition(position), side);
      for (const key of ["Home", "End"]) {
        await page.locator("#activity-chat-resize").focus();
        await page.keyboard.press(key);
        await bottom(`${mode} ${side} ${key} width`);
      }
    }
    await page.locator("#msg-input").fill("A composer draft that wraps across several lines in this companion. ".repeat(5));
    await layout();
    await bottom(`${mode} composer grows`);
    await page.locator("#btn-send").click();
    await page.waitForFunction(() => !document.getElementById("msg-input").value);
    await bottom(`${mode} own message and composer collapse`);
  }
  async function readingSnapshot() {
    return page.evaluate(() => {
      const bounds = ChatApp.messagesEl.getBoundingClientRect();
      const row = [...document.querySelectorAll(".msg-row")].find(node => node.getBoundingClientRect().bottom > bounds.top + 1);
      return { key: row.dataset.msgkey, offset: row.getBoundingClientRect().top - bounds.top, top: ChatApp.messagesEl.scrollTop };
    });
  }
  try {
    await page.goto(`${origin}/index.html`);
    await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
    await page.click("#btn-go-login"); await page.fill("#login-code", "TEST-USER"); await page.click("#btn-login");
    await page.waitForFunction(() => ChatApp.currentUser?.code === "TEST-USER");
    await openRoom("test");
    await page.evaluate(() => ChatApp.openMergePartyActivity("test"));
    await page.waitForFunction(() => document.querySelector("#games-frame")?.contentWindow?.__mergeParty);
    await page.frameLocator("#games-frame").locator("#activityChatBtn").click();
    await bottom("normal to activity");
    await resizeAndSend("activity");
    await page.locator("#activity-chat-close").click();
    await page.frameLocator("#games-frame").locator("#activityChatBtn").click();
    await bottom("activity chat hidden then revealed");
    await page.frameLocator("#games-frame").locator("#activityExitBtn").click();
    await page.waitForFunction(() => document.body.dataset.companionMode === "none");
    await bottom("activity to normal");
    await page.evaluate(async () => {
      await __testDatabase.ref("calls/test/members/TEST-USER").set({ code: "TEST-USER", username: "Tester", displayName: "Tester", sessionId: "scroll-fixture", connected: true, joinedAt: Date.now() });
      ChatApp.currentCallRoomId = "test"; ChatApp.callSessionId = "scroll-fixture"; ChatApp.openCallMenu();
    });
    await page.locator("#btn-call-menu-chat").click(); await bottom("normal to call");
    await resizeAndSend("call");
    await page.locator("#btn-call-menu-expand").click(); await bottom("call to normal");
    await page.evaluate(() => ChatApp.closeCallMenu());
    await page.evaluate(() => { ChatApp.openTimeDisplayModal(); ChatApp.toggleTimeDisplayChat(); });
    await page.waitForFunction(() => document.body.dataset.companionMode === "time" && document.body.dataset.companionChat === "1");
    await bottom("normal to time display"); await resizeAndSend("time");
    await page.evaluate(() => ChatApp.closeModal());
    await page.waitForFunction(() => document.body.dataset.companionMode === "none"); await bottom("time display to normal");
    // Load after all old 900–1400ms pin windows expire. The image has no
    // reserved height until decoding and exceeds the old 720px near-bottom cap.
    await page.evaluate(() => new Promise(resolve => {
      const image = document.createElement("img"); image.style.cssText = "display:block;width:180px;max-width:100%";
      document.querySelector(".msg-row:last-child .bubble").appendChild(image);
      ChatApp.keepBottomPinnedOnMedia(image);
      setTimeout(() => { image.onload = resolve; image.src = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="950"><rect width="180" height="950" fill="#314859"/></svg>'); }, 1600);
    }));
    await bottom("late image beyond previous pin window");
    // Genuine upward wheel input cancels following and subsequent media/messages
    // preserve the reader's visible message instead of snapping them down.
    await page.locator("#messages").hover(); await page.mouse.wheel(0, -1100);
    await page.waitForFunction(() => ChatApp.chatScrollUserReading && !ChatApp.chatScrollFollowing);
    await layout();
    const reading = await readingSnapshot();
    await page.evaluate(async () => {
      await __testDatabase.ref("messages/test/zz-reading-check").set({ t: "text", text: "New message while reading history", userCode: "SOMEONE-ELSE", username: "Other", createdAt: Date.now() + 5000 });
      const image = document.createElement("img"); image.style.cssText = "display:block;width:180px;height:240px";
      document.querySelector(".msg-row:last-child .bubble").appendChild(image); ChatApp.keepBottomPinnedOnMedia(image);
      image.src = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="240"/>');
    });
    await page.waitForFunction(() => ChatApp.msgDataByKey.has("zz-reading-check")); await layout();
    const afterMessages = await readingSnapshot();
    assert.equal(afterMessages.key, reading.key); assert.ok(Math.abs(afterMessages.offset - reading.offset) <= 2, "New content preserves the history anchor");
    await page.evaluate(() => { ChatApp.openTimeDisplayModal(); ChatApp.toggleTimeDisplayChat(); });
    await page.waitForFunction(() => document.body.dataset.companionChat === "1"); await layout();
    const companionReading = await readingSnapshot();
    assert.equal(companionReading.key, reading.key); assert.ok(Math.abs(companionReading.offset - reading.offset) <= 3, "Width changes preserve the history message and offset");
    await page.evaluate(() => ChatApp.closeModal()); await layout();
    const normalReading = await readingSnapshot();
    assert.equal(normalReading.key, reading.key); assert.ok(Math.abs(normalReading.offset - reading.offset) <= 3, "Returning from companion preserves history reading");
    checks.push("intentional history reading survives content and layout changes");
    await page.evaluate(() => { ChatApp.messagesEl.scrollTop = ChatApp.messagesEl.scrollHeight; });
    await bottom("manual return to bottom");
    await page.waitForFunction(() => ChatApp.chatScrollFollowing && !ChatApp.chatScrollUserReading);
    await page.evaluate(() => {
      const original = ChatApp.setRefWithRetry;
      window.__restoreSend = () => { ChatApp.setRefWithRetry = original; };
      ChatApp.setRefWithRetry = async function (...args) {
        if (String(args[0]).startsWith("messages/test/")) await new Promise(resolve => { window.__releaseSendCommit = resolve; });
        return original.apply(this, args);
      };
    });
    await page.locator("#msg-input").fill("A delayed send acknowledgement must not cancel reading history");
    await page.locator("#btn-send").click();
    await bottom("optimistic sent message");
    await page.waitForFunction(() => window.__releaseSendCommit);
    await page.locator("#messages").hover(); await page.mouse.wheel(0, -700);
    await page.waitForFunction(() => ChatApp.chatScrollUserReading); await layout();
    const beforeAck = await readingSnapshot();
    await page.evaluate(() => { __releaseSendCommit(); __restoreSend(); });
    await page.waitForFunction(() => !document.querySelector(".msg-row.stub")); await layout();
    const afterAck = await readingSnapshot();
    assert.equal(afterAck.key, beforeAck.key); assert.ok(Math.abs(afterAck.offset - beforeAck.offset) <= 2, "Delayed send acknowledgement cannot restart bottom pinning");
    checks.push("delayed send respects subsequent upward scrolling");
    await openRoom("second"); await openRoom("test");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.body.dataset.mobileUi === "1");
    await bottom("mobile normal viewport resize");
    await page.locator("#msg-input").fill("First line");
    const beforeReturn = await page.evaluate(() => Object.keys(__testDatabase.values.messages.test).length);
    await page.locator("#msg-input").press("Enter");
    await page.keyboard.type("Second line");
    assert.equal(await page.locator("#msg-input").inputValue(), "First line\nSecond line", "Mobile Return inserts a newline");
    assert.equal(await page.evaluate(() => Object.keys(__testDatabase.values.messages.test).length), beforeReturn, "Return never sends a mobile draft");
    await page.locator("#btn-send").click(); await bottom("mobile multiline message sends only with Send");
    await page.evaluate(() => {
      const target=document.querySelector('.msg-row:last-child .bubble-text');
      window.__mobileSwipeTarget=target;
      const dispatch=(type,x,y)=>target.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:[new Touch({identifier:1,target,clientX:x,clientY:y})]}));
      dispatch('touchstart',100,500); dispatch('touchmove',195,505);
    });
    await layout();
    assert.ok(await page.evaluate(()=>{
      const x=document.querySelector('.chat-main').getBoundingClientRect().x;
      return x>=94 && x<=96 && ChatApp.chatScrollFollowing && !ChatApp.chatScrollUserReading;
    }),"A horizontal touch follows the finger without switching chat into history-reading mode");
    await page.evaluate(()=>__mobileSwipeTarget.dispatchEvent(new TouchEvent('touchend',{bubbles:true,cancelable:true,touches:[]})));
    await page.waitForFunction(()=>document.body.dataset.mobileNav==='1');
    await page.evaluate(()=>ChatApp.setMobileDrawer(''));
    await page.waitForTimeout(220);
    await page.evaluate(()=>ChatApp.beginEditMessage(ChatApp.msgDataByKey.get('fixture-0089')));
    await page.locator('#msg-input').fill('Edited from phone');
    assert.equal(await page.locator('#btn-send').getAttribute('aria-label'),'Save Edit');
    await page.locator('#btn-send').click();
    await page.waitForFunction(()=>__testDatabase.values.messages.test['fixture-0089'].text==='Edited from phone');
    assert.equal(await page.locator('#composer-edit-notice').isHidden(),true,'Mobile edits have an explicit Save button and dismiss their notice');
    await page.evaluate(() => ChatApp.setMobileDrawer("navigation"));
    await page.waitForTimeout(220);
    const navigationGeometry = await page.evaluate(() => {
      const pane = document.querySelector("#sidebar-nav-surface").getBoundingClientRect();
      const chat = document.querySelector(".chat-main").getBoundingClientRect();
      return { paneLeft: pane.left, paneRight: pane.right, chatLeft: chat.left, viewport: innerWidth };
    });
    assert.ok(Math.abs(navigationGeometry.paneLeft) < 1 && Math.abs(navigationGeometry.paneRight - navigationGeometry.chatLeft) < 1);
    assert.ok(navigationGeometry.viewport - navigationGeometry.chatLeft >= 50, "A strip of the shifted chat remains visible");
    await page.screenshot({ path: path.join(root, "../mobile-navigation.png") });
    await page.evaluate(() => ChatApp.setMobileDrawer("members"));
    await page.waitForTimeout(220);
    const membersGeometry = await page.evaluate(() => {
      const pane = document.querySelector("#members-sidebar").getBoundingClientRect();
      const chat = document.querySelector(".chat-main").getBoundingClientRect();
      return { paneLeft: pane.left, paneRight: pane.right, chatRight: chat.right, viewport: innerWidth };
    });
    assert.ok(Math.abs(membersGeometry.paneRight - membersGeometry.viewport) < 1 && Math.abs(membersGeometry.paneLeft - membersGeometry.chatRight) < 1);
    await page.screenshot({ path: path.join(root, "../mobile-members.png") });
    await page.evaluate(() => ChatApp.setMobileDrawer(""));
    await page.waitForTimeout(220);
    await page.evaluate(() => { ChatApp.openTimeDisplayModal(); ChatApp.toggleTimeDisplayChat(); });
    await page.waitForFunction(() => document.body.dataset.companionMode === "time" && document.body.dataset.companionChat === "1");
    await bottom("mobile time companion entry");
    await page.evaluate(() => ChatApp.setMobileDrawer("members"));
    await page.waitForTimeout(220);
    const companionRoster = await page.evaluate(() => {
      const pane = document.querySelector("#members-sidebar").getBoundingClientRect();
      const chat = document.querySelector(".chat-main").getBoundingClientRect();
      const member = document.querySelector("#members-sidebar .member-name");
      const name = member?.getBoundingClientRect();
      return { width:pane.width, top:pane.top, chatTop:chat.top, bottom:pane.bottom, height:innerHeight, nameWidth:name?.width || 0 };
    });
    assert.ok(companionRoster.width >= 388 && Math.abs(companionRoster.top - companionRoster.chatTop) < 1, "Companion members cover the full chat width");
    assert.ok(companionRoster.bottom <= companionRoster.height + 1 && companionRoster.nameWidth > 35, "Companion roster names are visible and not clipped");
    assert.equal(await page.locator("#members-sidebar .member-name").first().evaluate(node=>{
      const rect=node.getBoundingClientRect();
      return !!document.elementFromPoint(rect.left+Math.min(5,rect.width/2),rect.top+rect.height/2)?.closest("#members-sidebar");
    }),true,"Companion roster is above the time display, not hidden under its stacking context");
    const clockControls = await page.evaluate(() => ['btn-time-display-chat','btn-time-display-expand','btn-modal-close'].map(id=>{
      const button=document.getElementById(id);
      const rect=button.getBoundingClientRect();
      return {id,...rect.toJSON(),hit:document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)?.closest('button')?.id};
    }));
    for (const control of clockControls) {
      assert.ok(control.width>=40 && control.height>=40 && control.left>=0 && control.right<=390 && control.top>=0 && control.bottom<=companionRoster.top, `Clock control stays inside its mobile stage: ${JSON.stringify(control)}`);
      assert.equal(control.hit,control.id,`Clock control ${control.id} receives its own touch target`);
    }
    for (let i=0;i<clockControls.length;i++) for(let j=i+1;j<clockControls.length;j++) {
      const a=clockControls[i],b=clockControls[j];
      assert.ok(a.right<=b.left || b.right<=a.left || a.bottom<=b.top || b.bottom<=a.top,`Clock controls ${a.id} and ${b.id} never overlap`);
    }
    checks.push('mobile expanded-clock controls have separate, reachable touch targets');
    await page.screenshot({ path: path.join(root, "../mobile-companion-members.png") });
    await page.evaluate(() => ChatApp.setMobileDrawer(""));
    for (const key of ["Home", "End"]) {
      await page.locator("#activity-chat-resize").focus(); await page.keyboard.press(key);
      await bottom(`mobile companion ${key} width`);
    }
    await page.locator("#msg-input").fill("Mobile companion draft that wraps several times");
    await bottom("mobile draft growth");
    await page.locator("#btn-send").click(); await bottom("mobile message send");
    await page.evaluate(() => ChatApp.closeModal());
    await page.waitForFunction(() => document.body.dataset.companionMode === "none"); await bottom("mobile companion to normal");
    await page.locator("#msg-input").fill("Keyboard stays above the visible viewport edge. ".repeat(6));
    await page.setViewportSize({ width:390,height:430 });
    await bottom("mobile keyboard viewport keeps newest message");
    const keyboardComposer = await page.locator("#btn-send").boundingBox();
    assert.ok(keyboardComposer.y + keyboardComposer.height <= 431 && keyboardComposer.y >= 0, "Send stays above keyboard");
    await page.screenshot({ path: path.join(root, "../mobile-keyboard.png") });
    await page.locator("#msg-input").fill("");
    await page.locator("#msg-input").blur();
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(async () => {
      await __testDatabase.ref("calls/test/members/TEST-USER").set({ code:"TEST-USER",username:"Tester",displayName:"Tester",sessionId:"mobile-call",connected:true,joinedAt:Date.now() });
      ChatApp.currentCallRoomId="test"; ChatApp.callSessionId="mobile-call"; ChatApp.openCallMenu();
    });
    await page.waitForTimeout(220);
    const controls = await page.evaluate(() => [...document.querySelectorAll("#call-menu .call-menu-controls .call-control")].filter(n=>!n.hidden && n.getClientRects().length).map(n=>({id:n.id,x:n.getBoundingClientRect().x,right:n.getBoundingClientRect().right,height:n.getBoundingClientRect().height})));
    assert.ok(controls.every(control=>control.x>=0 && control.right<=390 && control.height>=44), `Touch call controls remain onscreen: ${JSON.stringify(controls)}`);
    await page.screenshot({ path: path.join(root,"../mobile-call.png") });
    await page.setViewportSize({width:320,height:640});
    await layout();
    const narrowCall=await page.evaluate(()=>['call-menu','btn-call-leave'].map(id=>({id,...document.getElementById(id).getBoundingClientRect().toJSON()})).concat([...document.querySelectorAll('.call-menu-card,.call-menu-foot,.call-menu-controls')].map(n=>({id:n.className,...n.getBoundingClientRect().toJSON(),minWidth:getComputedStyle(n).minWidth,width:getComputedStyle(n).width}))));
    assert.ok(narrowCall[1].left>=0 && narrowCall[1].right<=320,`Leave Call stays visible on a 320px phone: ${JSON.stringify(narrowCall)}`);
    checks.push("mobile slide panes, multiline input, companion roster, keyboard and call controls");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ checks, errors }, null, 2));
    await page.screenshot({ path: path.join(root, "../chat-scroll-v3-failure.png") }).catch(() => {});
    throw error;
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
