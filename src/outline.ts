import type { OutlineOpts } from './types';

// Edge detection for the outline effect. We run a Sobel operator over R, G, B
// *and* alpha, combining by the strongest channel response so the lines pick up
// both brightness edges (the object's silhouette) and equal-brightness colour
// boundaries (e.g. a green→yellow transition), plus the alpha edge of a cut-out
// PNG. The result is bright lines on a transparent background, same pixel
// dimensions as the source, so the layer's geometry is unchanged.

/** Cap the worked resolution so a huge photo doesn't stall the main thread. */
const MAX_EDGE = 2200;

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 0, 255];
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas toBlob failed'))), 'image/png');
  });
}

/**
 * Decode a blob (raster or SVG) onto a 2D canvas, downscaled to fit MAX_EDGE
 * for the edge pass. `ow`/`oh` are the image's true dimensions so the caller
 * can emit an outline at the original size (the layer is displayed at the
 * image's intrinsic pixel size, so the outline must match it exactly).
 */
async function decodeToCanvas(
  blob: Blob,
): Promise<{ data: Uint8ClampedArray; w: number; h: number; ow: number; oh: number }> {
  let source: CanvasImageSource;
  let cleanup = () => {};
  let nw: number;
  let nh: number;
  try {
    const bmp = await createImageBitmap(blob);
    source = bmp;
    nw = bmp.width;
    nh = bmp.height;
    cleanup = () => bmp.close();
  } catch {
    // createImageBitmap rejects SVG; decode through an <img> instead.
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    await img.decode();
    source = img;
    nw = img.naturalWidth || 800;
    nh = img.naturalHeight || 600;
    cleanup = () => URL.revokeObjectURL(url);
  }
  const fit = Math.min(1, MAX_EDGE / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * fit));
  const h = Math.max(1, Math.round(nh * fit));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    cleanup();
    throw new Error('2D canvas context unavailable');
  }
  ctx.drawImage(source, 0, 0, w, h);
  cleanup();
  return { data: ctx.getImageData(0, 0, w, h).data, w, h, ow: nw, oh: nh };
}

/** Separable max-filter (morphological dilation) to thicken the line mask. */
function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask;
  const horiz = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < w) m = Math.max(m, mask[row + xx]);
      }
      horiz[row + x] = m;
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy >= 0 && yy < h) m = Math.max(m, horiz[yy * w + x]);
      }
      out[y * w + x] = m;
    }
  }
  return out;
}

/** Compute the outline image for a source blob; returns a PNG blob. */
export async function renderOutline(blob: Blob, opts: OutlineOpts): Promise<Blob> {
  const { data, w, h, ow, oh } = await decodeToCanvas(blob);

  // Sobel gradient magnitude per pixel, taking the strongest of R/G/B/A.
  const mag = new Float32Array(w * h);
  let maxMag = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const top = i - w * 4;
      const bot = i + w * 4;
      let best = 0;
      for (let c = 0; c < 4; c++) {
        const gx =
          -data[top - 4 + c] +
          data[top + 4 + c] +
          -2 * data[i - 4 + c] +
          2 * data[i + 4 + c] +
          -data[bot - 4 + c] +
          data[bot + 4 + c];
        const gy =
          -data[top - 4 + c] -
          2 * data[top + c] -
          data[top + 4 + c] +
          data[bot - 4 + c] +
          2 * data[bot + c] +
          data[bot + 4 + c];
        const m = Math.sqrt(gx * gx + gy * gy);
        if (m > best) best = m;
      }
      mag[y * w + x] = best;
      if (best > maxMag) maxMag = best;
    }
  }

  // Threshold relative to the strongest edge so faint, low-contrast images
  // still surface their best lines (the daytime/washed-out case).
  const cutoff = maxMag * opts.threshold;
  const mask = new Uint8Array(w * h);
  if (maxMag > 0) {
    for (let p = 0; p < mask.length; p++) mask[p] = mag[p] >= cutoff ? 255 : 0;
  }
  const thick = dilate(mask, w, h, Math.round(opts.thickness));

  const [r, g, b] = hexToRgb(opts.color);
  const out = new ImageData(w, h);
  for (let p = 0; p < thick.length; p++) {
    if (thick[p] === 0) continue;
    const o = p * 4;
    out.data[o] = r;
    out.data[o + 1] = g;
    out.data[o + 2] = b;
    out.data[o + 3] = 255;
  }

  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const sctx = small.getContext('2d');
  if (!sctx) throw new Error('2D canvas context unavailable');
  sctx.putImageData(out, 0, 0);

  // The edge pass ran at a downscaled size; emit at the image's true size so
  // the outline displays identically to the original (no shrink on toggle).
  if (w === ow && h === oh) return canvasToBlob(small);
  const full = document.createElement('canvas');
  full.width = ow;
  full.height = oh;
  const fctx = full.getContext('2d');
  if (!fctx) throw new Error('2D canvas context unavailable');
  fctx.drawImage(small, 0, 0, ow, oh);
  return canvasToBlob(full);
}
