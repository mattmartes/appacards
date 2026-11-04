// Builds the study queue for a deck and its subdecks, following Anki's v3
// queue builder (rslib/src/scheduler/queue/builder) and deck limits
// (rslib/src/decks/limits.rs).

import { isWithin, sortDecks } from './deckTree';
import { planNewLimit } from './dueDate';
import { today as todayNum, nowSecs } from './time';
import type { Card, Deck, Id, Preferences, Preset, ReviewMix } from './types';

export interface QueueContext {
  decks: Deck[];
  cards: Iterable<Card>;
  presetFor: (deck: Deck) => Preset;
  prefs: Preferences;
  /** current retrievability for review-order sorting */
  retrievability: (card: Card) => number;
}

export interface BuiltQueue {
  /** due intraday learning cards, earliest first */
  learnNow: Card[];
  /** intraday learning due within the learn-ahead limit */
  learnAhead: Card[];
  /** next intraday learning card due later today (for the wait message) */
  nextLearnAt: number | null;
  /** reviews, interday learning and new cards, in study order */
  main: Card[];
  counts: { newCount: number; learnCount: number; reviewCount: number };
}

interface Limits {
  review: number;
  new: number;
  capNewToReview: boolean;
}

/** Remaining limits for one deck (RemainingLimits::new_for_normal_deck_v3).
 * `newLeft` is the deck's unseen new cards (with its subdecks'), for a
 * due-date plan, which takes the place of the deck's usual new cards/day. */
export function remainingLimits(deck: Deck, preset: Preset, prefs: Preferences, today: number, newLeft = 0): Limits {
  const dayLimit = (l: Deck['reviewLimitToday']) => (l && l.day === today ? l.limit : null);
  const counts = deck.today.day === today ? deck.today : { newDone: 0, revDone: 0 };
  const planned = planNewLimit(deck.dueDate, today, newLeft + counts.newDone);
  let review = dayLimit(deck.reviewLimitToday) ?? deck.reviewLimit ?? preset.reviewsPerDay;
  let newLimit = dayLimit(deck.newLimitToday) ?? planned ?? deck.newLimit ?? preset.newPerDay;
  review -= counts.revDone;
  newLimit -= counts.newDone;
  const ignore = prefs.newCardsIgnoreReviewLimit;
  if (!ignore) {
    review -= counts.newDone;
    newLimit = Math.min(newLimit, review);
  }
  return { review: Math.max(review, 0), new: Math.max(newLimit, 0), capNewToReview: !ignore };
}

class LimitTree {
  private limits = new Map<Id, Limits>();
  private parent = new Map<Id, Id | null>();
  private children = new Map<Id, Id[]>();

  constructor(decks: Deck[], ctx: QueueContext, today: number) {
    const byName = new Map(decks.map((d) => [d.name, d]));
    // unseen new cards in each deck and its subdecks, for due-date plans
    const newLeft = new Map<Id, number>();
    if (decks.some((d) => d.dueDate)) {
      const byId = new Map(decks.map((d) => [d.id, d]));
      for (const c of ctx.cards) {
        const home = c.queue === 0 ? byId.get(c.deckId) : undefined;
        if (!home) continue;
        for (const d of decks) if (isWithin(home.name, d.name)) newLeft.set(d.id, (newLeft.get(d.id) ?? 0) + 1);
      }
    }
    for (const d of decks) {
      const own = remainingLimits(d, ctx.presetFor(d), ctx.prefs, today, newLeft.get(d.id) ?? 0);
      const parentDeck = d === decks[0] ? undefined : byName.get(d.name.slice(0, d.name.lastIndexOf('::')));
      this.parent.set(d.id, parentDeck?.id ?? null);
      if (parentDeck) {
        const p = this.limits.get(parentDeck.id)!;
        own.review = Math.min(own.review, p.review);
        own.new = Math.min(own.new, p.new);
        this.children.set(parentDeck.id, [...(this.children.get(parentDeck.id) ?? []), d.id]);
      }
      this.limits.set(d.id, own);
    }
  }

  get(deckId: Id, kind: 'review' | 'new') {
    return this.limits.get(deckId)?.[kind] ?? 0;
  }

  /** decrement_node_and_parent_limits */
  decrement(deckId: Id, kind: 'review' | 'new') {
    let id: Id | null | undefined = deckId;
    while (id != null) {
      const l = this.limits.get(id)!;
      const before = { ...l };
      if (kind === 'review') {
        l.review = Math.max(l.review - 1, 0);
        if (l.capNewToReview) l.new = Math.min(l.new, l.review);
      } else {
        l.new = Math.max(l.new - 1, 0);
      }
      if ((before.review > 0 && l.review === 0) || (before.new > 0 && l.new === 0)) this.capDescendants(id, l);
      id = this.parent.get(id);
    }
  }

  private capDescendants(id: Id, cap: Limits) {
    for (const child of this.children.get(id) ?? []) {
      const l = this.limits.get(child)!;
      l.review = Math.min(l.review, cap.review);
      l.new = Math.min(l.new, cap.new);
      this.capDescendants(child, cap);
    }
  }
}

function hash(n: number) {
  let x = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** Spreads `b` evenly through `a` (Anki's Intersperser). */
function intersperse<T>(a: T[], b: T[]): T[] {
  if (!a.length || !b.length) return [...a, ...b];
  const out: T[] = [];
  const ratio = (a.length + 1) / (b.length + 1);
  let ai = 0;
  for (let bi = 0; bi < b.length; bi++) {
    const until = Math.round(ratio * (bi + 1));
    while (ai < Math.min(until, a.length)) out.push(a[ai++]);
    out.push(b[bi]);
  }
  while (ai < a.length) out.push(a[ai++]);
  return out;
}

function mix<T>(main: T[], extra: T[], how: ReviewMix): T[] {
  if (how === 'afterReviews') return [...main, ...extra];
  if (how === 'beforeReviews') return [...extra, ...main];
  return intersperse(main, extra);
}

export function buildQueue(rootId: Id, ctx: QueueContext): BuiltQueue {
  // a due-date plan counts the cards once for the limits and again below,
  // and ctx.cards may be a one-pass iterator
  if (!Array.isArray(ctx.cards) && ctx.decks.some((d) => d.dueDate)) ctx = { ...ctx, cards: [...ctx.cards] };
  const t = todayNum();
  const now = nowSecs();
  const root = ctx.decks.find((d) => d.id === rootId);
  if (!root) return { learnNow: [], learnAhead: [], nextLearnAt: null, main: [], counts: { newCount: 0, learnCount: 0, reviewCount: 0 } };
  const decks = sortDecks(ctx.decks.filter((d) => isWithin(d.name, root.name)));
  const deckIndex = new Map(decks.map((d, i) => [d.id, i]));
  const rootPreset = ctx.presetFor(root);
  const limits = new LimitTree(decks, ctx, t);
  const deckOf = new Map(decks.map((d) => [d.id, d]));

  const aheadLimit = now + ctx.prefs.learnAheadMins * 60;
  const learnNow: Card[] = [];
  const learnAhead: Card[] = [];
  const later: Card[] = [];
  const interday: Card[] = [];
  const reviews: Card[] = [];
  const fresh: Card[] = [];
  for (const c of ctx.cards) {
    if (!deckIndex.has(c.deckId)) continue;
    if (c.queue === 1) {
      if (c.due <= now) learnNow.push(c);
      else if (c.due <= aheadLimit) learnAhead.push(c);
      else later.push(c);
    } else if (c.queue === 3 && c.due <= t) interday.push(c);
    else if (c.queue === 2 && c.due <= t) reviews.push(c);
    else if (c.queue === 0) fresh.push(c);
  }
  const byDue = (a: Card, b: Card) => a.due - b.due;
  learnNow.sort(byDue);
  learnAhead.sort(byDue);
  later.sort(byDue);

  // Sibling burying during gathering: a note shows one card of each buried kind.
  const seenNotes = new Set<Id>();
  const markSeen = (c: Card) => c.noteId !== undefined && seenNotes.add(c.noteId);
  const buriedBySibling = (c: Card, enabled: boolean) => enabled && c.noteId !== undefined && seenNotes.has(c.noteId);
  [...learnNow, ...learnAhead].forEach(markSeen);

  const take = (list: Card[], kind: 'review' | 'new', bury: (c: Card) => boolean) => {
    const out: Card[] = [];
    for (const c of list) {
      if (limits.get(c.deckId, kind) <= 0) continue;
      if (bury(c)) continue;
      out.push(c);
      markSeen(c);
      limits.decrement(c.deckId, kind);
      if (kind === 'new' && limits.get(rootId, 'new') <= 0) break;
    }
    return out;
  };
  const presetOf = (c: Card) => ctx.presetFor(deckOf.get(c.deckId)!);

  // Interday learning and reviews share the review limit.
  interday.sort((a, b) => a.due - b.due || hash(a.id + t) - hash(b.id + t));
  const gatheredInterday = take(interday, 'review', (c) => buriedBySibling(c, presetOf(c).buryInterdayLearning));
  sortReviews(reviews, rootPreset.reviewOrder, deckIndex, ctx.retrievability, t);
  const gatheredReviews = take(reviews, 'review', (c) => buriedBySibling(c, presetOf(c).buryReviews));

  // New cards: gather, then sort (NewCardGatherPriority / NewCardSortOrder).
  const gatheredNew = take(gatherOrder(fresh, rootPreset.newGatherPriority, deckIndex, t), 'new', (c) =>
    buriedBySibling(c, presetOf(c).buryNew),
  );
  sortNew(gatheredNew, rootPreset.newSortOrder, t);

  const main = mix(mix(gatheredReviews, gatheredInterday, rootPreset.interdayLearningMix), gatheredNew, rootPreset.newMix);
  return {
    learnNow,
    learnAhead,
    nextLearnAt: later[0]?.due ?? null,
    main,
    counts: {
      newCount: gatheredNew.length,
      learnCount: learnNow.length + learnAhead.length + gatheredInterday.length,
      reviewCount: gatheredReviews.length,
    },
  };
}

function sortReviews(cards: Card[], order: Preset['reviewOrder'], deckIndex: Map<Id, number>, r: (c: Card) => number, t: number) {
  const rnd = (c: Card) => hash(c.id + t);
  const overdue = (c: Card) => (t - (c.due - c.ivl)) / Math.max(c.ivl, 1);
  const cmp: Record<Preset['reviewOrder'], (a: Card, b: Card) => number> = {
    day: (a, b) => a.due - b.due || rnd(a) - rnd(b),
    dayThenDeck: (a, b) => a.due - b.due || deckIndex.get(a.deckId)! - deckIndex.get(b.deckId)! || rnd(a) - rnd(b),
    deckThenDay: (a, b) => deckIndex.get(a.deckId)! - deckIndex.get(b.deckId)! || a.due - b.due || rnd(a) - rnd(b),
    intervalsAscending: (a, b) => a.ivl - b.ivl || rnd(a) - rnd(b),
    intervalsDescending: (a, b) => b.ivl - a.ivl || rnd(a) - rnd(b),
    // with FSRS, "ease" orders by difficulty (higher difficulty = lower ease)
    easeAscending: (a, b) => (b.difficulty ?? 0) - (a.difficulty ?? 0) || rnd(a) - rnd(b),
    easeDescending: (a, b) => (a.difficulty ?? 0) - (b.difficulty ?? 0) || rnd(a) - rnd(b),
    retrievabilityAscending: (a, b) => r(a) - r(b) || rnd(a) - rnd(b),
    retrievabilityDescending: (a, b) => r(b) - r(a) || rnd(a) - rnd(b),
    relativeOverdueness: (a, b) => overdue(b) - overdue(a) || rnd(a) - rnd(b),
    random: (a, b) => rnd(a) - rnd(b),
    added: (a, b) => (a.noteId ?? a.id) - (b.noteId ?? b.id) || (a.ord ?? 0) - (b.ord ?? 0),
    reverseAdded: (a, b) => (b.noteId ?? b.id) - (a.noteId ?? a.id) || (a.ord ?? 0) - (b.ord ?? 0),
  };
  cards.sort(cmp[order]);
}

function gatherOrder(cards: Card[], priority: Preset['newGatherPriority'], deckIndex: Map<Id, number>, t: number): Card[] {
  const noteKey = (c: Card) => c.noteId ?? c.id;
  const byPos = (a: Card, b: Card) => a.due - b.due || (a.ord ?? 0) - (b.ord ?? 0);
  const deck = (c: Card) => deckIndex.get(c.deckId)!;
  const list = [...cards];
  switch (priority) {
    case 'deck':
      return list.sort((a, b) => deck(a) - deck(b) || byPos(a, b));
    case 'deckThenRandomNotes':
      return list.sort((a, b) => deck(a) - deck(b) || hash(noteKey(a) + t) - hash(noteKey(b) + t) || byPos(a, b));
    case 'lowestPosition':
      return list.sort(byPos);
    case 'highestPosition':
      return list.sort((a, b) => b.due - a.due || (a.ord ?? 0) - (b.ord ?? 0));
    case 'randomNotes':
      return list.sort((a, b) => hash(noteKey(a) + t) - hash(noteKey(b) + t) || (a.ord ?? 0) - (b.ord ?? 0));
    case 'randomCards':
      return list.sort((a, b) => hash(a.id + t) - hash(b.id + t));
  }
}

function sortNew(cards: Card[], order: Preset['newSortOrder'], t: number) {
  const gathered = new Map(cards.map((c, i) => [c.id, i]));
  const g = (c: Card) => gathered.get(c.id)!;
  const tmpl = (c: Card) => c.ord ?? 0;
  const noteKey = (c: Card) => c.noteId ?? c.id;
  switch (order) {
    case 'template':
      cards.sort((a, b) => tmpl(a) - tmpl(b) || g(a) - g(b));
      break;
    case 'templateThenRandom':
      cards.sort((a, b) => tmpl(a) - tmpl(b) || hash(a.id + t) - hash(b.id + t));
      break;
    case 'randomNoteThenTemplate':
      cards.sort((a, b) => hash(noteKey(a) + t) - hash(noteKey(b) + t) || tmpl(a) - tmpl(b));
      break;
    case 'randomCard':
      cards.sort((a, b) => hash(a.id + t) - hash(b.id + t));
      break;
    case 'noSort':
      break;
  }
}
