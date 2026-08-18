import { detectImageCrop, unionCrops, applyPadding, evenCrop } from "./crop-detect.js";
import { getExtension, fileStem } from "./media.js";

const FFMPEG_PKG = "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm";
const FFMPEG_CORE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm";
const FFMPEG_UTIL = "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js";
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
 * Robust video seeking with a safety timeout so browser playback / non-indexed streams never freeze.
 * @param {HTMLVideoElement} video
 * @param {number} time
 * @param {number} [timeoutMs=800]
 */
function seekVideo(video, time, timeoutMs = 800) {
  return new Promise((resolve) => {
    let timer = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      resolve();
    };

    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const target = duration > 0 ? Math.min(Math.max(time, 0), Math.max(0, duration - 0.05)) : 0;

    if (Math.abs(video.currentTime - target) < 0.02 && video.readyState >= 2) {
      cleanup();
      resolve();
      return;
    }

    try {
      video.currentTime = target;
    } catch {
      cleanup();
      resolve();
    }
  });
}

/**
 * Sample video frames across the timeline and union histogram crops.
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
      let timer = null;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        video.removeEventListener("loadeddata", onReady);
        video.removeEventListener("loadedmetadata", onReady);
        video.removeEventListener("error", onError);
      };
      const onReady = () => {
        if (video.videoWidth && video.videoHeight) {
          cleanup();
          resolve();
        }
      };
      const onError = () => {
        cleanup();
        reject(new Error(DESKTOP_VIDEO_HINT));
      };

      video.addEventListener("loadeddata", onReady, { once: true });
      video.addEventListener("loadedmetadata", onReady, { once: true });
      video.addEventListener("error", onError, { once: true });

      timer = setTimeout(() => {
        cleanup();
        if (video.videoWidth && video.videoHeight) resolve();
        else reject(new Error(DESKTOP_VIDEO_HINT));
      }, 3500);

      video.load();
    });

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) throw new Error(DESKTOP_VIDEO_HINT);

    try {
      await video.play();
      video.pause();
    } catch {
      // Autoplay can fail in background; seeking still works
    }

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const frameCount = duration > 0 ? 12 : 1;
    const start = duration > 1 ? Math.min(0.5, duration * 0.08) : 0;
    const end = duration > 1 ? Math.max(start, duration - 0.5) : duration;
    const span = end - start;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas is not available in this browser.");

    const crops = [];
    for (let i = 0; i < frameCount; i++) {
      const t = frameCount === 1 ? start : start + (i / (frameCount - 1)) * span;
      await seekVideo(video, t, 600);
      try {
        ctx.drawImage(video, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        crops.push(detectImageCrop(imageData.data, width, height, { tolerance }));
      } catch {
        // Continue if a frame cannot be rendered
      }
      onProgress?.(i + 1, frameCount);
    }

    if (!crops.length) {
      throw new Error(DESKTOP_VIDEO_HINT);
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
 * Also extracts a 1-frame poster image for preview thumbnails.
 * @param {File} file
 * @param {number} tolerance
 * @param {(msg: string) => void} [onStatus]
 */
export async function detectVideoCropFfmpeg(file, tolerance, onStatus) {
  const ffmpeg = await preloadFfmpeg(onStatus);
  if (!fetchFileFn) throw new Error(DESKTOP_VIDEO_HINT);

  const ext = getExtension(file.name).replace(".", "") || "mp4";
  const inputName = `detect_in_${Date.now()}.${ext}`;
  const thumbName = `thumb_${Date.now()}.jpg`;

  await ffmpeg.writeFile(inputName, await fetchFileFn(file));

  const logs = [];
  const onLog = ({ message }) => {
    if (message) logs.push(message);
  };
  ffmpeg.on("log", onLog);

  const limit = Math.min(1, Math.max(0, tolerance / 100)).toFixed(4);
  let thumbnailBlob = null;

  try {
    // Run cropdetect on 30 frames
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

    // Try extracting a preview thumbnail image for non-native video formats
    try {
      await ffmpeg.exec([
        "-i",
        inputName,
        "-ss",
        "00:00:00.5",
        "-vframes",
        "1",
        "-q:v",
        "3",
        thumbName,
      ]);
      const thumbData = await ffmpeg.readFile(thumbName);
      if (thumbData && thumbData.length > 0) {
        thumbnailBlob = new Blob([new Uint8Array(thumbData)], { type: "image/jpeg" });
      }
    } catch {
      // Thumbnail extraction is best-effort
    }
  } finally {
    ffmpeg.off("log", onLog);
    try {
      await ffmpeg.deleteFile(inputName);
    } catch {}
    try {
      await ffmpeg.deleteFile(thumbName);
    } catch {}
  }

  const text = logs.join("\n");

  // Collect all detected crop rectangles and pick the most common (mode)
  const re = /crop=(\d+):(\d+):(\d+):(\d+)/g;
  const cropCounts = new Map();
  let match;
  let lastCrop = null;

  while ((match = re.exec(text))) {
    const crop = {
      w: Number(match[1]),
      h: Number(match[2]),
      x: Number(match[3]),
      y: Number(match[4]),
    };
    if (crop.w > 0 && crop.h > 0) {
      const key = `${crop.w}:${crop.h}:${crop.x}:${crop.y}`;
      cropCounts.set(key, (cropCounts.get(key) || 0) + 1);
      lastCrop = crop;
    }
  }

  let bestCrop = lastCrop;
  let maxCount = 0;
  for (const [key, count] of cropCounts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      const [w, h, x, y] = key.split(":").map(Number);
      bestCrop = { w, h, x, y };
    }
  }

  if (!bestCrop || bestCrop.w === 0 || bestCrop.h === 0) {
    throw new Error(DESKTOP_VIDEO_HINT);
  }

  // Extract source dimensions from stream info or max crop coordinates
  let width = 0;
  let height = 0;
  const streamMatch = text.match(/Stream #\d+:\d+.*Video:.*?\s*(\d{2,5})x(\d{2,5})/);
  if (streamMatch) {
    width = Number(streamMatch[1]);
    height = Number(streamMatch[2]);
  } else {
    const boundsMatch = text.match(/x2:(\d+)\s+y2:(\d+)/);
    if (boundsMatch) {
      width = Number(boundsMatch[1]) + 1;
      height = Number(boundsMatch[2]) + 1;
    } else {
      width = bestCrop.x + bestCrop.w;
      height = bestCrop.y + bestCrop.h;
    }
  }

  return { crop: bestCrop, width, height, thumbnailBlob };
}

function isMemoryError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("memory") ||
    msg.includes("out of memory") ||
    msg.includes("array buffer") ||
    msg.includes("oom")
  );
}

/**
 * Crop a video file via in-browser FFmpeg WebAssembly.
 * Outputs fast, universally compatible MP4 (H.264 / YUV420p).
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
  const inputName = `in_${Date.now()}.${ext}`;
  const outputName = `out_${Date.now()}.mp4`;

  onStatus?.("Writing video into the in-browser engine…");
  try {
    await ffmpeg.writeFile(inputName, await fetchFileFn(file));
  } catch (err) {
    if (isMemoryError(err)) {
      throw new Error(
        "This video is too large for the browser. Download the Windows app for big batches."
      );
    }
    throw err;
  }

  let width = frameW || 0;
  let height = frameH || 0;
  if (!width || !height) {
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

    const args = [
      "-i",
      inputName,
      "-vf",
      cropFilter,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "ultrafast",
      "-movflags",
      "+faststart",
      outputName,
    ];

    const ret = await ffmpeg.exec(args);
    if (ret !== 0) {
      throw new Error(DESKTOP_VIDEO_HINT);
    }

    const data = await ffmpeg.readFile(outputName);
    const copy = new Uint8Array(data);
    return { blob: new Blob([copy], { type: "video/mp4" }), ext: "mp4" };
  } catch (err) {
    if (isMemoryError(err)) {
      throw new Error(
        "This video is too large for the browser. Download the Windows app for big batches."
      );
    }
    throw err;
  } finally {
    ffmpeg.off("progress", onFfmpegProgress);
    try {
      await ffmpeg.deleteFile(inputName);
    } catch {}
    try {
      await ffmpeg.deleteFile(outputName);
    } catch {}
  }
}
