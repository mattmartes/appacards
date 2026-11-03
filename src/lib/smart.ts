// Smart cards: notes whose cards show new values every time. An AI writes a
// small generator once; the app runs it (in smart.worker.ts) whenever a card
// is shown, so reviews need no AI and no network. Each case of a note is its
// own card with its own FSRS schedule: within a card only the surface
// changes, across cards the skill does.

import { askModel, cleanHtml, type ModelOptions } from './polish';
import type { SmartRun, SmartWorkerRequest, CaseCheck, TestCheck } from './smart.worker';
import { MAX_WORDINGS, type SmartCase, type SmartSpec, type SmartVar } from './types';

export type { SmartRun, CaseCheck, TestCheck };

// ---------------------------------------------------------------- running

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./smart.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    clearTimeout(p.timer);
    if (e.data.ok) p.resolve(e.data.result);
    else p.reject(new Error(e.data.error));
  };
  worker.onerror = (e) => {
    e.preventDefault();
    restart(new Error(e.message || 'The generator crashed.'));
  };
  return worker;
}

/** Stops a stuck or crashed worker; everything waiting on it fails. */
function restart(error: Error) {
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(error);
  }
  pending.clear();
}

type Request = SmartWorkerRequest extends infer R ? (R extends unknown ? Omit<R, 'id'> : never) : never;

function call<T>(req: Request, timeoutMs: number): Promise<T> {
  const id = nextId++;
  const w = getWorker();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => restart(new Error('The generator took too long (is there an endless loop?).')), timeoutMs);
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    w.postMessage({ ...req, id });
  });
}

/** One version of a case, from a seed. */
export function runCase(spec: SmartSpec, caseIndex: number, seed: number): Promise<SmartRun> {
  return call<SmartRun>({ type: 'run', code: spec.code, params: spec.cases[caseIndex]?.params ?? {}, seed }, 3000);
}

// ---------------------------------------------------------------- templates

const PLACEHOLDER = /\[([A-Za-z_][A-Za-z0-9_]*)\]/g;

/** The [names] used in a template. */
export function placeholders(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

/** Fills [name] placeholders. Values may be HTML (tables, gels); scripts and
 * event handlers are removed. Brackets that aren't placeholders stay. */
export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (whole, name: string) => (name in vars ? cleanHtml(vars[name]) : whole));
}

export interface SmartFace {
  front: string;
  /** the answer side, without the question */
  back: string;
}

/** A shown version of a card: templates filled, plus worked steps and common mistakes. */
export function renderRun(c: SmartCase, run: SmartRun): SmartFace {
  const steps = run.steps ? `<details class="smart-steps"><summary>How to get there</summary>${cleanHtml(run.steps)}</details>` : '';
  const traps = run.traps.length
    ? `<div class="smart-traps"><b>Common mistakes</b><ul>${run.traps.map((t) => `<li>${cleanHtml(t)}</li>`).join('')}</ul></div>`
    : '';
  return { front: fill(c.front, run.vars), back: fill(c.back, run.vars) + steps + traps };
}

// ---------------------------------------------------------------- checking

export interface SmartCheck {
  /** problems that block saving */
  errors: string[];
  /** worth a look, but allowed */
  warnings: string[];
  cases: CaseCheck[];
  tests: TestCheck[];
  /** per case: placeholders its templates must include but don't */
  missing: { front: string[]; back: string[]; alts: string[][] }[];
}

/** Runs every case on many seeds and the hand-worked tests, and checks each
 * card's wording uses its placeholders: inputs on the front, answers on the back. */
export async function checkSpec(spec: SmartSpec): Promise<SmartCheck> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!spec.cases.length) errors.push('There are no cards. Add at least one case.');
  let cases: CaseCheck[] = [];
  let tests: TestCheck[] = [];
  try {
    const r = await call<{ cases: CaseCheck[]; tests: TestCheck[] }>(
      { type: 'check', code: spec.code, cases: spec.cases.map((c) => c.params), tests: spec.tests, seedsPerCase: 60 },
      15000,
    );
    cases = r.cases;
    tests = r.tests;
  } catch (e) {
    errors.push(`The generator doesn't run: ${(e as Error).message}`);
  }

  const declared = new Map(spec.vars.map((v) => [v.name, v]));
  const missing = spec.cases.map((c, i) => {
    const produced = new Set(cases[i]?.keys ?? []);
    const vars = spec.vars.filter((v) => produced.has(v.name));
    const inFront = new Set(placeholders(c.front));
    const inBack = new Set(placeholders(c.back));
    const alts = c.altFronts ?? [];
    const label = `“${c.name || `Card ${i + 1}`}”`;
    for (const name of [...inFront, ...inBack, ...alts.flatMap(placeholders)]) {
      if (!declared.has(name)) errors.push(`${label} uses [${name}], which isn't one of the placeholders.`);
      else if (cases[i] && !produced.has(name)) errors.push(`${label} uses [${name}], but the generator doesn't fill it for this card.`);
    }
    const check = cases[i];
    if (check) {
      check.errors.forEach((e) => errors.push(`${label}: ${e}`));
      if (check.runs && check.distinct < 2) warnings.push(`${label} came out the same every time; it may not be varying anything.`);
    }
    return {
      front: vars.filter((v) => v.role === 'input' && !inFront.has(v.name)).map((v) => v.name),
      back: vars.filter((v) => v.role === 'answer' && !inBack.has(v.name) && !inFront.has(v.name)).map((v) => v.name),
      // every wording must show the same inputs as the front
      alts: alts.map((a) => {
        const has = new Set(placeholders(a));
        return vars.filter((v) => v.role === 'input' && !has.has(v.name)).map((v) => v.name);
      }),
    };
  });
  missing.forEach((m, i) => {
    const label = `“${spec.cases[i].name || `Card ${i + 1}`}”`;
    if (m.front.length) errors.push(`${label}: the front must include ${m.front.map((n) => `[${n}]`).join(', ')}.`);
    if (m.back.length) errors.push(`${label}: the back must include ${m.back.map((n) => `[${n}]`).join(', ')}.`);
    m.alts.forEach((a, j) => {
      if (a.length) errors.push(`${label}: wording ${j + 1} must include ${a.map((n) => `[${n}]`).join(', ')}.`);
    });
  });
  tests.forEach((t, i) => {
    if (!t.pass) errors.push(`Worked example ${i + 1} fails${t.error ? `: ${t.error}` : ''}. The generator may compute wrong answers.`);
  });
  if (!spec.tests.length) warnings.push('There are no worked examples to check the answers against.');
  return { errors, warnings, cases, tests, missing };
}

// ---------------------------------------------------------------- AI

const SYSTEM_PROMPT = `You design "smart cards" for a spaced-repetition flashcard app. A smart card's values change every time it is shown, so the student practises a skill instead of memorizing one example. You write a small JavaScript generator once; the app runs it on every review.

THE MOST IMPORTANT RULE: one card = one skill.
- Within a card, the random values change only the surface: names, organisms, letters, colours, numbers, sequences.
- If the reasoning changes (het x het vs. testcross, recessive vs. dominant epistasis, forward vs. reverse primer), that is a separate CASE, and each case becomes its own card with its own review schedule. Split the request into as many cases as there are distinct skills. If a student gets a card wrong, it should be clear which skill failed.
- A value may deliberately change something the student must notice when noticing it IS the skill (e.g. which phage genotypes are parental).

Write the JavaScript (plain ES2020, no imports) defining exactly two functions:
  function sample(r, params, lib) { ... return { a: ..., b: ..., ...raw values solve needs }; }
  function solve(inputs, params, lib) { ... return { vars: { c: ... }, steps: "<p>...</p>", traps: ["...", ...] }; }
- params is the case's "params" object, telling you which case/skill this card is.
- sample picks random inputs using only r (never Math.random): r.float(), r.int(min, max), r.pick(array), r.shuffle(array), r.sample(array, k), r.bool(p), r.multinomial(n, weights).
- solve computes the answers from the inputs. COMPUTE answers (with lib or your own code); do not look them up from a table keyed by the random values. solve must work on the hand-worked test inputs you provide.
- steps: a short worked solution (HTML) shown on the back. traps: common wrong answers and why they're wrong, computed for these values where possible (e.g. "TCGAA is the complement read 3'->5'").
- Values may be numbers, strings or HTML (tables, gels, sequences). Never use the DOM, fetch, timers or globals.

lib helpers:
- lib.cross(p1, p2): offspring of a cross with independent assortment. Genotypes as "Aa Bb", "b+/b; c+/c" or [["A","a"],["B","b"]]. Returns [{ genes: [["A","a"], ...], count }] with counts out of 4^n.
- lib.phenotypes(offspring, genes => "label" or null for lethal): { label: count }. lib.has(gene, allele), lib.homozygous(gene, allele).
- lib.describeRatio({black: 9, brown: 3, yellow: 4}) -> "9 black : 3 brown : 4 yellow" (largest first, lowest terms). lib.ratioOf(counts) -> "9:3:4". lib.ratio([18, 6, 8]) -> "9:3:4". lib.fraction(6, 8) -> "3/4". lib.percent(0.153) -> "15.3%". lib.gcd(a, b).
- lib.genotypeText(genes) -> "A/a; B/b".
- lib.complement("ATGC") -> "TACG" (same direction). lib.reverseComplement("ATGC") -> "GCAT". lib.randomSeq(r, length, gcFraction). lib.isPurine(b). lib.mutationType(from, to) -> "transition" | "transversion". lib.codons(seq, frame). lib.gcContent(seq).
- Display: lib.mono(text), lib.strand(seq) -> 5'-...-3', lib.duplex(top) -> both strands with labelled ends, lib.table(headerArray, rowsArray), lib.gel([{ label, bands: [sizes] }], { scale: "log" }) -> SVG agarose gel, lib.sangerGel(synthesizedStrand) -> four-lane ddNTP gel SVG, lib.esc(text).

Card templates use [name] placeholders for values. Every placeholder is declared in "vars" with a legend label and a role: "input" (shown on the front) or "answer" (computed, shown on the back). Each card's front must contain all input placeholders that case fills, and its back all answer placeholders. A case may fill only some of the vars.

Give each case up to 4 "altFronts": other wordings of its front that ask exactly the same thing with the same placeholders, varied in sentence structure and vocabulary so the card can't be recognized by its shape. One wording is picked at random each review.

Also give 2-4 hand-worked tests: inputs (including any raw values solve needs) and the expected answers, worked out by you independently of the code. Expected answers are compared ignoring case, spacing and HTML tags.

Reply in exactly this format: a <spec> block of JSON (without the code), then a <code> block of plain JavaScript. Nothing else.
<spec>
{"title":"...","description":"one sentence on what this practises",
 "vars":[{"name":"a","label":"what [a] is","role":"input"},{"name":"c","label":"...","role":"answer"}],
 "cases":[{"name":"skill this card tests","params":{"type":"..."},"front":"... [a] ... [b] ...","altFronts":["another way to ask it with [a] and [b]", "..."],"back":"[c]"}],
 "tests":[{"case":0,"inputs":{...},"expected":{"c":"..."}}]}
</spec>
<code>
function sample(r, params, lib) { ... }
function solve(inputs, params, lib) { ... }
</code>
Keep the code compact. Use short lowercase placeholder names. Fronts are questions a student can answer on paper in under two minutes.`;

/** Asks the model for a new smart note, or changes to one. */
export async function designWithAi(
  key: string,
  model: ModelOptions,
  request: { prompt: string; notes?: string; current?: SmartSpec; feedback?: string },
  signal: AbortSignal,
): Promise<SmartSpec> {
  const parts = [`What the student wants to practise:\n${request.prompt}`];
  if (request.notes?.trim()) parts.push(`Their course notes (use their terms and notation):\n${request.notes.trim().slice(0, 40_000)}`);
  if (request.current) {
    const { reports, ...current } = request.current;
    parts.push(`The current smart note (keep what works; return the complete updated note):\n${JSON.stringify(current)}`);
    if (reports?.length) {
      parts.push(
        `Answers the student reported as wrong (counterexamples; fix the generator so these come out right):\n${JSON.stringify(
          reports.map((r) => ({ case: r.case, values: r.vars, comment: r.comment })),
        )}`,
      );
    }
  }
  if (request.feedback?.trim()) parts.push(`Changes the student asked for:\n${request.feedback.trim()}`);
  // The reply isn't one JSON object (the code is in its own block), so no JSON mode.
  const options = { ...model, jsonMode: false };
  const request0 = parts.join('\n\n');
  let user = request0;
  for (let attempt = 0; ; attempt++) {
    const reply = await askModel(key, options, user, signal, SYSTEM_PROMPT, DESIGN_REPLY_TOKENS);
    try {
      if (reply.truncated) throw new SpecFormatError('cut off');
      return toSpec(reply.text, request.prompt);
    } catch (e) {
      if (!(e instanceof SpecFormatError)) throw e;
      console.warn("Couldn't read the smart card reply:", e.message, reply.text);
      if (attempt >= 1) {
        throw new Error(
          e.message === 'cut off'
            ? "The model's reply was cut off twice. Ask for fewer cards at once, or pick a model with longer replies in Preferences → AI."
            : `The model's reply wasn't in the expected format twice (${e.message}). Try again, or another model in Preferences → AI.`,
        );
      }
      // once more, telling the model what went wrong
      user = `${request0}\n\nYour previous reply ${
        e.message === 'cut off' ? 'was too long and got cut off; keep the code and wording more compact' : `couldn't be read (${e.message})`
      }. Reply again in exactly the <spec> and <code> format.`;
    }
  }
}

/** Room for the reply, including a thinking model's reasoning. */
const DESIGN_REPLY_TOKENS = 32000;

/** A reply that isn't a readable smart note; worth asking again. */
class SpecFormatError extends Error {}

/** The text of a reply's <tag>...</tag> block (to the end if unclosed), without code fences. */
export function block(text: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)(?:</${tag}>|$)`, 'i').exec(text);
  if (!m) return null;
  return m[1]
    .replace(/^\s*```[a-z]*[ \t]*\n?/i, '')
    .replace(/\n?\s*```\s*$/, '')
    .trim();
}

/** Escapes raw newlines and tabs inside JSON strings and drops trailing
 * commas: the usual ways a model's JSON goes wrong. */
export function repairJson(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      else if (ch === '\n') {
        out += '\\n';
        continue;
      } else if (ch === '\r') continue;
      else if (ch === '\t') {
        out += '\\t';
        continue;
      }
    } else if (ch === '"') inString = true;
    out += ch;
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}

function parseObject(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new SpecFormatError('no JSON found');
  const json = text.slice(start, end + 1);
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    try {
      return JSON.parse(repairJson(json)) as Record<string, unknown>;
    } catch (e) {
      throw new SpecFormatError(`invalid JSON: ${(e as Error).message}`);
    }
  }
}

/** A reply's <spec> JSON and <code> block, checked into a SmartSpec. A
 * reply with the code inside the JSON instead is read too. */
export function toSpec(text: string, prompt: string): SmartSpec {
  const specText = block(text, 'spec');
  const codeText = block(text, 'code');
  const raw = parseObject(specText ?? text.replace(/```(?:json)?/gi, ''));
  if (codeText) raw.code = codeText;
  const vars = (Array.isArray(raw.vars) ? raw.vars : []).map(
    (v: Record<string, unknown>): SmartVar => ({
      name: String(v.name ?? '').replace(/[^A-Za-z0-9_]/g, ''),
      label: String(v.label ?? ''),
      role: v.role === 'answer' ? 'answer' : 'input',
    }),
  );
  const cases = (Array.isArray(raw.cases) ? raw.cases : []).map(
    (c: Record<string, unknown>): SmartCase => ({
      name: String(c.name ?? ''),
      params: c.params && typeof c.params === 'object' ? (c.params as Record<string, unknown>) : {},
      front: String(c.front ?? ''),
      back: String(c.back ?? ''),
      altFronts: Array.isArray(c.altFronts) ? c.altFronts.map(String).filter((x) => x.trim()).slice(0, MAX_WORDINGS) : undefined,
    }),
  );
  const tests = (Array.isArray(raw.tests) ? raw.tests : []).map((t: Record<string, unknown>) => ({
    case: Number(t.case ?? 0) || 0,
    inputs: (t.inputs ?? {}) as Record<string, unknown>,
    expected: Object.fromEntries(Object.entries((t.expected ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)])),
  }));
  if (typeof raw.code !== 'string' || !/function\s+sample/.test(raw.code) || !/function\s+solve/.test(raw.code)) {
    throw new SpecFormatError('no sample and solve functions');
  }
  if (!vars.length || !cases.length) throw new SpecFormatError('no placeholders or cards');
  return { title: String(raw.title ?? 'Smart card'), description: String(raw.description ?? ''), vars, cases, code: raw.code, tests, prompt };
}
