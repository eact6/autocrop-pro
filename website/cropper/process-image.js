import { detectImageCrop, applyPadding } from "./crop-detect.js";

const DESKTOP_HINT = "This browser cannot decode this image. TIFF and some formats need the Windows app.";

/**
 * @param {File} file
 * @returns {Promise<ImageBitmap | HTMLImageElement>}
 */
export async function loadImageBitmap(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through
    }
  }
  return loadViaElement(file);
}

/**
 * @param {File} file
 * @returns {Promise<HTMLImageElement>}
 */
function loadViaElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(DESKTOP_HINT));
    };
    img.src = url;
  });
}

/**
 * @param {CanvasImageSource & { width: number, height: number }} source
 */
function sourceSize(source) {
  const width = "naturalWidth" in source && source.naturalWidth ? source.naturalWidth : source.width;
  const height = "naturalHeight" in source && source.naturalHeight ? source.naturalHeight : source.height;
  return { width, height };
}

/**
 * @param {File} file
 * @param {number} tolerance
 * @returns {Promise<{ crop: { x: number, y: number, w: number, h: number }, width: number, height: number }>}
 */
export async function detectFromImageFile(file, tolerance) {
  const bitmap = await loadImageBitmap(file);
  try {
    const { width, height } = sourceSize(bitmap);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas is not available in this browser.");
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height);
    return {
      crop: detectImageCrop(imageData.data, width, height, { tolerance }),
      width,
      height,
    };
  } finally {
    if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();
  }
}

/**
 * @param {string} outputFormat
 * @param {string} sourceName
 */
export function imageOutputSpec(outputFormat, sourceName) {
  const lower = (outputFormat || "same").toLowerCase();
  const sourceExt = (sourceName.split(".").pop() || "png").toLowerCase();
  const normalizedSource = sourceExt === "jpeg" ? "jpg" : sourceExt;

  if (lower === "same" || lower === "same as source" || lower === "") {
    if (normalizedSource === "jpg" || normalizedSource === "jpeg") {
      return { ext: "jpg", mime: "image/jpeg" };
    }
    if (normalizedSource === "webp") return { ext: "webp", mime: "image/webp" };
    if (normalizedSource === "gif") return { ext: "png", mime: "image/png" };
    if (normalizedSource === "bmp" || normalizedSource === "tif" || normalizedSource === "tiff") {
      return { ext: "png", mime: "image/png" };
    }
    return { ext: "png", mime: "image/png" };
  }
  if (lower === "jpg" || lower === "jpeg") return { ext: "jpg", mime: "image/jpeg" };
  if (lower === "webp") return { ext: "webp", mime: "image/webp" };
  return { ext: "png", mime: "image/png" };
}

/**
 * @param {File} file
 * @param {{ x: number, y: number, w: number, h: number }} crop
 * @param {string} outputFormat
 * @param {boolean} padding
 */
export async function cropImageFile(file, crop, outputFormat, padding) {
  const bitmap = await loadImageBitmap(file);
  try {
    const { width, height } = sourceSize(bitmap);
    const finalCrop = padding ? applyPadding(crop, width, height, 10) : crop;
    const w = Math.max(1, Math.min(finalCrop.w, width - finalCrop.x));
    const h = Math.max(1, Math.min(finalCrop.h, height - finalCrop.y));
    const x = Math.min(finalCrop.x, width - 1);
    const y = Math.min(finalCrop.y, height - 1);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available in this browser.");
    ctx.drawImage(bitmap, x, y, w, h, 0, 0, w, h);

    const spec = imageOutputSpec(outputFormat, file.name);
    const quality = spec.mime === "image/jpeg" || spec.mime === "image/webp" ? 0.92 : undefined;
    const blob = await canvasToBlob(canvas, spec.mime, quality);
    return { blob, ext: spec.ext, width: w, height: h };
  } finally {
    if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();
  }
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} mime
 * @param {number} [quality]
 * @returns {Promise<Blob>}
 */
function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not encode the cropped image."));
      },
      mime,
      quality,
    );
  });
}
