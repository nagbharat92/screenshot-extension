const SCROLL_SETTLE_DELAY_MS = 180;
const MIN_CAPTURE_INTERVAL_MS = 700;
const JPEG_QUALITY = 0.95;
const PDF_VERSION = "1.7";
const ENABLE_PDF_RASTER_AUDIT_LOG = true;

const popoverPorts = new Set();
const viewerPdfCache = new Map();

/* ── Enable / disable extension icon based on tab URL ── */

/* Default: icon is DISABLED globally. We selectively enable per tab. */
chrome.action.disable();

function updateActionStateForTab(tabId, url) {
  if (url && isSupportedTabUrl(url)) {
    chrome.action.enable(tabId);
    chrome.action.setTitle({ tabId, title: "Capture page as PDF 📸" });
  } else {
    chrome.action.disable(tabId);
    chrome.action.setTitle({ tabId, title: "Cannot capture this page" });
  }
}

/* On install/startup, scan all existing tabs */
async function updateAllTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id != null) updateActionStateForTab(tab.id, tab.url);
  }
}
chrome.runtime.onInstalled.addListener(updateAllTabs);
chrome.runtime.onStartup.addListener(updateAllTabs);

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    updateActionStateForTab(tabId, tab.url);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    updateActionStateForTab(tabId, tab.url);
  } catch (_) {
    /* tab may have closed */
  }
});

/* ── Inject popover via content script on icon click ── */
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content-popover.js"],
    });
  } catch (err) {
    console.warn("Could not inject popover into tab:", err);
  }
});

let currentState = {
  status: "idle",
  progress: 0,
  label: "Ready",
  sizeBytes: 0,
  error: "",
  captureMode: null,
};

let latestPdfBytes = null;
let latestFileName = "webpage-capture.pdf";
let latestPdfTabId = null;
let latestJpgDataUrl = null;
let latestJpgFileName = "webpage-capture.jpg";
let latestJpgTabId = null;
let captureLock = false;
let lastCaptureTs = 0;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "popover-state") {
    return;
  }

  popoverPorts.add(port);
  getStateForActiveTab()
    .then((state) => {
      port.postMessage({ type: "STATE", payload: state });
    })
    .catch(() => {
      port.postMessage({ type: "STATE", payload: currentState });
    });

  port.onDisconnect.addListener(() => {
    popoverPorts.delete(port);
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case "GET_STATE":
          sendResponse({ ok: true, state: await getStateForActiveTab() });
          break;
        case "START_CAPTURE":
          await startCapture();
          sendResponse({ ok: true });
          break;
        case "START_CAPTURE_JPG":
          await startCaptureJpg();
          sendResponse({ ok: true });
          break;
        case "OPEN_RESULT":
          if (currentState.captureMode === "jpg") {
            await openJpgInNewTab();
          } else {
            await openPdfInNewTab();
          }
          sendResponse({ ok: true });
          break;
        case "OPEN_PDF":
          await openPdfInNewTab();
          sendResponse({ ok: true });
          break;
        case "GET_VIEWER_PDF":
          sendResponse(getViewerPdfPayload(msg?.token));
          break;
        case "DOWNLOAD_RESULT":
          if (currentState.captureMode === "jpg") {
            await downloadJpg();
          } else {
            await downloadPdf();
          }
          sendResponse({ ok: true });
          break;
        case "DOWNLOAD_PDF":
          await downloadPdf();
          sendResponse({ ok: true });
          break;
        case "GET_JPG_DATA_URL":
          if (!latestJpgDataUrl) {
            sendResponse({ ok: false, error: "No image available." });
          } else {
            sendResponse({ ok: true, dataUrl: latestJpgDataUrl });
          }
          break;
        default:
          sendResponse({ ok: false, error: "Unknown action." });
      }
    } catch (error) {
      const message = error?.message || "Unexpected error.";
      sendResponse({ ok: false, error: message });
    }
  })();

  return true;
});

async function startCapture() {
  if (captureLock) {
    throw new Error("Capture is already in progress.");
  }

  captureLock = true;
  clearCaptureArtifacts();

  let metrics = null;
  let activeTab = null;

  try {
    setState({ status: "capturing", progress: 2, label: "Finding active tab...", error: "", sizeBytes: 0 });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab;

    if (!activeTab?.id || !activeTab.windowId || !activeTab.url) {
      throw new Error("Open a webpage or local HTML file first.");
    }

    if (!isSupportedTabUrl(activeTab.url)) {
      throw new Error("This tab type is not supported. Use an http(s) or file:// page.");
    }

    latestFileName = buildPdfFileName(activeTab);
    await preparePageForCapture(activeTab.id);

    setState({ progress: 8, label: "Reading page metrics...", captureMode: "pdf" });
    metrics = await getPageMetrics(activeTab.id);

    const capturePlan = buildCapturePlan(metrics);
    setState({ progress: 12, label: `Capturing ${capturePlan.yPositions.length} slices...` });

    const screenshots = await captureScreenshots(
      activeTab.id,
      activeTab.windowId,
      capturePlan,
      (done, total) => {
        const ratio = total === 0 ? 0 : done / total;
        const progress = 12 + Math.round(ratio * 58);
        setState({ progress, label: `Captured ${done}/${total} slices...` });
      }
    );

    setState({ progress: 75, label: "Stitching screenshots..." });
    const stitched = await stitchScreenshots(screenshots, metrics, capturePlan);

    setState({ progress: 84, label: "Optimizing PDF pages..." });
    const pageImages = await splitCanvasToJpegs(stitched);

    setState({ progress: 94, label: "Building PDF..." });
    const pdfBytes = buildPdf(pageImages);
    auditRasterOnlyPdf(pdfBytes);
    latestPdfBytes = pdfBytes;
    latestPdfTabId = activeTab.id;

    setState({
      status: "ready",
      progress: 100,
      label: "PDF ready",
      sizeBytes: pdfBytes.length,
      error: "",
      captureMode: "pdf",
    });
  } catch (error) {
    clearCaptureArtifacts();
    setState({
      status: "error",
      progress: 0,
      label: "Capture failed",
      error: error?.message || "Failed to capture page.",
      sizeBytes: 0,
    });
    throw error;
  } finally {
    if (activeTab?.id && metrics) {
      try {
        await scrollTabTo(activeTab.id, metrics.initialY);
      } catch (_restoreError) {
        // Best effort restore only.
      }
    }
    if (activeTab?.id) {
      try {
        await restorePageAfterCapture(activeTab.id);
      } catch (restoreDomError) {
        console.warn("Failed to restore page after capture cleanup:", restoreDomError);
      }
    }
    captureLock = false;
  }
}

async function startCaptureJpg() {
  if (captureLock) {
    throw new Error("Capture is already in progress.");
  }

  captureLock = true;
  clearCaptureArtifacts();

  let metrics = null;
  let activeTab = null;

  try {
    setState({ status: "capturing", progress: 2, label: "Finding active tab...", error: "", sizeBytes: 0, captureMode: "jpg" });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab;

    if (!activeTab?.id || !activeTab.windowId || !activeTab.url) {
      throw new Error("Open a webpage or local HTML file first.");
    }

    if (!isSupportedTabUrl(activeTab.url)) {
      throw new Error("This tab type is not supported. Use an http(s) or file:// page.");
    }

    latestJpgFileName = buildJpgFileName(activeTab);

    setState({ progress: 8, label: "Reading page metrics...", captureMode: "jpg" });
    metrics = await getPageMetrics(activeTab.id);

    const capturePlan = buildCapturePlan(metrics);
    setState({ progress: 12, label: `Capturing ${capturePlan.yPositions.length} slices...` });

    const screenshots = await captureScreenshots(
      activeTab.id,
      activeTab.windowId,
      capturePlan,
      (done, total) => {
        const ratio = total === 0 ? 0 : done / total;
        const progress = 12 + Math.round(ratio * 58);
        setState({ progress, label: `Captured ${done}/${total} slices...` });
      }
    );

    setState({ progress: 75, label: "Stitching screenshots..." });
    const stitched = await stitchScreenshots(screenshots, metrics, capturePlan);

    setState({ progress: 88, label: "Encoding high-quality JPEG..." });
    const jpgDataUrl = await stitchedCanvasToJpgDataUrl(stitched);

    latestJpgDataUrl = jpgDataUrl;
    latestJpgTabId = activeTab.id;

    // Estimate size from base64 data URL
    const base64Part = jpgDataUrl.split(",")[1] || "";
    const estimatedBytes = Math.round((base64Part.length * 3) / 4);

    setState({
      status: "ready",
      progress: 100,
      label: "Image ready",
      sizeBytes: estimatedBytes,
      error: "",
      captureMode: "jpg",
    });
  } catch (error) {
    clearCaptureArtifacts();
    setState({
      status: "error",
      progress: 0,
      label: "Capture failed",
      error: error?.message || "Failed to capture page.",
      sizeBytes: 0,
      captureMode: null,
    });
    throw error;
  } finally {
    if (activeTab?.id && metrics) {
      try {
        await scrollTabTo(activeTab.id, metrics.initialY);
      } catch (_restoreError) {
        // Best effort restore only.
      }
    }
    captureLock = false;
  }
}

async function openPdfInNewTab() {
  if (!latestPdfBytes) {
    throw new Error("No PDF generated yet.");
  }

  const token = buildViewerToken();
  viewerPdfCache.set(token, latestPdfBytes);
  setTimeout(() => {
    viewerPdfCache.delete(token);
  }, 5 * 60_000);

  const viewerUrl = chrome.runtime.getURL(`viewer.html?token=${encodeURIComponent(token)}`);
  await chrome.tabs.create({ url: viewerUrl });
  resetUiState();
}

async function downloadPdf() {
  if (!latestPdfBytes) {
    throw new Error("No PDF generated yet.");
  }

  const dataUrl = bytesToPdfDataUrl(latestPdfBytes);
  await chrome.downloads.download({
    url: dataUrl,
    filename: latestFileName,
    saveAs: true,
  });
  resetUiState();
}

async function openJpgInNewTab() {
  if (!latestJpgDataUrl) {
    throw new Error("No image generated yet.");
  }
  await chrome.tabs.create({ url: latestJpgDataUrl });
}

async function downloadJpg() {
  if (!latestJpgDataUrl) {
    throw new Error("No image generated yet.");
  }
  await chrome.downloads.download({
    url: latestJpgDataUrl,
    filename: latestJpgFileName,
    saveAs: true,
  });
}

function setState(patch) {
  currentState = {
    ...currentState,
    ...patch,
  };

  broadcastState();
}

function resetUiState() {
  clearCaptureArtifacts();
  setState({
    status: "idle",
    progress: 0,
    label: "Ready",
    sizeBytes: 0,
    error: "",
    captureMode: null,
  });
}

function clearCaptureArtifacts() {
  latestPdfBytes = null;
  latestPdfTabId = null;
  latestJpgDataUrl = null;
  latestJpgTabId = null;
}

async function getStateForActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return {
      status: "idle",
      progress: 0,
      label: "Ready",
      sizeBytes: 0,
      error: "",
      captureMode: null,
    };
  }

  if (currentState.status === "capturing") {
    return currentState;
  }

  if (currentState.status === "ready" && latestPdfBytes && latestPdfTabId === tab.id) {
    return currentState;
  }

  if (currentState.status === "ready" && latestJpgDataUrl && latestJpgTabId === tab.id) {
    return currentState;
  }

  if (currentState.status === "error") {
    return currentState;
  }

  return {
    status: "idle",
    progress: 0,
    label: "Ready",
    sizeBytes: 0,
    error: "",
    captureMode: null,
  };
}

function broadcastState() {
  for (const port of popoverPorts) {
    try {
      port.postMessage({ type: "STATE", payload: currentState });
    } catch (_error) {
      popoverPorts.delete(port);
    }
  }
}

async function getPageMetrics(tabId) {
  let resultPacket;
  try {
    [resultPacket] = await runInMainWorld(tabId, () => {
        const el = document.documentElement;
        const body = document.body;
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;

        const fullHeight = Math.max(
          el.scrollHeight,
          el.offsetHeight,
          el.clientHeight,
          body ? body.scrollHeight : 0,
          body ? body.offsetHeight : 0
        );

        let stickyTopHeightCssPx = 0;
        const allElements = document.body ? document.body.querySelectorAll("*") : [];

        for (const node of allElements) {
          const style = window.getComputedStyle(node);
          if (style.position !== "fixed" && style.position !== "sticky") {
            continue;
          }

          const rect = node.getBoundingClientRect();
          if (rect.height <= 0 || rect.width <= 0) {
            continue;
          }

          if (rect.top > 2 || rect.bottom <= 0) {
            continue;
          }

          // Skip very large top containers (e.g. full-screen overlays).
          if (rect.height >= viewportHeight * 0.45) {
            continue;
          }

          stickyTopHeightCssPx = Math.max(stickyTopHeightCssPx, rect.height);
        }

        return {
          initialY: window.scrollY,
          viewportHeight,
          viewportWidth,
          stickyTopHeightCssPx: Math.ceil(stickyTopHeightCssPx),
          fullHeight,
        };
    });
  } catch (error) {
    const message = String(error?.message || "");
    if (message.includes("Cannot access contents of the page")) {
      throw new Error(
        "Cannot access this page. For local file:// pages, enable 'Allow access to file URLs' in chrome://extensions for this extension."
      );
    }
    throw error;
  }

  return resultPacket.result;
}

function buildCapturePlan(metrics) {
  const baseOverlap = clamp(Math.floor(metrics.viewportHeight * 0.08), 24, 100);
  const stickyAwareOverlap = Math.ceil((metrics.stickyTopHeightCssPx || 0) + 12);
  const rawOverlap = Math.max(baseOverlap, stickyAwareOverlap);
  const maxAllowedOverlap = Math.max(24, Math.floor(metrics.viewportHeight * 0.35));
  const overlap = clamp(rawOverlap, 24, maxAllowedOverlap);

  if ((metrics.stickyTopHeightCssPx || 0) > metrics.viewportHeight * 0.35) {
    console.info("Sticky header is very tall; overlap capped at 35% of viewport.");
  }

  const step = Math.max(1, metrics.viewportHeight - overlap);
  const maxTop = Math.max(0, metrics.fullHeight - metrics.viewportHeight);

  const yPositions = [];
  for (let y = 0; y < maxTop; y += step) {
    yPositions.push(y);
  }
  yPositions.push(maxTop);

  return { yPositions, overlapCssPx: overlap };
}

async function captureScreenshots(tabId, windowId, capturePlan, onProgress) {
  const shots = [];

  for (let i = 0; i < capturePlan.yPositions.length; i += 1) {
    const y = capturePlan.yPositions[i];
    await scrollTabTo(tabId, y);
    await delay(SCROLL_SETTLE_DELAY_MS);
    const dataUrl = await captureVisibleTabWithRateLimit(windowId);
    shots.push({ y, dataUrl });

    if (onProgress) {
      onProgress(i + 1, capturePlan.yPositions.length);
    }
  }

  return shots;
}

async function captureVisibleTabWithRateLimit(windowId) {
  const elapsed = Date.now() - lastCaptureTs;
  if (elapsed < MIN_CAPTURE_INTERVAL_MS) {
    await delay(MIN_CAPTURE_INTERVAL_MS - elapsed);
  }

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    lastCaptureTs = Date.now();
    return dataUrl;
  } catch (error) {
    const message = String(error?.message || "");
    if (message.includes("MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND")) {
      await delay(MIN_CAPTURE_INTERVAL_MS);
      const retryDataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
      lastCaptureTs = Date.now();
      return retryDataUrl;
    }
    throw error;
  }
}

async function scrollTabTo(tabId, y) {
  await runInMainWorld(tabId, (scrollY) => {
      window.scrollTo(0, scrollY);
    }, [y]);
}

async function stitchScreenshots(screenshots, metrics, capturePlan) {
  if (!screenshots.length) {
    throw new Error("No screenshots were captured.");
  }

  const first = await decodeImageBitmap(screenshots[0].dataUrl);
  const scale = first.height / metrics.viewportHeight;
  const stitchedWidth = first.width;
  const stitchedHeight = Math.ceil(metrics.fullHeight * scale);

  const stitchedCanvas = new OffscreenCanvas(stitchedWidth, stitchedHeight);
  const ctx = stitchedCanvas.getContext("2d", { alpha: false });
  const cropTopDevicePx = Math.max(0, Math.round((capturePlan?.overlapCssPx || 0) * scale));

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, stitchedWidth, stitchedHeight);

  for (let i = 0; i < screenshots.length; i += 1) {
    const shot = screenshots[i];
    const bitmap = i === 0 ? first : await decodeImageBitmap(shot.dataUrl);

    if (i === 0 || cropTopDevicePx <= 0) {
      const destY = Math.round(shot.y * scale);
      ctx.drawImage(bitmap, 0, destY);
    } else {
      const sourceY = Math.min(cropTopDevicePx, bitmap.height - 1);
      const sourceHeight = Math.max(1, bitmap.height - sourceY);
      const destY = Math.round((shot.y + (capturePlan?.overlapCssPx || 0)) * scale);
      ctx.drawImage(
        bitmap,
        0,
        sourceY,
        bitmap.width,
        sourceHeight,
        0,
        destY,
        bitmap.width,
        sourceHeight
      );
    }

    bitmap.close();
  }

  return stitchedCanvas;
}

async function splitCanvasToJpegs(stitchedCanvas) {
  const pages = [];
  const pageWidth = stitchedCanvas.width;
  const maxPageHeight = Math.max(2000, Math.floor(pageWidth * 1.4));

  for (let y = 0; y < stitchedCanvas.height; y += maxPageHeight) {
    const sliceHeight = Math.min(maxPageHeight, stitchedCanvas.height - y);
    const pageCanvas = new OffscreenCanvas(pageWidth, sliceHeight);
    const pageCtx = pageCanvas.getContext("2d", { alpha: false });

    pageCtx.fillStyle = "#ffffff";
    pageCtx.fillRect(0, 0, pageWidth, sliceHeight);
    pageCtx.drawImage(stitchedCanvas, 0, y, pageWidth, sliceHeight, 0, 0, pageWidth, sliceHeight);

    const blob = await pageCanvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
    const jpegBytes = new Uint8Array(await blob.arrayBuffer());

    pages.push({
      width: pageWidth,
      height: sliceHeight,
      jpegBytes,
    });
  }

  return pages;
}

function buildPdf(images) {
  if (!images.length) {
    throw new Error("No PDF pages to build.");
  }

  const objectChunks = [];
  const pageObjectNumbers = [];

  const catalogObjectNumber = 1;
  const pagesRootObjectNumber = 2;
  let nextObjectNumber = 3;

  for (const image of images) {
    const imageObjectNumber = nextObjectNumber;
    const contentObjectNumber = nextObjectNumber + 1;
    const pageObjectNumber = nextObjectNumber + 2;
    nextObjectNumber += 3;

    pageObjectNumbers.push(pageObjectNumber);

    const imageDict = [
      "<<",
      "/Type /XObject",
      "/Subtype /Image",
      `/Width ${image.width}`,
      `/Height ${image.height}`,
      "/ColorSpace /DeviceRGB",
      "/BitsPerComponent 8",
      "/Filter /DCTDecode",
      `/Length ${image.jpegBytes.length}`,
      ">>",
      "stream\n",
    ].join("\n");

    const imageChunk = concatUint8([
      encodeText(imageDict),
      image.jpegBytes,
      encodeText("\nendstream"),
    ]);
    objectChunks.push({ number: imageObjectNumber, bytes: imageChunk });

    const contentStream = `q\n${image.width} 0 0 ${image.height} 0 0 cm\n/Im0 Do\nQ\n`;
    const contentBytes = encodeText(contentStream);
    const contentDict = `<< /Length ${contentBytes.length} >>\nstream\n`;
    const contentChunk = concatUint8([
      encodeText(contentDict),
      contentBytes,
      encodeText("endstream"),
    ]);
    objectChunks.push({ number: contentObjectNumber, bytes: contentChunk });

    const pageObject = [
      "<<",
      "/Type /Page",
      `/Parent ${pagesRootObjectNumber} 0 R`,
      `/MediaBox [0 0 ${image.width} ${image.height}]`,
      `/Resources << /XObject << /Im0 ${imageObjectNumber} 0 R >> >>`,
      `/Contents ${contentObjectNumber} 0 R`,
      ">>",
    ].join("\n");
    objectChunks.push({ number: pageObjectNumber, bytes: encodeText(pageObject) });
  }

  const pagesObject = [
    "<<",
    "/Type /Pages",
    `/Count ${pageObjectNumbers.length}`,
    `/Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(" ")}]`,
    ">>",
  ].join("\n");

  const catalogObject = [
    "<<",
    "/Type /Catalog",
    `/Pages ${pagesRootObjectNumber} 0 R`,
    ">>",
  ].join("\n");

  objectChunks.push({ number: pagesRootObjectNumber, bytes: encodeText(pagesObject) });
  objectChunks.push({ number: catalogObjectNumber, bytes: encodeText(catalogObject) });
  objectChunks.sort((a, b) => a.number - b.number);

  const pdfParts = [];
  const offsets = new Array(nextObjectNumber).fill(0);

  let cursor = 0;
  const push = (bytes) => {
    pdfParts.push(bytes);
    cursor += bytes.length;
  };

  push(encodeText(`%PDF-${PDF_VERSION}\n%\xFF\xFF\xFF\xFF\n`));

  for (const obj of objectChunks) {
    offsets[obj.number] = cursor;
    push(encodeText(`${obj.number} 0 obj\n`));
    push(obj.bytes);
    push(encodeText("\nendobj\n"));
  }

  const xrefOffset = cursor;
  push(encodeText(`xref\n0 ${nextObjectNumber}\n`));
  push(encodeText("0000000000 65535 f \n"));

  for (let i = 1; i < nextObjectNumber; i += 1) {
    const off = String(offsets[i]).padStart(10, "0");
    push(encodeText(`${off} 00000 n \n`));
  }

  const trailer = [
    "trailer",
    "<<",
    `/Size ${nextObjectNumber}`,
    `/Root ${catalogObjectNumber} 0 R`,
    ">>",
    "startxref",
    `${xrefOffset}`,
    "%%EOF",
  ].join("\n");

  push(encodeText(`${trailer}\n`));
  return concatUint8(pdfParts);
}

function auditRasterOnlyPdf(pdfBytes) {
  if (!ENABLE_PDF_RASTER_AUDIT_LOG || !pdfBytes || !pdfBytes.length) {
    return;
  }

  // Best-effort check: strip non-printable bytes and scan for text/font operators.
  // Note: some viewers may still OCR raster pages; this check only audits generator output.
  let asciiView = "";
  for (let i = 0; i < pdfBytes.length; i += 1) {
    const code = pdfBytes[i];
    asciiView += code >= 32 && code <= 126 ? String.fromCharCode(code) : " ";
  }

  const forbiddenPatterns = [
    "/Font",
    " BT ",
    " Tf ",
    " Tj ",
    " TJ ",
  ];

  const found = forbiddenPatterns.filter((pattern) => asciiView.includes(pattern));
  if (found.length > 0) {
    console.warn("Raster audit warning: text/font operators detected in generated PDF.", { found });
    return;
  }

  console.info("Raster audit passed: no text/font operators found in generated PDF.");
}

function concatUint8(chunks) {
  const total = chunks.reduce((sum, arr) => sum + arr.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }

  return out;
}

function encodeText(text) {
  return new TextEncoder().encode(text);
}

async function decodeImageBitmap(dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return createImageBitmap(blob);
}

/**
 * Converts a stitched OffscreenCanvas to a high-quality JPEG data URL.
 */
async function stitchedCanvasToJpgDataUrl(stitchedCanvas) {
  const blob = await stitchedCanvas.convertToBlob({
    type: "image/jpeg",
    quality: JPEG_QUALITY,
  });

  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const base64 = bytesToBase64(bytes);
  return `data:image/jpeg;base64,${base64}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSupportedTabUrl(url) {
  return /^https?:/i.test(url) || /^file:/i.test(url);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function runInMainWorld(tabId, func, args = []) {
  return chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func,
    args,
  });
}

async function preparePageForCapture(tabId) {
  try {
    const [resultPacket] = await runInMainWorld(tabId, () => {
      const STATE_KEY = "__captureCleanupState";
      const STYLE_ID = "__capture_cleanup_style";
      const MARK_ATTR = "data-capture-hidden";

      if (!window[STATE_KEY]) {
        window[STATE_KEY] = {
          hiddenMeta: [],
          layoutPatches: [],
          processedContainers: new WeakSet(),
          patchedElements: new WeakSet(),
          compactedContainerCount: 0,
          prepared: false,
        };
      }
      const state = window[STATE_KEY];

      if (state.prepared) {
        return {
          hiddenCount: state.hiddenMeta.length,
          heuristicCount: 0,
          compactedContainerCount: state.compactedContainerCount || 0,
        };
      }

      const adSelectors = [
        "[id*='ad-']",
        "[id^='ad_']",
        "[id*='ads']",
        "[id*='dfp']",
        "[id*='gpt']",
        "[class*='ad-']",
        "[class*='ads']",
        "[class*='ad_']",
        "[class*='dfp']",
        "[class*='gpt']",
        "[class*='banner']",
        "[class*='rail']",
        "[class*='sidebar']",
        "[class*='sponsored']",
        "[class*='promo']",
        "[class*='advert']",
        "[aria-label*='advert' i]",
        ".advertisement",
        ".ad-container",
        ".ad-wrapper",
        ".ad-slot",
        ".adsbygoogle",
        "[data-ad]",
        "[data-ads]",
        "[data-ad-slot]",
        "[data-slot*='ad']",
        "[data-testid*='ad']"
      ];

      if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `${adSelectors.join(", ")} { visibility: hidden !important; opacity: 0 !important; pointer-events: none !important; }`;
        (document.head || document.documentElement).appendChild(style);
      }

      const hiddenNodes = new Set();
      let heuristicCount = 0;
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const AD_MIN_WIDTH = 180;
      const AD_MIN_HEIGHT = 120;
      const AD_TOKEN_RE = /(ad|ads|advert|sponsor|promo|banner|rail|gpt|dfp)/i;

      function isVisible(el) {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        if (rect.bottom <= 0 || rect.top >= viewportHeight) return false;
        const cs = window.getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
        return true;
      }

      function inMainContent(el) {
        return Boolean(el.closest("main, article, [role='main']"));
      }

      function looksAdNamed(el) {
        const id = String(el.id || "");
        const cls = typeof el.className === "string" ? el.className : "";
        const attrs = `${id} ${cls} ${el.getAttribute("data-ad-slot") || ""} ${el.getAttribute("data-slot") || ""}`;
        return AD_TOKEN_RE.test(attrs);
      }

      function isLayoutContainer(el) {
        const display = window.getComputedStyle(el).display;
        if (display === "grid" || display === "inline-grid" || display === "flex" || display === "inline-flex") {
          return true;
        }

        const children = Array.from(el.children).filter((child) => child instanceof HTMLElement);
        return children.length >= 2;
      }

      function isBroadMainRoot(el) {
        if (!el.matches("main, article, [role='main']")) {
          return false;
        }
        const rect = el.getBoundingClientRect();
        return rect.width >= viewportWidth * 0.9 && rect.height >= viewportHeight * 0.6;
      }

      function savePatchOnce(el) {
        if (!(el instanceof HTMLElement) || state.patchedElements.has(el)) {
          return;
        }
        state.layoutPatches.push({
          el,
          prevStyleCssText: el.getAttribute("style") || "",
        });
        state.patchedElements.add(el);
      }

      function applyImportant(el, name, value) {
        savePatchOnce(el);
        el.style.setProperty(name, value, "important");
      }

      function isHiddenAdMeta(meta) {
        return meta && meta.area && (meta.area.width >= AD_MIN_WIDTH || meta.area.height >= AD_MIN_HEIGHT);
      }

      function findNearestCompactableContainer(adEl) {
        let current = adEl.parentElement;
        let depth = 0;
        while (current && depth < 8) {
          if (current === document.body || current === document.documentElement) {
            break;
          }

          if (isLayoutContainer(current) && !isBroadMainRoot(current)) {
            const children = Array.from(current.children).filter((child) => child instanceof HTMLElement);
            if (children.length >= 2) {
              return current;
            }
          }

          current = current.parentElement;
          depth += 1;
        }
        return null;
      }

      function getVisibleSiblings(container) {
        return Array.from(container.children).filter((child) => {
          if (!(child instanceof HTMLElement)) return false;
          if (child.hasAttribute(MARK_ATTR)) return false;
          if (!isVisible(child)) return false;
          return true;
        });
      }

      function pickPrimaryContentNode(nodes) {
        let best = null;
        let bestScore = 0;
        for (const node of nodes) {
          const rect = node.getBoundingClientRect();
          const textLen = (node.textContent || "").trim().length;
          const score = rect.width * rect.height + Math.min(textLen, 1000) * 2;
          if (score > bestScore) {
            bestScore = score;
            best = node;
          }
        }
        return best;
      }

      function compactContainerForAd(adMeta) {
        if (!isHiddenAdMeta(adMeta)) {
          return;
        }

        const adEl = adMeta.el;
        if (!(adEl instanceof HTMLElement)) {
          return;
        }

        const container = findNearestCompactableContainer(adEl);
        if (!container || state.processedContainers.has(container)) {
          return;
        }

        const visibleSiblings = getVisibleSiblings(container);
        const primary = pickPrimaryContentNode(visibleSiblings);
        if (!primary) {
          return;
        }

        const display = window.getComputedStyle(container).display;
        if (display === "grid" || display === "inline-grid") {
          applyImportant(container, "grid-template-columns", "minmax(0, 1fr)");
          applyImportant(container, "column-gap", "0");
          applyImportant(container, "justify-items", "center");
        } else if (display === "flex" || display === "inline-flex") {
          applyImportant(container, "justify-content", "center");
          applyImportant(container, "align-items", "stretch");
          applyImportant(primary, "flex", "1 1 auto");
        } else {
          applyImportant(container, "display", "block");
        }

        applyImportant(container, "width", "100%");
        applyImportant(container, "max-width", "100%");
        applyImportant(primary, "width", "auto");
        applyImportant(primary, "max-width", "none");
        applyImportant(primary, "min-width", "0");
        applyImportant(primary, "margin-left", "auto");
        applyImportant(primary, "margin-right", "auto");

        let ancestor = primary.parentElement;
        let hops = 0;
        while (ancestor && ancestor !== container && hops < 3) {
          if (ancestor instanceof HTMLElement) {
            applyImportant(ancestor, "width", "100%");
            applyImportant(ancestor, "max-width", "none");
            applyImportant(ancestor, "margin-left", "auto");
            applyImportant(ancestor, "margin-right", "auto");
          }
          ancestor = ancestor.parentElement;
          hops += 1;
        }

        state.processedContainers.add(container);
        state.compactedContainerCount += 1;
      }

      function hideNode(el, reason) {
        if (!(el instanceof HTMLElement) || hiddenNodes.has(el)) {
          return;
        }
        hiddenNodes.add(el);
        el.setAttribute(MARK_ATTR, "1");
        el.dataset.capturePrevDisplay = el.style.display || "";
        el.dataset.capturePrevVisibility = el.style.visibility || "";
        el.dataset.capturePrevOpacity = el.style.opacity || "";
        el.style.display = "none";
        const rect = el.getBoundingClientRect();
        state.hiddenMeta.push({
          el,
          reason,
          area: {
            width: rect.width,
            height: rect.height,
          },
        });
      }

      document.querySelectorAll(adSelectors.join(", ")).forEach((el) => {
        if (el instanceof HTMLElement) {
          hideNode(el, "selector");
        }
      });

      const adHosts = [
        "doubleclick",
        "googlesyndication",
        "adservice",
        "taboola",
        "outbrain",
        "amazon-adsystem",
        "pubmatic",
        "openx",
        "adnxs",
        "criteo",
      ];
      document.querySelectorAll("iframe").forEach((frame) => {
        const src = String(frame.src || "").toLowerCase();
        if (!src) return;
        if (adHosts.some((host) => src.includes(host))) {
          if (frame instanceof HTMLElement) {
            let target = frame;
            let depth = 0;
            while (target.parentElement && depth < 4) {
              const parent = target.parentElement;
              if (looksAdNamed(parent)) {
                target = parent;
              } else {
                break;
              }
              depth += 1;
            }
            hideNode(target, "iframe");
            heuristicCount += 1;
          }
        }
      });

      document.querySelectorAll("body *").forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (!isVisible(node)) return;
        if (inMainContent(node)) return;

        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        const text = (node.textContent || "").toLowerCase().trim();
        const linkCount = node.querySelectorAll("a").length;
        const textLen = text.length || 1;

        const isEdgeOverlay =
          (style.position === "fixed" || style.position === "sticky") &&
          (rect.top <= 8 || rect.bottom >= viewportHeight - 8) &&
          rect.height <= viewportHeight * 0.4 &&
          rect.width >= window.innerWidth * 0.5;

        const isPromoLike =
          (text.includes("sponsored") || text.includes("promoted") || text.includes("advertisement")) &&
          linkCount >= 2 &&
          linkCount / textLen > 0.01;

        const isLikelyAdRail =
          rect.height >= 120 &&
          rect.height <= viewportHeight * 0.5 &&
          rect.width <= window.innerWidth * 0.35 &&
          /ad|sponsor|promo|banner/i.test(`${node.id} ${node.className}`);

        const isAdNamedBlock =
          looksAdNamed(node) &&
          (rect.width >= AD_MIN_WIDTH || rect.height >= AD_MIN_HEIGHT) &&
          !inMainContent(node);

        if (isEdgeOverlay || isPromoLike || isLikelyAdRail || isAdNamedBlock) {
          hideNode(node, "heuristic");
          heuristicCount += 1;
        }
      });

      document.querySelectorAll("div, section, aside").forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (!looksAdNamed(node)) return;
        if (node.hasAttribute(MARK_ATTR)) return;
        if (inMainContent(node)) return;

        const visibleChildren = Array.from(node.children).filter((child) => {
          if (!(child instanceof HTMLElement)) return false;
          if (child.hasAttribute(MARK_ATTR)) return false;
          return isVisible(child);
        });

        const hasText = (node.textContent || "").trim().length > 80;
        if (visibleChildren.length === 0 && !hasText) {
          hideNode(node, "empty-ad-shell");
          heuristicCount += 1;
        }
      });

      state.hiddenMeta.forEach((meta) => {
        compactContainerForAd(meta);
      });

      state.prepared = true;
      return {
        hiddenCount: hiddenNodes.size,
        heuristicCount,
        compactedContainerCount: state.compactedContainerCount || 0,
      };
    });

    if (resultPacket?.result) {
      const { hiddenCount = 0, heuristicCount = 0, compactedContainerCount = 0 } = resultPacket.result;
      console.info("Capture cleanup applied:", { hiddenCount, heuristicCount, compactedContainerCount });
    }
  } catch (error) {
    console.warn("Capture cleanup skipped:", error);
  }
}

async function restorePageAfterCapture(tabId) {
  await runInMainWorld(tabId, () => {
    const STATE_KEY = "__captureCleanupState";
    const STYLE_ID = "__capture_cleanup_style";
    const MARK_ATTR = "data-capture-hidden";
    const state = window[STATE_KEY];

    if (state?.layoutPatches && Array.isArray(state.layoutPatches)) {
      for (let i = state.layoutPatches.length - 1; i >= 0; i -= 1) {
        const patch = state.layoutPatches[i];
        if (!patch?.el || !(patch.el instanceof HTMLElement)) {
          continue;
        }
        patch.el.setAttribute("style", patch.prevStyleCssText || "");
        if (!patch.prevStyleCssText) {
          patch.el.removeAttribute("style");
        }
      }
    }

    const style = document.getElementById(STYLE_ID);
    if (style) {
      style.remove();
    }

    document.querySelectorAll(`[${MARK_ATTR}='1']`).forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      node.style.display = node.dataset.capturePrevDisplay || "";
      node.style.visibility = node.dataset.capturePrevVisibility || "";
      node.style.opacity = node.dataset.capturePrevOpacity || "";
      delete node.dataset.capturePrevDisplay;
      delete node.dataset.capturePrevVisibility;
      delete node.dataset.capturePrevOpacity;
      node.removeAttribute(MARK_ATTR);
    });

    if (window[STATE_KEY]) {
      delete window[STATE_KEY];
    }
  });
}

function bytesToPdfDataUrl(bytes) {
  const base64 = bytesToBase64(bytes);
  return `data:application/pdf;base64,${base64}`;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function getViewerPdfPayload(token) {
  if (!token || !viewerPdfCache.has(token)) {
    return { ok: false, error: "PDF is no longer available. Capture again." };
  }

  const bytes = viewerPdfCache.get(token);
  viewerPdfCache.delete(token);
  return {
    ok: true,
    base64: bytesToBase64(bytes),
    filename: latestFileName,
  };
}

function buildViewerToken() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function buildPdfFileName(tab) {
  const fromTitle = sanitizeFileBase(tab?.title || "");
  if (fromTitle) {
    return `${fromTitle}.pdf`;
  }

  return buildFileNameFromUrl(tab?.url || "", "pdf");
}

function buildJpgFileName(tab) {
  const fromTitle = sanitizeFileBase(tab?.title || "");
  if (fromTitle) {
    return `${fromTitle}.jpg`;
  }

  return buildFileNameFromUrl(tab?.url || "", "jpg");
}

function sanitizeFileBase(input) {
  const cleaned = String(input)
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/g, "");

  if (!cleaned) {
    return "";
  }

  // Keep filenames reasonably short and cross-platform safe.
  return cleaned.slice(0, 120).trim();
}

function buildFileNameFromUrl(url, ext = "pdf") {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") {
      const pathPart = decodeURIComponent(parsed.pathname || "");
      const candidate = pathPart.split("/").pop() || "local-page";
      const withoutExt = candidate.replace(/\.[^/.]+$/, "");
      const safe = sanitizeFileBase(withoutExt);
      return `${safe || "local-page"}.${ext}`;
    }

    const pathPart = decodeURIComponent(parsed.pathname || "");
    const slug = pathPart.split("/").filter(Boolean).pop() || parsed.hostname.replace(/^www\./i, "");
    const safe = sanitizeFileBase(slug);
    return `${safe || "webpage-capture"}.${ext}`;
  } catch (_error) {
    return `webpage-capture-${Date.now()}.${ext}`;
  }
}
