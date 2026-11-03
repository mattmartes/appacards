// How light the custom background is where page text sits on it, so that
// text can switch between dark and light ink and stay readable over any image.

/** Relative luminance of an sRGB colour (0 black … 1 white). */
function luminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Parses "#rrggbb" or "rgb(r, g, b)". */
function parseColor(css: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = css.match(/\d+(\.\d+)?/g)?.map(Number) ?? [255, 255, 255];
  return [m[0] ?? 255, m[1] ?? 255, m[2] ?? 255];
}

const loaded = new Map<string, Promise<HTMLImageElement>>();
function load(url: string): Promise<HTMLImageElement> {
  let p = loaded.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
    loaded.set(url, p);
  }
  return p;
}

/** The luminance where dark and light ink contrast equally. */
export const TONE_THRESHOLD = 0.18;

/**
 * How light the background looks behind the content area (0 … 1), which is
 * the theme's ground with the image laid over it at `opacity`. Only the part
 * right of the sidebar and the top half of the window count, since that's
 * where page titles and loose text sit.
 */
export async function groundLuminance(url: string, opacity: number, groundColor: string, contentLeft: number): Promise<number> {
  const img = await load(url);
  const w = 96;
  const h = Math.max(1, Math.round((w * window.innerHeight) / Math.max(window.innerWidth, 1)));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 0;
  // draw it as `background-size: cover; background-position: center` does
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  const x0 = Math.min(w - 1, Math.floor((contentLeft / Math.max(window.innerWidth, 1)) * w));
  const { data } = ctx.getImageData(x0, 0, w - x0, Math.ceil(h / 2));
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += luminance(data[i], data[i + 1], data[i + 2]);
    n++;
  }
  const image = n ? sum / n : 0;
  const ground = luminance(...parseColor(groundColor));
  return ground * (1 - opacity) + image * opacity;
}

/** Hysteresis around the threshold: the side only changes once the
 * brightness is clearly past it, so small slider moves don't flicker. */
const BAND = 0.025;

export function nextTone(seen: number, current: 'light' | 'dark' | undefined): 'light' | 'dark' {
  if (current === 'light' && seen > TONE_THRESHOLD - BAND) return 'light';
  if (current === 'dark' && seen < TONE_THRESHOLD + BAND) return 'dark';
  return seen > TONE_THRESHOLD ? 'light' : 'dark';
}

/** 0 … 1: how much halo the text needs. Strongest at the threshold, where
 * neither ink contrasts well, fading as the background moves clearly to one side. */
export function haloStrength(seen: number): number {
  const distance = Math.abs(seen - TONE_THRESHOLD) / 0.12;
  return Math.max(0, Math.min(1, 1 - distance));
}
