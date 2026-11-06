# Mino Browser

A simple vibe-coded Chrome-style desktop browser: tabs, address bar, back/forward/reload,
bookmarks (star + bookmarks bar), and a password screen every time it opens. I made this for my own use.

## Build the Linux package

Needs Node.js 18+ and internet access (to download Electron).

    npm install
    npm run dist          # AppImage + .deb in ./dist
    npm run dist:appimage # AppImage only
    npm run dist:deb      # .deb only

Run without packaging: `npm start`

Install: `chmod +x dist/*.AppImage && ./dist/*.AppImage`  or  `sudo apt install ./dist/*.deb`

If the AppImage will not start on Ubuntu 23.10+ because of the user-namespace
sandbox rule, run it with `--no-sandbox`, or install the .deb instead.

## Shortcuts
Ctrl+T new tab, Ctrl+W close tab, Ctrl+L address bar, Ctrl+D bookmark, Ctrl+R reload, Ctrl+Shift+K lock. The window uses its own title bar (tabs, minimize, maximize, close); drag the empty space beside the tabs to move it.

## About the password
It is a screen lock for the app window. The password is stored as a salted hash in the
app's local storage. It does not encrypt your bookmarks or browsing data.

## Profiles (multiple Google accounts)
The round button next to the lock is the profile switcher, like Chrome's. Every profile has
its own cookies, sign-ins, tabs and bookmarks, so sign in to a different Google account in
each profile. Use "Add profile…" for more.
Google does not allow sign-in to Google accounts inside embedded browsers like this one
("This browser or app may not be secure"). Use "Open page in default browser" in the menu
for Google accounts. Other sites that need a login work normally in each profile.

## Editing bookmarks
Right-click a bookmark (bookmarks bar, new tab page or menu) for Open, Open in new tab,
Edit… (name and URL) and Delete.

## Sync
Menu > Sync > Choose sync folder. Pick a folder that Google Drive, Dropbox, Nextcloud or
Syncthing already syncs between your computers. The app keeps one file there,
`padlock-sync.json`, and merges profiles and bookmarks from every computer using it
(newest edit wins, deletes carry over). Sign-ins and cookies are never synced.

## User agent
Menu > User agent switches what pages are told about the browser (Chrome, Firefox, Safari,
Windows, Android, or a custom string). It changes the User-Agent header and navigator.userAgent
for every tab. It does not make Google sign-in work.

## Window state
The app remembers its size, position and whether it was maximized, and restores them at the
next start. It does not start minimized, so launching it always shows the window.

## Search engine
Menu > Search engine sets what the address bar and new tab page use for searches:
DuckDuckGo (default), Google, Bing, Brave Search, Ecosia, Startpage, or a custom address with %s.

## Building on Windows
The app code is cross-platform, but the packaging in `package.json` is set up for Linux.
Windows packages cannot be built from the Linux scripts above (`npm run dist` and friends),
so use electron-builder's Windows target directly. This has not been tested here.

1. Install Node.js 18+ from https://nodejs.org.
2. In the project folder, open PowerShell and run:

       npm install
       npx electron-builder --win

3. The installer appears in `dist\` (named `mino-browser-<version>.exe`).
   For a portable `.exe` that needs no install, run `npx electron-builder --win portable`.

Notes:
- electron-builder converts `build/icon.png` into the Windows icon automatically.
- The installer is not code-signed, so Windows SmartScreen shows an "unknown publisher"
  warning. Choose "More info" then "Run anyway".
- Run it with `npm start` to try the app without building a package.
- In the menu, the user agent entry named "Default (Chrome on Linux)" will actually send your
  Windows system's details. It is only a label.
- Settings are stored in `%APPDATA%\mino-browser`.
