/**
 * Histogram edge detection — port of detect_image_crop in src-tauri/src/lib.rs.
 * Operates on packed pixel buffers (RGBA from canvas or RGB).
 */

/**
 * @typedef {{ x: number, y: number, w: number, h: number }} CropArea
 */

/**
 * @param {Uint8ClampedArray | Uint8Array} data
 * @param {number} width
 * @param {number} height
 * @param {{ tolerance?: number, channels?: number }} [opts]
 * @returns {CropArea}
 */
export function detectImageCrop(data, width, height, opts = {}) {
  const tolerance = opts.tolerance ?? 20;
  const channels = opts.channels ?? 4;

  if (width === 0 || height === 0) {
    return { w: width, h: height, x: 0, y: 0 };
  }

  // Rust: ((tolerance / 100.0) * 255.0).clamp(0.0, 254.0) as u8
  const threshold = Math.min(254, Math.max(0, Math.trunc((tolerance / 100) * 255)));

  const rowCounts = new Uint32Array(height);
  const colCounts = new Uint32Array(width);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > threshold || g > threshold || b > threshold) {
        rowCounts[y] += 1;
        colCounts[x] += 1;
      }
    }
  }

  // Rust: (dim as f32 * 0.01).max(1.0) as u32
  const colNoiseFloor = Math.max(1, Math.trunc(height * 0.01));
  const rowNoiseFloor = Math.max(1, Math.trunc(width * 0.01));

  let minX = 0;
  let maxX = Math.max(0, width - 1);
  let minY = 0;
  let maxY = Math.max(0, height - 1);

  while (minX < maxX && colCounts[minX] < colNoiseFloor) minX += 1;
  while (maxX > minX && colCounts[maxX] < colNoiseFloor) maxX -= 1;
  while (minY < maxY && rowCounts[minY] < rowNoiseFloor) minY += 1;
  while (maxY > minY && rowCounts[maxY] < rowNoiseFloor) maxY -= 1;

  if (minX >= maxX || minY >= maxY) {
    return { w: width, h: height, x: 0, y: 0 };
  }

  return {
    w: maxX - minX + 1,
    h: maxY - minY + 1,
    x: minX,
    y: minY,
  };
}

/**
 * 10px padding, clamped to the source frame (matches process_files + process_single_image).
 * @param {CropArea} crop
 * @param {number} width
 * @param {number} height
 * @param {number} [pad=10]
 * @returns {CropArea}
 */
export function applyPadding(crop, width, height, pad = 10) {
  const x = Math.max(0, crop.x - pad);
  const y = Math.max(0, crop.y - pad);
  const w = crop.w + pad * 2;
  const h = crop.h + pad * 2;
  const safeX = Math.min(x, Math.max(0, width - 1));
  const safeY = Math.min(y, Math.max(0, height - 1));
  const maxW = Math.max(0, width - safeX);
  const maxH = Math.max(0, height - safeY);
  return {
    x: safeX,
    y: safeY,
    w: w === 0 ? maxW : Math.min(w, maxW),
    h: h === 0 ? maxH : Math.min(h, maxH),
  };
}

/**
 * Union of content boxes across sampled video frames (safer than last-match).
 * @param {CropArea[]} crops
 * @param {number} width
 * @param {number} height
 * @returns {CropArea}
 */
export function unionCrops(crops, width, height) {
  if (!crops.length) return { x: 0, y: 0, w: width, h: height };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = 0;
  let maxY = 0;

  for (const crop of crops) {
    minX = Math.min(minX, crop.x);
    minY = Math.min(minY, crop.y);
    maxX = Math.max(maxX, crop.x + crop.w);
    maxY = Math.max(maxY, crop.y + crop.h);
  }

  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) {
    return { x: 0, y: 0, w: width, h: height };
  }

  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
  };
}

/**
 * Even x/y/w/h for YUV420 video encoders.
 * @param {CropArea} crop
 * @param {number} width
 * @param {number} height
 * @returns {CropArea}
 */
export function evenCrop(crop, width, height) {
  let x = crop.x - (crop.x % 2);
  let y = crop.y - (crop.y % 2);
  let w = crop.w - (crop.w % 2);
  let h = crop.h - (crop.h % 2);
  if (x + w > width) w = Math.max(0, w - 2);
  if (y + h > height) h = Math.max(0, h - 2);
  if (w < 2) w = Math.min(2, width - (width % 2));
  if (h < 2) h = Math.min(2, height - (height % 2));
  return { x, y, w, h };
}
