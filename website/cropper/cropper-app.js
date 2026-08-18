import { applyPadding } from "./crop-detect.js";
import {
  classifyFile,
  fileStem,
  isRiskyWebFormat,
  VIDEO_WARN_BYTES,
  BATCH_WARN_COUNT,
} from "./media.js";
import { detectFromImageFile, cropImageFile } from "./process-image.js";
import {
  detectFromVideoFile,
  detectVideoCropFfmpeg,
  cropVideoFile,
  preloadFfmpeg,
} from "./process-video.js";
import { buildZip } from "./zip.js";

/** @typedef {{ x: number, y: number, w: number, h: number }} CropArea */

/** @type {{
 *   files: Array<{
 *     id: string,
 *     file: File,
 *     name: string,
 *     type: "image" | "video",
 *     previewUrl: string,
 *     crop: CropArea | null,
 *     naturalW: number,
 *     naturalH: number,
 *     detectKey: string | null,
 *     status: string,
 *     error: string | null,
 *     resultBlob: Blob | null,
 *     resultName: string | null,
 *     risky: boolean,
 *     oversized: boolean,
 *   }>,
 *   options: { tolerance: number, padding: boolean, outputFormat: string },
 *   tab: "queue" | "results",
 *   processing: boolean,
 *   previewId: string | null,
 * }} */
const state = {
  files: [],
  options: { tolerance: 20, padding: false, outputFormat: "same" },
  tab: "queue",
  processing: false,
  previewId: null,
};

let toleranceTimer = null;
let ffmpegPreloadStarted = false;

function $(id) {
  return document.getElementById(id);
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toast(message, isError = false) {
  const root = $("toasts");
  const el = document.createElement("div");
  el.className = `cropper-toast${isError ? " is-error" : ""}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 5200);
}

function detectKey() {
  return String(state.options.tolerance);
}

function displayedCrop(item) {
  if (!item.crop || !item.naturalW || !item.naturalH) return null;
  return state.options.padding
    ? applyPadding(item.crop, item.naturalW, item.naturalH, 10)
    : item.crop;
}

function initChrome() {
  const root = document.documentElement;
  const themeToggle = $("theme-toggle");

  function applyTheme(theme) {
    const isDark = theme !== "light";
    root.classList.toggle("dark", isDark);
    localStorage.setItem("theme", isDark ? "dark" : "light");
    if (themeToggle) {
      themeToggle.setAttribute("aria-pressed", isDark ? "true" : "false");
      themeToggle.setAttribute("title", isDark ? "Switch to light mode" : "Switch to dark mode");
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", isDark ? "#000000" : "#f6f7fb");
  }

  const savedTheme = localStorage.getItem("theme");
  if (savedTheme === "light") {
    applyTheme("light");
  } else {
    applyTheme("dark");
  }

  themeToggle?.addEventListener("click", () => {
    const isDark = root.classList.contains("dark");
    applyTheme(isDark ? "light" : "dark");
  });

  const navToggle = $("nav-toggle");
  const navMobile = $("nav-mobile");
  const navOverlay = $("nav-overlay");

  function setNavOpen(open) {
    navToggle?.setAttribute("aria-expanded", String(open));
    navMobile?.classList.toggle("open", open);
    navOverlay?.classList.toggle("open", open);
    navMobile?.toggleAttribute("hidden", !open);
    document.body.style.overflow = open ? "hidden" : "";
  }

  navToggle?.addEventListener("click", () => {
    setNavOpen(navToggle.getAttribute("aria-expanded") !== "true");
  });
  navOverlay?.addEventListener("click", () => setNavOpen(false));
  navMobile?.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setNavOpen(false));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && navToggle?.getAttribute("aria-expanded") === "true") {
      setNavOpen(false);
    }
  });
}

function maybePreloadFfmpeg() {
  if (ffmpegPreloadStarted) return;
  if (!state.files.some((f) => f.type === "video")) return;
  ffmpegPreloadStarted = true;
  preloadFfmpeg((msg) => setProgress(true, 0, msg)).catch((err) => {
    ffmpegPreloadStarted = false;
    toast(`Video engine failed to load. Images still work. ${err.message}`, true);
  });
}

function addFiles(fileList) {
  if (state.processing) return;
  const incoming = Array.from(fileList || []);
  let added = 0;
  const existing = new Set(state.files.map((f) => `${f.name}:${f.file.size}:${f.file.lastModified}`));

  for (const file of incoming) {
    const type = classifyFile(file.name);
    if (!type) {
      toast(`Skipped ${file.name} — unsupported format.`, true);
      continue;
    }
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (existing.has(key)) continue;
    existing.add(key);

    const oversized = type === "video" && file.size >= VIDEO_WARN_BYTES;
    state.files.push({
      id: crypto.randomUUID(),
      file,
      name: file.name,
      type,
      previewUrl: URL.createObjectURL(file),
      thumbnailUrl: null,
      crop: null,
      naturalW: 0,
      naturalH: 0,
      detectKey: null,
      status: "queued",
      error: null,
      resultBlob: null,
      resultName: null,
      risky: isRiskyWebFormat(file.name),
      oversized,
    });
    added += 1;
  }

  if (state.files.length > BATCH_WARN_COUNT) {
    toast(`That's ${state.files.length} files. The Windows app is faster for big batches.`);
  }
  if (state.files.some((f) => f.oversized)) {
    toast("A video is over 80MB. The browser may run out of memory — the Windows app handles large files.");
  }

  if (added) {
    maybePreloadFfmpeg();
    render();
  }
}

function removeFile(id) {
  if (state.processing) return;
  const item = state.files.find((f) => f.id === id);
  if (item) {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    if (item.thumbnailUrl) URL.revokeObjectURL(item.thumbnailUrl);
  }
  state.files = state.files.filter((f) => f.id !== id);
  if (state.previewId === id) closePreview();
  render();
}

async function ensureCrop(item, onStatus) {
  const key = detectKey();
  if (item.crop && item.detectKey === key) return item.crop;

  item.status = "detecting";
  item.error = null;
  renderQueue();

  try {
    if (item.type === "image") {
      const result = await detectFromImageFile(item.file, state.options.tolerance);
      item.crop = result.crop;
      item.naturalW = result.width;
      item.naturalH = result.height;
    } else {
      try {
        const result = await detectFromVideoFile(item.file, state.options.tolerance);
        item.crop = result.crop;
        item.naturalW = result.width;
        item.naturalH = result.height;
      } catch {
        onStatus?.("Analyzing video with FFmpeg engine…");
        const result = await detectVideoCropFfmpeg(item.file, state.options.tolerance, onStatus);
        item.crop = result.crop;
        item.naturalW = result.width;
        item.naturalH = result.height;
        if (result.thumbnailBlob && !item.thumbnailUrl) {
          item.thumbnailUrl = URL.createObjectURL(result.thumbnailBlob);
        }
      }
    }
    item.detectKey = key;
    item.status = "ready";
    return item.crop;
  } catch (err) {
    item.status = "error";
    item.error = err.message || "Detection failed.";
    throw err;
  } finally {
    renderQueue();
  }
}

async function openPreview(id) {
  const item = state.files.find((f) => f.id === id);
  if (!item) return;
  state.previewId = id;

  const dialog = $("preview-dialog");
  $("preview-title").textContent = item.name;
  $("preview-meta").textContent = "Detecting crop…";
  $("preview-overlay").hidden = true;
  $("preview-loading").hidden = false;

  const img = $("preview-img");
  const video = $("preview-video");

  if (item.type === "image") {
    img.hidden = false;
    video.hidden = true;
    img.src = item.previewUrl;
  } else if (item.thumbnailUrl) {
    img.hidden = false;
    video.hidden = true;
    img.src = item.thumbnailUrl;
  } else {
    img.hidden = true;
    video.hidden = false;
    if (video.src !== item.previewUrl) {
      video.src = item.previewUrl;
      video.play().catch(() => {});
    }
  }

  if (!dialog.open) dialog.showModal();

  try {
    await ensureCrop(item, (msg) => {
      if (state.previewId === id) $("preview-meta").textContent = msg;
    });
    if (item.thumbnailUrl && video.hidden) {
      img.src = item.thumbnailUrl;
      img.hidden = false;
    }
    updatePreviewOverlay();
  } catch (err) {
    $("preview-meta").textContent = err.message;
    $("preview-loading").hidden = true;
  }
}

function updatePreviewOverlay() {
  const item = state.files.find((f) => f.id === state.previewId);
  const overlay = $("preview-overlay");
  const loading = $("preview-loading");
  if (!item) return;

  loading.hidden = item.status !== "detecting";
  const crop = displayedCrop(item);
  if (!crop || !item.naturalW) {
    overlay.hidden = true;
    if (item.status !== "detecting") {
      $("preview-meta").textContent = item.error || "No crop detected.";
    }
    return;
  }

  overlay.hidden = false;
  overlay.style.left = `${(crop.x / item.naturalW) * 100}%`;
  overlay.style.top = `${(crop.y / item.naturalH) * 100}%`;
  overlay.style.width = `${(crop.w / item.naturalW) * 100}%`;
  overlay.style.height = `${(crop.h / item.naturalH) * 100}%`;
  $("preview-meta").textContent = `Crop ${crop.w}×${crop.h} at (${crop.x}, ${crop.y})${state.options.padding ? " · 10px padding" : ""}`;
}

function closePreview() {
  const dialog = $("preview-dialog");
  if (dialog.open) dialog.close();
  state.previewId = null;
  const video = $("preview-video");
  video.pause();
  video.removeAttribute("src");
  video.load();
  $("preview-img").removeAttribute("src");
}

function invalidateCrops() {
  for (const item of state.files) {
    item.crop = null;
    item.detectKey = null;
    if (item.status === "ready" || item.status === "error") item.status = "queued";
    item.error = null;
  }
}

function setProgress(visible, ratio, message) {
  const wrap = $("progress-wrap");
  wrap.hidden = !visible;
  $("progress-fill").style.width = `${Math.round((ratio || 0) * 100)}%`;
  $("progress-msg").textContent = message || "";
}

async function processAll() {
  if (state.processing || !state.files.length) return;
  state.processing = true;
  render();

  const total = state.files.length;
  let done = 0;
  let failures = 0;

  for (const item of state.files) {
    if (item.status === "done" && item.resultBlob) {
      done += 1;
      setProgress(true, done / total, `Already processed ${item.name}`);
      continue;
    }

    item.status = "processing";
    item.error = null;
    renderQueue();
    setProgress(true, done / total, `Detecting ${item.name}…`);

    try {
      await ensureCrop(item, (msg) => setProgress(true, done / total, msg));
      setProgress(true, (done + 0.4) / total, `Cropping ${item.name}…`);

      if (item.type === "image") {
        const result = await cropImageFile(
          item.file,
          item.crop,
          state.options.outputFormat,
          state.options.padding,
        );
        item.resultBlob = result.blob;
        item.resultName = `${fileStem(item.name)}_cropped.${result.ext}`;
      } else {
        const result = await cropVideoFile(
          item.file,
          item.crop,
          state.options.padding,
          item.naturalW,
          item.naturalH,
          (msg) => setProgress(true, (done + 0.45) / total, msg),
          (ratio) => setProgress(true, (done + 0.45 + ratio * 0.5) / total, `Encoding ${item.name}…`),
        );
        item.resultBlob = result.blob;
        item.resultName = `${fileStem(item.name)}_cropped.${result.ext}`;
      }
      item.status = "done";
    } catch (err) {
      failures += 1;
      item.status = "error";
      item.error = err.message || "Processing failed.";
    }

    done += 1;
    setProgress(true, done / total, item.error ? `Error: ${item.name}` : `Processed ${item.name}`);
    renderQueue();
  }

  state.processing = false;
  state.tab = "results";
  setProgress(false, 1, "");
  render();

  if (failures) {
    toast(`${failures} file${failures === 1 ? "" : "s"} failed. The Windows app handles large or unusual formats.`, true);
  } else {
    toast("Done. Download from Results — files never left this tab.");
  }
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}

async function downloadAll() {
  const ready = state.files.filter((f) => f.resultBlob && f.resultName);
  if (!ready.length) return;
  if (ready.length === 1) {
    downloadBlob(ready[0].resultBlob, ready[0].resultName);
    return;
  }
  const zip = await buildZip(ready.map((f) => ({ name: f.resultName, blob: f.resultBlob })));
  downloadBlob(zip, "autocrop-results.zip");
}

function renderQueue() {
  const grid = $("queue-grid");
  const dropzone = $("dropzone");
  const empty = $("queue-empty-hint");
  const hasFiles = state.files.length > 0;

  dropzone.classList.toggle("has-files", hasFiles);
  grid.hidden = !hasFiles;
  empty.hidden = hasFiles;
  $("queue-count").textContent = String(state.files.length);
  $("btn-process").disabled = !hasFiles || state.processing;
  $("process-label").textContent = state.processing ? "Processing…" : "Process files";
  $("opt-tolerance").disabled = state.processing;
  $("opt-padding").disabled = state.processing;
  $("opt-format").disabled = state.processing;
  $("btn-browse").disabled = state.processing;

  grid.innerHTML = state.files
    .map((item) => {
      const src = item.thumbnailUrl || item.previewUrl;
      const media =
        item.type === "image" || item.thumbnailUrl
          ? `<img src="${esc(src)}" alt="">`
          : `<video src="${esc(src)}" muted playsinline preload="metadata"></video>`;
      const sub = [
        item.type,
        formatBytes(item.file.size),
        item.risky ? "may need Windows app" : "",
        item.oversized ? ">80MB" : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const statusClass = item.status === "error" ? "is-error" : item.status === "done" ? "is-done" : "";
      return `<li>
        <article class="cropper-card" data-id="${item.id}" tabindex="0" role="button" aria-label="Preview ${esc(item.name)}">
          <button type="button" class="cropper-remove" data-remove="${item.id}" aria-label="Remove ${esc(item.name)}" ${state.processing ? "disabled" : ""}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
          <div class="cropper-thumb">${media}</div>
          <div class="cropper-card-meta">
            <div class="cropper-card-name">${esc(item.name)}</div>
            <div class="cropper-card-sub">${esc(sub)}</div>
            <span class="cropper-status ${statusClass}">${esc(item.error || item.status)}</span>
          </div>
        </article>
      </li>`;
    })
    .join("");
}

function renderResults() {
  const list = $("results-list");
  const empty = $("results-empty");
  const ready = state.files.filter((f) => f.resultBlob && f.resultName);
  $("results-count").textContent = String(ready.length);
  $("btn-download-all").disabled = !ready.length;
  empty.hidden = ready.length > 0;
  list.hidden = ready.length === 0;
  list.innerHTML = ready
    .map(
      (item) => `<li class="cropper-result">
        <span class="cropper-result-name">${esc(item.resultName)}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-download="${item.id}">Download</button>
      </li>`,
    )
    .join("");
}

function setTab(tab) {
  state.tab = tab;
  $("tab-queue").classList.toggle("is-active", tab === "queue");
  $("tab-results").classList.toggle("is-active", tab === "results");
  $("tab-queue").setAttribute("aria-selected", String(tab === "queue"));
  $("tab-results").setAttribute("aria-selected", String(tab === "results"));
  $("panel-queue").hidden = tab !== "queue";
  $("panel-results").hidden = tab !== "results";
}

function render() {
  setTab(state.tab);
  renderQueue();
  renderResults();
}

function bind() {
  const dropzone = $("dropzone");
  const input = $("file-input");

  $("btn-browse").addEventListener("click", (e) => {
    e.stopPropagation();
    input.click();
  });
  dropzone.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    addFiles(input.files);
    input.value = "";
  });

  ["dragenter", "dragover"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("is-hover");
    });
  });
  ["dragleave", "drop"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("is-hover");
    });
  });
  dropzone.addEventListener("drop", (e) => {
    addFiles(e.dataTransfer?.files);
  });

  $("queue-grid").addEventListener("click", (e) => {
    const remove = e.target.closest("[data-remove]");
    if (remove) {
      e.stopPropagation();
      removeFile(remove.getAttribute("data-remove"));
      return;
    }
    const card = e.target.closest(".cropper-card");
    if (card) openPreview(card.getAttribute("data-id"));
  });
  $("queue-grid").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".cropper-card");
    if (!card) return;
    e.preventDefault();
    openPreview(card.getAttribute("data-id"));
  });

  $("results-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-download]");
    if (!btn) return;
    const item = state.files.find((f) => f.id === btn.getAttribute("data-download"));
    if (item?.resultBlob) downloadBlob(item.resultBlob, item.resultName);
  });

  $("tab-queue").addEventListener("click", () => {
    state.tab = "queue";
    render();
  });
  $("tab-results").addEventListener("click", () => {
    state.tab = "results";
    render();
  });

  $("opt-tolerance").addEventListener("input", (e) => {
    const value = Number(e.target.value);
    state.options.tolerance = value;
    $("tolerance-value").textContent = `${value}%`;
    e.target.setAttribute("aria-valuenow", String(value));
    invalidateCrops();
    renderQueue();
    if (toleranceTimer) clearTimeout(toleranceTimer);
    toleranceTimer = setTimeout(() => {
      if (state.previewId) openPreview(state.previewId);
    }, 300);
  });

  $("opt-padding").addEventListener("click", () => {
    state.options.padding = !state.options.padding;
    $("opt-padding").setAttribute("aria-checked", String(state.options.padding));
    updatePreviewOverlay();
  });

  $("opt-format").addEventListener("change", (e) => {
    state.options.outputFormat = e.target.value;
  });

  $("btn-process").addEventListener("click", () => processAll());
  $("btn-download-all").addEventListener("click", () => {
    downloadAll().catch((err) => toast(err.message, true));
  });

  $("preview-close").addEventListener("click", () => closePreview());
  $("preview-dialog").addEventListener("close", () => {
    state.previewId = null;
    const video = $("preview-video");
    video.pause();
  });
  $("preview-dialog").addEventListener("click", (e) => {
    if (e.target === $("preview-dialog")) closePreview();
  });

  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    if (e.target.closest("#dropzone")) return;
    e.preventDefault();
    addFiles(e.dataTransfer?.files);
  });
}

initChrome();
bind();
render();
