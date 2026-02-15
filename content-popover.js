/* ============================================================
   content-popover.js
   Injects a floating, rounded popover into the active page
   using Shadow DOM for full style isolation.

   Tokens are loaded from tokens.css via adoptedStyleSheets —
   no token duplication needed.
   ============================================================ */
(function () {
  const HOST_ID = "__screenshot-ext-popover__";
  const SCRIM_ID = "__screenshot-ext-scrim__";

  /* ── Toggle: click icon again → close ── */
  const existing = document.getElementById(HOST_ID);
  if (existing) {
    const existingScrim = document.getElementById(SCRIM_ID);
    const existingScrimTokens = document.getElementById("__screenshot-ext-scrim-tokens__");
    existing.style.opacity = "0";
    existing.style.transform = "translateY(-8px) scale(0.97)";
    if (existingScrim) {
      existingScrim.style.opacity = "0";
    }
    setTimeout(() => {
      existing.remove();
      if (existingScrim) existingScrim.remove();
      if (existingScrimTokens) existingScrimTokens.remove();
    }, 200);
    return;
  }

  /* ── Scrim (radial gradient overlay behind popover) ── */
  /* Inject tokens onto the page :root so the scrim can resolve --overlay */
  const scrimTokenStyle = document.createElement("link");
  scrimTokenStyle.id = "__screenshot-ext-scrim-tokens__";
  scrimTokenStyle.rel = "stylesheet";
  scrimTokenStyle.href = chrome.runtime.getURL("tokens.css");
  document.head.appendChild(scrimTokenStyle);

  const scrim = document.createElement("div");
  scrim.id = SCRIM_ID;
  Object.assign(scrim.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100vw",
    height: "100vh",
    zIndex: "2147483646",
    opacity: "0",
    transition: "opacity 200ms ease",
    pointerEvents: "auto",
  });

  /* Radial color overlay — strongest near the popover, fading to transparent */
  const scrimColor = document.createElement("div");
  Object.assign(scrimColor.style, {
    position: "absolute",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    background:
      "radial-gradient(ellipse at 100% 0%, var(--overlay) 0%, transparent 80%)",
    pointerEvents: "none",
  });
  scrim.appendChild(scrimColor);

  document.documentElement.appendChild(scrim);

  /* ── Host element (positioned fixed, top-right) ── */
  const host = document.createElement("div");
  host.id = HOST_ID;
  Object.assign(host.style, {
    position: "fixed",
    top: "24px",
    right: "24px",
    zIndex: "2147483647",
    fontSize: "var(--text-base)",
    lineHeight: "var(--leading-normal)",
    opacity: "0",
    transform: "translateY(-8px) scale(0.97)",
    transition: "opacity 180ms ease, transform 180ms ease",
  });
  document.documentElement.appendChild(host);

  /* Animate in */
  requestAnimationFrame(() => {
    scrim.style.opacity = "1";
    host.style.opacity = "1";
    host.style.transform = "translateY(0) scale(1)";
  });

  const shadow = host.attachShadow({ mode: "closed" });

  /* ────────────────────────────────────
     Styles — tokens loaded from tokens.css (single source of truth),
     component styles defined inline (no token duplication).
     ──────────────────────────────────── */
  const tokensSheet = new CSSStyleSheet();
  const componentSheet = new CSSStyleSheet();

  /* Fetch tokens.css from the extension bundle */
  fetch(chrome.runtime.getURL("tokens.css"))
    .then((r) => r.text())
    .then((css) => tokensSheet.replaceSync(css));

  componentSheet.replaceSync(/* css */ `
    /* ── Reset host ── */
    :host {
      all: initial;
      font-family: var(--font-family);
      color: var(--foreground);
      font-size: var(--text-base);
      line-height: var(--leading-normal);
    }

    *, *::before, *::after {
      box-sizing: border-box;
    }

    /* ── Dialog Content (shadcn-inspired) ── */
    .dialog-content {
      width: var(--popover-width);
      background: var(--popover);
      color: var(--popover-foreground);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-popover);
      position: relative;
      overflow: hidden;
    }

    .dialog-body {
      padding: var(--space-6);
    }

    /* ── Dialog Header ── */
    .dialog-header {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }

    .dialog-header + * {
      margin-top: var(--space-5);
    }

    .dialog-title {
      margin: 0;
      font-size: var(--text-lg);
      font-weight: var(--weight-semi);
      line-height: var(--leading-none);
      letter-spacing: var(--tracking-tight);
    }

    .dialog-description {
      margin: 0;
      font-size: var(--text-sm);
      line-height: var(--leading-sm);
      color: var(--muted-foreground);
    }

    /* ── Dialog Close Button ── */
    .dialog-close {
      position: absolute;
      top: var(--space-4);
      right: var(--space-4);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      border: none;
      border-radius: var(--radius-xs);
      background: transparent;
      color: var(--muted-foreground);
      cursor: pointer;
      opacity: 0.7;
      transition: opacity var(--transition-fast), background var(--transition-fast);
    }

    .dialog-close:hover {
      opacity: 1;
      background: var(--accent);
    }

    .dialog-close svg {
      width: 16px;
      height: 16px;
      pointer-events: none;
    }

    .note {
      margin: 0;
      font-size: var(--text-xs);
      color: var(--muted-foreground);
      line-height: var(--leading-xs);
    }

    /* ── Dialog Footer ── */
    .dialog-footer {
      display: flex;
      flex-direction: row;
      justify-content: flex-end;
      gap: var(--space-3);
      padding: var(--space-6);
      border-top: 1px solid var(--border);
    }

    .dialog-footer .btn {
      flex: 1;
    }

    /* ── Buttons ── */
    .btn {
      border: 1px solid var(--border);
      background: var(--card);
      color: var(--foreground);
      border-radius: var(--radius-sm);
      padding: 9px var(--space-5);
      font-size: var(--text-sm);
      font-weight: var(--weight-semi);
      line-height: var(--leading-sm);
      cursor: pointer;
      transition: background-color var(--transition-fast);
      font-family: inherit;
    }

    .btn:hover {
      background: var(--accent);
    }

    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .btn-primary {
      width: 100%;
      background: var(--primary);
      color: var(--primary-foreground);
      border-color: var(--primary);
    }

    .btn-primary:hover {
      background: var(--primary);
      opacity: 0.9;
    }

    .btn-jpg {
      background: var(--secondary);
      color: var(--secondary-foreground);
      border-color: var(--border);
    }

    .btn-jpg:hover {
      background: var(--accent);
    }

    .btn-copy {
      background: var(--secondary);
      color: var(--secondary-foreground);
      border-color: var(--border);
    }

    .btn-copy:hover {
      background: var(--accent);
    }

    .btn-copy.copied {
      background: var(--success-bg);
      color: var(--success);
      border-color: var(--success-border);
    }

    /* ── Result footer ── */
    .result-footer {
      padding: var(--space-6);
      border-top: 1px solid var(--border);
    }

    .size-text {
      margin: 0 0 var(--space-4);
      font-size: var(--text-sm);
      line-height: var(--leading-sm);
      color: var(--muted-foreground);
    }

    .actions {
      display: flex;
      gap: var(--space-3);
    }

    .actions .btn {
      flex: 1;
    }

    /* ── Error ── */
    .error-text {
      margin: var(--space-4) 0 0;
      font-size: var(--text-sm);
      line-height: var(--leading-sm);
      color: var(--destructive);
    }

    .hidden {
      display: none !important;
    }
  `);

  shadow.adoptedStyleSheets = [tokensSheet, componentSheet];

  /* ────────────────────────────────────
     HTML — shadcn Dialog structure
     ──────────────────────────────────── */
  const container = document.createElement("div");
  container.className = "dialog-content";
  container.innerHTML = `
    <button class="dialog-close" aria-label="Close">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
    <div class="dialog-body">
      <div class="dialog-header">
        <h2 class="dialog-title">📸 Full Page Capture</h2>
        <p class="dialog-description">Capture this tab as a crisp PDF or a single stitched image.</p>
      </div>
      <p class="note">Note: some PDF viewers may show selectable OCR text overlays even when pages are raster-only images.</p>

      <p id="errorText" class="error-text hidden"></p>
    </div>

    <div class="dialog-footer">
      <button id="captureBtn" class="btn btn-primary">Capture as PDF</button>
      <button id="captureJpgBtn" class="btn btn-jpg">Capture as Image</button>
    </div>

    <section id="resultWrap" class="result-footer hidden">
      <p id="sizeText" class="size-text"></p>
      <div class="actions">
        <button id="openBtn" class="btn">Open in New Tab</button>
        <button id="downloadBtn" class="btn">Download</button>
        <button id="copyImgBtn" class="btn btn-copy hidden">📋 Copy Image</button>
      </div>
    </section>
  `;
  shadow.appendChild(container);

  /* ── Close button handler ── */
  container.querySelector(".dialog-close").addEventListener("click", closePopover);

  /* ────────────────────────────────────
     Element refs (inside shadow DOM)
     ──────────────────────────────────── */
  const $ = (id) => shadow.getElementById(id);

  const captureBtn    = $("captureBtn");
  const captureJpgBtn = $("captureJpgBtn");
  const resultWrap    = $("resultWrap");
  const sizeText      = $("sizeText");
  const openBtn       = $("openBtn");
  const downloadBtn   = $("downloadBtn");
  const copyImgBtn    = $("copyImgBtn");
  const errorText     = $("errorText");

  /* ────────────────────────────────────
     Communication with service worker
     ──────────────────────────────────── */
  const port = chrome.runtime.connect({ name: "popover-state" });
  port.onMessage.addListener((msg) => {
    if (msg?.type === "STATE") {
      renderState(msg.payload);
    }
  });

  /* Close popover if service worker disconnects (e.g. extension reloaded) */
  port.onDisconnect.addListener(() => {
    closePopover();
  });

  /* Also fetch state immediately */
  chrome.runtime.sendMessage({ type: "GET_STATE" }).then((response) => {
    if (response?.ok) {
      renderState(response.state);
    }
  });

  /* ── Close on scrim click ── */
  scrim.addEventListener("click", closePopover);

  /* ── Close on Escape ── */
  document.addEventListener("keydown", onEscKey);

  function onEscKey(e) {
    if (e.key === "Escape") closePopover();
  }

  /* ── Animated close helper ── */
  function closePopover() {
    document.removeEventListener("keydown", onEscKey);
    host.style.opacity = "0";
    host.style.transform = "translateY(-8px) scale(0.97)";
    scrim.style.opacity = "0";
    setTimeout(() => {
      host.remove();
      scrim.remove();
      scrimTokenStyle.remove();
    }, 200);
  }

  /* ────────────────────────────────────
     Button handlers
     ──────────────────────────────────── */
  captureBtn.addEventListener("click", async () => {
    clearError();
    try {
      const response = await chrome.runtime.sendMessage({ type: "START_CAPTURE" });
      if (!response?.ok) showError(response?.error || "Failed to start capture.");
    } catch (error) {
      showError(error.message || "Failed to start capture.");
    }
  });

  captureJpgBtn.addEventListener("click", async () => {
    clearError();
    try {
      const response = await chrome.runtime.sendMessage({ type: "START_CAPTURE_JPG" });
      if (!response?.ok) showError(response?.error || "Failed to start capture.");
    } catch (error) {
      showError(error.message || "Failed to start capture.");
    }
  });

  openBtn.addEventListener("click", async () => {
    clearError();
    try {
      const response = await chrome.runtime.sendMessage({ type: "OPEN_RESULT" });
      if (!response?.ok) showError(response?.error || "Unable to open.");
    } catch (error) {
      showError(error.message || "Unable to open.");
    }
  });

  downloadBtn.addEventListener("click", async () => {
    clearError();
    try {
      const response = await chrome.runtime.sendMessage({ type: "DOWNLOAD_RESULT" });
      if (!response?.ok) showError(response?.error || "Unable to download.");
    } catch (error) {
      showError(error.message || "Unable to download.");
    }
  });

  copyImgBtn.addEventListener("click", async () => {
    clearError();
    try {
      copyImgBtn.disabled = true;
      copyImgBtn.textContent = "Copying...";

      const response = await chrome.runtime.sendMessage({ type: "GET_JPG_DATA_URL" });
      if (!response?.ok) {
        showError(response?.error || "Unable to copy image.");
        copyImgBtn.disabled = false;
        copyImgBtn.textContent = "\u{1F4CB} Copy Image";
        return;
      }

      const imgResponse = await fetch(response.dataUrl);
      const imgBlob = await imgResponse.blob();
      const bitmap = await createImageBitmap(imgBlob);

      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();

      const pngBlob = await canvas.convertToBlob({ type: "image/png" });
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": pngBlob }),
      ]);

      copyImgBtn.textContent = "\u2705 Copied!";
      copyImgBtn.classList.add("copied");
      setTimeout(() => {
        copyImgBtn.textContent = "\u{1F4CB} Copy Image";
        copyImgBtn.classList.remove("copied");
        copyImgBtn.disabled = false;
      }, 2000);
    } catch (error) {
      showError(error.message || "Failed to copy image.");
      copyImgBtn.disabled = false;
      copyImgBtn.textContent = "\u{1F4CB} Copy Image";
    }
  });

  /* ────────────────────────────────────
     Render helpers
     ──────────────────────────────────── */
  function renderState(state) {
    const status = state?.status || "idle";
    const captureMode = state?.captureMode || null;

    captureBtn.disabled = false;
    captureJpgBtn.disabled = false;

    if (status === "ready") {
      captureBtn.textContent = "Capture as PDF";
      captureJpgBtn.textContent = "Capture as Image";
      resultWrap.classList.remove("hidden");

      if (captureMode === "jpg") {
        sizeText.textContent = `Image Size: ${formatBytes(state.sizeBytes || 0)}`;
        downloadBtn.textContent = "Download JPG";
        copyImgBtn.classList.remove("hidden");
      } else {
        sizeText.textContent = `PDF Size: ${formatBytes(state.sizeBytes || 0)}`;
        downloadBtn.textContent = "Download PDF";
        copyImgBtn.classList.add("hidden");
      }
      return;
    }

    captureBtn.textContent = "Capture as PDF";
    captureJpgBtn.textContent = "Capture as Image";
    resultWrap.classList.add("hidden");
    copyImgBtn.classList.add("hidden");

    if (status === "error" && state.error) {
      showError(state.error);
    }
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB"];
    let size = bytes / 1024;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
  }

  function showError(message) {
    errorText.textContent = message;
    errorText.classList.remove("hidden");
  }

  function clearError() {
    errorText.classList.add("hidden");
    errorText.textContent = "";
  }
})();
