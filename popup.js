const captureBtn = document.getElementById("captureBtn");
const captureJpgBtn = document.getElementById("captureJpgBtn");
const resultWrap = document.getElementById("resultWrap");
const sizeText = document.getElementById("sizeText");
const openBtn = document.getElementById("openBtn");
const downloadBtn = document.getElementById("downloadBtn");
const copyImgBtn = document.getElementById("copyImgBtn");
const errorText = document.getElementById("errorText");

const port = chrome.runtime.connect({ name: "popover-state" });
port.onMessage.addListener((msg) => {
  if (msg?.type === "STATE") {
    renderState(msg.payload);
  }
});

captureBtn.addEventListener("click", async () => {
  clearError();
  try {
    const response = await chrome.runtime.sendMessage({ type: "START_CAPTURE" });
    if (!response?.ok) {
      showError(response?.error || "Failed to start capture.");
    }
  } catch (error) {
    showError(error.message || "Failed to start capture.");
  }
});

captureJpgBtn.addEventListener("click", async () => {
  clearError();
  try {
    const response = await chrome.runtime.sendMessage({ type: "START_CAPTURE_JPG" });
    if (!response?.ok) {
      showError(response?.error || "Failed to start capture.");
    }
  } catch (error) {
    showError(error.message || "Failed to start capture.");
  }
});

openBtn.addEventListener("click", async () => {
  clearError();
  try {
    const response = await chrome.runtime.sendMessage({ type: "OPEN_RESULT" });
    if (!response?.ok) {
      showError(response?.error || "Unable to open.");
    }
  } catch (error) {
    showError(error.message || "Unable to open.");
  }
});

downloadBtn.addEventListener("click", async () => {
  clearError();
  try {
    const response = await chrome.runtime.sendMessage({ type: "DOWNLOAD_RESULT" });
    if (!response?.ok) {
      showError(response?.error || "Unable to download.");
    }
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
      copyImgBtn.textContent = "\ud83d\udccb Copy Image";
      return;
    }

    // Convert JPEG data URL to PNG blob for clipboard (clipboard API requires PNG)
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
      copyImgBtn.textContent = "\ud83d\udccb Copy Image";
      copyImgBtn.classList.remove("copied");
      copyImgBtn.disabled = false;
    }, 2000);
  } catch (error) {
    showError(error.message || "Failed to copy image.");
    copyImgBtn.disabled = false;
    copyImgBtn.textContent = "\ud83d\udccb Copy Image";
  }
});

chrome.runtime.sendMessage({ type: "GET_STATE" }).then((response) => {
  if (response?.ok) {
    renderState(response.state);
  }
});

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
  if (bytes < 1024) {
    return `${bytes} B`;
  }
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
