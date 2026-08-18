import { detectImageCrop, unionCrops, applyPadding, evenCrop } from "./crop-detect.js";
import { getExtension, fileStem } from "./media.js";

const FFMPEG_PKG = "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm";
const FFMPEG_CORE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm";
const FFMPEG_UTIL = "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js";
// Browsers block cross-origin Worker() (jsDelivr). Host the tiny worker on this origin.
const CLASS_WORKER_URL = new URL("./ffmpeg/worker.js", import.meta.url).href;

const DESKTOP_VIDEO_HINT =
  "This video could not be processed in the browser. Download the Windows app for large files and formats like WMV, AVI, and MKV.";

/** @type {any} */
let ffmpegInstance = null;
/** @type {Promise<any> | null} */
let ffmpegLoading = null;
/** @type {((data: Uint8Array | File | Blob) => Promise<Uint8Array>) | null} */
let fetchFileFn = null;

/**
 * @param {(msg: string) => void} [onStatus]
 */
export async function preloadFfmpeg(onStatus) {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoading) return ffmpegLoading;

  ffmpegLoading = loadFfmpeg(onStatus).finally(() => {
    ffmpegLoading = null;
  });
  return ffmpegLoading;
}

/**
 * @param {(msg: string) => void} [onStatus]
 */
async function loadFfmpeg(onStatus) {
  onStatus?.("Loading in-browser video engine (~25MB, one-time)…");

  const [{ FFmpeg }, util] = await Promise.all([
    import(`${FFMPEG_PKG}/index.js`),
    import(FFMPEG_UTIL),
  ]);

  fetchFileFn = util.fetchFile;
  const ffmpeg = new FFmpeg();

  try {
    await ffmpeg.load({
      coreURL: await util.toBlobURL(`${FFMPEG_CORE}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await util.toBlobURL(`${FFMPEG_CORE}/ffmpeg-core.wasm`, "application/wasm"),
      classWorkerURL: CLASS_WORKER_URL,
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (/worker/i.test(msg) || /securityerror/i.test(msg)) {
      throw new Error("Could not start the in-browser video engine. Try a refresh, or use the Windows app.");
    }
    throw err;
  }

  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

/**
 * @param {HTMLVideoElement} video
 * @param {number} time
 */
function seekVideo(video, time) {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(DESKTOP_VIDEO_HINT));
    };
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const target = duration > 0 ? Math.min(Math.max(time, 0), Math.max(0, duration - 0.05)) : 0;
    if (Math.abs(video.currentTime - target) < 0.001 && video.readyState >= 2) {
      cleanup();
      resolve();
      return;
    }
    video.currentTime = target;
  });
}

/**
 * Sample up to 30 frames and union histogram crops.
 * @param {File} file
 * @param {number} tolerance
 * @param {(current: number, total: number) => void} [onProgress]
 */
export async function detectFromVideoFile(file, tolerance, onProgress) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;

  try {
    await new Promise((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error(DESKTOP_VIDEO_HINT));
      };
      const cleanup = () => {
        video.removeEventListener("loadeddata", onReady);
        video.removeEventListener("error", onError);
      };
      video.addEventListener("loadeddata", onReady);
      video.addEventListener("error", onError);
      video.load();
    });

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) throw new Error(DESKTOP_VIDEO_HINT);

    try {
      await video.play();
      video.pause();
    } catch {
      // Autoplay can fail; seeking still works after loadeddata.
    }

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const sampleWindow = duration > 0 ? Math.min(duration, 2) : 0;
    const frameCount = sampleWindow === 0 ? 1 : 30;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas is not available in this browser.");

    const crops = [];
    for (let i = 0; i < frameCount; i++) {
      const t = frameCount === 1 ? 0 : (i / (frameCount - 1)) * sampleWindow;
      await seekVideo(video, t);
      ctx.drawImage(video, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      crops.push(detectImageCrop(imageData.data, width, height, { tolerance }));
      onProgress?.(i + 1, frameCount);
    }

    return {
      crop: unionCrops(crops, width, height),
      width,
      height,
    };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * FFmpeg cropdetect fallback when the browser cannot decode the container.
 * @param {File} file
 * @param {number} tolerance
 * @param {(msg: string) => void} [onStatus]
 */
export async function detectVideoCropFfmpeg(file, tolerance, onStatus) {
  const ffmpeg = await preloadFfmpeg(onStatus);
  if (!fetchFileFn) throw new Error(DESKTOP_VIDEO_HINT);

  const ext = getExtension(file.name).replace(".", "") || "mp4";
  const inputName = `detect_in.${ext}`;
  await ffmpeg.writeFile(inputName, await fetchFileFn(file));

  const logs = [];
  const onLog = ({ message }) => {
    if (message) logs.push(message);
  };
  ffmpeg.on("log", onLog);

  const limit = Math.min(1, Math.max(0, tolerance / 100)).toFixed(4);
  try {
    await ffmpeg.exec([
      "-i",
      inputName,
      "-vframes",
      "30",
      "-vf",
      `cropdetect=limit=${limit}:round=2:reset=1`,
      "-f",
      "null",
      "-",
    ]);
  } finally {
    ffmpeg.off("log", onLog);
    try {
      await ffmpeg.deleteFile(inputName);
    } catch {
      // ignore
    }
  }

  const re = /crop=(\d+):(\d+):(\d+):(\d+)/g;
  let last = null;
  const text = logs.join("\n");
  let match;
  while ((match = re.exec(text))) {
    last = { w: Number(match[1]), h: Number(match[2]), x: Number(match[3]), y: Number(match[4]) };
  }
  if (!last || last.w === 0 || last.h === 0) {
    throw new Error(DESKTOP_VIDEO_HINT);
  }

  const dimMatch = text.match(/(\d{2,5})x(\d{2,5})/);
  const width = dimMatch ? Number(dimMatch[1]) : last.x + last.w;
  const height = dimMatch ? Number(dimMatch[2]) : last.y + last.h;
  return { crop: last, width, height };
}

function outputVideoExt(name) {
  return getExtension(name) === ".webm" ? "webm" : "mp4";
}

function isMemoryError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("memory") || msg.includes("out of") || msg.includes("array buffer") || msg.includes("oom");
}

/**
 * @param {File} file
 * @param {{ x: number, y: number, w: number, h: number }} crop
 * @param {boolean} padding
 * @param {number} [frameW]
 * @param {number} [frameH]
 * @param {(msg: string) => void} [onStatus]
 * @param {(ratio: number) => void} [onProgress]
 */
export async function cropVideoFile(file, crop, padding, frameW, frameH, onStatus, onProgress) {
  const ffmpeg = await preloadFfmpeg(onStatus);
  if (!fetchFileFn) throw new Error(DESKTOP_VIDEO_HINT);

  const ext = getExtension(file.name).replace(".", "") || "mp4";
  const outExt = outputVideoExt(file.name);
  const inputName = `in.${ext}`;
  const outputName = `out.${outExt}`;

  onStatus?.("Writing video into the in-browser engine…");
  try {
    await ffmpeg.writeFile(inputName, await fetchFileFn(file));
  } catch (err) {
    if (isMemoryError(err)) {
      throw new Error("This video is too large for the browser. Download the Windows app for big batches.");
    }
    throw err;
  }

  let width = frameW || 0;
  let height = frameH || 0;
  if (!width || !height) {
    // Probe via a dummy crop; callers should pass dimensions from detect.
    width = crop.x + crop.w;
    height = crop.y + crop.h;
  }

  let finalCrop = padding ? applyPadding(crop, width, height, 10) : crop;
  finalCrop = evenCrop(finalCrop, width, height);
  const cropFilter = `crop=${finalCrop.w}:${finalCrop.h}:${finalCrop.x}:${finalCrop.y}`;

  const onFfmpegProgress = ({ progress }) => {
    if (typeof progress === "number" && Number.isFinite(progress)) {
      onProgress?.(Math.min(1, Math.max(0, progress)));
    }
  };
  ffmpeg.on("progress", onFfmpegProgress);

  try {
    onStatus?.(`Cropping ${fileStem(file.name)}…`);
    try {
      await ffmpeg.exec(["-y", "-i", inputName, "-vf", cropFilter, "-c:a", "copy", outputName]);
    } catch {
      await ffmpeg.exec(["-y", "-i", inputName, "-vf", cropFilter, outputName]);
    }

    const data = await ffmpeg.readFile(outputName);
    const copy = new Uint8Array(data);
    const mime = outExt === "webm" ? "video/webm" : "video/mp4";
    return { blob: new Blob([copy], { type: mime }), ext: outExt };
  } catch (err) {
    if (isMemoryError(err)) {
      throw new Error("This video is too large for the browser. Download the Windows app for big batches.");
    }
    throw new Error(DESKTOP_VIDEO_HINT);
  } finally {
    ffmpeg.off("progress", onFfmpegProgress);
    try {
      await ffmpeg.deleteFile(inputName);
    } catch {
      // ignore
    }
    try {
      await ffmpeg.deleteFile(outputName);
    } catch {
      // ignore
    }
  }
}
