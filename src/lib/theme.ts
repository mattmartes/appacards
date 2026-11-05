// The app's colour theme and font. The theme: follow the system, a fixed light, dark, blue,
// purple, pink or periwinkle look, or a custom one built from a colour you pick. It's a
// choice for this computer, kept in localStorage, and set on <html> before
// the first render so nothing flashes.

export type Theme = 'system' | 'light' | 'dark' | 'blue' | 'purple' | 'pink' | 'periwinkle' | 'custom';

/** Presets made the way a custom colour is (see customTokens): the theme and its colour. */
const PRESET_COLOURS: Partial<Record<Theme, string>> = { periwinkle: '#ccccff' };

/** `swatch` is the one colour each theme shows in Preferences. */
export const THEMES: { key: Theme; name: string; swatch: string }[] = [
  { key: 'system', name: 'Match system', swatch: '#9a9a94' },
  { key: 'light', name: 'Light', swatch: '#f5f4f0' },
  { key: 'dark', name: 'Dark', swatch: '#1b1b1a' },
  { key: 'blue', name: 'Blue', swatch: '#3d7fe6' },
  { key: 'purple', name: 'Purple', swatch: '#9d6ff2' },
  { key: 'pink', name: 'Pink', swatch: '#ff5fae' },
  { key: 'periwinkle', name: 'Periwinkle', swatch: '#ccccff' },
  { key: 'custom', name: 'Custom', swatch: '' },
];

const STORE = 'appa-theme';
const CUSTOM_STORE = 'appa-theme-custom';
export const DEFAULT_CUSTOM = '#2bb39a';
/** sent on window when the theme changes, so anything measuring colours can redo it */
export const THEME_EVENT = 'appa-theme';

export function readTheme(): Theme {
  try {
    const t = localStorage.getItem(STORE) as Theme | null;
    if (t && THEMES.some((x) => x.key === t)) return t;
  } catch {
    // storage blocked: follow the system
  }
  return 'system';
}

export function readCustomColour(): string {
  try {
    const c = localStorage.getItem(CUSTOM_STORE);
    if (c && /^#[0-9a-f]{6}$/i.test(c)) return c;
  } catch {
    // storage blocked
  }
  return DEFAULT_CUSTOM;
}

/** Hue (0-360), saturation and lightness (0-100) of a #rrggbb colour. */
function hsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  if (!d) return [0, 0, Math.round(l * 100)];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round((h * 60 + 360) % 360), Math.round(s * 100), Math.round(l * 100)];
}

/** Relative luminance (0 black to 1 white) of red, green and blue in 0-1. */
function lum(r: number, g: number, b: number): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
/** How light a #rrggbb colour looks. */
const luminance = (hex: string) => lum(...([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]));
/** How light an hsl() colour looks; s and l in 0-100. */
function hslLuminance(h: number, s: number, l: number): number {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return lum(f(0), f(8), f(4));
}
/** contrast of white text on a colour of this luminance */
const onWhite = (y: number) => 1.05 / (y + 0.05);

/** A colour light enough to be the page itself (pastels, cream, light grey);
 * anything darker becomes the accent of a dark theme. */
const isLightColour = (hex: string) => luminance(hex) > 0.42;

/** The tokens a custom theme sets.
 *
 * A light colour is the ground itself: the page is that colour, panels are a
 * lighter tint of it, the ink is a dark shade of its hue, and the accent a
 * deeper version of it that white text reads on.
 *
 * Any other colour builds on the dark theme: the ground, panels and ink in
 * the colour's own hue and with real saturation, so it reads as that colour
 * rather than grey, and the accent kept bright enough to stand out on the
 * dark ground even when the colour picked is a dark one. */
function customTokens(hex: string): Record<string, string> {
  const [h, s0, l0] = hsl(hex);
  if (isLightColour(hex)) {
    const s = Math.min(s0, 90);
    const at = (l: number, k = 1) => `hsl(${h} ${Math.round(s * k)}% ${Math.round(Math.max(0, Math.min(100, l)))}%)`;
    const inkSat = Math.min(s0, 45);
    // hints and counts are small, so they're darkened until they read (4.5:1) on the page
    const bgY = luminance(hex);
    const hintSat = Math.round(inkSat * 0.6);
    let hintL = Math.min(42, l0 - 36);
    while (hintL > 15 && (bgY + 0.05) / (hslLuminance(h, hintSat, hintL) + 0.05) < 4.6) hintL -= 2;
    // the accent is a deeper shade of the colour: deep enough that white
    // text on a button reads clearly (4.5:1), whatever the hue
    const accentSat = Math.max(s0, 55);
    let accentL = Math.min(42, l0 - 30);
    while (accentL > 10 && onWhite(hslLuminance(h, accentSat, accentL)) < 4.5) accentL -= 2;
    const accent = `hsl(${h} ${accentSat}% ${accentL}%)`;
    return {
      '--bg': hex,
      '--surface': at(l0 + (100 - l0) * 0.6),
      '--surface-2': at(l0 - 4),
      '--surface-hover': at(l0 - 7),
      '--border': at(l0 - 12, 0.6),
      '--border-strong': at(l0 - 22, 0.6),
      '--ink': `hsl(${h} ${inkSat}% 12%)`,
      '--ink-2': `hsl(${h} ${Math.round(inkSat * 0.8)}% ${Math.min(30, l0 - 45)}%)`,
      '--ink-3': `hsl(${h} ${hintSat}% ${hintL}%)`,
      '--accent': accent,
      '--accent-ink': '#ffffff',
      '--series-1': accent,
    };
  }
  const s = Math.min(Math.max(s0, 35), 90);
  const sat = (k: number) => `${Math.round(s * k)}%`;
  const accent = l0 < 52 || s0 < 45 ? `hsl(${h} ${Math.max(s0, 70)}% ${Math.max(l0, 60)}%)` : hex;
  // a bright accent stays bright on the dark ground, so its buttons take dark text
  const accentY = accent === hex ? luminance(hex) : hslLuminance(h, Math.max(s0, 70), Math.max(l0, 60));
  const accentInk = onWhite(accentY) < 4.5 ? `hsl(${h} 40% 9%)` : '#ffffff';
  return {
    '--bg': `hsl(${h} ${sat(0.85)} 9%)`,
    '--surface': `hsl(${h} ${sat(0.75)} 13%)`,
    '--surface-2': `hsl(${h} ${sat(0.7)} 17%)`,
    '--surface-hover': `hsl(${h} ${sat(0.65)} 21%)`,
    '--border': `hsl(${h} ${sat(0.6)} 23%)`,
    '--border-strong': `hsl(${h} ${sat(0.55)} 33%)`,
    '--ink': `hsl(${h} 80% 97%)`,
    '--ink-2': `hsl(${h} ${sat(0.6)} 84%)`,
    '--ink-3': `hsl(${h} ${sat(0.4)} 68%)`,
    '--accent': accent,
    '--accent-ink': accentInk,
    '--series-1': accent,
  };
}
const CUSTOM_KEYS = Object.keys(customTokens('#000000'));

/** data-theme picks the palette; data-scheme="dark" turns on the dark rules
 * for every theme built on the dark one, whatever the system says. A custom
 * colour also sets data-tint="custom" (its glow and heatmap); a light one
 * counts as the light theme so no dark rules apply to it. */
export function applyTheme(t: Theme, picked = readCustomColour()) {
  const root = document.documentElement;
  // a preset like Periwinkle is a custom theme with its colour already chosen
  const preset = PRESET_COLOURS[t];
  const custom = preset ?? picked;
  if (preset) t = 'custom';
  const lightCustom = t === 'custom' && isLightColour(custom);
  const shown = lightCustom ? 'light' : t;
  if (shown === 'system') delete root.dataset.theme;
  else root.dataset.theme = shown;
  if (shown !== 'system' && shown !== 'light') root.dataset.scheme = 'dark';
  else delete root.dataset.scheme;
  if (t === 'custom') root.dataset.tint = 'custom';
  else delete root.dataset.tint;
  for (const k of CUSTOM_KEYS) root.style.removeProperty(k);
  if (t === 'custom') for (const [k, v] of Object.entries(customTokens(custom))) root.style.setProperty(k, v);
  // your own accent and text colour go over whichever theme's (the line
  // clearing a custom theme's tokens above clears these too)
  applyOwnColours();
}

export function setTheme(t: Theme, custom?: string) {
  try {
    localStorage.setItem(STORE, t);
    if (custom) localStorage.setItem(CUSTOM_STORE, custom);
  } catch {
    // back to the system theme next time
  }
  applyTheme(t, custom ?? readCustomColour());
  window.dispatchEvent(new Event(THEME_EVENT));
}

// ---- the app's font: also a choice for this computer

const FONT_STORE = 'appa-font';

/** Fonts that come with Windows or macOS, so they work offline; each falls
 * back to the system font where it's missing. */
export const FONTS: { key: string; name: string; stack: string }[] = [
  { key: 'system', name: 'System (Segoe UI)', stack: "'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif" },
  { key: 'arial', name: 'Arial', stack: "Arial, Helvetica, 'Segoe UI', system-ui, sans-serif" },
  { key: 'calibri', name: 'Calibri', stack: "Calibri, Carlito, 'Segoe UI', system-ui, sans-serif" },
  { key: 'verdana', name: 'Verdana', stack: "Verdana, Geneva, 'Segoe UI', system-ui, sans-serif" },
  { key: 'trebuchet', name: 'Trebuchet', stack: "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif" },
  { key: 'georgia', name: 'Georgia (serif)', stack: "Georgia, 'Iowan Old Style', 'Times New Roman', serif" },
  { key: 'cambria', name: 'Cambria (serif)', stack: "Cambria, Caladea, Georgia, serif" },
  { key: 'palatino', name: 'Palatino (serif)', stack: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif" },
  { key: 'mono', name: 'Monospace', stack: "'Cascadia Code', Consolas, 'SF Mono', Menlo, monospace" },
  { key: 'comic', name: 'Comic Sans', stack: "'Comic Sans MS', 'Comic Neue', 'Chalkboard SE', cursive" },
];

export function readFont(): string {
  try {
    const f = localStorage.getItem(FONT_STORE);
    if (f && FONTS.some((x) => x.key === f)) return f;
  } catch {
    // storage blocked: the system font
  }
  return 'system';
}

export function applyFont(key: string) {
  const f = FONTS.find((x) => x.key === key);
  const root = document.documentElement;
  if (!f || f.key === 'system') root.style.removeProperty('font-family');
  else root.style.setProperty('font-family', f.stack);
}

export function setFont(key: string) {
  try {
    localStorage.setItem(FONT_STORE, key);
  } catch {
    // back to the system font next time
  }
  applyFont(key);
}

// ---- your own accent and text over any theme: the accent is buttons,
// toggles, focus, selections and the calendar's chosen days; the text is its
// colour and thickness. Each is a choice for this computer; none means the
// theme's own.

const ACCENT_STORE = 'appa-accent';
const TEXT_COLOUR_STORE = 'appa-text-colour';
const TEXT_WEIGHT_STORE = 'appa-text-weight';

/** Accent colours a tap away; any other comes from the colour picker. */
export const ACCENTS: { name: string; value: string }[] = [
  { name: 'Sky', value: '#2f6fd1' },
  { name: 'Teal', value: '#13a3a0' },
  { name: 'Green', value: '#2e9b4e' },
  { name: 'Orange', value: '#e07a1f' },
  { name: 'Red', value: '#d6453d' },
  { name: 'Pink', value: '#e0458f' },
  { name: 'Purple', value: '#8a5cf0' },
  { name: 'Periwinkle', value: '#7c7cf0' },
];
/** Text colours a tap away, picked to read on light grounds (dark ones) and dark grounds (light ones). */
export const TEXT_COLOURS: { name: string; value: string }[] = [
  { name: 'Charcoal', value: '#191917' },
  { name: 'Navy', value: '#1c2b4a' },
  { name: 'Plum', value: '#3b1f3a' },
  { name: 'Forest', value: '#1f3a2a' },
  { name: 'White', value: '#ffffff' },
  { name: 'Cream', value: '#f6eedc' },
  { name: 'Ice', value: '#e3ecfb' },
];
export const TEXT_WEIGHTS: { value: number; name: string }[] = [
  { value: 300, name: 'Light' },
  { value: 400, name: 'Regular' },
  { value: 500, name: 'Medium' },
  { value: 600, name: 'Bold' },
];

const readHex = (key: string): string | null => {
  try {
    const v = localStorage.getItem(key);
    if (v && /^#[0-9a-f]{6}$/i.test(v)) return v;
  } catch {
    // storage blocked: the theme's own
  }
  return null;
};
const save = (key: string, value: string | null) => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // the theme's own next time
  }
};

/** The accent you picked, or null for the theme's own. */
export const readAccent = () => readHex(ACCENT_STORE);
/** The text colour you picked, or null for the theme's own. */
export const readTextColour = () => readHex(TEXT_COLOUR_STORE);
export function readTextWeight(): number {
  try {
    const w = Number(localStorage.getItem(TEXT_WEIGHT_STORE));
    if (TEXT_WEIGHTS.some((x) => x.value === w)) return w;
  } catch {
    // storage blocked
  }
  return 400;
}

/** Puts your accent and text colour over the theme applyTheme just set out
 * (it clears both first, so "the theme's own" needs nothing here). */
function applyOwnColours() {
  const root = document.documentElement;
  const accent = readAccent();
  if (accent) {
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--series-1', accent);
    // white text on it where that reads (4.5:1), else a near-black of its hue
    root.style.setProperty('--accent-ink', onWhite(luminance(accent)) < 4.5 ? `hsl(${hsl(accent)[0]} 40% 9%)` : '#ffffff');
  }
  const ink = readTextColour();
  if (ink) {
    // softer text and hints are the colour mixed toward the page
    root.style.setProperty('--ink', ink);
    root.style.setProperty('--ink-2', `color-mix(in srgb, ${ink} 78%, var(--bg))`);
    root.style.setProperty('--ink-3', `color-mix(in srgb, ${ink} 60%, var(--bg))`);
  }
}

export function setAccent(hex: string | null) {
  save(ACCENT_STORE, hex);
  applyTheme(readTheme());
  window.dispatchEvent(new Event(THEME_EVENT));
}
export function setTextColour(hex: string | null) {
  save(TEXT_COLOUR_STORE, hex);
  applyTheme(readTheme());
  window.dispatchEvent(new Event(THEME_EVENT));
}
/** The app's text thickness: on <html>, so everything that doesn't set its
 * own weight follows it, and as --weight-shift for what does. */
export function applyTextWeight(w = readTextWeight()) {
  const root = document.documentElement;
  if (w === 400) root.style.removeProperty('font-weight');
  else root.style.setProperty('font-weight', String(w));
  // text that sets a weight of its own (the sidebar, buttons, headings) moves by the same step
  if (w === 400) root.style.removeProperty('--weight-shift');
  else root.style.setProperty('--weight-shift', String(w - 400));
}
export function setTextWeight(w: number) {
  save(TEXT_WEIGHT_STORE, w === 400 ? null : String(w));
  applyTextWeight(w);
}
