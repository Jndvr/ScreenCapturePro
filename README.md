# ScreenCapture Pro

A feature-rich Chrome Extension (Manifest V3) for capturing full-page screenshots, annotating them in a built-in editor, and exporting to PNG, JPEG, or PDF.

---

## Features

### Capture Modes
| Feature | Description |
|---|---|
| **Full-page capture** | Scrolls and stitches the entire page — including SPAs, iframes, and Power Apps / Power Automate |
| **Visible area** | Captures only what's currently on screen |
| **Region / area select** | Drag a box on the page to capture just that rectangle |
| **Screen recording** | Record your tab or desktop as a video |
| **Delay capture** | 3 s or 5 s countdown shown directly on the page, so you can hover over tooltips and menus before the shot fires |
| **Scroll speed control** | Slow / Normal / Fast scroll speed for stitching |
| **Lazy-load detection** | Waits for images to finish loading before each stitch tile |
| **Sticky/fixed header compensation** | Detects and removes repeated headers that appear in every scroll tile |

### Keyboard Shortcuts (no popup needed)
| Shortcut | Action |
|---|---|
| `Alt+Shift+S` | Full-page capture |
| `Alt+Shift+V` | Visible area capture |
| `Alt+Shift+R` | Region select capture |

### Editor — Annotation Tools
| Key | Tool |
|---|---|
| `V` | Select / Pan |
| `P` | Pen (freehand) |
| `H` | Highlight (semi-transparent marker) |
| `A` | Arrow |
| `L` | Line |
| `R` | Rectangle |
| `E` | Ellipse |
| `Q` | Callout bubble |
| `N` | Numbered step circle |
| `T` | Text |
| `B` | Blur (pixelate a region) |
| `K` | Sticky note |
| `M` | Cursor / pointer icon annotation |
| `X` | OCR — extract text from a selected region |
| `C` | Crop |

### Editor — Other Features
- **Multi-undo / redo** with labelled history panel
- **Zoom** — scroll wheel (Ctrl/⌘), `+` / `-` / `0` keys, fit-to-window button
- **Copy to clipboard** (PNG)
- **Export PNG** (`Ctrl+S`)
- **Export JPEG** with quality slider
- **Export PDF** — pure-JS, no library, works offline
- **URL + timestamp stamp** — optionally burns the page URL and capture time into the bottom of the image
- **Sticky notes** — draggable HTML notes in 5 colours, flattened onto export

### OCR
Select a region with the `X` tool. Text is extracted using **Tesseract.js** loaded on-demand from CDN (first run ~10 s, subsequent runs instant). Extracted text can be copied to clipboard or inserted as a text annotation.

---

## Installation

> The extension is not yet on the Chrome Web Store. Install it in developer mode:

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `ScreenCapture` folder
5. The extension icon appears in your toolbar

---

## Compatibility

| Site type | Status |
|---|---|
| Standard web pages | ✅ Full-page stitching |
| Wikipedia / long articles | ✅ Rate-limit-safe capture |
| Single-page apps (React, Angular, Vue) | ✅ Scroll detection works |
| Power Apps / Power Automate | ✅ iframe content captured |
| Pages with sticky headers | ✅ Header deduplication |
| Lazy-loaded images | ✅ Auto-wait before each tile |

---

## Project Structure

```
ScreenCapture/
├── manifest.json        # MV3 manifest — permissions, commands, CSP
├── background.js        # Service worker — capture orchestration, scroll stitching
├── content.js           # Injected into all frames — scroll detection & loop
├── popup.html/js        # Extension popup UI
├── editor.html/js/css   # Full annotation editor
├── recording.html/js    # Screen recorder UI
├── sandbox.html         # Sandboxed page for Tesseract OCR (fetch+eval pattern)
└── icons/               # Extension icons (16, 48, 128 px)
```

---

## Architecture Notes

### Full-page stitching
`content.js` is injected into **all frames** (`allFrames: true`). Each frame independently measures its own scrollable height. The frame that has scrollable content drives the scroll loop, sending `capture` events back to the background service worker, which calls `chrome.tabs.captureVisibleTab()` for each position. The resulting tiles are stitched in the editor.

### OCR sandbox
Chrome MV3 blocks `<script src="https://...">` in extension pages. The `sandbox.html` page works around this by using `fetch()` (governed by `connect-src`, which is unrestricted) to download Tesseract.js source text, then `eval()`ing it (allowed in sandboxed pages by `'unsafe-eval'`). The worker and WASM core are wrapped as `blob:` URLs so the spawned Web Worker never needs `importScripts` from a remote origin.

### PDF export
No library required. A valid single-page PDF is assembled byte-by-byte: the canvas is serialised as a JPEG (`DCTDecode` stream), the PDF object tree is constructed, byte offsets are calculated for the xref table, and the result is saved as a `Blob`. Works fully offline.

---

## Permissions

| Permission | Reason |
|---|---|
| `tabs` / `activeTab` | Read tab URL, inject scripts |
| `scripting` | Inject `content.js` and overlay scripts |
| `downloads` | Save PNG / JPEG / PDF files |
| `clipboardWrite` | Copy screenshot to clipboard |
| `webNavigation` | Enumerate all frames for iframe capture |
| `<all_urls>` | Capture any page the user is viewing |

---

## License

MIT
