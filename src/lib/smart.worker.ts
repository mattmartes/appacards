// Runs smart card generators (AI-written code) away from the page: a worker
// has no DOM, and the network and storage APIs are removed before any
// generator code runs. The page stops a worker that takes too long.

import { lib, makeRng } from './smartLib';

for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker']) {
  try {
    Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false });
  } catch {
    // already gone
  }
}

type Params = Record<string, unknown>;
type Inputs = Record<string, unknown>;

interface Generator {
  sample: (r: ReturnType<typeof makeRng>, params: Params, l: typeof lib) => Inputs;
  solve: (inputs: Inputs, params: Params, l: typeof lib) => unknown;
}

export type SmartWorkerRequest =
  | { id: number; type: 'run'; code: string; params: Params; seed: number }
  | {
      id: number;
      type: 'check';
      code: string;
      cases: Params[];
      tests: { case: number; inputs: Inputs; expected: Record<string, string> }[];
      seedsPerCase: number;
    };

export interface SmartRun {
  /** every value as display text, inputs and answers */
  vars: Record<string, string>;
  steps: string;
  traps: string[];
}

export interface CaseCheck {
  /** placeholders the generator filled for this case */
  keys: string[];
  runs: number;
  /** how many different versions came out */
  distinct: number;
  errors: string[];
}

export interface TestCheck {
  case: number;
  pass: boolean;
  got: Record<string, string>;
  error?: string;
}

const compiled = new Map<string, Generator>();

function compile(code: string): Generator {
  let g = compiled.get(code);
  if (!g) {
    const make = new Function(
      `"use strict";\n${code}\n;return { sample: typeof sample === 'function' ? sample : null, solve: typeof solve === 'function' ? solve : null };`,
    ) as () => Partial<Generator>;
    const made = make();
    if (!made.sample) throw new Error('The code needs a function sample(r, params, lib).');
    if (!made.solve) throw new Error('The code needs a function solve(inputs, params, lib).');
    g = made as Generator;
    compiled.set(code, g);
    if (compiled.size > 50) compiled.delete(compiled.keys().next().value!);
  }
  return g;
}

function toText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(toText).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** solve() may return { vars: {...}, steps, traps } or the answers directly. */
function readSolve(out: unknown): { answers: Record<string, unknown>; steps: string; traps: string[] } {
  if (!out || typeof out !== 'object') throw new Error('solve() must return an object of answers.');
  const o = out as Record<string, unknown>;
  const answers =
    o.vars && typeof o.vars === 'object'
      ? (o.vars as Record<string, unknown>)
      : Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'steps' && k !== 'traps'));
  return { answers, steps: o.steps ? String(o.steps) : '', traps: Array.isArray(o.traps) ? o.traps.map(String) : [] };
}

function run(g: Generator, params: Params, seed: number): SmartRun {
  const inputs = g.sample(makeRng(seed), params, lib);
  if (!inputs || typeof inputs !== 'object') throw new Error('sample() must return an object of inputs.');
  const { answers, steps, traps } = readSolve(g.solve({ ...inputs }, params, lib));
  const vars = Object.fromEntries(Object.entries({ ...inputs, ...answers }).map(([k, v]) => [k, toText(v)]));
  return { vars, steps, traps };
}

/** Compares answers loosely: tags, spacing, case and prime marks don't matter. */
const loose = (s: string) =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/[′’']/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

self.onmessage = (e: MessageEvent<SmartWorkerRequest>) => {
  const req = e.data;
  try {
    const g = compile(req.code);
    if (req.type === 'run') {
      self.postMessage({ id: req.id, ok: true, result: run(g, req.params, req.seed) });
      return;
    }
    const cases: CaseCheck[] = req.cases.map((params, i) => {
      const keys = new Set<string>();
      const seen = new Set<string>();
      const errors = new Set<string>();
      let runs = 0;
      for (let k = 0; k < req.seedsPerCase; k++) {
        try {
          const r = run(g, params, 1000 * (i + 1) + k * 7919);
          runs++;
          for (const [key, v] of Object.entries(r.vars)) {
            keys.add(key);
            if (v === '' || /\bundefined\b|\bNaN\b|\[object Object\]/.test(v)) errors.add(`[${key}] came out as “${v || 'empty'}”.`);
          }
          seen.add(JSON.stringify(r.vars));
        } catch (err) {
          errors.add(err instanceof Error ? err.message : String(err));
        }
      }
      return { keys: [...keys], runs, distinct: seen.size, errors: [...errors].slice(0, 5) };
    });
    const tests: TestCheck[] = req.tests.map((t) => {
      try {
        const { answers } = readSolve(g.solve({ ...t.inputs }, req.cases[t.case] ?? {}, lib));
        const got = Object.fromEntries(Object.keys(t.expected).map((k) => [k, toText(answers[k])]));
        const pass = Object.entries(t.expected).every(([k, v]) => loose(got[k] ?? '') === loose(String(v)));
        return { case: t.case, pass, got };
      } catch (err) {
        return { case: t.case, pass: false, got: {}, error: err instanceof Error ? err.message : String(err) };
      }
    });
    self.postMessage({ id: req.id, ok: true, result: { cases, tests } });
  } catch (err) {
    self.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
