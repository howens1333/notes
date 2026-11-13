# Leafnote

A free, local-first notebook app for iPad and desktop browsers. No accounts, subscriptions, external libraries, or server-side infrastructure.

## Features

- Create, rename, recolor, and delete separate notebooks.
- Add, duplicate, delete, and reorder pages.
- Blank, ruled, grid, and dotted paper styles.
- Pen, transparent highlighter, stroke eraser, and hand/pan tool.
- Apple Pencil pressure support, palm-rejection assistance, Apple Pencil-only handwriting (mouse supported on desktop), and finger pan/pinch without ink.
- Two-finger pinch zoom and zoom buttons.
- Undo/redo and keyboard shortcuts.
- Automatic storage with IndexedDB (localStorage fallback).
- Export notebooks as multi-page PDF or a page as PNG.
- Export and re-import all notebooks as portable JSON backups (import merges; it does not overwrite existing notes).
- Home Screen progressive web app (PWA) with cached offline shell when served over HTTPS.

A single-file experimental version is also available as `Leafnote-Standalone.html` outside the ZIP. It is convenient for desktop testing but **hosting the full app** is strongly recommended for iPad use and offline installation.

## Try locally

Open `index.html` in a desktop browser, or from this directory run:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080` in your browser. A server is recommended for reliable browser storage and PWA testing.

## Put it on your iPad for free

You only need a **static HTTPS website**. GitHub Pages is one option:

1. On GitHub, make a new *public* repository, for example `leafnote`.
2. Upload the **contents** of this folder to the root of the repository (`index.html`, `app.js`, `styles.css`, etc.). Do not just upload the ZIP as one file.
3. Go to repository **Settings → Pages**, choose **Deploy from a branch**, and select `main` / `(root)`. GitHub provides a Pages URL after publishing.
4. Open your published link in **Safari on your iPad**. Use Share → **Add to Home Screen**.
5. Launch Leafnote from its Home Screen icon at least once while online. The application files will be cached for offline reopening. Data remains local to that installed app on the device.

Other free static hosts (such as Cloudflare Pages or Netlify) are also suitable. HTTPS is needed for the service worker.

## Important privacy and data note

**Your notes are stored only inside the browser's local storage on the device.** They are not synced between devices or automatically backed up to the cloud. If you erase site data, uninstall the app, switch browser profiles, or the browser evicts storage, notes can disappear. **Use Back up regularly** and save the JSON file somewhere safe (e.g., your Files app/iCloud Drive). You can also save each notebook as a PDF. Apple Pencil palm rejection varies by iPad/browser version; the Pencil-only setting helps prevent finger marks.

## Code overview

- `index.html`: layout and icons
- `styles.css`: responsive UI
- `app.js`: storage, notebooks, canvas rendering and tools, PDF and PNG export, backup/import
- `manifest.webmanifest`: Home Screen application metadata
- `sw.js`: offline resource caching

Data model uses `notebooks` and `pages` IndexedDB object stores. Each page stores editable vector strokes in logical 816×1056 coordinates, allowing high-resolution output independent of display scaling. A PDF is generated client-side using JPEG page images; there are no network API calls.

License: MIT (see LICENSE).

## iPad handwriting controls

- **Apple Pencil:** draw, highlight, and erase.
- **Finger:** drag to move the page or pinch with two fingers to zoom; finger and palm contact cannot draw or erase.
- **Desktop:** mouse drawing is supported.
- Safari text selection and callouts on the canvas are disabled to avoid interrupted strokes.
