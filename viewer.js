const statusEl = document.getElementById("status");
const frameEl = document.getElementById("pdfFrame");

init().catch((error) => {
  statusEl.textContent = error?.message || "Failed to load PDF.";
});

async function init() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");

  if (!token) {
    throw new Error("Missing PDF token.");
  }

  const response = await chrome.runtime.sendMessage({ type: "GET_VIEWER_PDF", token });
  if (!response?.ok || !response?.base64) {
    throw new Error(response?.error || "PDF not available.");
  }

  const fileName = (response.filename || "PDF").replace(/\.pdf$/i, "");
  document.title = fileName;

  const bytes = base64ToBytes(response.base64);
  const blob = new Blob([bytes], { type: "application/pdf" });
  const blobUrl = URL.createObjectURL(blob);

  frameEl.src = blobUrl;
  frameEl.style.display = "block";
  statusEl.style.display = "none";

  window.addEventListener("beforeunload", () => {
    URL.revokeObjectURL(blobUrl);
  });
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}
