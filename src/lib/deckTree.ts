// Deck hierarchy helpers. Names use Anki's "::" separator.

import type { Deck } from './types';

export const SEP = '::';

export const components = (name: string) => name.split(SEP);
export const parentName = (name: string) => components(name).slice(0, -1).join(SEP);
export const baseName = (name: string) => components(name).pop() ?? name;
export const depth = (name: string) => components(name).length - 1;

/** True if `name` is `ancestor` or below it. */
export function isWithin(name: string, ancestor: string) {
  return name === ancestor || name.startsWith(ancestor + SEP);
}

/** Depth-first order, siblings sorted case-insensitively like Anki, except
 * that classes (top-level decks) go in the order they were arranged in, if
 * they have been; ones never moved come after, by name. */
export function sortDecks(decks: Deck[]): Deck[] {
  const position = new Map(decks.filter((d) => !d.name.includes(SEP)).map((d) => [d.name, d.position ?? Infinity]));
  return [...decks].sort((a, b) => {
    const ca = components(a.name);
    const cb = components(b.name);
    if (ca[0] !== cb[0]) {
      const pa = position.get(ca[0]) ?? Infinity;
      const pb = position.get(cb[0]) ?? Infinity;
      if (pa !== pb) return pa - pb;
    }
    for (let i = 0; i < Math.min(ca.length, cb.length); i++) {
      const c = ca[i].localeCompare(cb[i], undefined, { sensitivity: 'base' });
      if (c) return c;
    }
    return ca.length - cb.length;
  });
}

/** All names from the top level down to `name`, e.g. A, A::B, A::B::C. */
export function ancestorNames(name: string): string[] {
  const parts = components(name);
  return parts.map((_, i) => parts.slice(0, i + 1).join(SEP));
}
