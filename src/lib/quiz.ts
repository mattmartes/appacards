// AI multiple-choice quizzes, one question at a time for as long as you like,
// from a deck's cards or from your own files (slides, notes, plus past
// quizzes as a style reference). Each question targets the least-covered
// card or section, and questions you get wrong come back later.

import { col, MISSED_RETIRE_STREAK } from './collection';
import { askModel, cleanHtml, type ModelOptions } from './polish';
import { repairJson } from './smart';
import { stripHtml } from './template';
import type { Card, Id, LessonSection, MissedQuestion, QuizQuestion, QuizSet } from './types';

export type { QuizQuestion };

/** related cards sent with each deck question, for tempting wrong answers */
const CONTEXT_CARDS = 45;
const CONTEXT_CHARS = 14_000;
/** a question you got wrong comes back after this many other questions */
const RETRY_AFTER = 5;
/** questions you got wrong in earlier quizzes return every this many questions */
const REPLAY_EVERY = 4;

export type QuizFocus = 'all' | 'weak' | 'new';
export type QuizKinds = 'single' | 'mixed' | 'multi';

let seq = 0;

const plain = (html: string) =>
  stripHtml(html.replace(/<br\s*\/?>|<\/(div|p|li|tr)>/gi, ' '))
    .replace(/\s+/g, ' ')
    .trim();

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9′'+-]{4,}/g) ?? []);

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of b) if (a.has(w)) n++;
  return n;
}

/** The same question with its options in a new order. */
function reshuffle(q: QuizQuestion): QuizQuestion {
  const order = q.options.map((_, i) => i).sort(() => Math.random() - 0.5);
  const notes: Record<number, string> = {};
  order.forEach((from, to) => {
    if (q.notes[from]) notes[to] = q.notes[from];
  });
  return {
    ...q,
    id: `q${++seq}`,
    options: order.map((i) => q.options[i]),
    correct: q.correct.map((i) => order.indexOf(i)).sort((a, b) => a - b),
    notes,
    replay: true,
  };
}

/** A missed-question list after a miss: added, or its count raised. */
export function withMiss(list: MissedQuestion[], q: QuizQuestion): MissedQuestion[] {
  const { replay: _replay, ...stored } = q;
  void _replay;
  const old = list.find((m) => m.q.question === q.question);
  const entry = { q: old?.q ?? stored, misses: (old?.misses ?? 0) + 1, streak: 0, last: Date.now() };
  return [...list.filter((m) => m !== old), entry];
}

/** A missed-question list after a returning question was answered right: retired after two in a row. */
export function withRightAgain(list: MissedQuestion[], q: QuizQuestion): MissedQuestion[] {
  return list.flatMap((m) =>
    m.q.question !== q.question ? [m] : m.streak + 1 >= MISSED_RETIRE_STREAK ? [] : [{ ...m, streak: m.streak + 1, last: Date.now() }],
  );
}

// ---------------------------------------------------------------- scheduling

/** What one question request needs: the prompts, and how to finish the reply. */
interface QuestionRequest {
  system: string;
  user: string;
  /** adds the cards or sections it's about */
  finish: (q: QuizQuestion, raw: RawQuestion) => QuizQuestion;
}

/** Decides what each question is about so a quiz covers everything: units
 * (cards or sections) never quizzed come first, then the least quizzed, none
 * repeated until all have had a turn or twice within a few questions.
 * Questions you get wrong come back a few questions later and, through
 * `saved`, in later quizzes, until you get them right twice in a row. */
export abstract class QuizSource<U> {
  readonly units: U[];
  readonly title: string;
  private readonly asked = new Map<string, number>();
  private readonly lastAt = new Map<string, number>();
  /** units to ask about first (e.g. "quiz me again on what I missed") */
  private readonly first: string[];
  private readonly comeback: { q: QuizQuestion; at: number }[] = [];
  /** loaded on first use: subclasses set up their own fields after this constructor */
  private savedList: QuizQuestion[] | null = null;
  private nextSavedAt = 2;
  private written = 0;

  constructor(title: string, units: U[], first: string[]) {
    this.title = title;
    this.units = units;
    this.first = [...first];
  }

  /** questions missed in earlier quizzes on these units, oldest first */
  private get saved(): QuizQuestion[] {
    if (!this.savedList) {
      const keys = new Set(this.units.map((u) => this.key(u)));
      this.savedList = this.savedMisses()
        .filter((m) => keys.has(this.questionKey(m.q) ?? ''))
        .sort((a, b) => a.last - b.last)
        .map((m) => m.q);
    }
    return this.savedList;
  }

  protected abstract key(u: U): string;
  /** the unit a question is about */
  abstract questionKey(q: QuizQuestion): string | undefined;
  /** how often the unit was quizzed before this quiz */
  protected abstract pastAsked(u: U): number;
  /** lower goes first, among equally covered units */
  protected bias(_u: U): number {
    return 0;
  }
  protected abstract savedMisses(): MissedQuestion[];
  /** saves the answer: stats, and the question if it was missed or retired */
  protected abstract record(q: QuizQuestion, right: boolean): void;
  protected abstract request(u: U, multi: boolean, asked: string[]): QuestionRequest;

  get total(): number {
    return this.units.length;
  }
  get covered(): number {
    return this.asked.size;
  }
  /** missed questions still waiting to come back in this quiz */
  get waiting(): number {
    return this.comeback.length + this.saved.length;
  }

  /** A question you got wrong, if one is due now: asked again (options
   * reshuffled) instead of writing a new one. */
  takeReplay(): QuizQuestion | null {
    const n = this.written;
    const due = this.comeback.findIndex((r) => r.at <= n);
    let q: QuizQuestion | undefined;
    if (due >= 0) q = this.comeback.splice(due, 1)[0].q;
    else if (this.saved.length && n >= this.nextSavedAt) {
      q = this.saved.shift();
      this.nextSavedAt = n + REPLAY_EVERY;
    }
    if (!q) return null;
    this.written++;
    const k = this.questionKey(q);
    if (k) this.mark(k, n);
    return reshuffle(q);
  }

  /** The unit the next question should be about. */
  next(): U {
    const n = this.written++;
    while (this.first.length) {
      const k = this.first.shift()!;
      const u = this.units.find((x) => this.key(x) === k);
      if (u) return this.mark(k, n, u);
    }
    const gap = Math.min(6, Math.floor(this.units.length / 2));
    let best = this.units[0];
    let bestScore = Infinity;
    for (const u of this.units) {
      const k = this.key(u);
      const here = this.asked.get(k) ?? 0;
      const last = this.lastAt.get(k);
      const score =
        here * 1000 + // not again this quiz until everything has had a turn
        (last !== undefined && n - last <= gap ? 500 : 0) + // not twice within a few questions
        Math.max(this.pastAsked(u), here) * 10 + // least quizzed overall
        this.bias(u) * 8 +
        Math.random() * 6;
      if (score < bestScore) {
        bestScore = score;
        best = u;
      }
    }
    return this.mark(this.key(best), n, best);
  }

  private mark<T>(k: string, n: number, u?: T): T {
    this.asked.set(k, (this.asked.get(k) ?? 0) + 1);
    this.lastAt.set(k, n);
    return u as T;
  }

  answered(q: QuizQuestion, right: boolean) {
    this.record(q, right);
    if (!right && !this.comeback.some((r) => r.q.question === q.question)) this.comeback.push({ q, at: this.written + RETRY_AFTER });
  }

  /** The next question's prompts, about the least-covered unit. */
  nextRequest(multi: boolean, asked: string[]): QuestionRequest {
    return this.request(this.next(), multi, asked);
  }
}

// ---------------------------------------------------------------- decks

/** A card as text: its question and the answer without the repeated question. */
function cardText(card: Card): { q: string; a: string } {
  const m = /<hr id=["']?answer["']?\s*\/?>/i.exec(card.back);
  const answer = m ? card.back.slice(m.index + m[0].length) : card.back;
  return { q: plain(card.front), a: plain(answer) };
}

/** Cards a quiz can use: text cards, one per note (cloze numbers and reverse
 * cards say the same thing), without image occlusion or suspended cards. */
export function quizCards(deckId: Id): Card[] {
  const seen = new Set<Id>();
  return col.subtreeCards(deckId).filter((c) => {
    if (c.queue === -1 || /class="io-card"/.test(c.front)) return false;
    const note = c.noteId !== undefined ? col.notes.get(c.noteId) : undefined;
    if (note?.kind === 'imageOcclusion') return false;
    if (note) {
      if (seen.has(note.id)) return false;
      seen.add(note.id);
    }
    const t = cardText(c);
    return t.q.length + t.a.length > 3;
  });
}

const STYLE_RULES = `Write a question that tests understanding, not just recognition. Vary the style from question to question: applying an idea to a new example or scenario, predicting an outcome, interpreting data, comparing related ideas, explaining why, spotting the odd one out, or direct recall of a key fact.

Wrong options must be plausible to someone who half-knows the material: related terms and facts from elsewhere in the material, common misconceptions, near-miss numbers, or the right idea applied wrongly. Never silly. Make all options similar in length, style and grammar. No "all/none of the above".

Question types:
- "single": 4 options, exactly one correct.
- "multi" (select all that apply): 5 options, 2 to 4 of them correct, each option judged on its own as true or false.

Don't repeat or closely paraphrase a question already asked.`;

const DECK_PROMPT = `You write one quiz question at a time for a student from their flashcard deck. You get the FOCUS card the question must be about, plus related cards from the same deck, with ids like [c3]. Stay within what the cards teach.

${STYLE_RULES}

Keep it short: the question under about 40 words, options under about 15 words.

Reply with JSON only:
{"type":"single","question":"...","options":["...","...","...","..."],"correct":[0],"explanation":"1-2 sentences on the answer","notes":["why option A is right/wrong","..."],"cards":["c1","c7"]}
"correct" lists the right options' indexes; "notes" has one short entry per option; "cards" lists the cards the question uses, focus card first.`;

/** Deck quizzes: a question per card, with the answers kept in the collection. */
export class Coverage extends QuizSource<Card> {
  private readonly focus: QuizFocus;

  constructor(title: string, cards: Card[], focus: QuizFocus, firstIds: Id[] = []) {
    super(title, cards, firstIds.map(String));
    this.focus = focus;
  }

  protected key(c: Card) {
    return String(c.id);
  }
  questionKey(q: QuizQuestion) {
    return q.cardIds[0] !== undefined ? String(q.cardIds[0]) : undefined;
  }
  protected pastAsked(c: Card) {
    return col.quizStats.get(c.id)?.asked ?? 0;
  }
  protected bias(c: Card): number {
    if (this.focus === 'weak') {
      const r = col.retrievability(c);
      return (r === null ? 0.6 : r) - Math.min(c.lapses, 8) * 0.06;
    }
    if (this.focus === 'new') return c.type === 0 ? 0 : Math.min(c.reps, 20) / 20;
    return 0;
  }
  protected savedMisses() {
    return [...col.quizMissed.values()];
  }
  protected record(q: QuizQuestion, right: boolean) {
    if (q.cardIds.length) void col.recordQuiz(q.cardIds, right);
    if (!right) void col.saveMissedQuestion(q);
    else if (q.replay) void col.missedQuestionRight(q);
  }

  /** The cards most related to `card` (shared words), then a random mix, for wrong answers. */
  private context(card: Card): Card[] {
    const t = cardText(card);
    const mine = words(`${t.q} ${t.a}`);
    const scored = this.units
      .filter((c) => c.id !== card.id)
      .map((c) => {
        const x = cardText(c);
        return { c, score: overlap(mine, words(`${x.q} ${x.a}`)) + Math.random() * 0.5 };
      })
      .sort((a, b) => b.score - a.score);
    const related = scored.slice(0, Math.ceil(CONTEXT_CARDS * 0.6)).map((x) => x.c);
    const rest = scored
      .slice(related.length)
      .sort(() => Math.random() - 0.5)
      .slice(0, CONTEXT_CARDS - related.length)
      .map((x) => x.c);
    return [...related, ...rest];
  }

  protected request(focus: Card, multi: boolean, asked: string[]): QuestionRequest {
    const idOf = new Map<string, Id>();
    const lines: string[] = [];
    let size = 0;
    for (const c of [focus, ...this.context(focus)]) {
      const short = `c${idOf.size + 1}`;
      const t = cardText(c);
      const line = `[${short}] ${t.q} → ${t.a}`.slice(0, 500);
      if (size + line.length > CONTEXT_CHARS) break;
      size += line.length;
      idOf.set(short, c.id);
      lines.push(line);
    }
    const [focusLine, ...others] = lines;
    const user = [
      `Deck: ${this.title}`,
      `FOCUS card (the question is about this):\n${focusLine}`,
      `Related cards from the deck:\n${others.join('\n') || '(none)'}`,
      askedList(asked),
      `Write one "${multi ? 'multi' : 'single'}" question.`,
    ]
      .filter(Boolean)
      .join('\n\n');
    return {
      system: DECK_PROMPT,
      user,
      finish: (q, raw) => {
        const used = (Array.isArray(raw.cards) ? raw.cards : [])
          .map((c) => idOf.get(String(c).replace(/[[\]\s"]/g, '').toLowerCase()))
          .filter((x): x is Id => x !== undefined && x !== focus.id);
        // the card it was written for comes first, for coverage
        return { ...q, cardIds: [focus.id, ...used] };
      },
    };
  }
}

// ---------------------------------------------------------------- your material

const MATERIAL_PROMPT = `You write one quiz question at a time for a student from their course material (lecture slides, notes, readings). You get the FOCUS section the question must be about, nearby and related sections for context, and excerpts from REFERENCE quizzes: the course's own practice quizzes or past exams, when there are any.

Use the reference quizzes to match the course: their question formats, difficulty, level of detail, and the kinds of things they test (calculations, interpreting data or experiments, applying concepts, definitions). Never copy a reference question; write a new one (new numbers, organisms, scenario or wording) that tests the same kind of skill. Every question must be answerable from the material.

${STYLE_RULES}

Keep the question under about 60 words (a small table or data set written out in text is fine) and options under about 20 words. Don't refer to "the slide" or "the material"; ask about the subject itself. Sections with no text were images; don't invent their content.

Reply with JSON only:
{"type":"single","question":"...","options":["...","...","...","..."],"correct":[0],"explanation":"1-2 sentences on the answer","notes":["why option A is right/wrong","..."],"sections":["M1.4"]}
"correct" lists the right options' indexes; "notes" has one short entry per option; "sections" lists the sections the question uses, focus first.`;

const sectionText = (s: LessonSection, max: number) => `[${s.ref}] ${s.title}\n${s.text.slice(0, max)}`;

/** Sections a material quiz asks about: those with enough text from study
 * material, or from the reference quizzes if that's all there is. */
export function quizSections(set: QuizSet): LessonSection[] {
  const usable = (role: 'material' | 'reference') =>
    set.sources.filter((s) => s.role === role).flatMap((s) => s.sections.filter((x) => x.text.length >= 40));
  const material = usable('material');
  return material.length ? material : usable('reference');
}

/** Material quizzes: a question per section; history is kept with the quiz set. */
export class MaterialCoverage extends QuizSource<LessonSection> {
  private readonly set: QuizSet;
  private readonly references: LessonSection[];
  private readonly neighbors = new Map<string, LessonSection[]>();

  constructor(set: QuizSet, firstRefs: string[] = []) {
    super(set.title, quizSections(set), firstRefs);
    this.set = set;
    this.references = set.sources.filter((s) => s.role === 'reference').flatMap((s) => s.sections.filter((x) => x.text.length >= 20));
    for (const src of set.sources) {
      src.sections.forEach((s, i) => this.neighbors.set(s.ref, [src.sections[i - 1], src.sections[i + 1]].filter((x) => !!x)));
    }
  }

  protected key(s: LessonSection) {
    return s.ref;
  }
  questionKey(q: QuizQuestion) {
    return q.refs?.[0];
  }
  protected pastAsked(s: LessonSection) {
    return col.quizSets.get(this.set.id)?.stats[s.ref]?.asked ?? 0;
  }
  protected savedMisses() {
    return this.set.missed;
  }
  protected record(q: QuizQuestion, right: boolean) {
    void col.updateQuizSet(this.set.id, (set) => {
      const stats = { ...set.stats };
      for (const ref of q.refs ?? []) {
        const s = stats[ref] ?? { asked: 0, wrong: 0 };
        stats[ref] = { asked: s.asked + 1, wrong: s.wrong + (right ? 0 : 1) };
      }
      const missed = !right ? withMiss(set.missed, q) : q.replay ? withRightAgain(set.missed, q) : set.missed;
      return { ...set, stats, missed };
    });
  }

  protected request(focus: LessonSection, multi: boolean, asked: string[]): QuestionRequest {
    const mine = words(`${focus.title} ${focus.text}`);
    const near = this.neighbors.get(focus.ref) ?? [];
    const related = this.units
      .filter((s) => s.ref !== focus.ref && !near.includes(s))
      .map((s) => ({ s, score: overlap(mine, words(`${s.title} ${s.text}`)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.s);
    // the reference questions closest to this topic, plus one at random for range
    const refsSorted = this.references
      .map((s) => ({ s, score: overlap(mine, words(s.text)) + Math.random() * 0.5 }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.s);
    const refPick = [...refsSorted.slice(0, 3), ...refsSorted.slice(3).sort(() => Math.random() - 0.5).slice(0, 1)];
    const known = new Set(this.set.sources.flatMap((s) => s.sections.map((x) => x.ref)));
    const user = [
      `Quiz: ${this.title}`,
      `FOCUS section (the question is about this):\n${sectionText(focus, 4000)}`,
      near.length ? `Nearby sections:\n${near.map((s) => sectionText(s, 2000)).join('\n\n')}` : '',
      related.length ? `Related material:\n${related.map((s) => sectionText(s, 1500)).join('\n\n')}` : '',
      refPick.length ? `Reference quizzes from the course (match their style; don't copy):\n${refPick.map((s) => sectionText(s, 2500)).join('\n\n')}` : '',
      askedList(asked),
      `Write one "${multi ? 'multi' : 'single'}" question.`,
    ]
      .filter(Boolean)
      .join('\n\n---\n\n');
    return {
      system: MATERIAL_PROMPT,
      user,
      finish: (q, raw) => {
        const used = (Array.isArray(raw.sections) ? raw.sections : []).map((x) => String(x).replace(/[[\]\s"]/g, '')).filter((r) => known.has(r) && r !== focus.ref);
        return { ...q, refs: [focus.ref, ...used] };
      },
    };
  }
}

// ---------------------------------------------------------------- writing

interface RawQuestion {
  type?: unknown;
  question?: unknown;
  options?: unknown;
  correct?: unknown;
  explanation?: unknown;
  notes?: unknown;
  why_wrong?: unknown;
  cards?: unknown;
  sections?: unknown;
}

const askedList = (asked: string[]) =>
  asked.length ? `Questions already asked (don't repeat):\n${asked.slice(-30).map((q) => `- ${plain(q)}`).join('\n')}` : '';

/** The question object in a reply, tolerating fences, prose and common JSON slips. */
function readQuestion(text: string): RawQuestion | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  const json = text.slice(start, end + 1);
  for (const candidate of [json, repairJson(json)]) {
    try {
      const parsed = JSON.parse(candidate) as RawQuestion & { questions?: RawQuestion[] };
      return Array.isArray(parsed.questions) ? (parsed.questions[0] ?? null) : parsed;
    } catch {
      // try the repaired version
    }
  }
  return null;
}

/** Checks a question and shuffles its options. */
function toQuestion(raw: RawQuestion, multi: boolean): QuizQuestion | null {
  const options = Array.isArray(raw.options) ? raw.options.map((o) => cleanHtml(String(o ?? '')).trim()) : [];
  const correctRaw = (Array.isArray(raw.correct) ? raw.correct : [raw.correct]).map(Number).filter((i) => i >= 0 && i < options.length);
  const correct = [...new Set(correctRaw)];
  const question = cleanHtml(String(raw.question ?? '')).trim();
  if (!question || options.length < 3 || options.length > 6 || options.some((o) => !o)) return null;
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return null;
  if (multi ? correct.length < 1 || correct.length >= options.length : correct.length !== 1) return null;
  const notesRaw = Array.isArray(raw.notes) ? raw.notes : Array.isArray(raw.why_wrong) ? raw.why_wrong : [];
  const order = options.map((_, i) => i).sort(() => Math.random() - 0.5);
  const notes: Record<number, string> = {};
  order.forEach((from, to) => {
    const n = cleanHtml(String(notesRaw[from] ?? '')).trim();
    if (n) notes[to] = n;
  });
  return {
    id: `q${++seq}`,
    multi,
    question,
    options: order.map((i) => options[i]),
    correct: correct.map((i) => order.indexOf(i)).sort((a, b) => a - b),
    explanation: cleanHtml(String(raw.explanation ?? '')).trim(),
    notes,
    cardIds: [],
  };
}

/** Writes the next question about the least-covered card or section, single
 * or "select all", avoiding questions already asked. Retries once if the
 * reply is unusable. */
export async function nextQuestion<U>(
  key: string,
  model: ModelOptions,
  source: QuizSource<U>,
  kinds: QuizKinds,
  asked: string[],
  signal: AbortSignal,
): Promise<QuizQuestion> {
  const multi = kinds === 'multi' || (kinds === 'mixed' && Math.random() < 0.35);
  const req = source.nextRequest(multi, asked);
  for (let attempt = 0; ; attempt++) {
    const reply = await askModel(key, model, req.user, signal, req.system, 4000);
    const raw = readQuestion(reply.text);
    const q = raw && toQuestion(raw, multi);
    if (raw && q && !asked.includes(q.question)) return req.finish(q, raw);
    if (attempt >= 1) throw new Error("The model's question wasn't usable. Try again.");
  }
}

/** Whether a set of picks matches the right answers exactly. */
export const isRight = (q: QuizQuestion, picks: number[]) =>
  picks.length === q.correct.length && q.correct.every((i) => picks.includes(i));
