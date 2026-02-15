# Backlog

Feature ideas and improvements gathered from competitive analysis (GoFullPage) and internal review. Items are grouped by priority and area.

---

## 🔴 High Priority — Capture Quality

### 1. DevicePixelRatio (HiDPI / Retina) support
Scale the offscreen stitching canvas by `window.devicePixelRatio` so captures are pixel-perfect on Retina and high-DPI displays. Without this, screenshots appear blurry on Mac and 4K screens.

### 2. Lazy-loaded content triggering
Before capturing each slice, dispatch synthetic `scroll` events and wait for `img[loading="lazy"]` elements in the viewport to finish loading. Currently, lazy images may render as placeholders or blank areas.

### 3. Dynamic page height re-measurement
Some pages change height during scrolling (e.g. infinite scroll, collapsing banners). Re-measure `scrollHeight` after each scroll step and adjust the capture plan on the fly instead of measuring once upfront.

### 4. Last-fragment overlap clipping
When the final scroll position overshoots, the bottom slice may contain duplicate content from the previous slice. Clip the source rect of the last fragment precisely so there is no visible seam or duplication.

---

## 🟡 Medium Priority — Robustness & Edge Cases

### 5. Improved fixed/sticky element handling
Currently we neutralize sticky positioning globally. GoFullPage takes a more granular approach: it shows fixed headers/footers in the first and last frames but hides them for all intermediate frames. This preserves the visual context while avoiding ghosting.

### 6. Restricted-page user feedback
We already disable the action icon on unsupported URLs, but if a user somehow triggers a capture on a `chrome://`, `chrome-extension://`, or Web Store page, we should surface a clear, friendly error message instead of silently failing.

### 7. Scroll-settle intelligence
Replace the fixed `SCROLL_SETTLE_DELAY_MS` with heuristic-based detection: `requestAnimationFrame` + mutation observers to confirm the layout has actually stabilized before capturing. This avoids timing-related artifacts without over-waiting.

### 8. Capture retry / resilience
If `captureVisibleTab` fails for a single slice (e.g. transient permission error), retry that slice 2–3 times with backoff before aborting the entire capture.

### 9. Cross-origin iframe graceful degradation
Detect cross-origin iframes and either blank them cleanly or inform the user, rather than letting them render as broken rectangles.

---

## 🟢 Low Priority — Features & Polish

### 10. PNG export option
Add a third output format alongside PDF and JPEG. PNG is lossless and preferred for UI screenshots, documentation, and design work.

### 11. PDF export improvements
- Selectable text layer via lightweight OCR or DOM text extraction.
- Metadata (title, author, creation date) embedded in the PDF.
- Page-size options (A4, Letter, auto-fit).

### 12. Horizontal scroll / wide-page support
Detect pages wider than the viewport and extend the capture grid horizontally, stitching in both X and Y directions.

### 13. Overflow container detection
Some SPAs render content inside a scrollable `<div>` rather than the document body. Detect the primary scrollable container and capture it rather than the document scroll.

### 14. Annotation / editing tools in viewer
After capture, allow the user to crop, annotate (arrows, rectangles, text), or redact portions of the screenshot before downloading.

### 15. Capture region selection
Let the user drag-select a rectangular region of the page to capture instead of always capturing the full page.

### 16. Auto-copy to clipboard after capture
Optionally copy the result to the clipboard automatically once capture completes (user preference stored in `chrome.storage`).

### 17. Keyboard shortcut
Register a configurable keyboard shortcut (e.g. `Ctrl+Shift+S`) via the `commands` API so users can trigger capture without clicking the icon.

### 18. Capture history
Store recent captures (thumbnails + metadata) locally so users can re-download or re-open without re-capturing.

### 19. Settings page
An options page for user preferences: default format (PDF / JPG / PNG), JPEG quality, auto-download vs. preview, keyboard shortcut, etc.

### 20. Delayed / timed capture
Allow users to set a 3–5 second delay before capture begins, useful for pages with hover states, tooltips, or dropdown menus that need to remain visible.

---

## 🔧 Tech Debt & Infrastructure

### 21. Modularise service_worker.js
The service worker is ~1 500 lines in a single file. Split it into modules (capture pipeline, PDF builder, state management, messaging) using ES module imports.

### 22. Automated testing
Add a basic test suite (Playwright or Puppeteer) that loads known pages and validates capture output dimensions, file size, and format.

### 23. CI / release pipeline
Set up GitHub Actions to lint, test, and package the extension as a `.zip` ready for Chrome Web Store upload.

### 24. Error telemetry (opt-in)
Optional, privacy-respecting error reporting so we can learn which edge cases fail in the wild.

---

_Last updated: 2026-02-15_
