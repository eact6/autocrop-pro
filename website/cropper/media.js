export const VIDEO_EXTENSIONS = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv"];
export const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif", ".gif"];
export const RISKY_WEB_EXTENSIONS = [".tiff", ".tif", ".wmv", ".avi", ".mkv", ".flv"];

export const VIDEO_WARN_BYTES = 80 * 1024 * 1024;
export const BATCH_WARN_COUNT = 30;

/**
 * @param {string} name
 * @returns {string}
 */
export function getExtension(name) {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  return name.slice(dot).toLowerCase();
}

/**
 * @param {string} name
 * @returns {"video" | "image" | null}
 */
export function classifyFile(name) {
  const ext = getExtension(name);
  if (VIDEO_EXTENSIONS.includes(ext)) return "video";
  if (IMAGE_EXTENSIONS.includes(ext)) return "image";
  return null;
}

/**
 * @param {string} name
 */
export function isRiskyWebFormat(name) {
  return RISKY_WEB_EXTENSIONS.includes(getExtension(name));
}

/**
 * @param {string} name
 */
export function fileStem(name) {
  const base = name.split(/[/\\]/).pop() || name;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}
