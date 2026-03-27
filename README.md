# ScreenCapture Pro

**ScreenCapture Pro** is a Chrome extension (Manifest V3) for capturing, annotating, and exporting screenshots — plus recording your screen as a video or GIF — entirely in the browser with no backend, no account, and no setup.

> Built by [Jan Düver](https://www.linkedin.com/in/janduever/)

---

## Features at a Glance

| Tool | What it does |
|---|---|
| **Capture Full Page** | Scroll-stitches the entire page into one screenshot, including content below the fold |
| **Capture Visible Area** | Captures exactly what's on screen right now |
| **Capture Region** | Drag to select any area of the page for a precise crop |
| **Record Screen** | Records a tab or full screen as WebM or MP4 with pause/resume support |
| **Annotate** | Draw arrows, shapes, text, and freehand lines on any screenshot |
| **Blur / Redact** | Blur sensitive areas before sharing |
| **Crop** | Trim the screenshot to the exact frame you need |
| **Export** | Save as PNG, JPEG, or PDF with one click |
| **URL & Timestamp stamp** | Optionally burn the page URL and capture time onto the image |
| **GIF Export** | Convert any recording to an animated GIF directly in the browser — no external tools |
| **Zoom Bubble** | During recording: a 2× magnifier circle follows your cursor to highlight fine UI details |
| **Laser Pointer** | A glowing red dot that fades 400 ms after you stop moving — perfect for presentations |
| **Draw on Screen** | Annotate live during a recording with freehand strokes, colour swatches, and an eraser |

Works as a **popup** — shortcut keys trigger captures without even opening the popup.

---

## Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the `ScreenCapture` folder

---

## How It Works

### Screenshots

1. Navigate to any page
2. Click the ScreenCapture Pro icon (or use a keyboard shortcut)
3. The screenshot is taken and the **editor** opens in a new tab automatically
4. Annotate, blur, and crop as needed — then export

### Screen Recording

1. Click the ScreenCapture Pro icon
2. Click **Record Screen** — a floating control pill appears directly on the page
3. Grant screen-share permission when prompted
4. Use the pill to **pause**, **resume**, or **stop** the recording at any time
5. The file downloads automatically when you stop; you can also export it as a GIF from the done card

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Alt + Shift + S` | Capture full page |
| `Alt + Shift + V` | Capture visible area |
| `Alt + Shift + R` | Capture region (drag to select) |

---

## Settings

Open the popup and use the **Settings** section to configure capture behaviour.

### Delay

| Option | Behaviour |
|---|---|
| **None** | Capture immediately |
| **3 s** | Wait 3 seconds — useful for opening hover menus before the shot |
| **5 s** | Wait 5 seconds |

When a delay is active, a countdown overlay appears on the page so you can set up the state you want captured.

### Speed

Controls how fast the page is scrolled during a full-page capture. Slower speeds give lazy-loaded images more time to appear.

| Level | Behaviour |
|---|---|
| Slow | 800 ms per scroll step |
| Normal | 350 ms per scroll step |
| Fast | 150 ms per scroll step |

### Wait for lazy images

When enabled, the capture waits for images that load on scroll (lazy-loading) before taking each screenshot slice. Recommended for most sites.

### Add URL & timestamp

Burns the page URL and the capture time as a small footer onto the exported image. Useful for documentation and compliance screenshots.

---

## Tools — Detailed Reference

<details>
<summary><strong>Capture Full Page</strong> — Scroll-stitched full-page screenshot</summary>

Scrolls the page from top to bottom, capturing each viewport slice and stitching them together into a single tall image. Handles pages with sticky headers, infinite scroll elements, and lazy-loaded images.

The editor opens automatically when the capture is complete. Progress is shown on the extension icon badge (e.g. `42%`) so you can watch the capture from any tab.

</details>

<details>
<summary><strong>Capture Visible Area</strong> — Instant viewport screenshot</summary>

Captures only what is currently visible in the browser window — no scrolling. The editor opens immediately.

Use this for quick screenshots of above-the-fold content, error messages, or UI states that don't require the full page.

</details>

<details>
<summary><strong>Capture Region</strong> — Drag-to-select crop</summary>

Closes the popup and overlays a dimmed selection canvas on the page. Drag to draw a rectangle around the area you want. Release to capture — only the selected region is cropped and sent to the editor.

- Minimum region size: 10 × 10 px
- Press **Esc** to cancel

</details>

<details>
<summary><strong>Record Screen</strong> — In-page recording with pause / resume</summary>

Injects a floating control pill into the active tab — so controls are always visible no matter which tab or window you switch to during a recording.

**Output formats** (choose before starting):

| Format | Notes |
|---|---|
| **WebM · VP9** | Default — best compatibility in Chrome, smallest file |
| **WebM · H.264** | Better compression, same WebM container |
| **MP4** | Widest playback support across devices and media players |

**Pill controls:**

| Button | Action |
|---|---|
| Pause / Resume | Suspend and continue recording without splitting the file |
| Stop | End the recording — file downloads automatically |
| Zoom | Toggle the 2× magnifier bubble that follows your cursor |
| Laser | Toggle the glowing laser-pointer dot |
| Draw | Open the draw toolbar — annotate live on screen |

**Options (before recording starts):**
- **Include microphone audio** — record your mic alongside the screen audio
- **Highlight cursor clicks** — show a red ripple ring at every click point

After stopping, the done card lets you **download again** or **export as GIF**.

</details>

<details>
<summary><strong>Editor</strong> — Annotate, blur, crop and export</summary>

The editor opens in a new tab after every screenshot capture. All editing happens locally in the browser — no data is uploaded anywhere.

**Annotation tools:**

| Tool | What it does |
|---|---|
| Arrow | Draw directional arrows pointing to elements |
| Rectangle | Highlight regions with an outlined box |
| Text | Add a text label anywhere on the image |
| Pen | Freehand drawing |
| Blur | Apply a mosaic blur to cover sensitive content |
| Crop | Trim the canvas to a selected rectangle |

**Export formats:**

| Format | Notes |
|---|---|
| PNG | Lossless — best for UI screenshots with text |
| JPEG | Smaller file — good for photos and complex imagery |
| PDF | Single-page PDF — useful for reports and documentation |

</details>

<details>
<summary><strong>GIF Export</strong> — Convert a recording to animated GIF in the browser</summary>

Available in the done card after stopping a recording. Runs a pure-JavaScript GIF encoder directly in the page — no external service, no upload.

- **FPS:** 10 frames per second
- **Max width:** 800 px (scaled down proportionally if larger)
- A progress bar shows encoding progress frame by frame
- The GIF downloads automatically when encoding completes

Best suited for short recordings (under ~30 seconds). Longer recordings produce large GIF files.

</details>

<details>
<summary><strong>Zoom Bubble</strong> — 2× magnifier during recording</summary>

Toggle **Zoom** in the recording pill. A circular 160 px magnifier appears near your cursor, showing a 2× zoom of the area underneath. Ideal for highlighting small UI details — buttons, form fields, status badges — without zooming the entire browser.

The zoom source is the live screen-capture stream, so it always reflects the real screen content.

</details>

<details>
<summary><strong>Laser Pointer</strong> — Glowing presentation dot</summary>

Toggle **Laser** in the recording pill. A glowing red dot follows your cursor and fades out 400 ms after you stop moving. No persistent marks are left on the page.

Use it to draw attention to a UI element during a demo or walkthrough recording without cluttering the screenshot.

</details>

<details>
<summary><strong>Draw on Screen</strong> — Live freehand annotation during recording</summary>

Toggle **Draw** in the recording pill. A transparent canvas overlays the entire page and a draw toolbar appears above the pill.

**Draw toolbar:**

| Control | Options |
|---|---|
| Colour | Red, Orange, Yellow, Green, Blue, White |
| Stroke weight | Thin (3 px), Thick (8 px) |
| Eraser | Click and drag to erase strokes |
| Clear all | Remove all drawings in one click |

Drawings appear on-screen in real time and are captured in the recording. Disabling draw mode hides the canvas without clearing it — toggle back on to continue drawing.

</details>

---

## Permissions

| Permission | Reason |
|---|---|
| `activeTab` | Access the currently open tab to capture or inject scripts |
| `tabs` | Read tab URL and dimensions for capture metadata |
| `scripting` | Inject the capture and recording overlay scripts |
| `downloads` | Save exported screenshots and recordings to disk |
| `clipboardWrite` | Copy image data to clipboard when requested |
| `storage` | Persist user preferences (delay, speed, toggles) |
| `webNavigation` | Track tab navigation for context refresh |
| `<all_urls>` | Capture and inject on any website |

---

## Project Structure

```
ScreenCapture/
├── manifest.json
├── popup.html               # Extension popup UI
├── popup.js                 # Popup controller
├── background.js            # Service worker — message routing, capture orchestration
├── content.js               # Scroll & capture content script
├── editor.html              # Full-page screenshot editor
├── editor.js                # Editor controller (annotations, blur, crop, export)
├── recorder_overlay.js      # Injected recording HUD — pill, draw, zoom, laser
├── gif_encoder.js           # Pure-JS GIF89a encoder (streaming, no dependencies)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Changelog

### v1.1
- **New: Screen Recorder** — injected floating pill with pause/resume, format selection (WebM VP9 / H.264 / MP4)
- **New: GIF Export** — pure-JS streaming GIF encoder, no external dependencies
- **New: Zoom Bubble** — 2× magnifier circle fed from the live recording stream
- **New: Laser Pointer** — fading glowing dot for presentation use
- **New: Draw on Screen** — live freehand annotation canvas during recording with colour and eraser tools
- **New: Custom tooltips** — every recording pill button shows a name and description on hover
- Capture progress shown on the extension icon badge during full-page captures

### v1.0
- Initial release
- Full-page scroll-stitched capture
- Visible area and region capture
- Screenshot editor with annotations (arrow, rectangle, text, pen, blur, crop)
- Export to PNG, JPEG, PDF
- URL & timestamp stamp option
- Capture delay (3 s / 5 s) and speed controls
- Keyboard shortcuts (`Alt+Shift+S`, `Alt+Shift+V`, `Alt+Shift+R`)

---

## Support & Feedback

If ScreenCapture Pro saves you time, consider buying me a coffee:

[![Ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/jndvr)

Have a bug, feature request, or idea? Submit it here:

[![Feedback](https://img.shields.io/badge/Give%20Feedback-Tally-4F46E5)](https://tally.so/r/WOPe9v)

Want to connect? Find me on LinkedIn:

[![LinkedIn](https://img.shields.io/badge/Connect-LinkedIn-0A66C2?logo=linkedin&logoColor=white)](https://www.linkedin.com/in/janduever/)

---

## License

Source-available — free to use, not licensed for redistribution or use in competing products. For redistribution or partnership enquiries contact [Jan Düver](https://www.linkedin.com/in/janduever/).
