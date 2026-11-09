(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var mem = {};
  var store = {
    get: function (k) { try { var v = localStorage.getItem(k); return v === null ? (mem[k] === undefined ? null : mem[k]) : v; } catch (e) { return mem[k] === undefined ? null : mem[k]; } },
    set: function (k, v) { mem[k] = v; try { localStorage.setItem(k, v); } catch (e) {} }
  };
  var KEYS = { pw: "padlock.pw", salt: "padlock.salt", bm: "padlock.bookmarks" };

  /* ---------- helpers ---------- */
  function h(tag, props) {
    var e = document.createElement(tag);
    if (props) for (var k in props) {
      if (k === "text") e.textContent = props[k];
      else if (k === "class") e.className = props[k];
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), props[k]);
      else e.setAttribute(k, props[k]);
    }
    for (var i = 2; i < arguments.length; i++) if (arguments[i]) e.appendChild(arguments[i]);
    return e;
  }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u; } }
  function colorFor(s) {
    var n = 0; for (var i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0;
    return "hsl(" + (n % 360) + " 45% 42%)";
  }
  function fav(url, extra) {
    var hn = host(url);
    var f = h("span", { class: "fav" + (extra ? " " + extra : ""), text: (hn[0] || "?").toUpperCase() });
    f.style.background = colorFor(hn);
    return f;
  }
  var ENGINES = [
    { id: "ddg", name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
    { id: "google", name: "Google", url: "https://www.google.com/search?q=%s" },
    { id: "bing", name: "Bing", url: "https://www.bing.com/search?q=%s" },
    { id: "brave", name: "Brave Search", url: "https://search.brave.com/search?q=%s" },
    { id: "ecosia", name: "Ecosia", url: "https://www.ecosia.org/search?q=%s" },
    { id: "startpage", name: "Startpage", url: "https://www.startpage.com/do/search?q=%s" }
  ];
  var searchTpl = store.get("padlock.search") || ENGINES[0].url;
  function searchUrl(q) { return searchTpl.replace("%s", encodeURIComponent(q)); }
  function normalize(v) {
    v = v.trim();
    if (!v) return "";
    if (/^https?:\/\//i.test(v)) return v;
    if (!/\s/.test(v) && (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(v) || /^localhost(:\d+)?(\/.*)?$/.test(v))) return "https://" + v;
    return searchUrl(v);
  }

  /* ---------- password lock ---------- */
  function sha(pw, salt) {
    if (window.crypto && crypto.subtle) {
      return crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + ":" + pw)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
      });
    }
    return Promise.resolve(btoa(unescape(encodeURIComponent(salt + ":" + pw))));
  }
  function newSalt() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

  var lockEl = $("#lock"), lockForm = $("#lockform"), lockPw = $("#lockpw"), lockPw2 = $("#lockpw2");
  var lockErr = $("#lockerr"), fails = 0, blockedUntil = 0, setupMode = false;

  function showLock() {
    closePops();
    $("#modalwrap").hidden = true;
    setupMode = !store.get(KEYS.pw);
    lockPw.value = ""; lockPw2.value = ""; lockErr.textContent = "";
    $("#confirmwrap").hidden = !setupMode;
    $("#locktitle").textContent = setupMode ? "Create a password" : "Enter password";
    $("#locksub").textContent = setupMode ? "You will need it every time this browser opens." : "Your tabs and bookmarks are waiting.";
    $("#locksubmit").textContent = setupMode ? "Set password and open" : "Unlock";
    lockPw.autocomplete = setupMode ? "new-password" : "current-password";
    lockEl.hidden = false; $("#app").classList.add("locked");
    setTimeout(function () { lockPw.focus(); }, 30);
  }
  lockForm.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var pw = lockPw.value;
    if (setupMode) {
      if (pw.length < 4) { lockErr.textContent = "Use at least 4 characters."; return; }
      if (pw !== lockPw2.value) { lockErr.textContent = "The two passwords do not match."; return; }
      var salt = newSalt();
      sha(pw, salt).then(function (hh) { store.set(KEYS.salt, salt); store.set(KEYS.pw, hh); unlock(); });
      return;
    }
    var now = Date.now();
    if (now < blockedUntil) { lockErr.textContent = "Too many attempts. Try again in " + Math.ceil((blockedUntil - now) / 1000) + " seconds."; return; }
    sha(pw, store.get(KEYS.salt) || "").then(function (hh) {
      if (hh === store.get(KEYS.pw)) { fails = 0; unlock(); }
      else {
        fails++;
        lockPw.value = ""; lockPw.focus();
        if (fails >= 3) { blockedUntil = Date.now() + 5000 * (fails - 2); lockErr.textContent = "Wrong password. Wait " + (5 * (fails - 2)) + " seconds before trying again."; }
        else lockErr.textContent = "Wrong password. Try again.";
      }
    });
  });
  function unlock() { lockEl.hidden = true; $("#app").classList.remove("locked"); syncNow(); lockPw.value = ""; lockPw2.value = ""; if (!tabs.length) newTab(); else show(); }

  $("#lockbtn").addEventListener("click", showLock);

  /* ---------- profiles, bookmarks, sync ---------- */
  var api = window.padlock || {};
  var DEFAULT_UA = navigator.userAgent.replace(/\s*(padlock-browser|mino-browser|Mino Browser|Electron)\/\S+/g, "");
  var CV = (DEFAULT_UA.match(/Chrome\/(\S+)/) || [0, "130.0.0.0"])[1];
  var UA_PRESETS = [
    { id: "default", name: "Default (Chrome on Linux)", ua: DEFAULT_UA },
    { id: "firefox", name: "Firefox on Linux", ua: "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0" },
    { id: "safari", name: "Safari on Mac", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15" },
    { id: "win", name: "Chrome on Windows", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + CV + " Safari/537.36" },
    { id: "android", name: "Android phone", ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + CV + " Mobile Safari/537.36" }
  ];
  var UA = store.get("padlock.ua") || DEFAULT_UA;
  function setUA(ua) {
    UA = ua || DEFAULT_UA; store.set("padlock.ua", UA === DEFAULT_UA ? "" : UA);
    profiles.forEach(function (p) {
      p.tabs.forEach(function (t) { if (t.frame && t.hist[t.i] !== "newtab") { try { t.frame.setUserAgent(UA); t.frame.reload(); } catch (e) {} } });
    });
  }
  function rid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  var COLORS = ["#1a73e8", "#d93025", "#188038", "#e37400", "#a142f4", "#007b83", "#c2185b", "#5f6368"];
  var SEED = [
    { name: "Wikipedia", url: "https://en.wikipedia.org/" },
    { name: "MDN Web Docs", url: "https://developer.mozilla.org/" },
    { name: "OpenStreetMap", url: "https://www.openstreetmap.org/" },
    { name: "Internet Archive", url: "https://archive.org/" }
  ];
  var profiles = [], cur = null, bookmarks = [], tombs = [];
  function bmKey(id) { return "padlock.bm." + id; }
  function visible() { return profiles.filter(function (p) { return !p.deleted; }); }
  function splitBm(p, list) {
    p.bookmarks = list.filter(function (x) { return !x.deleted; });
    p.tombs = list.filter(function (x) { return x.deleted; });
  }
  function allBm(p) { return p.bookmarks.concat(p.tombs); }
  function partOf(pid) { return pid === "default" ? "persist:padlock" : "persist:profile-" + pid; }

  function saveProfiles() {
    store.set("padlock.profiles", JSON.stringify(profiles.map(function (p) { return { id: p.id, name: p.name, color: p.color, updated: p.updated, deleted: !!p.deleted }; })));
  }
  function saveBm(p) { p = p || cur; store.set(bmKey(p.id), JSON.stringify(allBm(p))); }

  function loadProfiles() {
    var raw = store.get("padlock.profiles"), list = [];
    try { list = raw ? JSON.parse(raw) : []; } catch (e) { list = []; }
    if (!list.length) list = [{ id: "default", name: "Person 1", color: COLORS[0], updated: 1 }];
    profiles = list.map(function (m) {
      var p = { id: m.id, name: m.name, color: m.color, updated: m.updated || 0, deleted: !!m.deleted, tabs: [], activeId: null, bookmarks: [], tombs: [] };
      var items = null, braw = store.get(bmKey(p.id));
      if (braw) { try { items = JSON.parse(braw); } catch (e) { items = null; } }
      if (!items && p.id === "default") {
        var legacy = store.get(KEYS.bm);
        if (legacy) { try { items = JSON.parse(legacy).map(function (b) { return { id: rid(), name: b.name, url: b.url, updated: 1 }; }); } catch (e) { items = null; } }
        if (!items) items = SEED.map(function (b, i) { return { id: "seed" + i, name: b.name, url: b.url, updated: 1 }; });
      }
      splitBm(p, items || []);
      return p;
    });
    if (!visible().length) profiles.push({ id: rid(), name: "Person 1", color: COLORS[0], updated: Date.now(), deleted: false, tabs: [], activeId: null, bookmarks: [], tombs: [] });
    var want = store.get("padlock.cur");
    cur = visible().filter(function (p) { return p.id === want; })[0] || visible()[0];
    saveProfiles();
  }
  function bind() { tabs = cur.tabs; activeId = cur.activeId; rebindBm(); }
  function rebindBm() { bookmarks = cur.bookmarks; tombs = cur.tombs; }

  function findBm(url) { for (var i = 0; i < bookmarks.length; i++) if (bookmarks[i].url === url) return i; return -1; }
  function changed() { saveBm(); renderAllBm(); scheduleSync(); }
  function addBm(name, url) { bookmarks.push({ id: rid(), name: name, url: url, updated: Date.now() }); changed(); }
  function delBm(b) {
    var i = bookmarks.indexOf(b); if (i < 0) return;
    bookmarks.splice(i, 1); tombs.push({ id: b.id, deleted: true, updated: Date.now() }); changed();
  }
  function cleanUrl(v) {
    v = (v || "").trim(); if (!v) return "";
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = "https://" + v;
    try { var u = new URL(v); return /^https?:$/.test(u.protocol) && u.hostname ? v : ""; } catch (e) { return ""; }
  }

  function bmButton(b, cls) {
    var isTile = cls === "tile";
    return h("button", { class: cls, title: b.url, onclick: function () { navigate(b.url); }, oncontextmenu: function (e) { e.preventDefault(); showBmCtx(e, b); } }, fav(b.url), h("span", { text: b.name }));
  }
  function renderBmBar() {
    var bar = $("#bmbar"); bar.textContent = "";
    if (!bookmarks.length) bar.appendChild(h("span", { class: "bm-empty", text: "Bookmarks you save with the star appear here." }));
    bookmarks.forEach(function (b) { bar.appendChild(bmButton(b, "bm")); });
  }
  function renderTiles() {
    var t = $("#tiles"); t.textContent = "";
    bookmarks.slice(0, 8).forEach(function (b) { t.appendChild(bmButton(b, "tile")); });
  }
  function renderProfileBtn() {
    var b = $("#profbtn"); if (!cur) return;
    b.textContent = (cur.name[0] || "?").toUpperCase(); b.style.background = cur.color; b.title = cur.name + " (profile)";
  }
  function renderAllBm() { renderBmBar(); renderTiles(); updateChrome(); }

  /* generic in-page form (no prompt() in a desktop app either) */
  var gwrap = $("#gwrap"), gHandler = null;
  function openForm(o) {
    closePops();
    $("#gtitle").textContent = o.title;
    var m = $("#gmsg"); m.textContent = o.message || ""; m.hidden = !o.message;
    var box = $("#gfields"); box.textContent = "";
    (o.fields || []).forEach(function (f) {
      box.appendChild(h("div", { class: "field" }, h("label", { for: "gf-" + f.id, text: f.label }), h("input", { id: "gf-" + f.id, type: "text", value: f.value || "", spellcheck: "false", autocomplete: "off" })));
    });
    $("#gerr").textContent = "";
    var ok = $("#gok"); ok.textContent = o.ok || "Save"; ok.className = "btn " + (o.danger ? "danger-fill" : "primary");
    gHandler = o.onSubmit; gwrap.hidden = false;
    var first = box.querySelector("input"); if (first) { first.focus(); first.select(); } else ok.focus();
  }
  $("#gform").addEventListener("submit", function (e) {
    e.preventDefault();
    var vals = {};
    Array.prototype.forEach.call(document.querySelectorAll("#gfields input"), function (i) { vals[i.id.slice(3)] = i.value; });
    var err = gHandler && gHandler(vals);
    if (err) $("#gerr").textContent = err; else gwrap.hidden = true;
  });
  $("#gcancel").addEventListener("click", function () { gwrap.hidden = true; });

  /* right-click menu for a bookmark */
  var ctx = $("#ctx");
  function editBmForm(b) {
    openForm({
      title: "Edit bookmark", ok: "Save",
      fields: [{ id: "name", label: "Name", value: b.name }, { id: "url", label: "URL", value: b.url }],
      onSubmit: function (v) {
        var u = cleanUrl(v.url);
        if (!u) return "Enter a web address that starts with http:// or https://.";
        b.name = v.name.trim() || host(u); b.url = u; b.updated = Date.now(); changed();
      }
    });
  }
  function showBmCtx(e, b) {
    closePops(); ctx.textContent = "";
    function item(label, fn, cls) { ctx.appendChild(h("button", { class: "item" + (cls ? " " + cls : ""), role: "menuitem", onclick: function () { ctx.hidden = true; fn(); } }, h("span", { text: label }))); }
    item("Open", function () { navigate(b.url); });
    item("Open in new tab", function () { newTab(b.url); });
    ctx.appendChild(h("hr"));
    item("Edit…", function () { editBmForm(b); });
    item("Delete", function () { delBm(b); }, "danger-text");
    ctx.hidden = false;
    var w = ctx.offsetWidth, hh = ctx.offsetHeight;
    ctx.style.left = Math.max(4, Math.min(e.clientX, window.innerWidth - w - 4)) + "px";
    ctx.style.top = Math.max(4, Math.min(e.clientY, window.innerHeight - hh - 4)) + "px";
  }
  ctx.addEventListener("click", function (e) { e.stopPropagation(); });

  /* star popover */
  var starBtn = $("#star"), bmPop = $("#bmpop");
  starBtn.addEventListener("click", function (ev) {
    ev.stopPropagation();
    var t = active(); if (!t) return;
    var c = t.hist[t.i];
    if (c === "newtab") return;
    closePops();
    var idx = findBm(c);
    if (idx < 0) { addBm(host(c), c); idx = bookmarks.length - 1; }
    $("#bmname").value = bookmarks[idx].name;
    bmPop.hidden = false;
    $("#bmname").focus(); $("#bmname").select();
  });
  function commitBmName() {
    var t = active(); if (!t) return;
    var idx = findBm(t.hist[t.i]);
    if (idx >= 0) { bookmarks[idx].name = $("#bmname").value.trim() || host(bookmarks[idx].url); bookmarks[idx].updated = Date.now(); changed(); }
  }
  $("#bmdone").addEventListener("click", function () { commitBmName(); bmPop.hidden = true; });
  $("#bmname").addEventListener("keydown", function (e) { if (e.key === "Enter") { commitBmName(); bmPop.hidden = true; } });
  $("#bmremove").addEventListener("click", function () {
    var t = active(); var idx = t ? findBm(t.hist[t.i]) : -1;
    if (idx >= 0) delBm(bookmarks[idx]);
    bmPop.hidden = true;
  });
  bmPop.addEventListener("click", function (e) { e.stopPropagation(); });

  /* profiles */
  var profPop = $("#profpop");
  function switchProfile(id) {
    var p = visible().filter(function (x) { return x.id === id; })[0];
    if (!p || p === cur) return;
    cur.activeId = activeId;
    tabs.forEach(function (t) { if (t.frame) t.frame.hidden = true; });
    cur = p; bind(); store.set("padlock.cur", cur.id);
    if (!tabs.length) newTab(); else show();
    renderAllBm(); renderProfileBtn();
  }
  function addProfile(name) {
    var p = { id: rid(), name: name, color: COLORS[visible().length % COLORS.length], updated: Date.now(), deleted: false, tabs: [], activeId: null, bookmarks: [], tombs: [] };
    profiles.push(p); saveProfiles(); saveBm(p); scheduleSync(); switchProfile(p.id);
  }
  function removeProfile(p) {
    p.tabs.forEach(function (t) { if (t.frame) t.frame.remove(); });
    p.tabs = []; p.deleted = true; p.updated = Date.now(); p.bookmarks = []; p.tombs = [];
    saveProfiles(); saveBm(p);
    if (api.wipe) api.wipe(partOf(p.id));
    if (p === cur) { var next = visible()[0]; cur = next; bind(); store.set("padlock.cur", cur.id); if (!tabs.length) newTab(); else show(); renderAllBm(); renderProfileBtn(); }
    scheduleSync();
  }
  function buildProfPop() {
    profPop.textContent = "";
    profPop.appendChild(h("h2", { text: "Profiles" }));
    visible().forEach(function (p) {
      var av = h("span", { class: "fav", text: (p.name[0] || "?").toUpperCase() }); av.style.background = p.color; av.style.width = "24px"; av.style.height = "24px"; av.style.fontSize = "12px";
      profPop.appendChild(h("button", { class: "item", role: "menuitem", onclick: function () { closePops(); switchProfile(p.id); } }, av, h("span", { text: p.name, style: "flex:1" }), p === cur ? h("span", { text: "Current", style: "font-size:11px;color:var(--muted)" }) : null));
    });
    profPop.appendChild(h("hr"));
    profPop.appendChild(h("div", { class: "menu-note", text: "Each profile keeps its own cookies, sign-ins, tabs and bookmarks. Google does not allow sign-in inside apps like this one; use your regular browser for Google accounts." }));
    profPop.appendChild(h("button", { class: "item", role: "menuitem", onclick: function () {
      openForm({ title: "Add profile", ok: "Add", fields: [{ id: "name", label: "Profile name", value: "" }], onSubmit: function (v) { var n = v.name.trim(); if (!n) return "Enter a name."; addProfile(n); } });
    } }, h("span", { text: "Add profile…" })));
    profPop.appendChild(h("button", { class: "item", role: "menuitem", onclick: function () {
      openForm({ title: "Rename profile", fields: [{ id: "name", label: "Profile name", value: cur.name }], onSubmit: function (v) { var n = v.name.trim(); if (!n) return "Enter a name."; cur.name = n; cur.updated = Date.now(); saveProfiles(); renderProfileBtn(); scheduleSync(); } });
    } }, h("span", { text: "Rename “" + cur.name + "”…" })));
    if (visible().length > 1) profPop.appendChild(h("button", { class: "item danger-text", role: "menuitem", onclick: function () {
      var p = cur;
      openForm({ title: "Delete profile", message: "Delete “" + p.name + "”? Its sign-ins, cookies and bookmarks are removed from this computer" + (syncFolder ? " and from your sync folder." : "."), ok: "Delete", danger: true, fields: [], onSubmit: function () { removeProfile(p); } });
    } }, h("span", { text: "Delete “" + cur.name + "”…" })));
  }
  $("#profbtn").addEventListener("click", function (e) { e.stopPropagation(); var open = !profPop.hidden; closePops(); if (!open) { buildProfPop(); profPop.hidden = false; } });
  profPop.addEventListener("click", function (e) { e.stopPropagation(); });

  /* sync through a folder (Google Drive, Dropbox, Nextcloud, Syncthing, ...) */
  var syncFolder = null, syncTimer = null, syncBusy = false, syncAgain = false, syncMsg = "";
  function newer(a, b) { return (b.updated || 0) > (a.updated || 0) ? b : a; }
  function mergeList(local, remote) {
    var order = [], m = {};
    local.concat(remote || []).forEach(function (x) {
      if (!m[x.id]) { m[x.id] = x; order.push(x.id); } else m[x.id] = newer(m[x.id], x);
    });
    var byUrl = {}, out = {};
    order.forEach(function (id) {
      var x = m[id]; out[id] = x;
      if (x.deleted) return;
      var prev = byUrl[x.url];
      if (!prev) { byUrl[x.url] = x; return; }
      var win = newer(prev, x), lose = win === prev ? x : prev;
      out[lose.id] = { id: lose.id, deleted: true, updated: Math.max(win.updated || 0, lose.updated || 0) + 1 };
      byUrl[x.url] = win;
    });
    return order.map(function (id) { return out[id]; });
  }
  function exportFile() {
    return { v: 1, profiles: profiles.map(function (p) { return { id: p.id, name: p.name, color: p.color, updated: p.updated, deleted: !!p.deleted, bookmarks: allBm(p) }; }) };
  }
  function canon(f) {
    return JSON.stringify((f.profiles || []).slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; }).map(function (p) {
      return [p.id, p.name, p.color, p.updated || 0, !!p.deleted, (p.bookmarks || []).slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; }).map(function (x) { return [x.id, x.name || "", x.url || "", x.updated || 0, !!x.deleted]; })];
    }));
  }
  function mergeRemote(remote) {
    var dirty = false;
    (remote.profiles || []).forEach(function (rp) {
      var lp = profiles.filter(function (p) { return p.id === rp.id; })[0];
      if (!lp) {
        lp = { id: rp.id, name: rp.name, color: rp.color, updated: rp.updated || 0, deleted: !!rp.deleted, tabs: [], activeId: null, bookmarks: [], tombs: [] };
        splitBm(lp, rp.bookmarks || []); profiles.push(lp); dirty = true; return;
      }
      if ((rp.updated || 0) > (lp.updated || 0)) { lp.name = rp.name; lp.color = rp.color; lp.deleted = !!rp.deleted; lp.updated = rp.updated; dirty = true; }
      var before = canon({ profiles: [{ id: lp.id, bookmarks: allBm(lp) }] });
      splitBm(lp, mergeList(allBm(lp), rp.bookmarks || []));
      if (canon({ profiles: [{ id: lp.id, bookmarks: allBm(lp) }] }) !== before) dirty = true;
    });
    return dirty;
  }
  function scheduleSync() {
    if (!syncFolder || !api.sync) return;
    clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 700);
  }
  function syncNow() {
    if (!syncFolder || !api.sync) return Promise.resolve();
    if (syncBusy) { syncAgain = true; return Promise.resolve(); }
    syncBusy = true;
    return api.sync.read().then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || "The sync folder could not be read.");
      var remote = null;
      if (res.text) { try { remote = JSON.parse(res.text); } catch (e) { throw new Error("The sync file is damaged, so nothing was changed."); } }
      if (remote && mergeRemote(remote)) {
        saveProfiles(); profiles.forEach(function (p) { saveBm(p); });
        profiles.forEach(function (p) {
          if (p.deleted && p.tabs.length) { p.tabs.forEach(function (t) { if (t.frame) t.frame.remove(); }); p.tabs = []; if (api.wipe) api.wipe(partOf(p.id)); }
        });
        if (cur.deleted) { cur = visible()[0] || cur; store.set("padlock.cur", cur.id); bind(); if (!tabs.length) newTab(); else show(); }
        rebindBm(); renderAllBm(); renderProfileBtn();
      }
      var out = exportFile();
      if (remote && canon(remote) === canon(out)) return;
      return api.sync.write(JSON.stringify(out, null, 1)).then(function (w) { if (!w || !w.ok) throw new Error((w && w.error) || "Could not write to the sync folder."); });
    }).then(function () {
      var d = new Date(); syncMsg = "Last synced " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }).catch(function (e) { syncMsg = e.message; }).then(function () {
      syncBusy = false;
      if (!menu.hidden) buildMenu();
      if (syncAgain) { syncAgain = false; scheduleSync(); }
    });
  }
  function chooseSync() {
    api.sync.choose().then(function (f) { syncFolder = f; syncMsg = f ? "" : syncMsg; if (f) return syncNow(); }).then(function () { if (!menu.hidden) buildMenu(); });
  }

  /* ---------- tabs and navigation ---------- */
  var tabs = [], activeId = null, uid = 0;
  var viewport = $("#viewport"), ntp = $("#ntp"), urlInput = $("#url");

  function active() { for (var i = 0; i < tabs.length; i++) if (tabs[i].id === activeId) return tabs[i]; return null; }

  function newTab(url) {
    var t = { id: ++uid, pid: cur.id, hist: [url || "newtab"], i: 0, frame: null };
    tabs.push(t);
    activeId = t.id;
    ensureFrame(t);
    show();
    if (!url) setTimeout(function () { $("#ntpq").focus(); }, 0);
  }
  function ensureFrame(t) {
    var cur = t.hist[t.i];
    if (cur === "newtab") return;
    if (!t.frame) {
      t.frame = h("webview", { partition: partOf(t.pid), allowpopups: "", useragent: UA, webpreferences: "contextIsolation=yes" });
      t.frame.addEventListener("did-navigate", function (e) { onNav(t, e.url); });
      t.frame.addEventListener("did-navigate-in-page", function (e) { if (e.isMainFrame) onNav(t, e.url); });
      t.frame.addEventListener("page-title-updated", function (e) { t.title = e.title; renderTabs(); });
      t.frame.addEventListener("page-favicon-updated", function (e) { t.icon = e.favicons && e.favicons[0]; renderTabs(); });
      t.frame.addEventListener("did-start-loading", function () { t.loading = true; });
      t.frame.addEventListener("did-stop-loading", function () { t.loading = false; });
      viewport.appendChild(t.frame);
    }
    if (t.frame.getAttribute("data-url") !== cur) { t.frame.setAttribute("data-url", cur); t.expect = true; t.frame.setAttribute("src", cur); }
  }
  function onNav(t, url) {
    var cur = t.hist[t.i];
    if (url === cur || url === "about:blank") return;
    if (t.expect) { t.hist[t.i] = url; t.expect = false; }
    else { t.hist = t.hist.slice(0, t.i + 1); t.hist.push(url); t.i++; }
    t.frame.setAttribute("data-url", url);
    t.title = t.title || "";
    if (t === active()) show(); else renderTabs();
  }
  function navigate(url) {
    var t = active(); if (!t || !url) return;
    t.hist = t.hist.slice(0, t.i + 1); t.hist.push(url); t.i++;
    t.title = ""; t.icon = null;
    ensureFrame(t); show();
  }
  function closeTab(id) {
    var i = tabs.findIndex(function (t) { return t.id === id; });
    if (i < 0) return;
    var t = tabs[i]; if (t.frame) t.frame.remove();
    tabs.splice(i, 1);
    if (!tabs.length) { newTab(); return; }
    if (activeId === id) activeId = tabs[Math.min(i, tabs.length - 1)].id;
    show();
  }
  function renderTabs() {
    var strip = $("#tabs"); strip.textContent = "";
    tabs.forEach(function (t) {
      var cur = t.hist[t.i];
      var title = cur === "newtab" ? "New Tab" : (t.title || host(cur));
      var el = h("div", { class: "tab" + (t.id === activeId ? " active" : ""), role: "tab", "aria-selected": String(t.id === activeId), title: cur === "newtab" ? "New Tab" : cur,
        onclick: function () { activeId = t.id; ensureFrame(t); show(); } },
        (cur !== "newtab" && t.icon) ? h("span", { class: "fav blank" }, h("img", { src: t.icon, alt: "" })) : cur === "newtab" ? h("span", { class: "fav blank" }, (function () { var s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", "14"); s.setAttribute("height", "14"); s.innerHTML = '<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/>'; return s; })()) : fav(cur),
        h("span", { class: "ttl", text: title }),
        h("button", { class: "x", title: "Close tab", "aria-label": "Close tab", onclick: function (e) { e.stopPropagation(); closeTab(t.id); } },
          (function () { var s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", "12"); s.setAttribute("height", "12"); s.innerHTML = '<path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>'; return s; })()));
      strip.appendChild(el);
    });
  }
  function updateChrome() {
    var t = active(); if (!t) return;
    var cur = t.hist[t.i], isNew = cur === "newtab";
    if (document.activeElement !== urlInput) urlInput.value = isNew ? "" : cur;
    $("#back").disabled = t.i === 0;
    $("#fwd").disabled = t.i >= t.hist.length - 1;
    starBtn.classList.toggle("on", !isNew && findBm(cur) >= 0);
    starBtn.disabled = isNew;
    if (api.navState) api.navState(t.i > 0, t.i < t.hist.length - 1);
  }
  function show() {
    tabs.forEach(function (t) { if (t.frame) t.frame.hidden = !(t.id === activeId && t.hist[t.i] !== "newtab"); });
    var t = active();
    ntp.hidden = !(t && t.hist[t.i] === "newtab");
    renderTabs(); updateChrome();
  }

  $("#newtab").addEventListener("click", function () { newTab(); });
  $("#back").addEventListener("click", function () { var t = active(); if (t && t.i > 0) { t.i--; t.expect = true; ensureFrame(t); show(); } });
  $("#fwd").addEventListener("click", function () { var t = active(); if (t && t.i < t.hist.length - 1) { t.i++; t.expect = true; ensureFrame(t); show(); } });
  $("#reload").addEventListener("click", function () { var t = active(); if (t && t.frame && t.hist[t.i] !== "newtab") { try { t.frame.reload(); } catch (e) { t.frame.setAttribute("src", t.hist[t.i]); } } });
  urlInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { var u = normalize(urlInput.value); if (u) { navigate(u); urlInput.blur(); } }
    if (e.key === "Escape") { urlInput.blur(); updateChrome(); }
  });
  urlInput.addEventListener("focus", function () { urlInput.select(); });
  urlInput.addEventListener("blur", updateChrome);
  $("#ntpform").addEventListener("submit", function (e) { e.preventDefault(); var u = normalize($("#ntpq").value); if (u) { $("#ntpq").value = ""; navigate(u); } });

  /* ---------- downloads ---------- */
  var dlPop = $("#dlpop"), dlBtn = $("#dlbtn"), dls = {}, dlRows = {};
  function fmtBytes(n) {
    if (!(n > 0)) return "0 B";
    var u = ["B", "KB", "MB", "GB", "TB"], i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    var v = n / Math.pow(1024, i);
    return (v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)) + " " + u[i];
  }
  function dlAct(id, a) { return function (e) { e.stopPropagation(); api.downloads.act(id, a); }; }
  function mkRow(d) {
    var ic = icon("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm-1 7V3.5L18.5 9z");
    var r = { el: null };
    r.name = h("div", { class: "dln" }); r.sub = h("div", { class: "dls" });
    r.bar = h("div", { class: "dlbar" }, document.createElement("i")); r.fill = r.bar.firstChild;
    r.bOpen = h("button", { class: "icon-btn", title: "Show in folder", "aria-label": "Show in folder", onclick: dlAct(d.id, "show") }, icon("M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8z"));
    r.bPause = h("button", { class: "icon-btn", title: "Pause", "aria-label": "Pause", onclick: dlAct(d.id, "pause") }, icon("M6 19h4V5H6zm8-14v14h4V5z"));
    r.bResume = h("button", { class: "icon-btn", title: "Resume", "aria-label": "Resume", onclick: dlAct(d.id, "resume") }, icon("M8 5v14l11-7z"));
    r.bCancel = h("button", { class: "icon-btn", title: "Cancel", "aria-label": "Cancel", onclick: dlAct(d.id, "cancel") }, icon("M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"));
    r.bRemove = h("button", { class: "icon-btn", title: "Remove from list", "aria-label": "Remove from list", onclick: dlAct(d.id, "remove") }, icon("M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"));
    r.name.addEventListener("click", function () { if (r.name.classList.contains("link")) api.downloads.act(d.id, "open"); });
    r.el = h("div", { class: "dlrow" }, h("div", { class: "dli" }, ic), h("div", { class: "dlm" }, r.name, r.bar, r.sub), h("div", { class: "dla" }, r.bOpen, r.bPause, r.bResume, r.bCancel, r.bRemove));
    return r;
  }
  function fillRow(r, d) {
    var done = d.state === "completed", live = d.state === "progressing", intr = d.state === "interrupted";
    r.name.textContent = d.name;
    r.name.title = d.url;
    r.name.classList.toggle("link", done && d.exists);
    r.name.classList.toggle("gone", done && !d.exists);
    var st;
    if (done) st = d.exists ? fmtBytes(d.total || d.received) + " · " + host(d.url) : "File moved or deleted";
    else if (d.state === "cancelled") st = "Cancelled";
    else if (intr) st = "Interrupted · " + fmtBytes(d.received) + (d.total ? " of " + fmtBytes(d.total) : "");
    else st = (d.paused ? "Paused · " : "") + fmtBytes(d.received) + (d.total ? " of " + fmtBytes(d.total) : "") + " · " + host(d.url);
    r.sub.textContent = st;
    r.sub.classList.toggle("err", intr || (done && !d.exists));
    r.bar.hidden = !(live || intr);
    r.bar.classList.toggle("indet", !d.total);
    r.fill.style.width = d.total ? Math.min(100, Math.round(d.received * 100 / d.total)) + "%" : "";
    r.bOpen.hidden = !d.path || (done && !d.exists);
    r.bPause.hidden = !(live && !d.paused);
    r.bResume.hidden = !((live && d.paused) || (intr && d.resumable));
    r.bCancel.hidden = !(live || intr);
    r.bRemove.hidden = live;
  }
  function renderDl() {
    dlPop.textContent = "";
    var list = Object.keys(dls).map(function (k) { return dls[k]; }).sort(function (a, b) { return b.time - a.time; });
    dlPop.appendChild(h("div", { class: "dlhead" }, h("h2", { text: "Downloads" }),
      h("div", { style: "display:flex;gap:4px" },
        h("button", { class: "btn", onclick: function (e) { e.stopPropagation(); api.downloads.act("", "folder-all"); } }, document.createTextNode("Open folder")),
        h("button", { class: "btn", onclick: function (e) { e.stopPropagation(); api.downloads.act("", "clear"); } }, document.createTextNode("Clear all")))));
    if (!list.length) { dlPop.appendChild(h("div", { class: "dlempty", text: "Files you download appear here." })); return; }
    list.forEach(function (d) { if (!dlRows[d.id]) dlRows[d.id] = mkRow(d); fillRow(dlRows[d.id], d); dlPop.appendChild(dlRows[d.id].el); });
  }
  function dlBusy() { return Object.keys(dls).some(function (k) { return dls[k].state === "progressing"; }); }
  function openDl() {
    closePops();
    api.downloads.list().then(function (items) {
      dls = {}; dlRows = {}; items.forEach(function (d) { dls[d.id] = d; });
      renderDl(); dlPop.hidden = false;
    });
  }
  function toggleDl() { if (!dlPop.hidden) closePops(); else openDl(); }
  dlBtn.addEventListener("click", function (e) { e.stopPropagation(); toggleDl(); });
  dlPop.addEventListener("click", function (e) { e.stopPropagation(); });
  if (api.downloads) {
    api.downloads.onUpdate(function (items) {
      var added = false, structural = false;
      items.forEach(function (d) {
        if (d.removed) { delete dls[d.id]; delete dlRows[d.id]; structural = true; return; }
        if (!dls[d.id]) { added = true; structural = true; }
        dls[d.id] = d;
        if (dlRows[d.id]) fillRow(dlRows[d.id], d);
      });
      dlBtn.classList.toggle("busy", dlBusy());
      if (added) { dlBtn.classList.add("flash"); setTimeout(function () { dlBtn.classList.remove("flash"); }, 2500); }
      if (structural && !dlPop.hidden) renderDl();
    });
  }

  /* ---------- menu ---------- */
  var menu = $("#menu");
  function closePops() { menu.hidden = true; bmPop.hidden = true; ctx.hidden = true; profPop.hidden = true; dlPop.hidden = true; }
  function icon(path) { var s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", "18"); s.setAttribute("height", "18"); s.innerHTML = '<path d="' + path + '"/>'; return s; }
  function buildMenu() {
    menu.textContent = "";
    menu.appendChild(h("button", { class: "item", role: "menuitem", onclick: function () { closePops(); newTab(); } }, icon("M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"), h("span", { text: "New tab" })));
    menu.appendChild(h("button", { class: "item", role: "menuitem", onclick: function () { closePops(); openDl(); } }, icon("M19 9h-4V3H9v6H5l7 7zM5 18v2h14v-2z"), h("span", { text: "Downloads", style: "flex:1" }), h("span", { text: "Ctrl+J", style: "font-size:11px;color:var(--muted)" })));
    var at = active();
    if (at && at.hist[at.i] !== "newtab" && api.openExternal) {
      menu.appendChild(h("button", { class: "item", role: "menuitem", onclick: function () { closePops(); api.openExternal(at.hist[at.i]); } }, icon("M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3z"), h("span", { text: "Open page in default browser" })));
    }
    menu.appendChild(h("hr"));
    menu.appendChild(h("h2", { text: "Bookmarks" }));
    if (!bookmarks.length) menu.appendChild(h("div", { class: "bm-empty", style: "padding:8px 16px", text: "No bookmarks yet. Use the star in the address bar." }));
    bookmarks.forEach(function (b, i) {
      menu.appendChild(h("div", { class: "bmrow" },
        h("button", { class: "item", role: "menuitem", title: b.url, onclick: function () { closePops(); navigate(b.url); }, oncontextmenu: function (e) { e.preventDefault(); showBmCtx(e, b); } }, fav(b.url), h("span", { text: b.name })),
        h("button", { class: "icon-btn", title: "Delete bookmark", "aria-label": "Delete bookmark " + b.name, onclick: function (e) { e.stopPropagation(); delBm(b); buildMenu(); } }, icon("M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"))));
    });
    menu.appendChild(h("hr"));
    menu.appendChild(h("h2", { text: "Search engine" }));
    var onEngine = false;
    ENGINES.forEach(function (en) {
      var on = en.url === searchTpl; if (on) onEngine = true;
      menu.appendChild(h("button", { class: "item", role: "menuitemradio", "aria-checked": String(on), onclick: function () { searchTpl = en.url; store.set("padlock.search", en.url); buildMenu(); } },
        h("span", { text: on ? "●" : "○", style: "width:18px;text-align:center;color:" + (on ? "var(--accent)" : "var(--muted)") }), h("span", { text: en.name })));
    });
    menu.appendChild(h("button", { class: "item", role: "menuitemradio", "aria-checked": String(!onEngine), onclick: function () {
      openForm({ title: "Custom search engine", message: "Enter the search address and put %s where the search words go, for example https://search.example.com/?q=%s", fields: [{ id: "u", label: "Search address", value: onEngine ? "" : searchTpl }],
        onSubmit: function (v) {
          var u = v.u.trim();
          if (!/^https?:\/\//i.test(u) || u.indexOf("%s") < 0) return "Use an address that starts with https:// and contains %s.";
          searchTpl = u; store.set("padlock.search", u);
        } });
    } }, h("span", { text: onEngine ? "○" : "●", style: "width:18px;text-align:center;color:" + (onEngine ? "var(--muted)" : "var(--accent)") }), h("span", { text: onEngine ? "Custom…" : "Custom (in use)…" })));
    menu.appendChild(h("hr"));
    menu.appendChild(h("h2", { text: "User agent" }));
    var onPreset = false;
    UA_PRESETS.forEach(function (u) {
      var on = u.ua === UA; if (on) onPreset = true;
      menu.appendChild(h("button", { class: "item", role: "menuitemradio", "aria-checked": String(on), onclick: function () { setUA(u.ua); buildMenu(); } },
        h("span", { text: on ? "●" : "○", style: "width:18px;text-align:center;color:" + (on ? "var(--accent)" : "var(--muted)") }), h("span", { text: u.name })));
    });
    menu.appendChild(h("button", { class: "item", role: "menuitemradio", "aria-checked": String(!onPreset), onclick: function () {
      openForm({ title: "Custom user agent", message: "Applies to every tab, in every profile. Clear the box to go back to the default.", fields: [{ id: "ua", label: "User agent string", value: onPreset ? "" : UA }], onSubmit: function (v) { setUA(v.ua.trim()); } });
    } }, h("span", { text: onPreset ? "○" : "●", style: "width:18px;text-align:center;color:" + (onPreset ? "var(--muted)" : "var(--accent)") }), h("span", { text: onPreset ? "Custom…" : "Custom (in use)…" })));
    menu.appendChild(h("hr"));
    menu.appendChild(h("h2", { text: "Sync" }));
    if (!api.sync) {
      menu.appendChild(h("div", { class: "menu-note", text: "Sync is available in the desktop app." }));
    } else if (!syncFolder) {
      menu.appendChild(h("div", { class: "menu-note", text: "Keep profiles and bookmarks the same on every computer: pick a folder that Google Drive, Dropbox, Nextcloud or Syncthing already syncs." }));
      menu.appendChild(h("button", { class: "item", role: "menuitem", onclick: function () { closePops(); chooseSync(); } }, h("span", { text: "Choose sync folder…" })));
    } else {
      menu.appendChild(h("div", { class: "menu-note", text: syncFolder }));
      if (syncMsg) menu.appendChild(h("div", { class: "menu-note", text: syncMsg }));
      menu.appendChild(h("button", { class: "item", role: "menuitem", onclick: function (e) { e.stopPropagation(); syncMsg = "Syncing…"; buildMenu(); syncNow(); } }, h("span", { text: "Sync now" })));
      menu.appendChild(h("button", { class: "item", role: "menuitem", onclick: function () { closePops(); chooseSync(); } }, h("span", { text: "Change folder…" })));
      menu.appendChild(h("button", { class: "item", role: "menuitem", onclick: function () { api.sync.off().then(function () { syncFolder = null; syncMsg = ""; buildMenu(); }); } }, h("span", { text: "Turn off sync" })));
    }
    menu.appendChild(h("hr"));
    menu.appendChild(h("button", { class: "item", role: "menuitem", onclick: function () { closePops(); openPwModal(); } }, icon("M12.65 10A5.99 5.99 0 0 0 7 6a6 6 0 1 0 5.65 8H17v4h4v-4h2v-4zM7 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"), h("span", { text: "Change password" })));
    menu.appendChild(h("button", { class: "item", role: "menuitem", onclick: function () { closePops(); showLock(); } }, icon("M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zM9 6a3 3 0 0 1 6 0v2H9z"), h("span", { text: "Lock browser" })));
  }
  $("#menubtn").addEventListener("click", function (e) { e.stopPropagation(); var open = !menu.hidden; closePops(); if (!open) { buildMenu(); menu.hidden = false; } });
  menu.addEventListener("click", function (e) { e.stopPropagation(); });
  document.addEventListener("click", closePops);
  /* A <webview> always paints above normal page content, which hid the menus and the
     lock screen behind the page. Hide it while any popup, dialog or the lock screen is open. */
  var ovlEls = [menu, bmPop, ctx, profPop, dlPop, gwrap, $("#modalwrap"), lockEl];
  function syncOverlay() { $("#app").classList.toggle("ovl", ovlEls.some(function (el) { return !el.hidden; })); }
  var ovlObs = new MutationObserver(syncOverlay);
  ovlEls.forEach(function (el) { ovlObs.observe(el, { attributes: true, attributeFilter: ["hidden"] }); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closePops(); $("#modalwrap").hidden = true; gwrap.hidden = true; } });

  /* ---------- change password ---------- */
  var modalWrap = $("#modalwrap");
  function openPwModal() { ["#pwold", "#pwnew", "#pwnew2"].forEach(function (s) { $(s).value = ""; }); $("#modalerr").textContent = ""; modalWrap.hidden = false; $("#pwold").focus(); }
  $("#modalcancel").addEventListener("click", function () { modalWrap.hidden = true; });
  $("#modal").addEventListener("submit", function (e) {
    e.preventDefault();
    var oldp = $("#pwold").value, np = $("#pwnew").value, np2 = $("#pwnew2").value, err = $("#modalerr");
    if (np.length < 4) { err.textContent = "Use at least 4 characters."; return; }
    if (np !== np2) { err.textContent = "The new passwords do not match."; return; }
    sha(oldp, store.get(KEYS.salt) || "").then(function (hh) {
      if (hh !== store.get(KEYS.pw)) { err.textContent = "The current password is wrong."; return; }
      var salt = newSalt();
      sha(np, salt).then(function (nh) { store.set(KEYS.salt, salt); store.set(KEYS.pw, nh); modalWrap.hidden = true; });
    });
  });

  function doShortcut(name) {
    if (!lockEl.hidden) return;
    if (name === "newtab") newTab();
    else if (name === "closetab") { var t = active(); if (t) closeTab(t.id); }
    else if (name === "focusurl") urlInput.focus();
    else if (name === "bookmark") starBtn.click();
    else if (name === "reload") $("#reload").click();
    else if (name === "downloads") toggleDl();
    else if (name === "lock") showLock();
  }
  document.addEventListener("keydown", function (e) {
    if (!lockEl.hidden || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    var k = e.key.toLowerCase();
    var name = e.shiftKey ? (k === "k" ? "lock" : null) : { t: "newtab", w: "closetab", l: "focusurl", d: "bookmark", r: "reload", j: "downloads" }[k];
    if (name) { e.preventDefault(); doShortcut(name); }
  });
  if (api.onShortcut) api.onShortcut(doShortcut);
  if (api.onNav) api.onNav(function (a) { if (!lockEl.hidden) return; $(a === "back" ? "#back" : a === "fwd" ? "#fwd" : "#reload").click(); });
  if (api.onSearchText) api.onSearchText(function (txt) { if (!lockEl.hidden || !txt) return; newTab(searchUrl(txt)); });
  if (window.padlock && window.padlock.onOpenUrl) window.padlock.onOpenUrl(function (u) { if (!lockEl.hidden) return; newTab(u); });

  /* ---------- window controls (custom title bar) ---------- */
  if (api && api.win) {
    $("#wmin").addEventListener("click", function () { api.win("minimize"); });
    $("#wmax").addEventListener("click", function () { api.win("maximize"); });
    $("#wrestore").addEventListener("click", function () { api.win("maximize"); });
    $("#wclose").addEventListener("click", function () { api.win("close"); });
    $("#dragfill").addEventListener("dblclick", function () { api.win("maximize"); });
    api.onMaximized(function (m) { document.documentElement.classList.toggle("maximized", m); });
    api.isMaximized().then(function (m) { document.documentElement.classList.toggle("maximized", m); });
  }

  /* ---------- boot: the browser opens locked ---------- */
  loadProfiles(); bind(); renderAllBm(); renderProfileBtn();
  if (api.sync) {
    api.sync.get().then(function (f) { syncFolder = f; });
    api.sync.onChanged(scheduleSync);
  }
  showLock();
})();
