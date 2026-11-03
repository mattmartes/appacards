// Turns the review log into FSRS training items, following Anki's
// rslib/src/scheduler/fsrs/params.rs (`reviews_for_fsrs`,
// `fsrs_items_for_training`).

import { dayNumber } from './time';
import type { Id, RevlogEntry } from './types';

export interface FsrsReview {
  rating: number;
  /** whole days since the previous review (0 for the first) */
  deltaT: number;
}

/** A card's review history, plus the prefix lengths that form training items. */
export interface CardHistory {
  cardId: Id;
  reviews: FsrsReview[];
  /** revlog id of the review that ends each item */
  itemEnds: { revlogId: Id; length: number }[];
}

const isReset = (e: RevlogEntry) => e.kind === 4 && e.rating === 0;

/** Keeps the part of a card's history that FSRS should see, as Anki's
 * `reviews_for_fsrs` does: everything from the first entry of the last group
 * of learning reviews onward, ignoring anything before a reset. When there is
 * no learning group, training ignores the card (null), while memory-state
 * calculation starts at the first graded review on a later day.
 * `entries` must be sorted by id. Only graded entries are returned. */
export function reviewsForFsrs(entries: RevlogEntry[], training: boolean): RevlogEntry[] | null {
  let firstOfLastLearn: number | null = null;
  let firstUserGrade: number | null = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const graded = e.rating > 0;
    const interday = e.ivl >= 1 || e.ivl <= -86400;
    if (graded && interday) firstUserGrade = i;
    if (graded && e.kind === 0) {
      firstOfLastLearn = i;
    } else if (isReset(e)) {
      if (firstOfLastLearn !== null || firstUserGrade !== null) break;
      return null;
    } else if (firstOfLastLearn !== null) {
      break;
    }
  }
  let start: number;
  if (firstOfLastLearn !== null) start = firstOfLastLearn;
  else if (training || firstUserGrade === null) return null;
  else start = firstUserGrade;
  return entries.slice(start).filter((e) => e.rating > 0);
}

export function toFsrsReviews(entries: RevlogEntry[]): FsrsReview[] {
  return entries.map((e, i) => ({
    rating: e.rating,
    deltaT: i === 0 ? 0 : Math.max(0, dayNumber(e.id) - dayNumber(entries[i - 1].id)),
  }));
}

export function groupRevlogByCard(revlog: RevlogEntry[]): Map<Id, RevlogEntry[]> {
  const byCard = new Map<Id, RevlogEntry[]>();
  for (const r of revlog) {
    const list = byCard.get(r.cardId);
    if (list) list.push(r);
    else byCard.set(r.cardId, [r]);
  }
  for (const list of byCard.values()) list.sort((a, b) => a.id - b.id);
  return byCard;
}

/** One item per review after the first that happened on a later day; each
 * item is the history up to and including that review. */
export function buildTrainingHistories(revlog: RevlogEntry[]): CardHistory[] {
  const out: CardHistory[] = [];
  for (const [cardId, all] of groupRevlogByCard(revlog)) {
    const entries = reviewsForFsrs(all, true);
    if (!entries) continue;
    const reviews = toFsrsReviews(entries);
    const itemEnds = [];
    for (let i = 1; i < reviews.length; i++) {
      if (reviews[i].deltaT > 0) itemEnds.push({ revlogId: entries[i].id, length: i + 1 });
    }
    if (itemEnds.length) out.push({ cardId, reviews, itemEnds });
  }
  return out;
}

export function longTermReviewCount(reviews: FsrsReview[], length: number): number {
  let n = 0;
  for (let i = 0; i < length; i++) if (reviews[i].deltaT >= 1) n++;
  return n;
}
