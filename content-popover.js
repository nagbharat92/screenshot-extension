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

  /* ── Scrim (dark overlay behind popover) ── */
  /* Inject tokens onto the page :root so the scrim can resolve --color-scrim */
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
      "radial-gradient(ellipse at 100% 0%, var(--color-scrim) 0%, transparent 80%)",
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
    fontSize: "16px",
    lineHeight: "1.5",
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
      color: var(--color-text);
      font-size: 16px;
      line-height: 1.5;
    }

    *, *::before, *::after {
      box-sizing: border-box;
    }

    /* ── Container ── */
    .popover-container {
      width: var(--popover-width);
      background: linear-gradient(160deg, var(--color-bg) 0%, var(--color-bg-muted) 100%);
      border-radius: var(--radius-xl);
      overflow: hidden;
      box-shadow: var(--shadow-popover);
    }

    .panel {
      padding: var(--space-6);
    }

    /* ── Typography ── */
    h1 {
      margin: 0 0 var(--space-1);
      font-size: var(--text-lg);
      font-weight: var(--weight-bold);
    }

    .subtitle {
      margin: 0 0 var(--space-5);
      font-size: var(--text-sm);
      color: var(--color-text-secondary);
    }

    .note {
      margin: 0 0 var(--space-5);
      font-size: var(--text-xs);
      color: var(--color-text-muted);
      line-height: 1.35;
    }

    /* ── Buttons ── */
    .btn {
      border: 1px solid var(--color-border);
      background: var(--color-surface);
      color: var(--color-text);
      border-radius: var(--radius-sm);
      padding: 9px var(--space-5);
      font-size: var(--text-base);
      font-weight: var(--weight-semi);
      cursor: pointer;
      transition: background-color var(--transition-fast);
      font-family: inherit;
    }

    .btn:hover {
      background: var(--color-bg-hover);
    }

    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .btn-primary {
      width: 100%;
      background: var(--color-primary);
      color: var(--color-primary-text);
      border-color: var(--color-primary);
    }

    .btn-primary:hover {
      background: var(--color-primary-hover);
    }

    .capture-buttons {
      display: flex;
      gap: var(--space-3);
    }

    .capture-buttons .btn {
      flex: 1;
    }

    .btn-jpg {
      background: var(--color-bg-muted);
      color: var(--color-text);
      border-color: var(--color-border);
    }

    .btn-jpg:hover {
      background: var(--color-bg-hover);
    }

    .btn-copy {
      background: var(--color-bg-muted);
      color: var(--color-text);
      border-color: var(--color-border);
    }

    .btn-copy:hover {
      background: var(--color-bg-hover);
    }

    .btn-copy.copied {
      background: var(--color-bg-success);
      color: var(--color-text-success);
      border-color: var(--color-border-success);
    }

    /* ── Progress ── */
    .progress-wrap {
      margin-top: var(--space-5);
    }

    .progress-row {
      display: flex;
      justify-content: space-between;
      font-size: var(--text-sm);
      margin-bottom: var(--space-2);
      color: var(--color-text-muted);
    }

    progress {
      width: 100%;
      height: var(--progress-height);
      -webkit-appearance: none;
      appearance: none;
    }

    progress::-webkit-progress-bar {
      background: var(--color-bg-muted);
      border-radius: 5px;
    }

    progress::-webkit-progress-value {
      background: var(--color-primary);
      border-radius: 5px;
    }

    /* ── Result ── */
    .result-wrap {
      margin-top: var(--space-5);
      padding: var(--space-4);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
    }

    .size-text {
      margin: 0 0 var(--space-4);
      font-size: var(--text-base);
      color: var(--color-text-secondary);
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
      color: var(--color-text-error);
    }

    .hidden {
      display: none !important;
    }
  `);

  shadow.adoptedStyleSheets = [tokensSheet, componentSheet];

  /* ────────────────────────────────────
     HTML
     ──────────────────────────────────── */
  const container = document.createElement("div");
  container.className = "popover-container";
  container.innerHTML = `
    <main class="panel">
      <h1>📸 Full Page Capture</h1>
      <p class="subtitle">Capture this tab as a crisp PDF or a single stitched image.</p>
      <p class="note">Note: some PDF viewers may show selectable OCR text overlays even when pages are raster-only images.</p>

      <div class="capture-buttons">
        <button id="captureBtn" class="btn btn-primary">Capture as PDF</button>
        <button id="captureJpgBtn" class="btn btn-jpg">Capture as Image</button>
      </div>

      <section id="progressWrap" class="progress-wrap hidden" aria-live="polite">
        <div class="progress-row">
          <span id="statusText">Preparing...</span>
          <span id="progressPct">0%</span>
        </div>
        <progress id="progressBar" value="0" max="100"></progress>
      </section>

      <section id="resultWrap" class="result-wrap hidden">
        <p id="sizeText" class="size-text"></p>
        <div class="actions">
          <button id="openBtn" class="btn">Open in New Tab</button>
          <button id="downloadBtn" class="btn">Download</button>
          <button id="copyImgBtn" class="btn btn-copy hidden">📋 Copy Image</button>
        </div>
      </section>

      <p id="errorText" class="error-text hidden"></p>
    </main>
  `;
  shadow.appendChild(container);

  /* ────────────────────────────────────
     Element refs (inside shadow DOM)
     ──────────────────────────────────── */
  const $ = (id) => shadow.getElementById(id);

  const captureBtn    = $("captureBtn");
  const captureJpgBtn = $("captureJpgBtn");
  const progressWrap  = $("progressWrap");
  const progressBar   = $("progressBar");
  const progressPct   = $("progressPct");
  const statusText    = $("statusText");
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
    const progress = Math.max(0, Math.min(100, Math.round(state?.progress || 0)));
    const label = state?.label || "Ready";
    const captureMode = state?.captureMode || null;

    statusText.textContent = label;
    progressBar.value = progress;
    progressPct.textContent = `${progress}%`;

    if (status === "capturing") {
      progressWrap.classList.remove("hidden");
      captureBtn.disabled = true;
      captureJpgBtn.disabled = true;
      captureBtn.textContent = "Capturing...";
      captureJpgBtn.textContent = "Capturing...";
      resultWrap.classList.add("hidden");
      return;
    }

    captureBtn.disabled = false;
    captureJpgBtn.disabled = false;

    if (status === "ready") {
      captureBtn.textContent = "Capture as PDF";
      captureJpgBtn.textContent = "Capture as Image";
      progressWrap.classList.add("hidden");
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
    progressWrap.classList.add("hidden");
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
