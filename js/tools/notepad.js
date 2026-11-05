/* tools/notepad: methods register before ordered initialization. */
(function (App) {
  "use strict";
// sessionStorage belongs to this browser tab and is never synchronized to Firebase.
// Keep an in-memory copy as well when browser storage is unavailable or full.
const notepadDrafts = new Map();
const draftKey = () => `chat.notepad.draft.v6:${App.firebaseConfig?.projectId || "chatappv6-e9da9"}:${App.currentUser?.code || "guest"}`;
const readDraft = key => {
  if (notepadDrafts.has(key)) return notepadDrafts.get(key);
  let draft = { filename: "", text: "" };
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || "null");
    if (saved && typeof saved.filename === "string" && typeof saved.text === "string") draft = saved;
  } catch {}
  notepadDrafts.set(key, draft);
  return draft;
};
const writeDraft = (key, draft) => {
  notepadDrafts.set(key, draft);
  try { sessionStorage.setItem(key, JSON.stringify(draft)); } catch {}
};
App.stopCameraModalStream = function () {
  if (!window.__cameraModalStream) return;
  try {
    window.__cameraModalStream.getTracks().forEach(track => track.stop());
  } catch {}
  window.__cameraModalStream = null;
};
App.downloadNotepadFile = function (filename, content, mime) {
  const blob = new Blob([content], {
    type: mime
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
App.openNotepadModal = function () {
  const key = draftKey();
  let filenameEl;
  let editorEl;
  let importGeneration = 0;
  const saveDraft = () => {
    if (filenameEl && editorEl) writeDraft(key, { filename: filenameEl.value, text: editorEl.value });
  };
  App.openModal({
    title: "Notepad",
    size: "notepad",
    onBeforeClose: () => {
      importGeneration += 1;
      saveDraft();
    },
    bodyHTML: `
      <div class="notepad-app">
        <div class="notepad-filebar">
          <label class="notepad-document-name"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Zm0 0v6h6M8 13h8M8 17h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg><input class="input mono-input" id="notepad-filename" maxlength="80" spellcheck="false" placeholder="Untitled.txt" aria-label="File name" /></label>
          <div class="notepad-file-actions">
            <button class="btn tiny" id="btn-notepad-new" type="button">New</button>
            <button class="btn tiny" id="btn-notepad-open" type="button">Open</button>
            <button class="btn tiny" id="btn-notepad-copy" type="button">Copy</button>
            <button class="btn tiny primary" id="btn-notepad-download" type="button">Download</button>
          </div>
        </div>
        <div class="notepad-searchbar" role="search">
          <label class="app-search-field"><input class="app-search-input" id="notepad-search-input" type="search" placeholder="Find in note" aria-label="Find in note" autocomplete="off" spellcheck="false" data-escape-local="1" /></label>
          <button class="btn tiny" id="btn-notepad-prev" type="button" aria-label="Previous match" title="Previous match (Shift+Enter)"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 14 5-5 5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button class="btn tiny" id="btn-notepad-next" type="button" aria-label="Next match" title="Next match (Enter)"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 10 5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <span class="muted small" id="notepad-search-status" aria-live="polite">Find a word or phrase</span>
        </div>
        <input id="notepad-file-input" type="file" accept=".txt,.md,.html,.htm,.css,.js,.json,text/*" hidden />
        <textarea class="input mono-input notepad-editor" id="notepad-editor" spellcheck="false" wrap="off" placeholder="Start typing or open a text/code file…" aria-label="Notepad editor"></textarea>
        <div class="notepad-statusbar"><span id="notepad-document-stats" aria-live="off"></span><span>Draft saved in this tab</span></div>
      </div>
    `
  });
  filenameEl = App.$("notepad-filename");
  editorEl = App.$("notepad-editor");
  const draft = readDraft(key);
  if (filenameEl) filenameEl.value = draft.filename;
  if (editorEl) editorEl.value = draft.text;
  filenameEl?.addEventListener("input", () => {
    importGeneration += 1;
    saveDraft();
  });
  const fileInputEl = App.$("notepad-file-input");
  const searchEl = App.$("notepad-search-input");
  const searchStatusEl = App.$("notepad-search-status");
  let textVersion = 0;
  let cachedVersion = -1;
  let cachedNeedle = "";
  let cachedMatches = [];
  let activeNeedle = "";
  const updateStats = () => {
    const text = String(editorEl?.value || "");
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const lines = text.split("\n").length;
    const stats = App.$("notepad-document-stats");
    if (stats) stats.textContent = `${words.toLocaleString()} ${words === 1 ? "word" : "words"} · ${lines.toLocaleString()} ${lines === 1 ? "line" : "lines"}`;
  };
  updateStats();
  const matchesFor = needle => {
    if (cachedVersion !== textVersion || cachedNeedle !== needle) {
      // Regex indices refer to the original UTF-16 text. Lowercasing the entire
      // document can change its length (for example, İ) and select wrong text.
      const expression = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
      cachedMatches = Array.from(String(editorEl?.value || "").matchAll(expression), match => [match.index, match.index + match[0].length]);
      cachedVersion = textVersion;
      cachedNeedle = needle;
    }
    return cachedMatches;
  };
  const findMatch = (direction = 1) => {
    if (!editorEl || !searchEl) return;
    const needle = String(searchEl.value || "");
    if (!needle) {
      if (searchStatusEl) searchStatusEl.textContent = "Type a word, then press Enter.";
      return;
    }
    const matches = matchesFor(needle);
    const continuing = needle === activeNeedle;
    activeNeedle = needle;
    if (!matches.length) {
      if (searchStatusEl) searchStatusEl.textContent = "No matches.";
      searchEl.focus({
        preventScroll: true
      });
      return;
    }
    const from = direction < 0 ? continuing ? editorEl.selectionStart : Infinity : continuing ? editorEl.selectionEnd : 0;
    // Cached offsets keep repeated next/previous navigation logarithmic even
    // in a large imported note. Both directions use the same nonoverlapping set.
    let low = 0, high = matches.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (matches[middle][0] < from) low = middle + 1; else high = middle;
    }
    let position = direction < 0 ? low - 1 : low;
    const wrapped = position < 0 || position >= matches.length;
    if (wrapped) position = direction < 0 ? matches.length - 1 : 0;
    const [start, end] = matches[position];
    editorEl.focus({
      preventScroll: true
    });
    editorEl.setSelectionRange(start, end, direction < 0 ? "backward" : "forward");
    if (searchStatusEl) searchStatusEl.textContent = `${position + 1} of ${matches.length}${wrapped ? " · wrapped" : ""}`;
  };
  editorEl?.addEventListener("input", () => {
    importGeneration += 1;
    saveDraft();
    updateStats();
    textVersion += 1;
    activeNeedle = "";
    if (searchStatusEl && searchEl?.value) searchStatusEl.textContent = "Text changed · press Enter to search.";
  });
  editorEl?.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === "f") {
      event.preventDefault();
      searchEl?.focus({
        preventScroll: true
      });
      searchEl?.select();
    } else if (event.key === "F3") {
      event.preventDefault();
      findMatch(event.shiftKey ? -1 : 1);
    }
  });
  searchEl?.addEventListener("input", () => {
    activeNeedle = "";
    if (searchStatusEl) searchStatusEl.textContent = searchEl.value ? "Press Enter to find." : "Type a word, then press Enter.";
  });
  searchEl?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      findMatch(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      searchEl.value = "";
      activeNeedle = "";
      if (searchStatusEl) searchStatusEl.textContent = "Search cleared.";
      editorEl?.focus({
        preventScroll: true
      });
    }
  });
  App.$("btn-notepad-prev")?.addEventListener("click", () => findMatch(-1));
  App.$("btn-notepad-next")?.addEventListener("click", () => findMatch(1));
  App.$("btn-notepad-new")?.addEventListener("click", () => {
    importGeneration += 1;
    if (editorEl) editorEl.value = "";
    if (filenameEl) filenameEl.value = "";
    if (fileInputEl) fileInputEl.value = "";
    saveDraft();
    updateStats();
    textVersion += 1;
    cachedVersion = -1;
    activeNeedle = "";
    if (searchStatusEl) searchStatusEl.textContent = "New note ready.";
    editorEl?.focus({
      preventScroll: true
    });
  });
  App.$("btn-notepad-open")?.addEventListener("click", () => fileInputEl?.click());
  fileInputEl?.addEventListener("change", async () => {
    const file = fileInputEl.files?.[0];
    if (!file) return;
    fileInputEl.value = "";
    const generation = ++importGeneration;
    try {
      const value = await file.text();
      // A slow read must not overwrite newer edits, New, a replacement import,
      // or a note reopened after this modal was closed.
      if (generation !== importGeneration || !editorEl?.isConnected) return;
      if (editorEl) editorEl.value = value;
      if (filenameEl) filenameEl.value = file.name || "";
      saveDraft();
      updateStats();
      textVersion += 1;
      cachedVersion = -1;
      activeNeedle = "";
      if (searchStatusEl) searchStatusEl.textContent = `${file.name || "File"} opened.`;
    } catch {
      if (generation !== importGeneration || !editorEl?.isConnected) return;
      App.showToast({
        title: "Open failed",
        body: "That file could not be opened.",
        duration: 2600
      });
    }
  });
  App.$("btn-notepad-copy")?.addEventListener("click", async () => {
    try {
      await App.copyTextToClipboard(editorEl?.value || "");
      App.showToast({
        title: "Copied",
        body: "The full note was copied.",
        duration: 1800
      });
    } catch {
      App.showToast({
        title: "Copy failed",
        body: "Could not copy that note.",
        duration: 2200
      });
    }
  });
  App.$("btn-notepad-download")?.addEventListener("click", () => {
    const safeName = String(filenameEl?.value || "").trim().replace(/[\\/:*?"<>|]+/g, "_");
    if (!safeName || !/.+\.[A-Za-z0-9]{1,16}$/.test(safeName)) {
      App.showToast({
        title: "File name required",
        body: "Use a file name with an extension, such as notes.txt or page.html.",
        duration: 2600
      });
      return;
    }
    const ext = safeName.split(".").pop().toLowerCase();
    const mime = /^(html|htm)$/.test(ext) ? "text/html;charset=utf-8" : "text/plain;charset=utf-8";
    App.downloadNotepadFile(safeName, editorEl?.value || "", mime);
  });
  requestAnimationFrame(() => editorEl?.focus({
    preventScroll: true
  }));
};

App.register("tools/notepad", function initializeFeature() {

});
})(globalThis.ChatApp);
