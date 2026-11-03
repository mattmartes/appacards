// TypeScript port of the FSRS inference code from fsrs-rs 6.6.2, the version
// Anki pins. Empty params select FSRS-7 (34 params); 17/19/21 params select
// FSRS-6. Training/optimisation is not ported.

export type Rating = 1 | 2 | 3 | 4;

export interface MemoryState {
  stability: number;
  difficulty: number;
  /** FSRS-7 fast trace; equals stability for FSRS-6. */
  stabilityFast: number;
}

export interface ItemState {
  memory: MemoryState;
  /** days, fractional */
  interval: number;
}

export interface NextStates {
  again: ItemState;
  hard: ItemState;
  good: ItemState;
  easy: ItemState;
}

export const S_MIN = 0.0001;
export const S_MAX = 36500;
export const D_MIN = 1;
export const D_MAX = 10;
const INIT_S_MAX = 100;

export const FSRS5_DEFAULT_DECAY = 0.5;
export const FSRS6_DEFAULT_DECAY = 0.1542;

export const FSRS6_DEFAULT_PARAMETERS = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
  0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, FSRS6_DEFAULT_DECAY,
];

export const FSRS7_DEFAULT_PARAMETERS = [
  0.1104, 2.2395, 3.9221, 11.7841, 6.1686, 0.6457, 3.6807, 1.9795, 0.0, 1.3826, 0.7024, 0.5999,
  0.8146, 0.6398, 1.0, 1.3207, 0.6707, 3.8668, 0.4416, 0.0934, 1.8631, 0.6162, 1.0869, 0.1567,
  0.0801, 0.2421, 0.9464, 0.1433, 0.7145, 0.0, 0.5667, 0.3734, 0.5333, 0.3048,
];

export type ModelVersion = 'fsrs6' | 'fsrs7';

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

function clampSafe(value: number, low: number, high: number): number {
  low = Number.isFinite(low) ? low : 0;
  high = Number.isFinite(high) ? high : low;
  if (low > high) [low, high] = [high, low];
  return clamp(Number.isFinite(value) ? value : low, low, high);
}

/** Expands legacy parameter sets and validates length. Throws on bad input. */
export function checkAndFillParameters(params: number[]): number[] {
  let p: number[];
  switch (params.length) {
    case 0:
      p = [...FSRS7_DEFAULT_PARAMETERS];
      break;
    case 17:
      p = [...params];
      p[4] = p[5] * 2 + p[4];
      p[5] = Math.log(p[5] * 3 + 1) / 3;
      p[6] += 0.5;
      p.push(0, 0, 0, FSRS5_DEFAULT_DECAY);
      break;
    case 19:
      p = [...params, 0, FSRS5_DEFAULT_DECAY];
      break;
    case 21:
    case 34:
      p = [...params];
      break;
    default:
      throw new Error(`Invalid FSRS parameter count ${params.length} (expected 0, 17, 19, 21 or 34)`);
  }
  if (p.some((v) => !Number.isFinite(v))) throw new Error('FSRS parameters must be finite numbers');
  return p;
}

function clipFsrs6(p: number[], numRelearningSteps: number, enableShortTerm: boolean) {
  const w1718Ceiling =
    p.length > 14 && numRelearningSteps > 1
      ? Math.min(
          Math.sqrt(
            Math.max(
              -(Math.log(p[11]) + Math.log(Math.pow(2, p[13]) - 1) + p[14] * 0.3) / numRelearningSteps,
              0.01,
            ),
          ),
          2,
        )
      : 2;
  const w19Floor = enableShortTerm ? 0.01 : 0;
  const clamps: [number, number][] = [
    [S_MIN, INIT_S_MAX],
    [S_MIN, INIT_S_MAX],
    [S_MIN, INIT_S_MAX],
    [S_MIN, INIT_S_MAX],
    [D_MIN, D_MAX],
    [0.001, 4],
    [0.001, 4],
    [0.001, 0.75],
    [0, 4.5],
    [0, 0.8],
    [0.001, 3.5],
    [0.001, 5],
    [0.001, 0.25],
    [0.001, 0.9],
    [0, 4],
    [0, 1],
    [1, 6],
    [0, w1718Ceiling],
    [0, w1718Ceiling],
    [w19Floor, 0.8],
    [0.1, 0.8],
  ];
  clamps.forEach(([lo, hi], i) => (p[i] = clamp(p[i], lo, hi)));
}

export function clipFsrs7(p: number[]) {
  const ranges: [number, number][] = [
    [0.001, 4],
    [0.1, 4],
    [0, 4],
    [0, 1.2],
    [0.3, 3],
    [0.01, 1.5],
    [0.1, 1],
    [0, 3.5],
    [0, 1],
    [1, 7],
    [0, 4],
    [0, 2],
    [0.5, 6],
    [0.001, 1.5],
    [0.001, 1],
    [0, 5],
    [0, 1],
    [1, 7],
    [0.01, 0.25],
    [0.01, 0.95],
    [0.2, 0.85],
  ];
  p[0] = clampSafe(p[0], S_MIN, INIT_S_MAX / 2);
  p[1] = clampSafe(p[1], p[0], INIT_S_MAX);
  p[2] = clampSafe(p[2], p[1], INIT_S_MAX);
  p[3] = clampSafe(p[3], p[2], INIT_S_MAX);
  p[4] = clampSafe(p[4], 1, 10);
  ranges.forEach(([lo, hi], i) => (p[i + 5] = clampSafe(p[i + 5], lo, hi)));
  p[26] = clampSafe(p[26], Math.max(p[25], 0.5), 0.99);
  p[27] = clampSafe(p[27], 0.01, 1);
  p[28] = clampSafe(p[28], 0.1, 1);
  p[29] = clampSafe(p[29], 0, 0.9);
  p[30] = clampSafe(p[30], 0.1, 1.1);
  p[31] = clampSafe(p[31], 0, 1);
  p[32] = clampSafe(p[32], 0, 0.6);
  p[33] = clampSafe(p[33], 0, 0.6);
}

// ---------------------------------------------------------------- FSRS-6

function v6ForgettingCurve(w: number[], t: number, s: number): number {
  s = Math.max(s, S_MIN);
  const decay = -w[20];
  const factor = Math.pow(0.9, 1 / decay) - 1;
  t = Math.round(Math.max(t, 0));
  return Math.pow((t / s) * factor + 1, decay);
}

function v6NextInterval(w: number[], stability: number, desiredRetention: number): number {
  stability = Math.max(stability, S_MIN);
  desiredRetention = clamp(desiredRetention, 0.0001, 0.9999);
  const decay = -w[20];
  const factor = Math.pow(0.9, 1 / decay) - 1;
  return clamp((stability / factor) * (Math.pow(desiredRetention, 1 / decay) - 1), 0, S_MAX);
}

function v6InitDifficulty(w: number[], rating: number): number {
  return w[4] - Math.exp(w[5] * Math.max(rating - 1, 0)) + 1;
}

function v6NextDifficulty(w: number[], d: number, rating: number): number {
  const deltaD = -w[6] * (rating - 3);
  const newD = d + ((10 - d) / 9) * deltaD;
  return clamp(w[7] * v6InitDifficulty(w, 4) + (1 - w[7]) * newD, D_MIN, D_MAX);
}

function v6StabilityAfterSuccess(w: number[], s: number, r: number, d: number, rating: number) {
  const hardPenalty = rating === 2 ? w[15] : 1;
  const easyBonus = rating === 4 ? w[16] : 1;
  return clamp(
    s *
      (Math.exp(w[8]) *
        (11 - d) *
        Math.pow(s, -w[9]) *
        (Math.exp((1 - r) * w[10]) - 1) *
        hardPenalty *
        easyBonus +
        1),
    S_MIN,
    S_MAX,
  );
}

function v6StabilityAfterFailure(w: number[], s: number, r: number, d: number) {
  const newSMin = s / Math.exp(w[17] * w[18]);
  const newS = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]);
  return clamp(Math.min(newS, newSMin), S_MIN, S_MAX);
}

function v6NextState(w: number[], state: MemoryState, deltaT: number, rating: number): MemoryState {
  rating = clamp(rating, 1, 4);
  deltaT = Math.round(Math.max(deltaT, 0));
  const s = clamp(state.stability, S_MIN, S_MAX);
  const d = clamp(state.difficulty, D_MIN, D_MAX);
  const r = v6ForgettingCurve(w, deltaT, s);
  let stability: number;
  if (deltaT === 0) {
    const sinc = Math.exp(w[17] * (rating - 3 + w[18])) * Math.pow(s, -w[19]);
    stability = clamp(s * (rating >= 2 ? Math.max(sinc, 1) : sinc), S_MIN, S_MAX);
  } else if (rating === 1) {
    stability = v6StabilityAfterFailure(w, s, r, d);
  } else {
    stability = v6StabilityAfterSuccess(w, s, r, d, rating);
  }
  return { stability, difficulty: v6NextDifficulty(w, d, rating), stabilityFast: stability };
}

// ---------------------------------------------------------------- FSRS-7

const DR_MIN = 0.0001;
const DR_MAX = 0.9999;
const MIN_T = 1 / 86_400;

function v7InitDifficulty(w: number[], rating: number): number {
  return w[4] - Math.exp(w[5] * (rating - 1)) + 1;
}

function v7NextDifficulty(w: number[], d: number, rating: number, retention: number): number {
  rating = clamp(rating, 1, 4);
  let deltaD = -w[6] * (rating - 3);
  if (rating === 1) deltaD *= retention + 0.1;
  const newD = d + ((10 - d) * deltaD) / 9;
  return clamp(v7InitDifficulty(w, 4) * 0.01 + newD * 0.99, D_MIN, D_MAX);
}

function v7StabilityForSet(
  w: number[],
  lastS: number,
  lastD: number,
  r: number,
  rating: number,
  start: number,
): number {
  rating = clamp(rating, 1, 4);
  const hardPenalty = rating === 2 ? w[start + 6] : 1;
  const easyBonus = rating === 4 ? w[start + 7] : 1;
  const newSFail = w[start + 3] * (Math.pow(lastS + 1, w[start + 4]) - 1) * Math.exp((1 - r) * w[start + 5]);
  const pls = Math.min(lastS, newSFail);
  const sinc =
    Math.exp(w[start] - 1.5) *
      (11 - lastD) *
      Math.pow(lastS, -w[start + 1]) *
      (Math.exp((1 - r) * w[start + 2]) - 1) *
      hardPenalty *
      easyBonus +
    1;
  const newSSuccess = Math.max(pls, lastS * sinc);
  return clamp(rating > 1 ? newSSuccess : pls, S_MIN, S_MAX);
}

function v7FastComponentRecall(w: number[], t: number, sFast: number): number {
  t = Math.max(t, 0);
  sFast = clamp(sFast, S_MIN, S_MAX);
  const decay1 = -clamp(w[23] * Math.pow(sFast, w[33] - 0.3), 0.01, 0.95);
  const factor1 = Math.exp(Math.min(Math.log(w[25]) / decay1, 60)) - 1;
  return Math.pow(1 + factor1 * (t / sFast), decay1);
}

function v7CurveParts(w: number[], t: number, state: MemoryState) {
  t = Math.max(t, 0);
  const s = Math.max(state.stability, S_MIN);
  const sFast = Math.max(state.stabilityFast, S_MIN);
  const d = clamp(state.difficulty, D_MIN, D_MAX);

  const decay1 = -clamp(w[23] * Math.pow(sFast, w[33] - 0.3), 0.01, 0.95);
  const factor1 = Math.exp(Math.min(Math.log(w[25]) / decay1, 60)) - 1;
  const b1 = 1 + factor1 * (t / sFast);
  const r1 = Math.pow(b1, decay1);
  const dr1dt = (decay1 * Math.pow(b1, decay1 - 1) * factor1) / sFast;

  const decay2 = -clamp(w[24], 0.01, 0.95);
  const factor2 = Math.pow(w[26], 1 / decay2) - 1;
  const dTimescale = Math.exp((d - 5) * (w[32] - 0.3));
  const b2 = 1 + factor2 * dTimescale * (t / s);
  const r2 = Math.pow(b2, decay2);
  const dr2dt = (decay2 * Math.pow(b2, decay2 - 1) * factor2 * dTimescale) / s;

  const weight1 = w[27] * Math.pow(sFast, -w[29]);
  const weight2 = w[28] * Math.pow(s, w[30]) * Math.exp((d - 5) * (w[31] - 0.5));
  return { r1, r2, dr1dt, dr2dt, weight1, weight2 };
}

function v7ForgettingCurve(w: number[], t: number, state: MemoryState): number {
  const { r1, r2, weight1, weight2 } = v7CurveParts(w, t, state);
  const retention = (weight1 * r1 + weight2 * r2) / (weight1 + weight2);
  return retention * (1 - 2e-5) + 1e-5;
}

function v7ForgettingCurveAndDerivative(w: number[], t: number, state: MemoryState): [number, number] {
  const { r1, r2, dr1dt, dr2dt, weight1, weight2 } = v7CurveParts(w, t, state);
  const weightSum = Math.max(weight1 + weight2, 1e-9);
  const retention = (weight1 * r1 + weight2 * r2) / weightSum;
  const derivative = (weight1 * dr1dt + weight2 * dr2dt) / weightSum;
  return [retention * (1 - 2e-5) + 1e-5, derivative * (1 - 2e-5)];
}

function v7NextState(w: number[], state: MemoryState, deltaT: number, rating: number): MemoryState {
  deltaT = Math.max(deltaT, 0);
  rating = clamp(rating, 1, 4);
  const r = v7ForgettingCurve(w, deltaT, state);
  const newSSlow = v7StabilityForSet(w, state.stability, state.difficulty, r, rating, 7);
  const rFast = v7FastComponentRecall(w, deltaT, state.stabilityFast);
  let newSFast = v7StabilityForSet(w, state.stabilityFast, state.difficulty, rFast, rating, 15);
  if (rating === 1) newSFast = Math.min(newSFast, newSSlow * 0.8);
  return {
    stability: newSSlow,
    difficulty: v7NextDifficulty(w, state.difficulty, rating, r),
    stabilityFast: clamp(newSFast, S_MIN, S_MAX),
  };
}

function v7IntervalBisection(w: number[], state: MemoryState, desiredRetention: number): number {
  desiredRetention = clamp(desiredRetention, DR_MIN, DR_MAX);
  if (desiredRetention >= DR_MAX) return 0;
  let low = 0;
  let high = Math.max(state.stability, state.stabilityFast, 1);
  while (v7ForgettingCurve(w, high, state) > desiredRetention && high < S_MAX) {
    high = Math.min(high * 2, S_MAX);
  }
  for (let i = 0; i < 50; i++) {
    const mid = (low + high) * 0.5;
    if (v7ForgettingCurve(w, mid, state) > desiredRetention) low = mid;
    else high = mid;
  }
  return clamp((low + high) * 0.5, 0, S_MAX);
}

function v7NextInterval(w: number[], state: MemoryState, desiredRetention: number): number {
  desiredRetention = clamp(desiredRetention, DR_MIN, DR_MAX);
  if (desiredRetention >= DR_MAX) return 0;
  state = {
    stability: clamp(state.stability, S_MIN, S_MAX),
    difficulty: clamp(state.difficulty, D_MIN, D_MAX),
    stabilityFast: clamp(state.stabilityFast, S_MIN, S_MAX),
  };
  // Newton's method in log-time, falling back to bisection.
  const minLogT = Math.log(MIN_T);
  const maxLogT = Math.log(S_MAX);
  let logT = Math.log(Math.max(state.stability, state.stabilityFast, MIN_T));
  for (let i = 0; i < 7; i++) {
    logT = clamp(logT, minLogT, maxLogT);
    const t = clamp(Math.exp(logT), MIN_T, S_MAX);
    const [r, deriv] = v7ForgettingCurveAndDerivative(w, t, state);
    const dfdu = Math.min(deriv * t, -1e-12);
    logT -= clamp((r - desiredRetention) / dfdu, -4, 4);
    if (!Number.isFinite(logT)) return v7IntervalBisection(w, state, desiredRetention);
  }
  const interval = clamp(Math.exp(logT), 0, S_MAX);
  const r = v7ForgettingCurve(w, interval, state);
  return Number.isFinite(r) && Math.abs(r - desiredRetention) <= 1e-3
    ? interval
    : v7IntervalBisection(w, state, desiredRetention);
}

// ---------------------------------------------------------------- model

export class FSRS {
  readonly params: number[];
  readonly version: ModelVersion;

  /** `numRelearningSteps` only affects FSRS-6 parameter clipping. */
  constructor(params: number[] = [], numRelearningSteps = 1) {
    const p = checkAndFillParameters(params);
    this.version = p.length === 34 ? 'fsrs7' : 'fsrs6';
    if (this.version === 'fsrs7') clipFsrs7(p);
    else clipFsrs6(p, numRelearningSteps, true);
    this.params = p;
  }

  initStability(rating: Rating): number {
    return this.params[Math.min(rating - 1, 3)];
  }

  initDifficulty(rating: Rating): number {
    return this.version === 'fsrs7'
      ? v7InitDifficulty(this.params, rating)
      : v6InitDifficulty(this.params, rating);
  }

  /** One review step. `state` null means the card has never been reviewed. */
  step(state: MemoryState | null, daysElapsed: number, rating: Rating): MemoryState {
    if (!state) {
      const stability = clamp(this.initStability(rating), S_MIN, S_MAX);
      return {
        stability,
        difficulty: clamp(this.initDifficulty(rating), D_MIN, D_MAX),
        stabilityFast: this.version === 'fsrs7' ? clamp(stability * 0.8, S_MIN, S_MAX) : stability,
      };
    }
    const last: MemoryState = {
      stability: clamp(state.stability, S_MIN, S_MAX),
      difficulty: clamp(state.difficulty, D_MIN, D_MAX),
      stabilityFast: clamp(state.stabilityFast, S_MIN, S_MAX),
    };
    return this.version === 'fsrs7'
      ? v7NextState(this.params, last, daysElapsed, rating)
      : v6NextState(this.params, last, daysElapsed, rating);
  }

  nextInterval(state: MemoryState, desiredRetention: number): number {
    return this.version === 'fsrs7'
      ? v7NextInterval(this.params, state, desiredRetention)
      : v6NextInterval(this.params, state.stability, desiredRetention);
  }

  retrievability(state: MemoryState, daysElapsed: number): number {
    const t = Math.max(daysElapsed, 0);
    return this.version === 'fsrs7'
      ? v7ForgettingCurve(this.params, t, state)
      : v6ForgettingCurve(this.params, t, state.stability);
  }

  nextStates(state: MemoryState | null, desiredRetention: number, daysElapsed: number): NextStates {
    const item = (rating: Rating): ItemState => {
      const memory = this.step(state, daysElapsed, rating);
      if (!Number.isFinite(memory.stability) || !Number.isFinite(memory.difficulty)) {
        throw new Error('FSRS produced an invalid memory state');
      }
      return { memory, interval: this.nextInterval(memory, desiredRetention) };
    };
    return { again: item(1), hard: item(2), good: item(3), easy: item(4) };
  }

  /** Estimates a memory state from SM-2 scheduling (ease factor like 2.5,
   * interval in days), as Anki does for cards without a usable history. */
  memoryStateFromSm2(easeFactor: number, interval: number, sm2Retention = 0.9): MemoryState | null {
    const w = this.params;
    if (this.version === 'fsrs6') {
      const decay = -w[20];
      const factor = Math.pow(0.9, 1 / decay) - 1;
      const stability = (Math.max(interval, S_MIN) * factor) / (Math.pow(sm2Retention, 1 / decay) - 1);
      const difficulty =
        11 - (easeFactor - 1) / (Math.exp(w[8]) * Math.pow(stability, -w[9]) * Math.expm1((1 - sm2Retention) * w[10]));
      if (!Number.isFinite(stability) || !Number.isFinite(difficulty)) return null;
      return { stability, difficulty: clamp(difficulty, D_MIN, D_MAX), stabilityFast: stability };
    }
    // FSRS-7: bisect log-stability so recall at `interval` equals sm2Retention.
    if (!Number.isFinite(interval) || !(sm2Retention >= 0 && sm2Retention < 1)) return null;
    const t = clamp(Math.max(interval, S_MIN), S_MIN, S_MAX);
    const stateAt = (logS: number): MemoryState => {
      const stability = clamp(Math.exp(logS), S_MIN, S_MAX);
      return { stability, difficulty: 5, stabilityFast: clamp(stability * 0.8, S_MIN, S_MAX) };
    };
    let low = Math.log(S_MIN);
    let high = Math.log(S_MAX);
    if (sm2Retention <= v7ForgettingCurve(w, t, stateAt(low))) return stateAt(low);
    if (sm2Retention >= v7ForgettingCurve(w, t, stateAt(high))) return stateAt(high);
    for (let i = 0; i < 50; i++) {
      const mid = (low + high) * 0.5;
      const r = v7ForgettingCurve(w, t, stateAt(mid));
      if (Math.abs(r - sm2Retention) <= 1e-6) return stateAt(mid);
      if (r < sm2Retention) low = mid;
      else high = mid;
    }
    return stateAt((low + high) * 0.5);
  }

  /** Replays a card's history to rebuild its memory state. */
  memoryStateFromHistory(reviews: { rating: Rating; daysElapsed: number }[]): MemoryState | null {
    let state: MemoryState | null = null;
    for (const r of reviews) state = this.step(state, r.daysElapsed, r.rating);
    return state;
  }
}
