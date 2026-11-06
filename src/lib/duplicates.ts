// Duplicate warnings for Add cards: a new card whose front matches the front
// of a card already in the deck, or whose back matches a back. Formatting,
// capitals and spacing don't count, so "<b>Mitosis</b>" matches "mitosis".

import { textFields } from './noteTypes';
import { stripHtml } from './search';
import type { Card, Id, Note } from './types';

/** The parts of the collection the check reads. */
type Cards = { cards: Map<Id, Card>; notes: Map<Id, Note> };

/** Text as it's compared: no tags, entities, case or extra spaces. */
export function comparable(html: string): string {
  const el = typeof document !== 'undefined' ? document.createElement('textarea') : null;
  let text = stripHtml(html);
  if (el) {
    // &amp; and the like, as the words would read
    el.innerHTML = text;
    text = el.value;
  }
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export interface Duplicate {
  side: 'front' | 'back';
  /** the existing card's front and back, as plain text */
  front: string;
  back: string;
  card: Card;
}

/** An existing card's two sides: its note's first two text fields, or for a
 * card imported without a note, its question and the answer after Anki's
 * dividing line. */
function sides(col: Cards, card: Card): { front: string; back: string } {
  const note = card.noteId !== undefined ? col.notes.get(card.noteId) : undefined;
  if (note) {
    const [f, b] = textFields(note.kind);
    return { front: note.fields[f] ?? '', back: b ? (note.fields[b] ?? '') : '' };
  }
  const answer = card.back.split(/<hr[^>]*id=["']?answer["']?[^>]*>/i).pop() ?? card.back;
  return { front: card.front, back: answer };
}

/** Cards in `deckId` with the same front, or the same back, as the card being
 * made; each existing note counts once. */
export function findDuplicates(col: Cards, deckId: Id, front: string, back: string): Duplicate[] {
  const f = comparable(front);
  const b = comparable(back);
  if (!f && !b) return [];
  const seen = new Set<Id | string>();
  const out: Duplicate[] = [];
  for (const card of col.cards.values()) {
    if (card.deckId !== deckId) continue;
    const key = card.noteId ?? `c${card.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const s = sides(col, card);
    const side = f && comparable(s.front) === f ? 'front' : b && comparable(s.back) === b ? 'back' : null;
    if (side) out.push({ side, front: stripHtml(s.front), back: stripHtml(s.back), card });
  }
  return out;
}
