# Full Page Screenshot to PDF 📸

A Chrome extension that captures an entire webpage—no matter how long—and outputs it as a crisp **PDF** or a single stitched **JPEG** image. Everything runs locally in the browser; no data is sent to any server.

## Features

- **Full-page capture** — Scrolls through the page viewport-by-viewport and stitches every slice into one seamless result.
- **PDF output** — Generates a multi-page, raster-only PDF with high-quality JPEG compression. Opens in a built-in viewer tab.
- **JPEG output** — Produces a single stitched JPEG of the entire page.
- **Copy to clipboard** — One-click copy of the captured image (converted to PNG for clipboard compatibility).
- **Download** — Save the PDF or image directly via Chrome's download dialog.
- **Shadow DOM popover** — The in-page capture UI is fully isolated inside a Shadow DOM, so it never conflicts with the host page's styles.
- **Sticky/fixed element handling** — Detects fixed and sticky headers and neutralises them during capture to prevent ghosting across slices.
- **Ad & clutter removal** — Heuristically hides common ad containers, cookie banners, and promotional overlays before capturing for a cleaner result.
- **Dark mode support** — UI follows the system/browser color scheme automatically.
- **Restricted-page awareness** — The extension icon is disabled on `chrome://`, Web Store, and other pages that cannot be captured.

## How It Works

1. **Click the extension icon** — A floating popover appears on the page (or the browser popup opens).
2. **Choose format** — "Capture as PDF" or "Capture as Image".
3. **Scroll-and-stitch** — The service worker scrolls the page in steps, calls `chrome.tabs.captureVisibleTab()` for each viewport slice, and stitches them together on an `OffscreenCanvas`.
4. **Output** — For PDF, the stitched canvas is split into page-sized JPEG tiles and assembled into a PDF (built from scratch, no external library). For JPEG, the stitched canvas is exported directly.
5. **Preview & download** — The result opens in a viewer tab (PDF) or can be downloaded / copied to clipboard.

## Architecture

```
manifest.json             MV3 manifest — permissions, service worker, icons
service_worker.js         Background service worker — orchestrates capture,
                          stitching, PDF generation, messaging, downloads
content-popover.js        Content script — injects the in-page popover UI
                          inside a Shadow DOM with adopted stylesheets
popup.html / popup.js     Browser-action popup (alternative UI entry point)
viewer.html / viewer.js   Extension page — displays the generated PDF in an iframe
tokens.css                Design tokens — single source of truth for colors,
                          typography, spacing, shadows, and dark mode
design-system.css         Component-level styles that consume the tokens
icons/                    Extension icons (16, 32, 48, 128 px)
```

### Capture Pipeline (simplified)

```
Icon click
  → Inject content-popover.js
  → User clicks "Capture"
  → service_worker receives START_CAPTURE / START_CAPTURE_JPG
  → getPageMetrics()          — measure page dimensions & sticky headers
  → neutralizeStickyPositioning()
  → preparePageForCapture()   — hide ads, banners, overlays
  → buildCapturePlan()        — calculate scroll positions & overlap
  → captureScreenshots()      — scroll → settle → captureVisibleTab loop
  → stitchScreenshots()       — assemble slices on OffscreenCanvas
  → buildPdf() / toJpgDataUrl()
  → Restore scroll position, sticky elements, hidden UI
  → Result ready for preview / download / clipboard
```

## Design System

The UI is built on a token-based design system:

- **[tokens.css](tokens.css)** defines all primitive color scales (Stone, Slate, Emerald, Rose, Amber) and semantic tokens for text, backgrounds, borders, shadows, typography, spacing, and radii. Light and dark themes are handled via `@media (prefers-color-scheme: dark)`.
- **[design-system.css](design-system.css)** imports the tokens and defines reusable component classes (`.btn`, `.panel`, `.progress-wrap`, etc.).
- The content-popover loads `tokens.css` into the Shadow DOM via `adoptedStyleSheets`, so tokens work identically inside and outside the shadow boundary.

## Installation (Development)

1. Clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the project folder.
5. Navigate to any webpage and click the extension icon to capture.

## Permissions

| Permission       | Why                                                        |
|------------------|------------------------------------------------------------|
| `activeTab`      | Access the current tab to inject scripts and read metrics  |
| `scripting`      | Inject content scripts for the popover and page prep       |
| `tabs`           | Query and capture the visible tab                          |
| `downloads`      | Trigger "Save As" download dialog for the output file      |
| `clipboardWrite` | Copy the captured image to the clipboard                   |

## Roadmap

See [backlog.md](backlog.md) for the full list of planned improvements, including HiDPI support, lazy-load handling, PNG export, annotation tools, and more.

## License

Private / unlicensed. All rights reserved.
