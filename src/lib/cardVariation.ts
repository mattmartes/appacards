// Card variation: each time a card is shown it gets one of three similar
// fonts and a random text size, so you can't recognise a card by its shape.
// Fonts are ones installed on Windows and macOS, so this works offline.

import type { CardVariation, VariationFontSet } from './types';

export const VARIATION_FONTS: Record<VariationFontSet, { label: string; fonts: { name: string; stack: string }[] }> = {
  sans: {
    label: 'Sans-serif',
    fonts: [
      { name: 'Segoe UI', stack: "'Segoe UI', 'Helvetica Neue', system-ui, sans-serif" },
      { name: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
      { name: 'Verdana', stack: 'Verdana, Tahoma, Geneva, sans-serif' },
    ],
  },
  serif: {
    label: 'Serif',
    fonts: [
      { name: 'Georgia', stack: 'Georgia, serif' },
      { name: 'Cambria', stack: "Cambria, 'Times New Roman', Times, serif" },
      { name: 'Palatino', stack: "'Palatino Linotype', Palatino, 'Book Antiqua', serif" },
    ],
  },
};

/** Normal card text size (matches .card-face in index.css). */
export const BASE_CARD_FONT_PX = 22;

export interface VariedStyle {
  fontFamily: string;
  fontSize: string;
  fontName: string;
  sizePct: number;
}

/** Picks a font and size for one showing of a card. */
export function pickVariation(v: CardVariation, random: () => number = Math.random): VariedStyle {
  const fonts = VARIATION_FONTS[v.fontSet]?.fonts ?? VARIATION_FONTS.sans.fonts;
  const font = fonts[Math.floor(random() * fonts.length)];
  const lo = Math.min(v.minSizePct, v.maxSizePct);
  const hi = Math.max(v.minSizePct, v.maxSizePct);
  const sizePct = Math.round(lo + random() * (hi - lo));
  return {
    fontFamily: font.stack,
    fontSize: `${(BASE_CARD_FONT_PX * sizePct) / 100}px`,
    fontName: font.name,
    sizePct,
  };
}
