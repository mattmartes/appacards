// Port of FSRS-7 parameter optimisation from fsrs-rs 6.6.2 (training.rs,
// training_windowed.rs, analytic_v7.rs, parameter_initialization_fsrs7.rs),
// called the way Anki calls it (rslib/src/scheduler/fsrs/params.rs).
//
// Gradients use forward-mode dual numbers, which is how fsrs-rs computes its
// reference gradient (`windowed_loss_and_grad`); its fast kernels compute the
// same values with reverse mode and SIMD. Batch order is shuffled with a
// seeded PRNG, but not Rust's StdRng, so results are not bit-identical to Anki.

import { FSRS, FSRS7_DEFAULT_PARAMETERS, S_MIN, clipFsrs7, type MemoryState } from './fsrs';
import { buildTrainingHistories, longTermReviewCount, type CardHistory, type FsrsReview } from './fsrsDataset';
import type { RevlogEntry } from './types';

const N = 34;
const S_MAX = 36500;
const D_MIN = 1;
const D_MAX = 10;

// training.rs / training_v7.rs constants
const ADAM_BETA_1 = 0.7;
const ADAM_BETA_2 = 0.98;
const ADAM_EPSILON = 1e-8;
const LEARNING_RATE = 0.0118;
/** Anki overrides the FSRS-7 default of 9. */
const NUM_EPOCHS = 8;
const BATCH_SIZE = 512;
const SEED = 2023;
const MAX_SEQ_LEN = 256;
const PENALTY_W_L2 = 0.3333;
const PARAMS_STDDEV = [
  9999.0, 9999.0, 9999.0, 9999.0, 0.523, 0.2528, 0.4329, 0.2966, 0.2139, 0.2889, 0.1862, 0.175, 0.3812, 0.3013,
  0.9104, 0.3234, 0.2448, 0.3273, 0.1842, 0.1735, 0.4608, 0.311, 0.864, 0.0418, 0.2596, 0.0798, 0.0682, 0.1282,
  0.1397, 0.1407, 0.1489, 0.2, 0.15, 0.15,
];

// ------------------------------------------------------------ dual numbers

const ZERO = new Float64Array(N);

interface Dual {
  v: number;
  g: Float64Array;
}

const c = (v: number): Dual => ({ v, g: ZERO });

function variable(v: number, i: number): Dual {
  const g = new Float64Array(N);
  g[i] = 1;
  return { v, g };
}

function map(a: Dual, v: number, k: number): Dual {
  const g = new Float64Array(N);
  const ag = a.g;
  for (let i = 0; i < N; i++) g[i] = ag[i] * k;
  return { v, g };
}

function add(a: Dual, b: Dual): Dual {
  const g = new Float64Array(N);
  for (let i = 0; i < N; i++) g[i] = a.g[i] + b.g[i];
  return { v: a.v + b.v, g };
}
const addC = (a: Dual, k: number): Dual => ({ v: a.v + k, g: a.g });
const subC = (a: Dual, k: number): Dual => ({ v: a.v - k, g: a.g });
/** k - a */
const constSub = (a: Dual, k: number): Dual => map(a, k - a.v, -1);
const neg = (a: Dual): Dual => map(a, -a.v, -1);
const mulC = (a: Dual, k: number): Dual => map(a, a.v * k, k);

function mul(a: Dual, b: Dual): Dual {
  const g = new Float64Array(N);
  const av = a.v;
  const bv = b.v;
  for (let i = 0; i < N; i++) g[i] = a.g[i] * bv + b.g[i] * av;
  return { v: av * bv, g };
}

function div(a: Dual, b: Dual): Dual {
  const g = new Float64Array(N);
  const denom = b.v * b.v;
  for (let i = 0; i < N; i++) g[i] = (a.g[i] * b.v - a.v * b.g[i]) / denom;
  return { v: a.v / b.v, g };
}

function exp(a: Dual): Dual {
  const v = Math.exp(a.v);
  return map(a, v, v);
}
const ln = (a: Dual): Dual => map(a, Math.log(a.v), 1 / a.v);
const pow = (a: Dual, b: Dual): Dual => exp(mul(b, ln(a)));

function clamp(a: Dual, lo: number, hi: number): Dual {
  if (a.v < lo) return c(lo);
  if (a.v > hi) return c(hi);
  return a;
}
const clampMax = (a: Dual, hi: number): Dual => (a.v > hi ? c(hi) : a);

// ------------------------------------------------------------ FSRS-7 (dual)

interface StateDual {
  s: Dual;
  sf: Dual;
  d: Dual;
}

function initDifficulty(w: Dual[], rating: number): Dual {
  return addC(add(w[4], neg(exp(mulC(w[5], rating - 1)))), 1);
}

function fastDecay(w: Dual[], sf: Dual) {
  const decay1 = neg(clamp(mul(w[23], pow(sf, subC(w[33], 0.3))), 0.01, 0.95));
  const factor1 = subC(exp(clampMax(mul(ln(w[25]), div(c(1), decay1)), 60)), 1);
  return { decay1, factor1 };
}

function forgettingCurve(w: Dual[], t: number, s0: Dual, sf0: Dual, d0: Dual): Dual {
  t = Math.max(t, 0);
  const s = clamp(s0, S_MIN, S_MAX);
  const sf = clamp(sf0, S_MIN, S_MAX);
  const d = clamp(d0, D_MIN, D_MAX);
  const { decay1, factor1 } = fastDecay(w, sf);
  const r1 = pow(addC(mul(div(c(t), sf), factor1), 1), decay1);
  const decay2 = neg(clamp(w[24], 0.01, 0.95));
  const factor2 = subC(pow(w[26], div(c(1), decay2)), 1);
  const dTimescale = exp(mul(subC(d, 5), subC(w[32], 0.3)));
  const r2 = pow(addC(mul(mul(div(c(t), s), factor2), dTimescale), 1), decay2);
  const weight1 = mul(w[27], pow(sf, neg(w[29])));
  const weight2 = mul(mul(w[28], pow(s, w[30])), exp(mul(subC(d, 5), subC(w[31], 0.5))));
  const retention = div(add(mul(weight1, r1), mul(weight2, r2)), add(weight1, weight2));
  return addC(mulC(retention, 1 - 2e-5), 1e-5);
}

function fastComponentRecall(w: Dual[], t: number, sf0: Dual): Dual {
  t = Math.max(t, 0);
  const sf = clamp(sf0, S_MIN, S_MAX);
  const { decay1, factor1 } = fastDecay(w, sf);
  return pow(addC(mul(div(c(t), sf), factor1), 1), decay1);
}

function stabilityForSet(w: Dual[], lastS: Dual, lastD: Dual, r: Dual, rating: number, start: number): Dual {
  const hardPenalty = rating === 2 ? w[start + 6] : c(1);
  const easyBonus = rating === 4 ? w[start + 7] : c(1);
  const newSFail = mul(
    mul(w[start + 3], subC(pow(addC(lastS, 1), w[start + 4]), 1)),
    exp(mul(constSub(r, 1), w[start + 5])),
  );
  const pls = lastS.v > newSFail.v ? newSFail : lastS;
  if (rating <= 1) return pls;
  const sinc = addC(
    mul(
      mul(
        mul(
          mul(mul(exp(subC(w[start], 1.5)), constSub(lastD, 11)), pow(lastS, neg(w[start + 1]))),
          subC(exp(mul(constSub(r, 1), w[start + 2])), 1),
        ),
        hardPenalty,
      ),
      easyBonus,
    ),
    1,
  );
  const success = mul(lastS, sinc);
  return pls.v < success.v ? success : pls;
}

function nextDifficulty(w: Dual[], d: Dual, rating: number, r: Dual): Dual {
  let deltaD = mulC(neg(w[6]), rating - 3);
  if (rating === 1) deltaD = mul(deltaD, addC(r, 0.1));
  const newD = add(d, mulC(mul(constSub(d, 10), deltaD), 1 / 9));
  return clamp(add(mulC(initDifficulty(w, 4), 0.01), mulC(newD, 0.99)), D_MIN, D_MAX);
}

function step(w: Dual[], deltaT: number, rating: number, state: StateDual, nth: number): StateDual {
  const lastS = clamp(state.s, S_MIN, S_MAX);
  const lastD = clamp(state.d, D_MIN, D_MAX);
  const lastSf = clamp(state.sf, S_MIN, S_MAX);
  if (rating === 0) return { s: lastS, sf: lastSf, d: lastD };
  if (nth === 0 && state.s.v === 0) {
    const initS = w[Math.min(Math.max(rating, 1), 4) - 1];
    return {
      s: clamp(initS, S_MIN, S_MAX),
      sf: clamp(mulC(initS, 0.8), S_MIN, S_MAX),
      d: clamp(initDifficulty(w, rating), D_MIN, D_MAX),
    };
  }
  deltaT = Math.max(deltaT, 0);
  const r = forgettingCurve(w, deltaT, lastS, lastSf, lastD);
  const newSSlow = stabilityForSet(w, lastS, lastD, r, rating, 7);
  const rFast = fastComponentRecall(w, deltaT, lastSf);
  let newSFast = stabilityForSet(w, lastSf, lastD, rFast, rating, 15);
  if (rating === 1) {
    const relearn = mulC(newSSlow, 0.8);
    if (newSFast.v > relearn.v) newSFast = relearn;
  }
  return {
    s: clamp(newSSlow, S_MIN, S_MAX),
    sf: clamp(newSFast, S_MIN, S_MAX),
    d: nextDifficulty(w, lastD, rating, r),
  };
}

// ------------------------------------------------------------ batches

interface Column {
  reviews: FsrsReview[];
  /** weight per row; 0 where no item ends */
  weights: Float64Array;
  /** 1 = recalled, 0 = forgot */
  labels: Uint8Array;
}

interface Batch {
  columns: Column[];
  predictions: number;
}

interface WeightedItem {
  history: CardHistory;
  length: number;
  revlogId: number;
  weight: number;
}

/** x^11.25 as in training.rs */
const pow1125 = (x: number) => Math.pow(x, 11) * Math.sqrt(Math.sqrt(x));

function weightedItems(histories: CardHistory[]): WeightedItem[] {
  const items: WeightedItem[] = [];
  for (const h of histories) for (const e of h.itemEnds) items.push({ history: h, length: e.length, revlogId: e.revlogId, weight: 0 });
  items.sort((a, b) => a.revlogId - b.revlogId);
  const n = Math.max(items.length, 1);
  items.forEach((it, i) => (it.weight = 0.0667 + 0.9333 * pow1125(i / n)));
  return items;
}

/** Mirrors `build_windowed_batches`: one column per card holding its longest
 * prefix, cards sorted by length, packed up to BATCH_SIZE predictions. */
function buildBatches(items: WeightedItem[]): Batch[] {
  const byCard = new Map<CardHistory, WeightedItem[]>();
  for (const it of items) {
    const list = byCard.get(it.history);
    if (list) list.push(it);
    else byCard.set(it.history, [it]);
  }
  const cards = [...byCard.entries()].map(([h, prefixes]) => {
    prefixes.sort((a, b) => a.length - b.length);
    return { h, prefixes, fullLen: prefixes[prefixes.length - 1].length };
  });
  cards.sort((a, b) => a.fullLen - b.fullLen || a.h.cardId - b.h.cardId);

  const batches: Batch[] = [];
  let current: Column[] = [];
  let predictions = 0;
  for (const { h, prefixes, fullLen } of cards) {
    if (current.length && predictions + prefixes.length > BATCH_SIZE) {
      batches.push({ columns: current, predictions });
      current = [];
      predictions = 0;
    }
    const weights = new Float64Array(fullLen);
    const labels = new Uint8Array(fullLen);
    for (const p of prefixes) {
      weights[p.length - 1] = p.weight;
      labels[p.length - 1] = h.reviews[p.length - 1].rating > 1 ? 1 : 0;
    }
    current.push({ reviews: h.reviews.slice(0, fullLen), weights, labels });
    predictions += prefixes.length;
  }
  if (current.length) batches.push({ columns: current, predictions });
  return batches;
}

/** Summed weighted BCE loss and gradient over a batch (`windowed_loss_and_grad`). */
function batchLossAndGrad(params: number[], batch: Batch): { loss: number; grad: Float64Array } {
  const w = params.map((v, i) => variable(v, i));
  const grad = new Float64Array(N);
  let loss = 0;
  for (const col of batch.columns) {
    let state: StateDual = { s: c(0), sf: c(0), d: c(0) };
    const len = col.reviews.length;
    for (let row = 0; row < len; row++) {
      const { deltaT, rating } = col.reviews[row];
      const weight = col.weights[row];
      if (row > 0 && weight !== 0) {
        const r = clamp(forgettingCurve(w, deltaT, state.s, state.sf, state.d), 1e-5, 1 - 1e-5);
        const p = col.labels[row] === 0 ? constSub(r, 1) : r;
        // d/dw of -weight * ln(p)
        loss -= weight * Math.log(p.v);
        const k = -weight / p.v;
        for (let i = 0; i < N; i++) grad[i] += p.g[i] * k;
      }
      if (row + 1 < len) state = step(w, deltaT, rating, state, row);
    }
  }
  return { loss, grad };
}

// ------------------------------------------------------------ training

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class CosineAnnealingLR {
  private step_ = -1;
  private lr: number;
  private tMax: number;
  private initLr: number;

  constructor(tMax: number, initLr: number) {
    this.tMax = tMax;
    this.initLr = initLr;
    this.lr = initLr;
  }

  step(): number {
    this.step_ += 1;
    const s = this.step_;
    const t = this.tMax;
    if (s === 0) this.lr = this.initLr;
    else if ((s - 1 - t) % (2 * t) === 0) this.lr = (this.initLr * (1 - Math.cos(Math.PI / t))) / 2;
    else this.lr = ((1 + Math.cos((Math.PI * s) / t)) / (1 + Math.cos((Math.PI * (s - 1)) / t))) * this.lr;
    return this.lr;
  }
}

function smoothInitialStabilities(s0: number[]): number[] {
  // fill_initial_stabilities_fsrs7 with all four ratings present
  const values = s0.map((v) => Math.min(Math.max(v, 0.0001), 100));
  for (let i = 1; i < 4; i++) values[i] = Math.max(values[i], values[i - 1]);
  return values.map((v) => Math.min(Math.max(v, S_MIN), 100));
}

export interface Progress {
  epoch: number;
  epochs: number;
  processed: number;
  total: number;
}

function train(items: WeightedItem[], onProgress?: (p: Progress) => boolean): number[] {
  const batches = buildBatches(items);
  const total = items.length;
  const params = [...FSRS7_DEFAULT_PARAMETERS];
  const initial = [...params];
  const m1 = new Float64Array(N);
  const m2 = new Float64Array(N);
  let time = 0;
  const scheduler = new CosineAnnealingLR(batches.length * NUM_EPOCHS, LEARNING_RATE);
  const rand = mulberry32(SEED);
  const order = batches.map((_, i) => i);

  for (let epoch = 1; epoch <= NUM_EPOCHS; epoch++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    let processed = 0;
    for (const bi of order) {
      const batch = batches[bi];
      const { grad } = batchLossAndGrad(params, batch);
      // L2 penalty toward the starting parameters
      const scale = (PENALTY_W_L2 * batch.predictions) / total;
      for (let i = 0; i < N; i++) {
        const sigma = PARAMS_STDDEV[i];
        const g = ((2 * (params[i] - initial[i])) / (sigma * sigma)) * scale;
        grad[i] = Math.fround(grad[i]) + (Number.isFinite(g) ? g : 0);
      }
      // Adam
      time++;
      const lr = scheduler.step();
      const mc = 1 - Math.pow(ADAM_BETA_1, time);
      const vc = 1 - Math.pow(ADAM_BETA_2, time);
      for (let i = 0; i < N; i++) {
        const g = Number.isFinite(grad[i]) ? grad[i] : 0;
        m1[i] = m1[i] * ADAM_BETA_1 + g * (1 - ADAM_BETA_1);
        m2[i] = m2[i] * ADAM_BETA_2 + g * g * (1 - ADAM_BETA_2);
        params[i] -= (lr * (m1[i] / mc)) / (Math.sqrt(m2[i] / vc) + ADAM_EPSILON);
      }
      clipFsrs7(params);
      processed += batch.predictions;
      if (onProgress && !onProgress({ epoch, epochs: NUM_EPOCHS, processed: Math.min(processed, total), total })) {
        throw new Error('Optimization cancelled');
      }
    }
  }
  return [...smoothInitialStabilities(params.slice(0, 4)), ...params.slice(4)].map((v) => Math.fround(v));
}

// ------------------------------------------------------------ evaluation

export interface Evaluation {
  logLoss: number;
  rmseBins: number;
}

function rMatrixIndex(reviews: FsrsReview[], length: number): string {
  const deltaT = reviews[length - 1].deltaT;
  const deltaTBin = Math.round(2.48 * Math.pow(3.62, Math.floor(Math.log(deltaT) / Math.log(3.62))) * 100);
  const len = longTermReviewCount(reviews, length) + 1;
  const lengthBin = Math.round(1.99 * Math.pow(1.89, Math.floor(Math.log(len) / Math.log(1.89))));
  let lapse = 0;
  for (let i = 0; i < length - 1; i++) if (reviews[i].rating === 1 && reviews[i].deltaT >= 1) lapse++;
  const lapseBin = lapse === 0 ? 0 : Math.round(1.65 * Math.pow(1.73, Math.floor(Math.log(lapse) / Math.log(1.73))));
  return `${deltaTBin},${lengthBin},${lapseBin}`;
}

/** Like fsrs-rs `evaluate`: weighted log loss and RMSE over (Δt, length,
 * lapses) bins, with FSRS-6-style recency weights. */
export function evaluate(params: number[], histories: CardHistory[]): Evaluation {
  const fsrs = new FSRS(params);
  const preds: { revlogId: number; p: number; y: number; bin: string }[] = [];
  for (const h of histories) {
    const ends = new Set(h.itemEnds.map((e) => e.length));
    const idByLen = new Map(h.itemEnds.map((e) => [e.length, e.revlogId]));
    let state: MemoryState | null = null;
    for (let i = 0; i < h.reviews.length; i++) {
      const rv = h.reviews[i];
      if (ends.has(i + 1) && state) {
        preds.push({
          revlogId: idByLen.get(i + 1)!,
          p: fsrs.retrievability(state, rv.deltaT),
          y: rv.rating > 1 ? 1 : 0,
          bin: rMatrixIndex(h.reviews, i + 1),
        });
      }
      state = fsrs.step(state, rv.deltaT, rv.rating as 1 | 2 | 3 | 4);
    }
  }
  preds.sort((a, b) => a.revlogId - b.revlogId);
  const denom = Math.max(preds.length - 1, 1);
  let loss = 0;
  let weightSum = 0;
  const bins = new Map<string, { pred: number; actual: number; count: number; weight: number }>();
  preds.forEach((x, i) => {
    const weight = 0.25 + 0.75 * Math.pow(i / denom, 3);
    const r = Math.min(Math.max(x.p, 0.0001), 0.9999);
    loss += (x.y * Math.log(r) + (1 - x.y) * Math.log(1 - r)) * weight;
    weightSum += weight;
    const b = bins.get(x.bin) ?? { pred: 0, actual: 0, count: 0, weight: 0 };
    b.pred += x.p;
    b.actual += x.y;
    b.count += 1;
    b.weight += weight;
    bins.set(x.bin, b);
  });
  let se = 0;
  let wsum = 0;
  for (const b of bins.values()) {
    se += Math.pow(b.pred / b.count - b.actual / b.count, 2) * b.weight;
    wsum += b.weight;
  }
  return { logLoss: -loss / weightSum, rmseBins: Math.sqrt(se / wsum) };
}

/** Exposed for tests. */
export const internals = { weightedItems, buildBatches, batchLossAndGrad };

// ------------------------------------------------------------ entry point

export interface OptimizeResult {
  params: number[];
  /** training items (reviews on a later day than the previous one) */
  itemCount: number;
  reviewCount: number;
  /** true when the optimized params were kept */
  improved: boolean;
  before: Evaluation | null;
  after: Evaluation | null;
  /** why the defaults/current params were returned without training */
  note?: string;
}

/** Optimizes FSRS-7 parameters from the review log, the way Anki's
 * "Optimize" button does. `currentParams` are kept unless the new ones
 * predict the history better. */
export function optimizeParameters(
  revlog: RevlogEntry[],
  currentParams: number[],
  numRelearningSteps: number,
  onProgress?: (p: Progress) => boolean,
): OptimizeResult {
  const histories = buildTrainingHistories(revlog);
  let items = weightedItems(histories);
  const itemCount = items.length;
  const reviewCount = histories.reduce((n, h) => n + h.reviews.length, 0);
  const base = { itemCount, reviewCount, before: null, after: null };
  if (itemCount === 0) return { ...base, params: currentParams, improved: false, note: 'No reviews to learn from yet.' };

  let trained: number[];
  const onlyFirst = items.every((it) => longTermReviewCount(it.history.reviews, it.length) === 1);
  if (itemCount < 64 || onlyFirst) {
    // fsrs-rs returns the defaults without training below these thresholds.
    trained = [...FSRS7_DEFAULT_PARAMETERS];
  } else {
    items = items.filter((it) => it.length <= MAX_SEQ_LEN);
    trained = train(items, onProgress);
  }

  const after = evaluate(trained, histories);
  let before: Evaluation | null = null;
  let params = trained;
  let improved = true;
  try {
    const current = new FSRS(currentParams);
    before = evaluate(currentParams, histories);
    if (before.logLoss <= after.logLoss) {
      // Anki keeps the current parameters unless they misbehave with
      // multiple relearning steps.
      let keepCurrent = numRelearningSteps <= 1;
      if (!keepCurrent) {
        const start: MemoryState = { stability: 1, difficulty: 1, stabilityFast: 1 };
        let s = current.nextStates(start, 0.9, 2).again.memory;
        for (let i = 0; i < numRelearningSteps; i++) s = current.nextStates(s, 0.9, 0).good.memory;
        keepCurrent = s.stability < start.stability;
      }
      if (keepCurrent) {
        params = currentParams;
        improved = false;
      }
    }
  } catch {
    // invalid current params: take the optimized ones
  }
  return {
    ...base,
    params,
    improved,
    before,
    after,
    note: itemCount < 64 ? 'Fewer than 64 training items: FSRS uses its default parameters.' : undefined,
  };
}
