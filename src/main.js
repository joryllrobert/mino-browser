const { app, BrowserWindow, Menu, shell, ipcMain, dialog, session, screen } = require("electron");
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

app.whenReady().then(() => { loadConf(); createWindow(); watch(); });
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on("window-all-closed", () => app.quit());
