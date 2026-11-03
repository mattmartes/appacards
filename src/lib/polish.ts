// AI Polish: a model on OpenRouter rewords a deck's cards, splits cards that
// test several things, and suggests cards that fill gaps the deck implies.
// Nothing changes until the student reviews the suggestions; confirming
// creates a separate "<deck> - Polished" deck and leaves the original alone.

import { col } from './collection';
import { generateCards, noteProblem } from './noteTypes';
import { stripHtml } from './template';
import type { Card, Id, Note, NoteKind } from './types';

const API = 'https://openrouter.ai/api/v1';
const KEY_STORAGE = 'appa-openrouter-key';
const MODEL_STORAGE = 'appa-openrouter-model';
export const DEFAULT_MODEL = 'google/gemini-3.5-flash';
export const FALLBACK_MODEL = 'anthropic/claude-sonnet-4.5';

/** cards per request, and requests in flight at once */
const BATCH_SIZE = 15;
const CONCURRENCY = 3;
/** longest reply asked for, in tokens */
const MAX_REPLY_TOKENS = 16000;
/** times a card missing from a reply is asked for again */
const MAX_TRIES = 3;
/** the list of every card in the deck sent with each request, for spotting gaps */
const CONTEXT_CHARS = 60_000;

// ---------------------------------------------------------------- data

/** The note types a polished card can be. */
export type DraftKind = 'basic' | 'reversed' | 'cloze';

export interface DraftCard {
  id: string;
  kind: DraftKind;
  /** Front, or a cloze card's Text */
  front: string;
  /** Back, or a cloze card's Back Extra */
  back: string;
  /** for suggested new cards: whether to create it */
  include: boolean;
  /** why the AI suggested a new card */
  reason?: string;
}

export type ItemStatus = 'pending' | 'unchanged' | 'changed' | 'split' | 'duplicate' | 'occlusion' | 'error';
/** problems the AI found: too vague to have one answer, or the same question as another card */
export type ItemIssue = 'vague' | 'duplicate';
export type ItemChoice = 'polished' | 'original' | 'drop';

/** One original note (or noteless imported card) and the AI's suggestions for it. */
export interface PolishItem {
  /** "n<noteId>" or "c<cardId>" */
  key: string;
  /** the short id the AI sees, e.g. "c12" (long ids get mistyped) */
  aiId: string;
  /** cards made from one note (an imported cloze note's numbers, a card and
   * its reverse) share a group, e.g. "g3"; they're never duplicates */
  siblingGroup?: string;
  /** the original's deck, for recreating subdecks */
  deckName: string;
  note?: Note;
  card?: Card;
  /** the original as a draft card (what the AI sees) */
  original: Omit<DraftCard, 'id' | 'include'>;
  tags: string[];
  status: ItemStatus;
  /** the AI's one-line summary of what it changed */
  reason: string;
  issues: ItemIssue[];
  /** what the issue is, in one sentence */
  issueNote: string;
  /** for duplicates: the key of the card this one repeats or overlaps */
  duplicateOf?: string;
  error?: string;
  cards: DraftCard[];
  /** new cards the original suggested (gap filling) */
  added: DraftCard[];
  choice: ItemChoice;
}

export interface PolishSession {
  deckId: Id;
  deckName: string;
  model: string;
  items: PolishItem[];
  /** the model accepts response_format: json_object */
  jsonMode?: boolean;
  /** the longest reply the model allows, in tokens */
  maxTokens?: number;
}

let draftSeq = 0;
export const draftId = () => `d${++draftSeq}`;

/** The polish in progress or under review; kept until the app closes so an
 * accidental Exit doesn't throw away a paid-for run. */
let lastSession: PolishSession | null = null;
export const getLastSession = () => lastSession;
export const setLastSession = (s: PolishSession | null) => {
  lastSession = s;
};

export function savedKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function savedModel(): string {
  try {
    return localStorage.getItem(MODEL_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function saveKey(key: string) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    // asked for again next time
  }
}

export function saveModel(model: string) {
  try {
    localStorage.setItem(MODEL_STORAGE, model);
  } catch {
    // the default is used next time
  }
}

// ---------------------------------------------------------------- collecting

/** The answer part of an imported card's back, without the repeated question. */
function answerOnly(card: Card): string {
  const m = /<hr id=["']?answer["']?\s*\/?>/i.exec(card.back);
  if (m) return card.back.slice(m.index + m[0].length).trim();
  return card.back.startsWith(card.front) ? card.back.slice(card.front.length).trim() : card.back;
}

function noteAsDraft(note: Note): Omit<DraftCard, 'id' | 'include'> {
  const f = note.fields;
  if (note.kind === 'cloze') return { kind: 'cloze', front: f.Text ?? '', back: f['Back Extra'] ?? '' };
  const kind: DraftKind =
    note.kind === 'reversed' || (note.kind === 'optionalReversed' && stripHtml(f['Add Reverse'] ?? '').trim()) ? 'reversed' : 'basic';
  return { kind, front: f.Front ?? '', back: f.Back ?? '' };
}

const isOcclusionCard = (c: Card) => /class="io-card"/.test(c.front);

/** One item per note (or per noteless card) in the deck and its subdecks,
 * in deck order, then in the order they were added. */
export function collectItems(deckId: Id): PolishItem[] {
  const order = new Map(col.deckList().map((d, i) => [d.id, i]));
  const cards = col.subtreeCards(deckId).sort((a, b) => (order.get(a.deckId) ?? 0) - (order.get(b.deckId) ?? 0) || a.id - b.id);
  const seen = new Set<Id>();
  const items: PolishItem[] = [];
  for (const card of cards) {
    const deckName = col.decks.get(card.deckId)?.name ?? '';
    const note = card.noteId !== undefined ? col.notes.get(card.noteId) : undefined;
    if (note) {
      if (seen.has(note.id)) continue;
      seen.add(note.id);
    }
    // image occlusion and smart cards are copied as they are
    const occlusion = note ? note.kind === 'imageOcclusion' || note.kind === 'smart' : isOcclusionCard(card);
    const original = note && !occlusion ? noteAsDraft(note) : { kind: 'basic' as const, front: card.front, back: answerOnly(card) };
    items.push({
      key: note ? `n${note.id}` : `c${card.id}`,
      aiId: `c${items.length + 1}`,
      siblingGroup: !note && card.ankiNoteId !== undefined ? `a${card.ankiNoteId}` : undefined,
      deckName,
      note,
      card: note ? undefined : card,
      original,
      tags: [...(note?.tags ?? card.tags)],
      status: occlusion ? 'occlusion' : 'pending',
      reason: '',
      issues: [],
      issueNote: '',
      cards: [],
      added: [],
      choice: 'original',
    });
  }
  groupLegacySiblings(items);
  // short group names, and only for groups that have siblings
  const sizes = new Map<string, number>();
  for (const it of items) if (it.siblingGroup) sizes.set(it.siblingGroup, (sizes.get(it.siblingGroup) ?? 0) + 1);
  const names = new Map<string, string>();
  for (const it of items) {
    if (!it.siblingGroup) continue;
    if ((sizes.get(it.siblingGroup) ?? 0) < 2) it.siblingGroup = undefined;
    else {
      if (!names.has(it.siblingGroup)) names.set(it.siblingGroup, `g${names.size + 1}`);
      it.siblingGroup = names.get(it.siblingGroup);
    }
  }
  return items;
}

/** Cards imported before Appa kept the Anki note id: siblings were added in
 * the same second and either show the same answer text (the numbers of a
 * cloze note) or swap question and answer (a card and its reverse). */
function groupLegacySiblings(items: PolishItem[]) {
  const buckets = new Map<number, PolishItem[]>();
  for (const it of items) {
    if (!it.card || it.siblingGroup || it.status === 'occlusion') continue;
    buckets.set(it.card.created, [...(buckets.get(it.card.created) ?? []), it]);
  }
  for (const [created, list] of buckets) {
    if (list.length < 2) continue;
    const byAnswer = new Map<string, string>();
    const byPair = new Map<string, PolishItem>();
    list.forEach((it, i) => {
      const q = plain(it.original.front);
      const a = plain(it.original.back);
      if (a.length < 4) return;
      const group = `t${created}-${i}`;
      const cloze = byAnswer.get(a);
      const reverse = byPair.get(`${a}\u0000${q}`);
      if (cloze) it.siblingGroup = cloze;
      else if (reverse) it.siblingGroup = reverse.siblingGroup ??= group;
      byAnswer.set(a, (it.siblingGroup ??= group));
      byPair.set(`${q}\u0000${a}`, it);
    });
  }
}

// ---------------------------------------------------------------- OpenRouter

export interface ModelInfo {
  id: string;
  name: string;
  created: number;
  /** USD per token, as strings */
  pricing?: { prompt?: string; completion?: string };
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: string[];
  top_provider?: { max_completion_tokens?: number | null };
}

let modelsRequest: Promise<ModelInfo[]> | null = null;

/** OpenRouter's model list (needs no key), fetched once per session. */
export function fetchModels(): Promise<ModelInfo[]> {
  modelsRequest ??= fetch(`${API}/models`)
    .then(async (res) => {
      if (!res.ok) throw new Error(`OpenRouter returned ${res.status}`);
      return ((await res.json()) as { data: ModelInfo[] }).data;
    })
    .catch((e: unknown) => {
      modelsRequest = null;
      throw e;
    });
  return modelsRequest;
}

/** The labs whose flagship models are listed first, in this order. */
const TOP_PROVIDERS = ['anthropic', 'openai', 'google', 'x-ai', 'deepseek', 'qwen', 'moonshotai', 'z-ai', 'mistralai', 'meta-llama'];
/** families per lab, newest first */
const PER_PROVIDER = 4;
/** variants that aren't general text models */
const NOT_CHAT = /image|vision|banana|audio|tts|embed|guard|omni|exp|preview|code|build|multi-agent|lite|\d{4,}$/;

/** OpenRouter has no public popularity ranking, so "top models" are the
 * newest model of each family (e.g. claude-opus-#, gpt-#-sol, gemini-#-flash)
 * from the major labs. */
export function topModels(models: ModelInfo[]): ModelInfo[] {
  const out: ModelInfo[] = [];
  for (const provider of TOP_PROVIDERS) {
    const newest = new Map<string, ModelInfo>();
    for (const m of models) {
      const [org, slug = ''] = m.id.split('/');
      if (org !== provider || m.id.includes(':') || NOT_CHAT.test(slug)) continue;
      const outputs = m.architecture?.output_modalities;
      if (outputs && !(outputs.length === 1 && outputs[0] === 'text')) continue;
      const family = slug.replace(/\d+(\.\d+)*/g, '#');
      const seen = newest.get(family);
      if (!seen || m.created > seen.created) newest.set(family, m);
    }
    out.push(...[...newest.values()].sort((a, b) => b.created - a.created).slice(0, PER_PROVIDER));
  }
  return out;
}

/** "$3 / $15 per M tokens" (input / output). */
export function modelPrice(m: ModelInfo): string {
  const perM = (s?: string) => {
    const n = Number(s) * 1e6;
    return !Number.isFinite(n) ? '?' : n === 0 ? 'free' : `$${n.toFixed(2)}`;
  };
  return `${perM(m.pricing?.prompt)} in / ${perM(m.pricing?.completion)} out per 1M tokens`;
}

/** The default model: Gemini 3.5 (Flash if there's a choice), else the newest Claude Sonnet. */
export function defaultModel(models: ModelInfo[]): string {
  const ids = new Set(models.map((m) => m.id));
  if (ids.has(DEFAULT_MODEL)) return DEFAULT_MODEL;
  const gemini = models.find((m) => m.id.startsWith('google/gemini-3.5') && !NOT_CHAT.test(m.id));
  if (gemini) return gemini.id;
  const sonnets = models.filter((m) => m.id.startsWith('anthropic/claude-sonnet')).sort((a, b) => b.created - a.created);
  return sonnets[0]?.id ?? FALLBACK_MODEL;
}

/** Rough cost of polishing `items` with model `m`, in USD, or null if the
 * price is unknown. Assumes ~4 characters per token and replies about 1.5x
 * the size of the cards sent. */
export function estimateCost(items: PolishItem[], m: ModelInfo | undefined): number | null {
  const pIn = Number(m?.pricing?.prompt);
  const pOut = Number(m?.pricing?.completion);
  if (!m || !Number.isFinite(pIn) || !Number.isFinite(pOut)) return null;
  const todo = items.filter((it) => it.status === 'pending' || it.status === 'error');
  const batches = Math.ceil(todo.length / BATCH_SIZE);
  const cardChars = todo.reduce((n, it) => n + it.original.front.length + it.original.back.length + 40, 0);
  const inTokens = (batches * (SYSTEM_PROMPT.length + contextList(items).length) + cardChars) / 4;
  const outTokens = (cardChars * 1.5) / 4;
  return inTokens * pIn + outTokens * pOut;
}

const SYSTEM_PROMPT = `You are an expert at writing spaced-repetition flashcards (Anki). A student gives you a batch of cards from one of their decks, plus a list of every card in the deck for context. Improve each card in the batch while keeping what the student is trying to learn and test.

For each card you may:
- Reword it: fix grammar and spelling, remove ambiguity, and make the question specific enough that only one answer fits. Keep answers short.
- Split it: if one card tests several facts (lists, "and" questions, long answers), replace it with several atomic cards.
- Add cards that fill a clear gap the deck implies. Example: the deck asks "What happens to the gametophyte of a fern after fertilization?" and also mentions bryophyte gametophytes, so a contrasting card "What happens to the gametophyte of a bryophyte after fertilization?" belongs. Only add cards strongly suggested by the deck's own content, never ones that duplicate a card in the context list, and at most 2 per original card. Most cards need none.
- Leave it alone: if a card is already clear and atomic, mark it unchanged. Don't change cards just to change them.

Also look for two problems and fix them:
- Too vague: the question could have several valid answers, or lacks the context to know what's asked (e.g. "Function?", "What does it produce?", "Describe the process"). Add "vague" to "issues", say what was unclear in "issue_note", and rewrite it to be specific, using the deck's other cards to tell what's meant.
- Duplicates: the card asks the same thing as another card in the deck list, even if worded differently (e.g. "Where does photosynthesis occur?" and "Photosynthesis takes place in which organelle?"). Card ids are in [brackets] in the deck list. Add "duplicate" to "issues" and set "duplicate_of" to the other card's id.
  - The batch's cards also appear in the deck list: a card is never a duplicate of itself.
  - Cards with the same note group (e.g. [c4 note g2] and [c5 note g2]) come from one note: the numbers of one cloze note, or a card and its reverse. They are meant to be alike and are never duplicates of each other.
  - If both test the same fact, return "cards": [] so this card is left out, and only do this for the card that comes LATER in the deck list (the earlier one is kept). If the later card is better worded, still drop the later one but say so in "issue_note".
  - If they overlap but each tests something different, keep both: reword this card so the difference is clear, and return it in "cards".

Rules:
- Card types: "basic" (front/back), "reversed" (front/back, also asked back-to-front), "cloze" (front is the text with {{c1::answer}} deletions, optional {{c1::answer::hint}}; back is optional extra info). Keep each card's type unless another type clearly suits it better.
- Only state facts you are confident are correct and well established. Never contradict the original's answer unless it is plainly wrong; if so, say so in the reason.
- Keep any <img ...> tags and [sound:...] tags exactly as they are, on the card that needs them.
- Formatting: plain text, optionally with <b>, <i>, <u>, <sub>, <sup>, <br>, <ul>, <ol>, <li>. No other HTML, no Markdown.
- Write in the same language as the card.

Use card ids exactly as given (e.g. "c12"). Reply with JSON only, no prose and no code fences, in this shape:
{"results":[
  {"id":"<card id>","unchanged":true},
  {"id":"<card id>","reason":"<one short sentence on what you changed>","cards":[{"type":"basic","front":"...","back":"..."}],"added":[{"type":"basic","front":"...","back":"...","reason":"<why this card fills a gap>"}]},
  {"id":"<card id>","issues":["vague"],"issue_note":"<what was unclear>","reason":"...","cards":[...]},
  {"id":"<card id>","issues":["duplicate"],"duplicate_of":"<other card id>","issue_note":"<how they overlap>","cards":[]}
]}
Give exactly one result for every card id in the batch. "cards" replaces the original (one card = reworded, several = split, none = duplicate left out). "added", "issues", "issue_note" and "duplicate_of" are optional.`;

/** A card's text on one line, without HTML. */
const plain = (html: string) =>
  stripHtml(html.replace(/<br\s*\/?>|<\/(div|p|li)>/gi, ' '))
    .replace(/\s+/g, ' ')
    .trim();

/** Short one-line text for the context list. */
function oneLine(html: string, max: number): string {
  const t = plain(html);
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function contextList(items: PolishItem[]): string {
  const lines: string[] = [];
  let size = 0;
  for (const it of items) {
    if (it.status === 'occlusion') continue;
    const group = it.siblingGroup ? ` note ${it.siblingGroup}` : '';
    const line = `- [${it.aiId}${group}] ${oneLine(it.original.front, 140)} → ${oneLine(it.original.back, 80)}`;
    size += line.length + 1;
    if (size > CONTEXT_CHARS) {
      lines.push(`(and ${items.length - lines.length} more cards)`);
      break;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

interface AiCard {
  type?: string;
  front?: string;
  back?: string;
  reason?: string;
}
interface AiResult {
  id?: string | number;
  unchanged?: boolean;
  reason?: string;
  cards?: AiCard[];
  added?: AiCard[];
  issues?: string[];
  issue_note?: string;
  duplicate_of?: string | number;
}

export class PolishError extends Error {
  /** true when retrying won't help (bad key, no credits, unknown model) */
  fatal: boolean;
  constructor(message: string, fatal = false) {
    super(message);
    this.fatal = fatal;
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason);
    });
  });

export interface Reply {
  text: string;
  /** the model hit its length limit, so the reply is cut off */
  truncated: boolean;
}

/** Model settings for one request. */
export type ModelOptions = Pick<PolishSession, 'model' | 'jsonMode' | 'maxTokens'>;

/** Reads OpenRouter's server-sent events: "data: {json}" lines with
 * pieces of the reply, comment lines while it's working, then "data: [DONE]". */
async function readStream(body: ReadableStream<Uint8Array>, onDelta: (textSoFar: string) => void): Promise<Reply> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let finish = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let event: { error?: { message?: string }; choices?: { delta?: { content?: string }; finish_reason?: string | null }[] };
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      if (event.error) throw new PolishError(event.error.message ?? 'OpenRouter returned an error');
      const choice = event.choices?.[0];
      if (choice?.delta?.content) {
        text += choice.delta.content;
        onDelta(text);
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
    }
  }
  return { text, truncated: finish === 'length' };
}

/** One chat request to OpenRouter, with retries for rate limits and server errors. */
export async function askModel(
  key: string,
  session: ModelOptions,
  /** the message, or its parts (text and images) for a model that can see */
  user: string | unknown[],
  signal: AbortSignal,
  system = SYSTEM_PROMPT,
  /** longest reply to ask for, in tokens (thinking models spend some of it before answering) */
  limit = MAX_REPLY_TOKENS,
  /** streams the reply: called with the text so far as it arrives */
  onDelta?: (textSoFar: string) => void,
): Promise<Reply> {
  let jsonMode = session.jsonMode ?? false;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/chat/completions`, {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Appa' },
      body: JSON.stringify({
        model: session.model,
        temperature: 0.3,
        max_tokens: Math.min(limit, session.maxTokens ?? limit),
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        ...(onDelta ? { stream: true } : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (res.ok && onDelta && res.body) return readStream(res.body, onDelta);
    if (res.ok) {
      const json = (await res.json()) as {
        choices?: { message?: { content?: string }; finish_reason?: string }[];
        error?: { message?: string };
      };
      if (json.error) throw new PolishError(json.error.message ?? 'OpenRouter returned an error');
      const choice = json.choices?.[0];
      return { text: choice?.message?.content ?? '', truncated: choice?.finish_reason === 'length' };
    }
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? '';
    } catch {
      // no JSON body
    }
    if (res.status === 401) throw new PolishError('OpenRouter rejected the API key.', true);
    if (res.status === 402) throw new PolishError('Your OpenRouter account is out of credits.', true);
    if (res.status === 400 && jsonMode) {
      // some providers refuse JSON mode; the prompt asks for JSON anyway
      jsonMode = false;
      continue;
    }
    if (res.status === 400 || res.status === 404) throw new PolishError(detail || `OpenRouter returned ${res.status}.`, true);
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(2000 * 2 ** attempt, signal);
      continue;
    }
    throw new PolishError(detail || `OpenRouter returned ${res.status}.`);
  }
}

/** The results in a reply. Tolerates code fences, prose around the JSON,
 * trailing commas, and replies cut off part-way (the complete results are
 * kept, and the rest are asked for again). */
export function parseReply(text: string): AiResult[] {
  const body = text.replace(/```(?:json)?/gi, '');
  const start = body.search(/[{[]/);
  if (start < 0) return [];
  const json = body.slice(start, Math.max(body.lastIndexOf('}'), body.lastIndexOf(']')) + 1);
  for (const candidate of [json, json.replace(/,\s*([}\]])/g, '$1')]) {
    try {
      const parsed = JSON.parse(candidate) as { results?: AiResult[] } | AiResult[];
      const results = Array.isArray(parsed) ? parsed : parsed.results;
      if (Array.isArray(results)) return results;
    } catch {
      // try the next repair
    }
  }
  return salvageResults(body);
}

/** Each complete {...} object in the reply's results list, parsed on its own. */
function salvageResults(text: string): AiResult[] {
  const at = text.indexOf('"results"');
  let i = text.indexOf('[', Math.max(at, 0));
  if (i < 0) return [];
  const out: AiResult[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let objStart = -1;
  for (i++; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try {
          out.push(JSON.parse(text.slice(objStart, i + 1).replace(/,\s*([}\]])/g, '$1')) as AiResult);
        } catch {
          // skip this one; it's asked for again
        }
        objStart = -1;
      }
    } else if (ch === ']' && depth === 0) break;
  }
  return out;
}

/** "c12", "[c12]", "12" and " C12 " all mean c12. */
function normalizeId(id: unknown): string {
  const t = String(id ?? '')
    .replace(/[[\]"\s]/g, '')
    .toLowerCase();
  return /^\d+$/.test(t) ? `c${t}` : t;
}

/** Removes anything a card shouldn't run: scripts, event handlers, frames. */
export function cleanHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.querySelectorAll('script, style, iframe, object, embed, link, meta, form').forEach((e) => e.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    }
  });
  return doc.body.innerHTML.trim();
}

function toDraft(c: AiCard, include = true): DraftCard {
  const kind: DraftKind = c.type === 'cloze' || c.type === 'reversed' ? c.type : 'basic';
  return { id: draftId(), kind, front: cleanHtml(c.front ?? ''), back: cleanHtml(c.back ?? ''), include, reason: c.reason };
}

const same = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

function applyResult(item: PolishItem, r: AiResult, byAiId: Map<string, PolishItem>) {
  item.issues = (r.issues ?? []).filter((x): x is ItemIssue => x === 'vague' || x === 'duplicate');
  item.issueNote = r.issue_note ?? '';
  // never a duplicate of itself or of a sibling from the same note
  const other = r.duplicate_of !== undefined ? byAiId.get(normalizeId(r.duplicate_of)) : undefined;
  const isDuplicate = other && other !== item && !(item.siblingGroup && other.siblingGroup === item.siblingGroup);
  item.duplicateOf = isDuplicate ? other.key : undefined;
  if (!isDuplicate && item.issues.includes('duplicate')) item.issueNote = '';
  if (item.issues.includes('duplicate') && !item.duplicateOf) item.issues = item.issues.filter((x) => x !== 'duplicate');
  if (item.duplicateOf && !item.issues.includes('duplicate')) item.issues.push('duplicate');
  item.error = undefined;
  if (item.duplicateOf && !r.unchanged && !(r.cards ?? []).length) {
    // the same question as another card: left out, the other is kept
    item.added = (r.added ?? []).filter((c) => stripHtml(c.front ?? '').trim()).map((c) => toDraft(c));
    item.reason = '';
    item.cards = [];
    item.status = 'duplicate';
    item.choice = 'drop';
    return;
  }
  item.added = (r.added ?? []).filter((c) => stripHtml(c.front ?? '').trim()).map((c) => toDraft(c));
  const cards = (r.cards ?? []).filter((c) => stripHtml(c.front ?? '').trim()).map((c) => toDraft(c));
  const o = item.original;
  const unchanged =
    r.unchanged || !cards.length || (cards.length === 1 && cards[0].kind === o.kind && same(cards[0].front, o.front) && same(cards[0].back, o.back));
  item.reason = unchanged ? '' : (r.reason ?? '');
  item.cards = unchanged ? [] : cards;
  item.status = unchanged ? 'unchanged' : cards.length > 1 ? 'split' : 'changed';
  item.choice = unchanged ? 'original' : 'polished';
}

/** Makes sure leaving out duplicates never drops both copies: a duplicate
 * is kept if the card it repeats is missing, left out, or itself a
 * duplicate of this one. Cards are checked in deck order. */
export function resolveDuplicates(items: PolishItem[]) {
  const byKey = new Map(items.map((it) => [it.key, it]));
  for (const it of items) {
    if (!it.duplicateOf) continue;
    const other = byKey.get(it.duplicateOf);
    if (!other) {
      it.duplicateOf = undefined;
      it.issues = it.issues.filter((x) => x !== 'duplicate');
      if (it.status === 'duplicate') {
        it.status = 'unchanged';
        it.choice = 'original';
      }
      continue;
    }
    if (it.status === 'duplicate' && other.choice === 'drop') {
      it.status = 'unchanged';
      it.choice = 'original';
      if (other.duplicateOf === it.key) {
        // each was marked as the other's duplicate: this earlier one is
        // the copy that stays, and the other row explains the pair
        it.duplicateOf = undefined;
        it.issues = it.issues.filter((x) => x !== 'duplicate');
        it.issueNote = '';
      } else {
        it.issueNote = `${it.issueNote} Kept, because the card it repeats was also left out.`.trim();
      }
    }
  }
}

export interface PolishProgress {
  /** cards finished */
  done: number;
  total: number;
}

/** Sends the session's pending (or failed) cards to the model, updating
 * them in place. Cards a reply misses (cut off, malformed, skipped) are
 * asked for again in smaller batches; cards still failing are marked as
 * errors and can be retried. */
export async function runPolish(
  session: PolishSession,
  key: string,
  signal: AbortSignal,
  onProgress: (p: PolishProgress) => void,
): Promise<void> {
  const todo = session.items.filter((it) => it.status === 'pending' || it.status === 'error');
  const batches: PolishItem[][] = [];
  for (let i = 0; i < todo.length; i += BATCH_SIZE) batches.push(todo.slice(i, i + BATCH_SIZE));
  const context = contextList(session.items);
  const byAiId = new Map(session.items.map((it) => [it.aiId, it]));
  let done = 0;
  let next = 0;
  let fatal: PolishError | null = null;
  onProgress({ done, total: todo.length });

  const polishBatch = async (batch: PolishItem[], tries: number): Promise<void> => {
    const user = JSON.stringify({
      deck: session.deckName,
      cards_in_deck: context,
      batch: batch.map((it) => ({
        id: it.aiId,
        ...(it.siblingGroup ? { note: it.siblingGroup } : {}),
        type: it.original.kind,
        front: it.original.front,
        back: it.original.back,
      })),
    });
    const reply = await askModel(key, session, user, signal);
    const results = parseReply(reply.text);
    const byId = new Map(results.map((r) => [normalizeId(r.id), r]));
    const missing: PolishItem[] = [];
    for (const it of batch) {
      const r = byId.get(it.aiId);
      if (r) {
        applyResult(it, r, byAiId);
        onProgress({ done: ++done, total: todo.length });
      } else missing.push(it);
    }
    if (!missing.length || signal.aborted) return;
    if (tries >= MAX_TRIES) {
      const why = reply.truncated
        ? "The model's reply was cut off."
        : results.length
          ? 'The model skipped this card.'
          : "The model's reply wasn't valid JSON.";
      for (const it of missing) {
        it.status = 'error';
        it.error = why;
        onProgress({ done: ++done, total: todo.length });
      }
      return;
    }
    // smaller batches mean shorter replies, which are less likely to break
    const half = Math.ceil(missing.length / 2);
    await polishBatch(missing.slice(0, half), tries + 1);
    if (half < missing.length) await polishBatch(missing.slice(half), tries + 1);
  };

  const worker = async () => {
    while (next < batches.length && !fatal && !signal.aborted) {
      const batch = batches[next++];
      try {
        await polishBatch(batch, 0);
      } catch (e) {
        if (signal.aborted) return;
        if (e instanceof PolishError && e.fatal) fatal = e;
        for (const it of batch) {
          if (it.status !== 'pending' && it.status !== 'error') continue;
          it.status = 'error';
          it.error = e instanceof Error ? e.message : String(e);
        }
        done = todo.filter((it) => it.status !== 'pending').length;
        onProgress({ done, total: todo.length });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
  resolveDuplicates(session.items);
  if (fatal) throw fatal;
}

// ---------------------------------------------------------------- creating

const NOTE_KIND: Record<DraftKind, NoteKind> = { basic: 'basic', reversed: 'reversed', cloze: 'cloze' };

export function draftFields(d: Pick<DraftCard, 'kind' | 'front' | 'back'>): Record<string, string> {
  return d.kind === 'cloze' ? { Text: d.front, 'Back Extra': d.back } : { Front: d.front, Back: d.back };
}

/** Why a draft card can't be created, or null. */
export function draftProblem(d: DraftCard): string | null {
  return noteProblem({ id: 0, kind: NOTE_KIND[d.kind], fields: draftFields(d), tags: [], mtime: 0 });
}

/** The draft cards that will be created, with their items. */
export function cardsToCreate(items: PolishItem[]): { item: PolishItem; draft: DraftCard }[] {
  const out: { item: PolishItem; draft: DraftCard }[] = [];
  for (const it of items) {
    if (it.choice === 'polished') for (const d of it.cards) out.push({ item: it, draft: d });
    for (const d of it.added) if (d.include) out.push({ item: it, draft: d });
  }
  return out;
}

/** How many cards confirming will create (reversed and multi-cloze notes make several). */
export function countCardsToCreate(items: PolishItem[]): { total: number; added: number } {
  const count = (kind: NoteKind, fields: Record<string, string>) => generateCards({ id: 0, kind, fields, tags: [], mtime: 0 }, '').length;
  let total = 0;
  let added = 0;
  for (const it of items) {
    if (it.choice === 'original') total += it.note ? count(it.note.kind, it.note.fields) : 1;
    for (const { draft } of cardsToCreate([it])) {
      const n = count(NOTE_KIND[draft.kind], draftFields(draft));
      total += n;
      if (it.added.includes(draft)) added += n;
    }
  }
  return { total, added };
}

/** "<deck> - Polished", or "<deck> - Polished 2" and so on if taken. */
export function polishedDeckName(deckName: string): string {
  const base = `${deckName} - Polished`;
  let name = base;
  for (let n = 2; col.deckByName(name); n++) name = `${base} ${n}`;
  return name;
}

/** Creates the polished deck next to the original (same parent, same
 * options preset), with subdecks mirroring the original's. Returns its name
 * and the number of cards made. */
export async function createPolishedDeck(session: PolishSession): Promise<{ name: string; cards: number }> {
  const rootName = polishedDeckName(session.deckName);
  const decks = new Map<string, Id>();
  const deckFor = async (originalName: string): Promise<Id> => {
    const rel = originalName.startsWith(session.deckName) ? originalName.slice(session.deckName.length) : '';
    const name = rootName + rel;
    let id = decks.get(name);
    if (id === undefined) {
      const deck = await col.addDeck(name, false);
      const source = col.deckByName(originalName) ?? col.decks.get(session.deckId);
      await col.updateDeck({ ...deck, configId: source?.configId, description: source?.description ?? '' });
      id = deck.id;
      decks.set(name, id);
    }
    return id;
  };

  await deckFor(session.deckName);
  let made = 0;
  for (const it of session.items) {
    const deckId = await deckFor(it.deckName);
    const keepOriginal = it.choice === 'original';
    if (keepOriginal && it.note) {
      made += (await col.addNote(it.note.kind, { ...it.note.fields }, [...it.tags], deckId, false)).length;
    } else if (keepOriginal && it.card) {
      await col.copyCard(it.card, deckId, false);
      made++;
    } else if (it.choice === 'polished') {
      for (const d of it.cards) made += (await col.addNote(NOTE_KIND[d.kind], draftFields(d), [...it.tags], deckId, false)).length;
    }
    for (const d of it.added) {
      if (d.include) made += (await col.addNote(NOTE_KIND[d.kind], draftFields(d), [...it.tags], deckId, false)).length;
    }
  }
  // re-saving the root deck refreshes the screen
  const root = col.deckByName(rootName);
  if (root) await col.updateDeck(root);
  return { name: rootName, cards: made };
}
