// The Learn tab's AI teacher: orders uploaded material into a teaching plan,
// teaches it in short chunks with a question after each, adapts to the
// student's answers, and unlocks flashcards for what the student has shown
// they understand.

import { askModel, type ModelOptions } from './polish';
import { block, repairJson } from './smart';
import type { Lesson, LessonCard, LessonMessage, PlanItem } from './types';

/** characters of material sent when planning (whole lesson) and per teaching turn */
const PLAN_MATERIAL_CHARS = 180_000;
const TURN_MATERIAL_CHARS = 14_000;
/** earlier messages the teacher sees each turn */
const HISTORY = 14;

let seq = 0;
export const learnId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(++seq).toString(36)}`;

// ---------------------------------------------------------------- planning

const PLAN_PROMPT = `You are an expert university teacher planning how to teach a student some course material (lecture slides, notes, readings). Sections are tagged with refs like [M1.3] (material 1, slide or page 3).

Make a teaching plan: an ordered list of concepts that, taught in order, gets the student to understand ALL of the material.
- Order for learning, not necessarily the material's order: prerequisites and definitions before what builds on them, simple before complex, related ideas together, worked examples right after the idea they illustrate. Keep the material's order where it already works.
- Each concept is one small, teachable unit: something you could explain in under 150 words and check with one or two questions. Split big slides; merge tiny related ones.
- Cover every substantive idea, example, method and practice question in the material. Leave out admin (office hours, resources, schedules, title slides).
- Sections with no text are probably images or diagrams; use their titles and surroundings, and don't invent their content.
- "refs" lists the sections each concept draws on.

Reply in exactly this format, nothing else:
<note>2-4 sentences for the student: how you ordered the material and why, naming any big moves (e.g. "I moved the definition of X before Y because ...")</note>
<plan>[{"title":"short name","summary":"one sentence: what the student will understand or be able to do","refs":["M1.3","M1.4"]}]</plan>`;

/** The material as text for the model, within a character budget. */
function materialText(lesson: Lesson, refs: Set<string> | null, budget: number): string {
  const out: string[] = [];
  let size = 0;
  for (const src of lesson.sources) {
    const sections = src.sections.filter((s) => !refs || refs.has(s.ref));
    if (!sections.length) continue;
    out.push(`## ${src.id}: ${src.name}`);
    for (const s of sections) {
      const body = s.text.length >= 20 ? s.text.slice(0, 4000) : '(no text: probably an image or diagram)';
      const piece = `[${s.ref}] ${s.title}\n${body}`;
      if (size + piece.length > budget) {
        out.push(`(material cut off here: ${budget.toLocaleString()} characters is the limit)`);
        return out.join('\n\n');
      }
      size += piece.length;
      out.push(piece);
    }
  }
  return out.join('\n\n');
}

function parseJson<T>(text: string | null, what: string): T {
  if (!text) throw new Error(`The model's reply had no ${what}. Try again.`);
  const start = text.search(/[[{]/);
  const json = text.slice(start, Math.max(text.lastIndexOf(']'), text.lastIndexOf('}')) + 1);
  try {
    return JSON.parse(json) as T;
  } catch {
    try {
      return JSON.parse(repairJson(json)) as T;
    } catch {
      throw new Error(`The model's ${what} wasn't readable. Try again.`);
    }
  }
}

export async function planLesson(key: string, model: ModelOptions, lesson: Lesson, signal: AbortSignal): Promise<{ plan: PlanItem[]; note: string }> {
  const user = `Lesson: ${lesson.title}\n\n${materialText(lesson, null, PLAN_MATERIAL_CHARS)}`;
  const reply = await askModel(key, { ...model, jsonMode: false }, user, signal, PLAN_PROMPT, 32000);
  if (reply.truncated) throw new Error("The plan was cut off. Try again, or split the material into smaller lessons.");
  const raw = parseJson<{ title?: string; summary?: string; refs?: unknown }[]>(block(reply.text, 'plan'), 'teaching plan');
  if (!Array.isArray(raw) || !raw.length) throw new Error('The model returned an empty plan. Try again.');
  const known = new Set(lesson.sources.flatMap((s) => s.sections.map((x) => x.ref)));
  const plan: PlanItem[] = raw.map((r) => ({
    id: learnId('p'),
    title: String(r.title ?? 'Concept'),
    summary: String(r.summary ?? ''),
    refs: (Array.isArray(r.refs) ? r.refs.map(String) : []).filter((x) => known.has(x)),
    status: 'todo',
  }));
  return { plan, note: block(reply.text, 'note') ?? '' };
}

// ---------------------------------------------------------------- teaching

/** What the student did this turn. */
export type TurnKind = 'start' | 'answer' | 'confused' | 'skip' | 'next';

const TURN_ACTIONS: Record<TurnKind, string> = {
  start: 'The lesson is starting: introduce the first concept.',
  answer: 'The student replied (an answer to your question, or a question of their own). Respond to it.',
  confused: "The student pressed \"I don't get it\". Explain the current concept again a different way (simpler, an analogy or a concrete example), then ask an easier question.",
  skip: 'The student says they already know this concept. Ask one quick question that checks it; if they answer it well next turn, move on.',
  next: 'The student asked to move on to the next concept now. Set advance to true and teach the next concept (understood stays null unless they showed it).',
};

const TEACH_PROMPT = `You are a patient, rigorous tutor teaching a university student their course material, one concept at a time, following a teaching plan. The goal is that the student truly understands every concept in the plan.

Each turn:
- Teach in SHORT chunks: one idea, at most about 150 words, plain language, using the course's own terms, notation and examples. Use Markdown (bold, lists, simple tables) sparingly.
- End with exactly ONE question that checks understanding: make the student explain, apply, predict or compare, not just repeat a definition or answer yes/no. Vary the question types.
- When the student answers, judge it honestly:
  - Correct and shows understanding (not a lucky guess): say briefly what was right, set "understood": true. If the concept has another important part, teach that next; otherwise set "advance": true.
  - Partly right or wrong: don't just give the answer. Point to the specific gap or misconception, explain it a different way, and ask a NEW question about the same concept. Set "understood": false.
  - If they're missing a prerequisite, add it to "insert_before" and teach it now.
- If the student asks their own question, answer it, then return to your question.
- When "advance" is true, briefly wrap up, then start teaching the NEXT concept (given below) in the same reply and ask about it.
- When the last concept is understood, set "done": true and give a short recap of everything covered.
- Stay faithful to the course material. Don't invent facts about diagrams you can't see.

Flashcards: when "understood" is true, unlock 0-3 flashcards for the knowledge the student just demonstrated, one fact or skill each. They must be concise: the front a clear question of about 15 words or fewer, the back at most about 8 words, unless the student's flashcard preferences say otherwise; their preferences always win. Never duplicate an existing card. Unlock none if the exchange showed nothing card-worthy.

Reply in exactly this format, nothing else:
<teach>your explanation or feedback, in Markdown</teach>
<question>your one question</question>
<control>{"understood": true|false|null, "advance": false, "done": false, "insert_before": [{"title":"...","summary":"..."}], "cards": [{"front":"...","back":"..."}]}</control>
"understood" is null when the student hasn't answered a question this turn.`;

export interface TurnResult {
  teach: string;
  question: string;
  understood: boolean | null;
  advance: boolean;
  done: boolean;
  insert: { title: string; summary: string }[];
  cards: { front: string; back: string }[];
}

/** The plan item being taught: the active one, else the first not yet done. */
export function currentIndex(lesson: Lesson): number {
  const active = lesson.plan.findIndex((p) => p.status === 'active');
  return active >= 0 ? active : lesson.plan.findIndex((p) => p.status === 'todo');
}

function nextIndex(lesson: Lesson, after: number): number {
  return lesson.plan.findIndex((p, i) => i > after && p.status === 'todo');
}

/** What's arrived so far of a <tag> block, without a half-received closing tag. */
function partialBlock(text: string, tag: string): string {
  const open = text.indexOf(`<${tag}>`);
  if (open < 0) return '';
  const rest = text.slice(open + tag.length + 2);
  const close = rest.indexOf(`</${tag}>`);
  return (close >= 0 ? rest.slice(0, close) : rest.replace(/<\/?[a-z]*$/i, '')).trimStart();
}

export interface TurnPartial {
  teach: string;
  question: string;
}

export async function teachTurn(
  key: string,
  model: ModelOptions,
  lesson: Lesson,
  kind: TurnKind,
  signal: AbortSignal,
  /** the reply as it streams in */
  onPartial?: (p: TurnPartial) => void,
): Promise<TurnResult> {
  const cur = currentIndex(lesson);
  const item = lesson.plan[cur];
  const next = lesson.plan[nextIndex(lesson, cur)];
  const outline = lesson.plan
    .map((p, i) => `${i + 1}. [${p.status}] ${p.title}: ${p.summary}${i === cur ? '   <-- CURRENT' : ''}`)
    .join('\n');
  const history = lesson.messages.slice(-HISTORY).map((m) =>
    m.role === 'teacher' ? `TUTOR: ${m.text.slice(0, 1500)}${m.question ? `\nQUESTION: ${m.question}` : ''}` : `STUDENT: ${m.text.slice(0, 1500)}`,
  );
  const existing = lesson.cards.filter((c) => c.status !== 'rejected').map((c) => `- ${c.front}`);
  const parts = [
    `Lesson: ${lesson.title}`,
    `Teaching plan:\n${outline}`,
    item ? `Current concept: ${item.title}\n${item.summary}\n\nIts material:\n${materialText(lesson, new Set(item.refs), TURN_MATERIAL_CHARS) || '(no specific sections)'}` : 'Every concept is done.',
    next ? `Next concept (teach it if you advance): ${next.title}\n${next.summary}\n\nIts material:\n${materialText(lesson, new Set(next.refs), TURN_MATERIAL_CHARS / 2)}` : 'This is the last concept.',
    `Student's flashcard preferences (follow them): ${lesson.cardStyle.length ? lesson.cardStyle.map((s) => `\n- ${s}`).join('') : 'none yet'}`,
    `Existing flashcards (don't duplicate):\n${existing.slice(-60).join('\n') || '(none)'}`,
    `Conversation so far:\n${history.join('\n\n') || '(none)'}`,
    `This turn: ${TURN_ACTIONS[kind]}`,
  ];
  const reply = await askModel(
    key,
    { ...model, jsonMode: false },
    parts.join('\n\n---\n\n'),
    signal,
    TEACH_PROMPT,
    12000,
    onPartial && ((so) => onPartial({ teach: partialBlock(so, 'teach'), question: partialBlock(so, 'question') })),
  );
  const teach = block(reply.text, 'teach');
  if (!teach) {
    if (reply.truncated) throw new Error("The tutor's reply was cut off. Try again.");
    // a reply that ignored the format is still worth showing
    if (reply.text.trim()) return { teach: reply.text.trim(), question: '', understood: null, advance: false, done: false, insert: [], cards: [] };
    throw new Error('The tutor sent an empty reply. Try again.');
  }
  let control: Record<string, unknown> = {};
  try {
    control = parseJson<Record<string, unknown>>(block(reply.text, 'control'), 'control');
  } catch {
    // keep the teaching even if the bookkeeping is unreadable
  }
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    teach,
    question: block(reply.text, 'question') ?? '',
    understood: control.understood === true ? true : control.understood === false ? false : null,
    advance: control.advance === true,
    done: control.done === true,
    insert: list<{ title?: unknown; summary?: unknown }>(control.insert_before)
      .filter((x) => x && x.title)
      .map((x) => ({ title: String(x.title), summary: String(x.summary ?? '') })),
    cards: list<{ front?: unknown; back?: unknown }>(control.cards)
      .filter((c) => c && c.front && c.back)
      .map((c) => ({ front: String(c.front).trim(), back: String(c.back).trim() })),
  };
}

/** The lesson after a turn: the tutor's message, plan progress, new cards. */
export function applyTurn(lesson: Lesson, kind: TurnKind, r: TurnResult, messageId = learnId('m')): Lesson {
  const plan = lesson.plan.map((p) => ({ ...p }));
  let cur = currentIndex({ ...lesson, plan });
  const assessed = plan[cur];
  // a concept is finished when the tutor moves on: understood, or skipped
  // if the student moved on without showing it
  if (assessed && r.advance) {
    assessed.status = r.understood === true || (kind !== 'next' && kind !== 'skip') ? 'understood' : 'skipped';
  }
  if (r.insert.length && cur >= 0) {
    // prerequisites go before the current concept and are taught now
    if (plan[cur].status === 'active') plan[cur].status = 'todo';
    plan.splice(cur, 0, ...r.insert.map((x) => ({ id: learnId('p'), title: x.title, summary: x.summary, refs: [], status: 'todo' as const, added: true })));
  }
  cur = plan.findIndex((p) => p.status === 'active');
  if (cur < 0) {
    const n = plan.findIndex((p) => p.status === 'todo');
    if (n >= 0) plan[n].status = 'active';
    cur = n;
  }
  const done = r.done || plan.every((p) => p.status === 'understood' || p.status === 'skipped');
  const message: LessonMessage = {
    id: messageId,
    role: 'teacher',
    text: r.teach,
    question: r.question || undefined,
    item: plan[cur]?.id ?? assessed?.id,
    verdict: r.understood === true ? 'understood' : r.understood === false ? 'not-yet' : undefined,
    at: Date.now(),
  };
  const cards: LessonCard[] = r.cards.map((c) => ({ id: learnId('k'), front: c.front, back: c.back, item: assessed?.id ?? '', status: 'pending' }));
  return {
    ...lesson,
    plan,
    messages: [...lesson.messages, message],
    cards: [...lesson.cards, ...cards],
    stage: done ? 'done' : 'learning',
  };
}

// ---------------------------------------------------------------- flashcards

const REWRITE_PROMPT = `You rewrite flashcards for a student. Keep each card's meaning and its answer, and follow the student's preferences exactly. Unless the preferences say otherwise, keep cards concise: a clear question of about 15 words or fewer on the front, at most about 8 words on the back, one fact each.

Reply with JSON only: {"cards":[{"id":"...","front":"...","back":"..."}]}`;

export async function rewriteCards(key: string, model: ModelOptions, lesson: Lesson, cards: LessonCard[], signal: AbortSignal): Promise<Map<string, { front: string; back: string }>> {
  const user = JSON.stringify({
    preferences: lesson.cardStyle,
    cards: cards.map((c) => ({ id: c.id, front: c.front, back: c.back })),
  });
  const reply = await askModel(key, model, user, signal, REWRITE_PROMPT, 8000);
  const raw = parseJson<{ cards?: { id?: unknown; front?: unknown; back?: unknown }[] }>(reply.text, 'flashcards');
  const out = new Map<string, { front: string; back: string }>();
  for (const c of raw.cards ?? []) if (c.id && c.front && c.back) out.set(String(c.id), { front: String(c.front), back: String(c.back) });
  return out;
}
