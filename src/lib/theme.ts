// The app's colour theme: follow the system, or a fixed light, dark, blue,
// purple or pink look. It's a choice for this computer, kept in
// localStorage, and set on <html> before the first render so nothing flashes.

export type Theme = 'system' | 'light' | 'dark' | 'blue' | 'purple' | 'pink';

export const THEMES: { key: Theme; name: string }[] = [
  { key: 'system', name: 'Match system' },
  { key: 'light', name: 'Light' },
  { key: 'dark', name: 'Dark' },
  { key: 'blue', name: 'Blue' },
  { key: 'purple', name: 'Purple' },
  { key: 'pink', name: 'Pink' },
];

const STORE = 'appa-theme';
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

/** data-theme picks the palette; data-scheme="dark" turns on the dark rules
 * for every theme built on the dark one, whatever the system says. */
export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme;
  else root.dataset.theme = t;
  if (t !== 'system' && t !== 'light') root.dataset.scheme = 'dark';
  else delete root.dataset.scheme;
}

export function setTheme(t: Theme) {
  applyTheme(t);
  try {
    localStorage.setItem(STORE, t);
  } catch {
    // back to the system theme next time
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}
