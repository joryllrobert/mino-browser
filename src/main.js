const { app, BrowserWindow, Menu, shell, ipcMain, dialog, session, screen, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");

/* Keep settings from the old "Padlock Browser" name: copy its data folder once. */
try {
  const oldDir = path.join(app.getPath("appData"), "padlock-browser");
  const newDir = path.join(app.getPath("appData"), "mino-browser");
  app.setPath("userData", newDir);
  if (!fs.existsSync(newDir) && fs.existsSync(oldDir)) fs.cpSync(oldDir, newDir, { recursive: true });
} catch (e) {}

if (!app.requestSingleInstanceLock()) app.quit();

/* ---- remember window size, position and maximized state ---- */
const statePath = () => path.join(app.getPath("userData"), "window-state.json");
function loadState() {
  const def = { width: 1280, height: 820, maximized: false };
  try {
    const st = JSON.parse(fs.readFileSync(statePath(), "utf8"));
    if (!(st.width >= 480 && st.height >= 360)) return def;
    const out = { width: st.width, height: st.height, maximized: !!st.maximized };
    // only reuse the position if the window would still be visible on a connected screen
    if (Number.isFinite(st.x) && Number.isFinite(st.y)) {
      const onScreen = screen.getAllDisplays().some((d) => {
        const a = d.workArea;
        return st.x + 100 > a.x && st.x < a.x + a.width - 100 && st.y >= a.y - 10 && st.y < a.y + a.height - 60;
      });
      if (onScreen) { out.x = st.x; out.y = st.y; }
    }
    return out;
  } catch (e) { return def; }
}
let saveTimer = null;
function saveState() {
  if (!win || win.isDestroyed()) return;
  const b = win.getNormalBounds();
  try {
    fs.writeFileSync(statePath(), JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() }));
  } catch (e) {}
}
function saveStateSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveState, 400); }

let win;
function createWindow() {
  const st = loadState();
  win = new BrowserWindow({
    width: st.width,
    height: st.height,
    x: st.x,
    y: st.y,
    show: false,
    minWidth: 480,
    minHeight: 360,
    title: "Mino Browser",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    frame: false,
    backgroundColor: "#202124",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });
  Menu.setApplicationMenu(null);
  win.once("ready-to-show", () => { if (st.maximized) win.maximize(); win.show(); });
  win.on("resize", saveStateSoon);
  win.on("move", saveStateSoon);
  win.on("maximize", saveStateSoon);
  win.on("unmaximize", saveStateSoon);
  win.on("close", saveState);

  const tell = () => win && !win.isDestroyed() && win.webContents.send("win-maximized", win.isMaximized());
  win.on("maximize", tell);
  win.on("unmaximize", tell);
  win.on("enter-full-screen", () => win.webContents.send("win-maximized", true));
  win.on("leave-full-screen", tell);
  win.loadFile(path.join(__dirname, "index.html"));

  // Web pages run with no Node access, whatever the page asks for.
  win.webContents.on("will-attach-webview", (_e, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
  });
  // Links that open a new window become new tabs.
  win.webContents.on("did-attach-webview", (_e, wc) => {
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) win.webContents.send("open-url", url);
      return { action: "deny" };
    });
    hookSession(wc.session);
    wc.on("context-menu", (_ev, params) => showPageMenu(wc, params));
    // Keystrokes inside a web page never reach the app's own page, so catch shortcuts here.
    wc.on("before-input-event", (ev, input) => {
      if (input.type !== "keyDown" || !(input.control || input.meta) || input.alt) return;
      const k = String(input.key).toLowerCase();
      const name = input.shift ? (k === "k" ? "lock" : null)
        : { t: "newtab", w: "closetab", l: "focusurl", d: "bookmark", r: "reload", j: "downloads" }[k];
      if (!name) return;
      ev.preventDefault();
      win.webContents.focus();
      win.webContents.send("shortcut", name);
    });
  });
  // Never let the app shell itself navigate away.
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

ipcMain.on("win", (e, action) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  if (action === "minimize") w.minimize();
  else if (action === "maximize") (w.isMaximized() ? w.unmaximize() : w.maximize());
  else if (action === "close") w.close();
});
ipcMain.handle("win-is-maximized", (e) => { const w = BrowserWindow.fromWebContents(e.sender); return !!w && w.isMaximized(); });

/* ---- folder sync: one JSON file inside a folder the user picks ---- */
const SYNC_FILE = "padlock-sync.json";
let syncFolder = null, watcher = null, watchTimer = null;
const confPath = () => path.join(app.getPath("userData"), "sync.json");
function loadConf() { try { syncFolder = JSON.parse(fs.readFileSync(confPath(), "utf8")).folder || null; } catch (e) { syncFolder = null; } }
function saveConf() { try { fs.writeFileSync(confPath(), JSON.stringify({ folder: syncFolder })); } catch (e) {} }
function watch() {
  if (watcher) { try { watcher.close(); } catch (e) {} watcher = null; }
  if (!syncFolder) return;
  try {
    watcher = fs.watch(syncFolder, { persistent: false }, (_ev, name) => {
      if (name && name !== SYNC_FILE) return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => { if (win && !win.isDestroyed()) win.webContents.send("sync-changed"); }, 500);
    });
    watcher.on("error", () => {});
  } catch (e) {}
}
ipcMain.handle("sync-get", () => syncFolder);
ipcMain.handle("sync-choose", async (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(w, { title: "Choose a sync folder", properties: ["openDirectory", "createDirectory"] });
  if (r.canceled || !r.filePaths[0]) return syncFolder;
  syncFolder = r.filePaths[0]; saveConf(); watch();
  return syncFolder;
});
ipcMain.handle("sync-off", () => { syncFolder = null; saveConf(); watch(); return null; });
ipcMain.handle("sync-read", () => {
  if (!syncFolder) return { ok: false, error: "No sync folder is set." };
  try { return { ok: true, text: fs.readFileSync(path.join(syncFolder, SYNC_FILE), "utf8") }; }
  catch (e) { return e.code === "ENOENT" ? { ok: true, text: null } : { ok: false, error: "Cannot read the sync folder: " + e.message }; }
});
ipcMain.handle("sync-write", (_e, text) => {
  if (!syncFolder || typeof text !== "string") return { ok: false, error: "No sync folder is set." };
  const file = path.join(syncFolder, SYNC_FILE);
  try {
    try { if (fs.readFileSync(file, "utf8") === text) return { ok: true }; } catch (e) {}
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, text); fs.renameSync(tmp, file);
    return { ok: true };
  } catch (e) { return { ok: false, error: "Cannot write to the sync folder: " + e.message }; }
});
ipcMain.handle("open-external", (_e, url) => { if (typeof url === "string" && /^https?:\/\//i.test(url)) shell.openExternal(url); return true; });
ipcMain.handle("wipe-partition", async (_e, part) => {
  if (typeof part === "string" && part.startsWith("persist:profile-")) {
    try { await session.fromPartition(part).clearStorageData(); } catch (e) {}
  }
  return true;
});

/* ---- right-click menu for web pages ---- */
let navState = { back: false, fwd: false };
ipcMain.on("nav-state", (_e, back, fwd) => { navState = { back: !!back, fwd: !!fwd }; });
const isWeb = (u) => /^https?:\/\//i.test(u || "");
function showPageMenu(wc, p) {
  if (!win || win.isDestroyed()) return;
  const send = (ch, ...a) => win.webContents.send(ch, ...a);
  const sel = (p.selectionText || "").trim();
  const t = [];
  const sep = () => { if (t.length && t[t.length - 1].type !== "separator") t.push({ type: "separator" }); };

  if (p.linkURL) {
    if (isWeb(p.linkURL)) t.push({ label: "Open link in new tab", click: () => send("open-url", p.linkURL) });
    t.push({ label: "Copy link address", click: () => clipboard.writeText(p.linkURL) });
    if (isWeb(p.linkURL)) t.push({ label: "Save link as…", click: () => { saveAsPending.add(p.linkURL); wc.downloadURL(p.linkURL); } });
  }
  if (p.mediaType === "image" && p.srcURL) {
    sep();
    if (isWeb(p.srcURL)) t.push({ label: "Open image in new tab", click: () => send("open-url", p.srcURL) });
    t.push({ label: "Save image as…", click: () => { saveAsPending.add(p.srcURL); wc.downloadURL(p.srcURL); } });
    t.push({ label: "Copy image", click: () => wc.copyImageAt(p.x, p.y) });
    if (isWeb(p.srcURL)) t.push({ label: "Copy image address", click: () => clipboard.writeText(p.srcURL) });
  }
  if ((p.mediaType === "video" || p.mediaType === "audio") && isWeb(p.srcURL)) {
    sep();
    t.push({ label: "Save " + p.mediaType + " as…", click: () => { saveAsPending.add(p.srcURL); wc.downloadURL(p.srcURL); } });
    t.push({ label: "Copy " + p.mediaType + " address", click: () => clipboard.writeText(p.srcURL) });
  }
  if (p.isEditable) {
    sep();
    const f = p.editFlags || {};
    t.push({ role: "undo", enabled: !!f.canUndo }, { role: "redo", enabled: !!f.canRedo }, { type: "separator" },
      { role: "cut", enabled: !!f.canCut }, { role: "copy", enabled: !!f.canCopy }, { role: "paste", enabled: !!f.canPaste },
      { role: "selectAll", enabled: !!f.canSelectAll });
  } else if (sel) {
    sep();
    t.push({ role: "copy" });
    const short = sel.length > 28 ? sel.slice(0, 28) + "…" : sel;
    t.push({ label: "Search for “" + short.replace(/\s+/g, " ") + "”", click: () => send("search-text", sel) });
  }
  if (!p.linkURL && !(p.mediaType === "image" && p.srcURL) && !p.isEditable && !sel) {
    t.push({ label: "Back", enabled: navState.back, click: () => send("nav", "back") },
      { label: "Forward", enabled: navState.fwd, click: () => send("nav", "fwd") },
      { label: "Reload", click: () => send("nav", "reload") });
    if (isWeb(p.pageURL)) { sep(); t.push({ label: "Copy page address", click: () => clipboard.writeText(p.pageURL) }); }
  }
  sep();
  t.push({ label: "Inspect", click: () => wc.inspectElement(p.x, p.y) });
  Menu.buildFromTemplate(t).popup({ window: win });
}

/* ---- downloads ---- */
const saveAsPending = new Set();
const downloads = new Map();
const hooked = new WeakSet();
let dlSeq = 0, dlTimer = null;
const dirty = new Set();
const dlFile = () => path.join(app.getPath("userData"), "downloads.json");

function pub(d) {
  return { id: d.id, name: d.name, url: d.url, path: d.path, received: d.received, total: d.total, state: d.state,
    paused: !!d.paused, resumable: !!(d.item && d.state === "interrupted" && d.item.canResume()), time: d.time,
    exists: d.state === "completed" ? fs.existsSync(d.path) : true };
}
function flush() {
  clearTimeout(dlTimer); dlTimer = null;
  const out = [...dirty].map((id) => downloads.get(id)).filter(Boolean).map(pub);
  const gone = [...dirty].filter((id) => !downloads.has(id)).map((id) => ({ id, removed: true }));
  dirty.clear();
  if (win && !win.isDestroyed() && (out.length || gone.length)) win.webContents.send("dl-update", out.concat(gone));
}
function touch(d, now) {
  dirty.add(d.id);
  if (now) flush(); else if (!dlTimer) dlTimer = setTimeout(flush, 250);
}
function saveDownloads() {
  const done = [...downloads.values()].filter((d) => d.state !== "progressing" && d.state !== "interrupted")
    .sort((a, b) => b.time - a.time).slice(0, 100)
    .map((d) => ({ id: d.id, name: d.name, url: d.url, path: d.path, received: d.received, total: d.total, state: d.state, time: d.time }));
  try { fs.writeFileSync(dlFile(), JSON.stringify(done)); } catch (e) {}
}
function loadDownloads() {
  try {
    JSON.parse(fs.readFileSync(dlFile(), "utf8")).forEach((d) => {
      if (d && typeof d.id === "string" && typeof d.path === "string") downloads.set(d.id, Object.assign(d, { item: null, paused: false }));
    });
  } catch (e) {}
}
function uniquePath(dir, name) {
  const ext = path.extname(name), base = path.basename(name, ext);
  let p = path.join(dir, name), i = 0;
  while (fs.existsSync(p)) p = path.join(dir, base + " (" + (++i) + ")" + ext);
  return p;
}
function hookSession(ses) {
  if (hooked.has(ses)) return;
  hooked.add(ses);
  ses.on("will-download", (_e, item) => {
    const url = item.getURL();
    const askWhere = saveAsPending.delete(url);
    const name = path.basename(item.getFilename() || "download") || "download";
    const d = { id: Date.now() + "-" + (++dlSeq), name, url, path: "", received: 0, total: item.getTotalBytes(), state: "progressing", paused: false, time: Date.now(), item };
    if (!askWhere) {
      const dir = app.getPath("downloads");
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
      d.path = uniquePath(dir, name);
      item.setSavePath(d.path);
    }
    downloads.set(d.id, d);
    touch(d, true);
    item.on("updated", (_ev, state) => {
      d.received = item.getReceivedBytes(); d.total = item.getTotalBytes(); d.paused = item.isPaused();
      d.state = state === "interrupted" ? "interrupted" : "progressing";
      if (!d.path && item.getSavePath()) { d.path = item.getSavePath(); d.name = path.basename(d.path); }
      touch(d);
    });
    item.once("done", (_ev, state) => {
      d.received = item.getReceivedBytes(); d.total = item.getTotalBytes() || d.received;
      d.path = item.getSavePath() || d.path; if (d.path) d.name = path.basename(d.path);
      d.state = state; d.paused = false; d.item = null;
      if (askWhere && state === "cancelled" && d.received === 0) { downloads.delete(d.id); touch(d, true); return; }
      touch(d, true); saveDownloads();
    });
  });
}
ipcMain.handle("dl-list", () => [...downloads.values()].sort((a, b) => b.time - a.time).map(pub));
ipcMain.on("dl-act", (_e, id, action) => {
  if (action === "folder-all") { shell.openPath(app.getPath("downloads")); return; }
  if (action === "clear") {
    [...downloads.values()].forEach((d) => { if (!d.item) { downloads.delete(d.id); dirty.add(d.id); } });
    flush(); saveDownloads(); return;
  }
  const d = downloads.get(id);
  if (!d) return;
  if (action === "open" && d.state === "completed" && d.path) shell.openPath(d.path);
  else if (action === "show" && d.path) shell.showItemInFolder(d.path);
  else if (action === "pause" && d.item) { d.item.pause(); d.paused = true; touch(d, true); }
  else if (action === "resume" && d.item) { d.item.resume(); d.paused = false; touch(d, true); }
  else if (action === "cancel" && d.item) d.item.cancel();
  else if (action === "remove") {
    if (d.item) d.item.cancel();
    downloads.delete(d.id); dirty.add(d.id); flush(); saveDownloads();
  }
});

app.whenReady().then(() => { loadConf(); loadDownloads(); createWindow(); watch(); });
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on("window-all-closed", () => app.quit());
