const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("padlock", {
  onOpenUrl: (cb) => ipcRenderer.on("open-url", (_e, url) => cb(url)),
  win: (action) => ipcRenderer.send("win", action),
  isMaximized: () => ipcRenderer.invoke("win-is-maximized"),
  onMaximized: (cb) => ipcRenderer.on("win-maximized", (_e, m) => cb(m)),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  wipe: (partition) => ipcRenderer.invoke("wipe-partition", partition),
  sync: {
    get: () => ipcRenderer.invoke("sync-get"),
    choose: () => ipcRenderer.invoke("sync-choose"),
    off: () => ipcRenderer.invoke("sync-off"),
    read: () => ipcRenderer.invoke("sync-read"),
    write: (text) => ipcRenderer.invoke("sync-write", text),
    onChanged: (cb) => ipcRenderer.on("sync-changed", () => cb()),
  },
});
