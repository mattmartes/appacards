// Port of Anki's card state machine (rslib/src/scheduler/states) with FSRS
// always enabled: learning/relearning steps, interval constraints, fuzz and
// leech handling.

import { FSRS, type MemoryState, type NextStates, type Rating } from './fsrs';
import type { Card, RevlogEntry, Settings } from './types';
import { DAY_SECS, dayNumber, dayStartMs, nowSecs, today } from './time';

interface LearnState {
  kind: 'learn';
  remainingSteps: number;
  scheduledSecs: number;
  memory: MemoryState | null;
}

interface ReviewState {
  kind: 'review';
  scheduledDays: number;
  elapsedDays: number;
  lapses: number;
  leeched: boolean;
  memory: MemoryState | null;
}

interface RelearnState {
  kind: 'relearn';
  learning: LearnState;
  review: ReviewState;
}

interface NewState {
  kind: 'new';
}

export type CardState = NewState | LearnState | ReviewState | RelearnState;

export interface SchedulingStates {
  current: CardState;
  again: CardState;
  hard: CardState;
  good: CardState;
  easy: CardState;
}

// ------------------------------------------------------------ steps.rs

class LearningSteps {
  private steps: number[];

  constructor(steps: number[]) {
    this.steps = steps;
  }

  private toSecs(mins: number) {
    return Math.floor(mins * 60);
  }

  private index(remaining: number) {
    const total = this.steps.length;
    return Math.max(0, Math.min(total - (remaining % 1000), total - 1));
  }

  private secsAt(i: number): number | undefined {
    return i >= 0 && i < this.steps.length ? this.toSecs(this.steps[i]) : undefined;
  }

  againDelaySecs() {
    return this.secsAt(0);
  }

  hardDelaySecs(remaining: number): number | undefined {
    const idx = this.index(remaining);
    const current = this.secsAt(idx) ?? this.secsAt(0);
    if (current === undefined) return undefined;
    return idx === 0 ? this.hardDelayForFirstStep(current) : current;
  }

  private hardDelayForFirstStep(againSecs: number) {
    const next = this.secsAt(1);
    if (next !== undefined) return maybeRoundInDays(Math.floor((againSecs + next) / 2));
    return maybeRoundInDays(Math.min(Math.floor((againSecs * 3) / 2), againSecs + DAY_SECS));
  }

  goodDelaySecs(remaining: number) {
    return this.secsAt(this.index(remaining) + 1);
  }

  currentDelaySecs(remaining: number) {
    return this.secsAt(this.index(remaining)) ?? 0;
  }

  remainingForGood(remaining: number) {
    return Math.max(0, this.steps.length - (this.index(remaining) + 1));
  }

  remainingForFailed() {
    return this.steps.length;
  }

  isEmpty() {
    return this.steps.length === 0;
  }
}

function maybeRoundInDays(secs: number) {
  return secs > DAY_SECS ? Math.round(secs / DAY_SECS) * DAY_SECS : secs;
}

// ------------------------------------------------------------ fuzz.rs

const FUZZ_RANGES = [
  { start: 2.5, end: 7.0, factor: 0.15 },
  { start: 7.0, end: 20.0, factor: 0.1 },
  { start: 20.0, end: Number.MAX_VALUE, factor: 0.05 },
];

function fuzzDelta(interval: number) {
  if (interval < 2.5) return 0;
  return FUZZ_RANGES.reduce(
    (delta, r) => delta + r.factor * Math.max(Math.min(interval, r.end) - r.start, 0),
    1,
  );
}

function constrainedFuzzBounds(interval: number, minimum: number, maximum: number): [number, number] {
  minimum = Math.min(minimum, maximum);
  interval = Math.min(Math.max(interval, minimum), maximum);
  const delta = fuzzDelta(interval);
  let lower = Math.min(Math.max(Math.round(interval - delta), minimum), maximum);
  let upper = Math.min(Math.max(Math.round(interval + delta), minimum), maximum);
  if (upper === lower && upper > 2 && upper < maximum) upper = lower + 1;
  return [lower, upper];
}

function withReviewFuzz(fuzz: number | null, interval: number, minimum: number, maximum: number) {
  if (fuzz === null) return Math.min(Math.max(Math.round(interval), minimum), maximum);
  const [lower, upper] = constrainedFuzzBounds(interval, minimum, maximum);
  return Math.floor(lower + fuzz * (1 + upper - lower));
}

function minimumReviewFuzzInterval(interval: number, previous: number, maximum: number) {
  const rounded = Math.round(interval);
  const [, upper] = constrainedFuzzBounds(interval, 1, maximum);
  if (rounded > previous) return previous + 1;
  if (previous <= upper) return previous;
  return 0;
}

/** Deterministic [0,1) value from card id + reps, like Anki's fuzz seed. */
function seededRandom(seed: number): number {
  let t = (seed >>> 0) ^ Math.floor(seed / 2 ** 32);
  t = (t + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function leechThresholdMet(lapses: number, threshold: number) {
  if (threshold <= 0) return false;
  const half = Math.max(Math.ceil(threshold / 2), 1);
  return lapses >= threshold && (lapses - threshold) % half === 0;
}

// ------------------------------------------------------------ context

class StateContext {
  steps: LearningSteps;
  relearnSteps: LearningSteps;
  allowShortTerm: boolean;
  settings: Settings;
  fsrsNext: NextStates;
  fuzz: number | null;

  constructor(settings: Settings, fsrsNext: NextStates, fuzz: number | null) {
    this.settings = settings;
    this.fsrsNext = fsrsNext;
    this.fuzz = fuzz;
    this.steps = new LearningSteps(settings.learnSteps);
    this.relearnSteps = new LearningSteps(settings.relearnSteps);
    const p = settings.params;
    // Mirrors Anki: short-term scheduling is allowed for default params, or
    // when the FSRS-6+ short-term parameters are non-zero.
    this.allowShortTerm = p.length === 0 || (p.length >= 19 && p[17] > 0 && p[18] > 0);
  }

  minMax(minimum: number): [number, number] {
    const maximum = Math.max(this.settings.maxInterval, 1);
    return [Math.min(Math.max(minimum, 1), maximum), maximum];
  }

  fuzzed(interval: number, minimum: number, maximum: number) {
    return withReviewFuzz(this.fuzz, interval, minimum, maximum);
  }

  /** Short-term (sub-day) FSRS scheduling only applies when there are no steps. */
  shortTerm(steps: LearningSteps, interval: number) {
    return this.allowShortTerm && steps.isEmpty() && interval < 0.5;
  }
}

// ------------------------------------------------------------ transitions

function learnNext(s: LearnState, ctx: StateContext): SchedulingStates {
  const toReviewOrShort = (rating: 'again' | 'hard' | 'good', base: LearnState): CardState => {
    const { interval, memory } = ctx.fsrsNext[rating];
    if (ctx.shortTerm(ctx.steps, interval)) {
      return { ...base, scheduledSecs: Math.floor(interval * DAY_SECS), memory };
    }
    const [min, max] = ctx.minMax(1);
    return {
      kind: 'review',
      scheduledDays: ctx.fuzzed(Math.max(Math.round(interval), 1), min, max),
      elapsedDays: 0,
      lapses: 0,
      leeched: false,
      memory,
    };
  };

  const againDelay = ctx.steps.againDelaySecs();
  const again: CardState =
    againDelay !== undefined
      ? { kind: 'learn', remainingSteps: ctx.steps.remainingForFailed(), scheduledSecs: againDelay, memory: ctx.fsrsNext.again.memory }
      : toReviewOrShort('again', { ...s, remainingSteps: ctx.steps.remainingForFailed() });

  const hardDelay = ctx.steps.hardDelaySecs(s.remainingSteps);
  const hard: CardState =
    hardDelay !== undefined
      ? { ...s, scheduledSecs: hardDelay, memory: ctx.fsrsNext.hard.memory }
      : toReviewOrShort('hard', s);

  const goodDelay = ctx.steps.goodDelaySecs(s.remainingSteps);
  const good: CardState =
    goodDelay !== undefined
      ? { kind: 'learn', remainingSteps: ctx.steps.remainingForGood(s.remainingSteps), scheduledSecs: goodDelay, memory: ctx.fsrsNext.good.memory }
      : toReviewOrShort('good', s);

  const [min, max] = ctx.minMax(1);
  const goodDays = ctx.fuzzed(ctx.fsrsNext.good.interval, min, max);
  const easy: ReviewState = {
    kind: 'review',
    scheduledDays: ctx.fuzzed(Math.max(Math.round(ctx.fsrsNext.easy.interval), 1), goodDays + 1, max),
    elapsedDays: 0,
    lapses: 0,
    leeched: false,
    memory: ctx.fsrsNext.easy.memory,
  };

  return { current: s, again, hard, good, easy };
}

function constrainPassing(ctx: StateContext, interval: number, minimum: number) {
  const [min, max] = ctx.minMax(minimum);
  return ctx.fuzzed(interval, min, max);
}

function reviewNext(s: ReviewState, ctx: StateContext): SchedulingStates {
  const { maxInterval } = ctx.settings;
  const n = ctx.fsrsNext;
  const hardDays = constrainPassing(
    ctx,
    n.hard.interval,
    Math.max(minimumReviewFuzzInterval(n.hard.interval, s.scheduledDays, maxInterval), 1),
  );
  const goodDays = constrainPassing(
    ctx,
    n.good.interval,
    Math.max(minimumReviewFuzzInterval(n.good.interval, s.scheduledDays, maxInterval), hardDays + 1),
  );
  const easyDays = constrainPassing(
    ctx,
    n.easy.interval,
    Math.max(minimumReviewFuzzInterval(n.easy.interval, s.scheduledDays, maxInterval), goodDays + 1),
  );

  const lapses = s.lapses + 1;
  const againInterval = n.again.interval;
  const againReview: ReviewState = {
    ...s,
    scheduledDays: Math.max(Math.round(againInterval), 1),
    elapsedDays: 0,
    lapses,
    leeched: leechThresholdMet(lapses, ctx.settings.leechThreshold),
    memory: n.again.memory,
  };
  const relearnDelay = ctx.relearnSteps.againDelaySecs();
  let again: CardState;
  if (relearnDelay !== undefined) {
    again = {
      kind: 'relearn',
      learning: { kind: 'learn', remainingSteps: ctx.relearnSteps.remainingForFailed(), scheduledSecs: relearnDelay, memory: n.again.memory },
      review: againReview,
    };
  } else if (ctx.shortTerm(ctx.relearnSteps, againInterval)) {
    again = {
      kind: 'relearn',
      learning: { kind: 'learn', remainingSteps: 0, scheduledSecs: Math.floor(againInterval * DAY_SECS), memory: n.again.memory },
      review: againReview,
    };
  } else {
    again = againReview;
  }

  const passing = (days: number, memory: MemoryState): ReviewState => ({ ...s, scheduledDays: days, elapsedDays: 0, memory });
  return {
    current: s,
    again,
    hard: passing(hardDays, n.hard.memory),
    good: passing(goodDays, n.good.memory),
    easy: passing(easyDays, n.easy.memory),
  };
}

function relearnNext(s: RelearnState, ctx: StateContext): SchedulingStates {
  const n = ctx.fsrsNext;
  const steps = ctx.relearnSteps;
  const [min, max] = ctx.minMax(1);

  const viaFsrs = (rating: 'again' | 'hard' | 'good', learning: LearnState): CardState => {
    const { interval, memory } = n[rating];
    const review: ReviewState = {
      ...s.review,
      scheduledDays: ctx.fuzzed(Math.max(Math.round(interval), 1), min, max),
      memory,
    };
    if (ctx.shortTerm(steps, interval)) {
      return { kind: 'relearn', learning: { ...learning, scheduledSecs: Math.floor(interval * DAY_SECS), memory }, review };
    }
    return review;
  };

  const againDelay = steps.againDelaySecs();
  const again: CardState =
    againDelay !== undefined
      ? {
          kind: 'relearn',
          learning: { kind: 'learn', remainingSteps: steps.remainingForFailed(), scheduledSecs: againDelay, memory: n.again.memory },
          review: { ...s.review, scheduledDays: Math.max(Math.round(n.again.interval), 1), elapsedDays: 0, memory: n.again.memory },
        }
      : viaFsrs('again', { ...s.learning, remainingSteps: steps.remainingForFailed() });

  const hardDelay = steps.hardDelaySecs(s.learning.remainingSteps);
  const hard: CardState =
    hardDelay !== undefined
      ? {
          kind: 'relearn',
          learning: { ...s.learning, scheduledSecs: hardDelay, memory: n.hard.memory },
          review: { ...s.review, elapsedDays: 0, memory: n.hard.memory },
        }
      : viaFsrs('hard', s.learning);

  const goodDelay = steps.goodDelaySecs(s.learning.remainingSteps);
  const good: CardState =
    goodDelay !== undefined
      ? {
          kind: 'relearn',
          learning: { kind: 'learn', remainingSteps: steps.remainingForGood(s.learning.remainingSteps), scheduledSecs: goodDelay, memory: n.good.memory },
          review: { ...s.review, elapsedDays: 0, memory: n.good.memory },
        }
      : viaFsrs('good', { ...s.learning, remainingSteps: steps.remainingForGood(s.learning.remainingSteps) });

  const goodDays = ctx.fuzzed(n.good.interval, min, max);
  const easy: ReviewState = {
    ...s.review,
    scheduledDays: ctx.fuzzed(Math.max(Math.round(n.easy.interval), 1), goodDays + 1, max),
    elapsedDays: 0,
    memory: n.easy.memory,
  };

  return { current: s, again, hard, good, easy };
}

// ------------------------------------------------------------ card <-> state

export function memoryOf(card: Card): MemoryState | null {
  if (card.stability === null || card.difficulty === null) return null;
  return { stability: card.stability, difficulty: card.difficulty, stabilityFast: card.stabilityFast ?? card.stability };
}

export function daysSinceLastReview(card: Card, todayNum = today()): number {
  return card.lastReview === null ? 0 : Math.max(0, todayNum - dayNumber(card.lastReview * 1000));
}

export function currentState(card: Card, settings: Settings): CardState {
  const memory = memoryOf(card);
  const steps = new LearningSteps(settings.learnSteps);
  const relearn = new LearningSteps(settings.relearnSteps);
  const elapsed = daysSinceLastReview(card);
  switch (card.type) {
    case 0:
      return { kind: 'new' };
    case 1:
      return { kind: 'learn', remainingSteps: card.left, scheduledSecs: steps.currentDelaySecs(card.left), memory };
    case 2:
      return { kind: 'review', scheduledDays: card.ivl, elapsedDays: elapsed, lapses: card.lapses, leeched: false, memory };
    case 3:
      return {
        kind: 'relearn',
        learning: { kind: 'learn', remainingSteps: card.left, scheduledSecs: relearn.currentDelaySecs(card.left), memory },
        review: { kind: 'review', scheduledDays: card.ivl, elapsedDays: elapsed, lapses: card.lapses, leeched: false, memory },
      };
  }
}

export function fsrsFor(settings: Settings): FSRS {
  return new FSRS(settings.params, settings.relearnSteps.length);
}

export function nextStates(card: Card, settings: Settings, fsrs = fsrsFor(settings)): SchedulingStates {
  const current = currentState(card, settings);
  const fsrsNext = fsrs.nextStates(memoryOf(card), settings.desiredRetention, daysSinceLastReview(card));
  const fuzz = settings.fuzz ? seededRandom(card.id + card.reps) : null;
  const ctx = new StateContext(settings, fsrsNext, fuzz);
  switch (current.kind) {
    case 'new':
      // A new card acts like a failed learning card.
      return {
        ...learnNext({ kind: 'learn', remainingSteps: ctx.steps.remainingForFailed(), scheduledSecs: 0, memory: null }, ctx),
        current,
      };
    case 'learn':
      return learnNext(current, ctx);
    case 'review':
      return reviewNext(current, ctx);
    case 'relearn':
      return relearnNext(current, ctx);
  }
}

/** Seconds until the next day starts (for converting learning steps to days). */
function secsUntilRollover(now = nowSecs()): number {
  return Math.max(1, Math.floor(dayStartMs(today() + 1) / 1000 - now));
}

export function intervalSecs(state: CardState): number {
  switch (state.kind) {
    case 'new':
      return 0;
    case 'learn':
      return state.scheduledSecs;
    case 'review':
      return state.scheduledDays * DAY_SECS;
    case 'relearn':
      return state.learning.scheduledSecs;
  }
}

function learningFuzz(card: Card, secs: number, fuzzOn: boolean) {
  if (!fuzzOn) return secs;
  const upper = secs + Math.floor(Math.min(secs * 0.25, 300));
  if (secs >= upper) return secs;
  return secs + Math.floor(seededRandom(card.id + card.reps + 7919) * (upper - secs));
}

export interface AnswerResult {
  card: Card;
  revlog: RevlogEntry;
  leeched: boolean;
}

export function answerCard(
  card: Card,
  rating: Rating,
  settings: Settings,
  timeTakenMs: number,
  states = nextStates(card, settings),
): AnswerResult {
  const fsrs = fsrsFor(settings);
  const next = [states.again, states.hard, states.good, states.easy][rating - 1];
  const now = nowSecs();
  const t = today();
  const c: Card = { ...card, reps: card.reps + 1, lastReview: now, mtime: now };
  const elapsedDays = daysSinceLastReview(card, t);
  const prevMemory = memoryOf(card);
  let leeched = false;

  const applyLearning = (l: LearnState, type: 1 | 3) => {
    c.type = type;
    c.left = l.remainingSteps;
    const secs = l.scheduledSecs;
    const untilRollover = secsUntilRollover(now);
    if (secs >= untilRollover) {
      c.queue = 3;
      c.due = t + Math.floor((secs - untilRollover) / DAY_SECS) + 1;
    } else {
      c.queue = 1;
      c.due = now + learningFuzz(card, secs, settings.fuzz);
    }
  };

  const setMemory = (m: MemoryState | null) => {
    c.stability = m?.stability ?? null;
    c.difficulty = m?.difficulty ?? null;
    c.stabilityFast = m?.stabilityFast ?? null;
  };

  switch (next.kind) {
    case 'learn':
      applyLearning(next, 1);
      setMemory(next.memory);
      break;
    case 'relearn':
      applyLearning(next.learning, 3);
      c.ivl = next.review.scheduledDays;
      c.lapses = next.review.lapses;
      leeched = next.review.leeched;
      setMemory(next.learning.memory);
      break;
    case 'review':
      c.type = 2;
      c.queue = 2;
      c.ivl = next.scheduledDays;
      c.due = t + next.scheduledDays;
      c.lapses = next.lapses;
      c.left = 0;
      leeched = next.leeched;
      setMemory(next.memory);
      break;
    case 'new':
      break;
  }

  if (leeched) {
    if (!c.tags.includes('leech')) c.tags = [...c.tags, 'leech'];
    if (settings.leechAction === 'suspend') c.queue = -1;
  }

  const kind = card.type === 0 || card.type === 1 ? 0 : card.type === 3 ? 2 : elapsedDays < card.ivl ? 3 : 1;
  const ivlSecs = intervalSecs(next);
  const revlog: RevlogEntry = {
    id: Date.now(),
    cardId: card.id,
    rating,
    ivl: ivlSecs >= DAY_SECS ? Math.round(ivlSecs / DAY_SECS) : -ivlSecs,
    lastIvl: card.type === 2 || card.type === 3 ? card.ivl : -intervalSecs(states.current),
    stability: c.stability ?? 0,
    difficulty: c.difficulty ?? 0,
    retrievability: prevMemory ? fsrs.retrievability(prevMemory, elapsedDays) : null,
    elapsedDays,
    time: Math.min(timeTakenMs, 60_000),
    kind,
  };
  return { card: c, revlog, leeched };
}

/** Current probability of recall, or null for cards never reviewed. */
export function retrievabilityNow(card: Card, fsrs: FSRS): number | null {
  const m = memoryOf(card);
  if (!m || card.type === 0) return null;
  return fsrs.retrievability(m, daysSinceLastReview(card));
}
