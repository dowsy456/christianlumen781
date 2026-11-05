/* chat/text-context-menu: methods register before ordered initialization. */
(function (App) {
  "use strict";
App.selectionIsInsideBubbleText = function (sel, bubbleText) {
  if (!sel || sel.isCollapsed || !bubbleText || !sel.rangeCount) return false;
  return bubbleText.contains(sel.anchorNode) && bubbleText.contains(sel.focusNode);
};
App.pointIsInsideSelection = function (sel, x, y) {
  if (!sel || !sel.rangeCount) return false;
  try {
    const rects = Array.from(sel.getRangeAt(0).getClientRects());
    return rects.some(r => x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2);
  } catch {
    return false;
  }
};
App.getMessageTextContextSelection = function (bubbleText, e) {
  const sel = window.getSelection?.();
  const cached = App.msgTextPointerSelection;
  if (cached?.bubbleText === bubbleText && Date.now() - cached.at < 1500 && Math.abs(cached.x - e.clientX) < 5 && Math.abs(cached.y - e.clientY) < 5) return cached.text;
  if (!App.selectionIsInsideBubbleText(sel, bubbleText)) return "";
  if (!App.pointIsInsideSelection(sel, e.clientX, e.clientY)) return "";
  const selected = String(sel.toString() || "");
  return selected.trim() ? selected : "";
};
App.getMessageDefinitionLookupWord = function (text) {
  const word = String(text || "").normalize("NFKC").replace(/[’‘]/g, "'").replace(/[‐‑–]/g, "-")
    .trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "").replace(/\s+/g, " ");
  if (!word || word.length > 100 || word.split(" ").length > 8 || !/^\p{L}[\p{L}' -]*\p{L}$|^\p{L}$/u.test(word)) return "";
  return word.toLowerCase();
};
App.getMessageWordAtPoint = function (bubbleText, event) {
  if (!bubbleText || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return "";
  let node, offset;
  if (document.caretPositionFromPoint) {
    const caret = document.caretPositionFromPoint(event.clientX, event.clientY);
    node = caret?.offsetNode; offset = caret?.offset;
  } else {
    const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    node = caret?.startContainer; offset = caret?.startOffset;
  }
  if (node?.nodeType !== 3 || !bubbleText.contains(node)) return "";
  for (const match of (node.textContent || "").matchAll(/\p{L}[\p{L}'’‐‑-]*/gu)) {
    if (offset < match.index || offset > match.index + match[0].length) continue;
    const range = document.createRange();
    range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
    if (![...range.getClientRects()].some(rect => event.clientX >= rect.left - 3 && event.clientX <= rect.right + 3 && event.clientY >= rect.top - 3 && event.clientY <= rect.bottom + 3)) continue;
    return match[0];
  }
  return "";
};
App.selectMessageDefinitionSenses = function (items) {
  const groups = new Map(), seen = new Set();
  for (const item of items || []) {
    const definition = String(item.definition || "").trim();
    const key = definition.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const partOfSpeech = String(item.partOfSpeech || "").trim().toLowerCase();
    if (!groups.has(partOfSpeech)) groups.set(partOfSpeech, []);
    groups.get(partOfSpeech).push({ ...item, definition, partOfSpeech });
  }
  const uncommon = item => /\b(archaic|obsolete|dated|historical|rare|nonstandard)\b/i.test(item.definition.slice(0, 100));
  for (const [part, senses] of groups) {
    const common = senses.filter(item => !uncommon(item));
    groups.set(part, common.length ? common : senses);
  }
  const result = [];
  // Represent different parts of speech before additional senses. The source
  // link provides the full entry without flooding a compact context menu.
  for (let round = 0; round < 4 && result.length < 4; round++) for (const senses of groups.values()) {
    if (senses[round] && result.length < 4) result.push(senses[round]);
  }
  return result;
};
App.fetchMessageDefinitions = async function (word, signal = null) {
  const key = App.getMessageDefinitionLookupWord(word);
  if (!key) return [];
  if (App.msgTextDefinitionCache.has(key)) return App.msgTextDefinitionCache.get(key);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) throw new DOMException("Definition lookup canceled", "AbortError");
  signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(cancel, 9000);
  let items = [], failure = null;
  try {
    try {
      const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`, { signal: controller.signal });
      if (!res.ok && res.status !== 404) throw new Error("Dictionary is temporarily unavailable");
      const data = res.ok ? await res.json() : [];
      for (const entry of Array.isArray(data) ? data : []) for (const meaning of entry.meanings || []) for (const item of meaning.definitions || []) {
        items.push({ partOfSpeech: meaning.partOfSpeech, definition: item.definition, example: item.example || "" });
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      failure = error;
    }
    if (!items.length && !controller.signal.aborted) {
      try {
        const res = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(key)}`, { signal: controller.signal });
        if (!res.ok && res.status !== 404) throw new Error("Dictionary is temporarily unavailable");
        const data = res.ok ? await res.json() : {};
        const plain = html => new DOMParser().parseFromString(String(html || ""), "text/html").body.textContent.trim();
        for (const meaning of data?.en || []) for (const item of meaning.definitions || []) {
          items.push({ partOfSpeech: meaning.partOfSpeech, definition: plain(item.definition), example: plain(item.examples?.[0]) });
        }
        failure = null;
      } catch (error) { failure = error; }
    }
    if (failure && !items.length) throw failure;
    const definitions = App.selectMessageDefinitionSenses(items);
    // Missing entries and outages are retryable, not permanent negative caches.
    if (definitions.length) {
      if (App.msgTextDefinitionCache.size >= 160) App.msgTextDefinitionCache.delete(App.msgTextDefinitionCache.keys().next().value);
      App.msgTextDefinitionCache.set(key, definitions);
    }
    return definitions;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
};
App.renderMsgTextDefinition = function (word, definitions, status = "ready") {
  const box = App.msgTextMenuEl?.querySelector?.(".msg-text-menu-definition");
  if (!box) return;
  const items = App.selectMessageDefinitionSenses(Array.isArray(definitions) ? definitions : []).map((item, index) => {
    const part = item.partOfSpeech ? `<span class="msg-text-menu-part">${App.escapeHtml(item.partOfSpeech)}</span>` : "";
    const example = item.example ? `<div class="msg-text-menu-example">${App.escapeHtml(item.example)}</div>` : "";
    return `<div class="msg-text-menu-definition-row"><span class="msg-text-menu-definition-num">${index + 1}</span><div class="msg-text-menu-definition-copy">${part}<div>${App.escapeHtml(item.definition)}</div>${example}</div></div>`;
  }).join("");
  const message = status === "loading" ? "Looking up this word or phrase…" : status === "error" ? "The dictionary could not be reached. Click Define to retry." : !items ? "No English dictionary entry found for this word or phrase." : "";
  const source = `https://en.wiktionary.org/wiki/${encodeURIComponent(String(word).replace(/ /g, "_"))}#English`;
  box.innerHTML = `<div class="msg-text-menu-definition-title">${App.escapeHtml(word)}</div>${items}${message ? `<div class="msg-text-menu-definition-status" role="status">${message}</div>` : ""}${status !== "loading" ? `<a class="msg-text-menu-source" href="${App.escapeHtml(source)}" target="_blank" rel="noopener noreferrer">${items ? "Full entry · Wiktionary" : "Look up on Wiktionary"} ↗</a>` : ""}`;
  box.hidden = false;
  box.setAttribute("aria-busy", String(status === "loading"));
  App.positionMsgTextMenu(App.msgTextMenuCtx?.pointerX, App.msgTextMenuCtx?.pointerY);
};
App.loadMsgTextDefinitions = async function () {
  const ctx = App.msgTextMenuCtx;
  if (!ctx?.word || ctx.definitionStatus === "loading") return;
  if (ctx.definitions.length) { App.renderMsgTextDefinition(ctx.word, ctx.definitions); return; }
  ctx.definitionStatus = "loading";
  App.renderMsgTextDefinition(ctx.word, [], "loading");
  App.msgTextDefinitionAbort?.abort();
  const controller = App.msgTextDefinitionAbort = new AbortController();
  try {
    const definitions = await App.fetchMessageDefinitions(ctx.word, controller.signal);
    if (App.msgTextMenuCtx !== ctx || controller.signal.aborted) return;
    ctx.definitions = definitions; ctx.definitionStatus = "ready";
    App.renderMsgTextDefinition(ctx.word, definitions);
  } catch {
    if (App.msgTextMenuCtx !== ctx || controller.signal.aborted) return;
    ctx.definitionStatus = "error";
    App.renderMsgTextDefinition(ctx.word, [], "error");
  }
};

App.ensureMsgTextMenu = function () {
  if (App.msgTextMenuEl) return App.msgTextMenuEl;
  App.msgTextMenuEl = document.createElement("div");
  App.msgTextMenuEl.id = "msg-text-menu";
  App.msgTextMenuEl.className = "msg-menu msg-text-menu";
  App.msgTextMenuEl.hidden = true;
  App.msgTextMenuEl.innerHTML = `
    <div class="msg-menu-user" data-msg-text-user></div>
    <button class="msg-menu-btn" type="button" data-msg-text-act="copy">
      <span class="msg-menu-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M8 8h10v12H8V8Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M6 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </span>
      <span class="msg-menu-label">Copy Text</span>
    </button>
    <button class="msg-menu-btn" type="button" data-msg-text-act="search">
      <span class="msg-menu-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="m16.2 16.2 3.8 3.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </span>
      <span class="msg-menu-label">Search Google</span>
    </button>
    <button class="msg-menu-btn" type="button" data-msg-text-act="define" hidden>
      <span class="msg-menu-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M6 4h11a2 2 0 0 1 2 2v14H8a2 2 0 0 0-2 2V4Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M6 4H5a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h1" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 8h6M9 12h5M9 16h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </span>
      <span class="msg-menu-label">Define</span>
    </button>
    <div class="msg-text-menu-definition" hidden></div>
  `;
  document.body.appendChild(App.msgTextMenuEl);
  App.msgTextMenuEl.addEventListener("click", async e => {
    const btn = e.target?.closest?.("[data-msg-text-act]");
    if (!btn || !App.msgTextMenuEl.contains(btn) || !App.msgTextMenuCtx) return;
    const act = btn.getAttribute("data-msg-text-act");
    const selectedText = String(App.msgTextMenuCtx.text || "");
    if (act === "copy") {
      try {
        await App.copyTextToClipboard(selectedText);
        App.showToast({
          title: "Copied",
          body: "Selected text copied.",
          duration: 1400
        });
      } catch {
        App.showToast({
          title: "Copy failed",
          body: "Could not copy selected text.",
          duration: 2000
        });
      }
      App.closeMsgTextMenu();
      return;
    }
    if (act === "search") {
      const q = selectedText.trim();
      if (q) window.open(`https://www.google.com/search?q=${encodeURIComponent(q)}`, "_blank", "noopener,noreferrer");
      App.closeMsgTextMenu();
      return;
    }
    if (act === "define") await App.loadMsgTextDefinitions();
  });
  document.addEventListener("pointerdown", e => {
    if (!App.msgTextMenuEl || App.msgTextMenuEl.hidden) return;
    if (App.msgTextMenuEl.contains(e.target)) return;
    App.closeMsgTextMenu();
  }, true);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") App.closeMsgTextMenu(true);
  }, true);
  window.addEventListener("resize", () => App.closeMsgTextMenu(true));
  window.addEventListener("blur", () => App.closeMsgTextMenu(true));
  return App.msgTextMenuEl;
};
App.positionMsgTextMenu = function (x, y) {
  if (!App.msgTextMenuEl || App.msgTextMenuEl.hidden) return;
  App.positionContextMenu(App.msgTextMenuEl, App.msgTextMenuCtx?.placement || { x, y });
};
App.closeMsgTextMenu = function (immediate = false) {
  App.msgTextDefinitionAbort?.abort();
  App.msgTextDefinitionAbort = null;
  App.closeContextMenu(App.msgTextMenuEl, { immediate, onClosed() {
    App.msgTextMenuCtx = null;
    const box = App.msgTextMenuEl?.querySelector(".msg-text-menu-definition");
    if (box) { box.hidden = true; box.textContent = ""; }
  } });
};
App.openMsgTextMenu = function ({
  x,
  y,
  text,
  word,
  username,
  displayName
}) {
  const selectedText = String(text || "");
  if (!selectedText.trim()) return;
  App.ensureMsgTextMenu();
  App.closeCallScreenContextMenu?.(true);
  const userEl = App.msgTextMenuEl?.querySelector?.(".msg-menu-user");
  if (userEl) userEl.textContent = String(username || displayName || "User");
  App.closeMsgMenu(true);
  App.msgTextMenuCloseSeq += 1;
  if (App.msgTextMenuCloseOnEnd) {
    App.msgTextMenuEl.removeEventListener("animationend", App.msgTextMenuCloseOnEnd);
    App.msgTextMenuCloseOnEnd = null;
  }
  if (App.msgTextDefinitionAbort) {
    try {
      App.msgTextDefinitionAbort.abort();
    } catch {}
    App.msgTextDefinitionAbort = null;
  }
  const defineBtn = App.msgTextMenuEl.querySelector('[data-msg-text-act="define"]');
  const definitionBox = App.msgTextMenuEl.querySelector(".msg-text-menu-definition");
  word = App.getMessageDefinitionLookupWord(word || selectedText);
  if (defineBtn) defineBtn.hidden = !word;
  if (definitionBox) {
    definitionBox.hidden = true;
    definitionBox.innerHTML = "";
  }
  const token = Symbol("definition-request");
  App.msgTextMenuCtx = {
    text: selectedText,
    word: word || "",
    definitions: [],
    pointerX: x,
    pointerY: y,
    placement: { x, y },
    token
  };
  App.openContextMenu(App.msgTextMenuEl);
  App.positionMsgTextMenu(x, y);
};
App.ensureMsgContextMenuDelegation = function () {
  if (App.msgContextMenuBound || !App.messagesListEl) return;
  App.msgContextMenuBound = true;
  document.addEventListener("pointerdown", event => {
    App.msgTextPointerSelection = null;
    if (event.button !== 2) return;
    const bubbleText = event.target.closest?.(".bubble-text"), sel = window.getSelection?.();
    if (App.selectionIsInsideBubbleText(sel, bubbleText) && App.pointIsInsideSelection(sel, event.clientX, event.clientY)) App.msgTextPointerSelection = { bubbleText, text: sel.toString(), x: event.clientX, y: event.clientY, at: Date.now() };
  }, true);
  document.addEventListener("contextmenu", e => {
    const ava = e.target?.closest?.(".msg-avatar");
    const bubbleText = ava ? null : e.target?.closest?.(".bubble-text");
    const row = e.target?.closest?.(".msg-row");
    if (!row) return;
    const search = !!row.closest("#room-search-results");
    if (!search && !App.messagesListEl?.contains(row)) return;
    const msgKey = row?.dataset?.msgkey || "";
    const msg = msgKey ? (search ? App.roomSearchState?.messages : App.msgDataByKey)?.get(msgKey) || null : null;
    if (msg?.t === "system") return;
    if (!msg && !ava) return;
    if (bubbleText) {
      const selectedText = App.getMessageTextContextSelection(bubbleText, e);
      if (String(selectedText || "").trim()) {
        e.preventDefault();
        e.stopPropagation();
        const code = row?.dataset?.usercode || msg?.userCode || "";
        const live = code ? App.liveUserCache.get(code) : null;
        App.openMsgTextMenu({
          x: e.clientX,
          y: e.clientY,
          text: selectedText,
          word: App.getMessageDefinitionLookupWord(selectedText),
          username: live?.username || msg?.username || "User",
          displayName: live?.displayName || msg?.displayName || live?.username || msg?.username || "User"
        });
        return;
      }
    }
    App.closeMsgTextMenu(true);
    e.preventDefault();
    e.stopPropagation();
    if (ava) {
      const code = row?.dataset?.usercode || msg?.userCode || "";
      const latest = code ? App.liveUserCache.get(code) : null;
      const uname = String(latest?.username || msg?.username || "User");
      const dname = String(latest?.displayName || msg?.displayName || uname);
      const photoDataURL = String(latest?.photoDataURL || msg?.photoDataURL || App.defaultStickmanDataURL());
      const bannerDataURL = String(latest?.bannerDataURL || msg?.bannerDataURL || "");
      const ext = App.inferImageExt(photoDataURL);
      const fn = `${App.safeFileBaseName(uname)}.${ext}`;
      const bannerFn = `${App.safeFileBaseName(uname)}-banner.${bannerDataURL ? App.inferImageExt(bannerDataURL) : "png"}`;
      App.openMsgMenuFor(ava, {
        menu: "avatar",
        userCode: code,
        username: uname,
        displayName: dname,
        imageDataURL: photoDataURL,
        imageFileName: fn,
        bannerDataURL,
        bannerFileName: bannerFn,
        pointerX: e.clientX,
        pointerY: e.clientY
      });
      return;
    }
    const code = row?.dataset?.usercode || msg?.userCode || "";
    const live = code ? App.liveUserCache.get(code) : null;
    App.openMsgMenuFor(row, {
      key: msgKey,
      roomId: search ? App.roomSearchState?.room : App.currentRoomId,
      message: msg,
      userCode: code,
      username: live?.username || msg?.username || "User",
      displayName: live?.displayName || msg?.displayName || live?.username || msg?.username || "User",
      text: msg?.text || "",
      lookupText: bubbleText ? App.getMessageWordAtPoint(bubbleText, e) : "",
      canEdit: !!(App.currentUser && String(msg?.userCode || "") === String(App.currentUser.code || "") && !msg?.__stub && msg?.t !== "sticker" && !msg?.sticker?.id && !msg?.stickerId),
      canReply: true,
      pointerX: e.clientX,
      pointerY: e.clientY
    });
  }, {
    passive: false
  });
};

App.register("chat/text-context-menu", function initializeFeature() {
App.msgContextMenuBound = false;
App.msgTextMenuEl = null;
App.msgTextMenuCtx = null;
App.msgTextDefinitionCache = new Map();
App.msgTextDefinitionAbort = null;
App.msgTextMenuCloseOnEnd = null;
App.msgTextMenuCloseSeq = 0;
App.ensureMsgContextMenuDelegation();
});
})(globalThis.ChatApp);
