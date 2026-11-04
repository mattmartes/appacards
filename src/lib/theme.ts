// The app's colour theme and font. The theme: follow the system, a fixed light, dark, blue,
// purple or pink look, or a custom one built from a colour you pick. It's a
// choice for this computer, kept in localStorage, and set on <html> before
// the first render so nothing flashes.

export type Theme = 'system' | 'light' | 'dark' | 'blue' | 'purple' | 'pink' | 'custom';

/** `swatch` is the one colour each theme shows in Preferences. */
export const THEMES: { key: Theme; name: string; swatch: string }[] = [
  { key: 'system', name: 'Match system', swatch: '#9a9a94' },
  { key: 'light', name: 'Light', swatch: '#f5f4f0' },
  { key: 'dark', name: 'Dark', swatch: '#1b1b1a' },
  { key: 'blue', name: 'Blue', swatch: '#3d7fe6' },
  { key: 'purple', name: 'Purple', swatch: '#9d6ff2' },
  { key: 'pink', name: 'Pink', swatch: '#ff5fae' },
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

/** The tokens a custom theme sets: the dark theme's ground, panels and ink
 * in the colour's own hue and with real saturation, so it reads as that
 * colour rather than grey; and the accent kept bright enough to stand out on
 * the dark ground even when the colour picked is a dark one. */
function customTokens(hex: string): Record<string, string> {
  const [h, s0, l0] = hsl(hex);
  const s = Math.min(Math.max(s0, 35), 90);
  const sat = (k: number) => `${Math.round(s * k)}%`;
  const accent = l0 < 52 || s0 < 45 ? `hsl(${h} ${Math.max(s0, 70)}% ${Math.max(l0, 60)}%)` : hex;
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
    '--series-1': accent,
  };
}
const CUSTOM_KEYS = Object.keys(customTokens('#000000'));

/** data-theme picks the palette; data-scheme="dark" turns on the dark rules
 * for every theme built on the dark one, whatever the system says. */
export function applyTheme(t: Theme, custom = readCustomColour()) {
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme;
  else root.dataset.theme = t;
  if (t !== 'system' && t !== 'light') root.dataset.scheme = 'dark';
  else delete root.dataset.scheme;
  for (const k of CUSTOM_KEYS) root.style.removeProperty(k);
  if (t === 'custom') for (const [k, v] of Object.entries(customTokens(custom))) root.style.setProperty(k, v);
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
