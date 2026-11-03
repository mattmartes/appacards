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

/** Depth-first order, siblings sorted case-insensitively like Anki. */
export function sortDecks(decks: Deck[]): Deck[] {
  return [...decks].sort((a, b) => {
    const ca = components(a.name);
    const cb = components(b.name);
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
