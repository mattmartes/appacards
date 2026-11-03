// AI-generated alternate wordings of card fronts. The reviewer shows a
// random one each time, so you recall the answer from what's asked rather
// than recognizing the card by its exact sentence.

import { col } from './collection';
import { askModel, cleanHtml, parseReply, type ModelOptions } from './polish';
import { stripHtml } from './template';
import { MAX_WORDINGS, type Card } from './types';

const BATCH_SIZE = 20;
const CONCURRENCY = 3;

const SYSTEM_PROMPT = `You rewrite the questions (fronts) of flashcards. For each card, write the requested number of alternative wordings of its front. Each must ask exactly the same thing and have exactly the same answer (the card's back).

Vary the sentence so the card can't be recognized by its shape: different structure (question vs. statement to complete vs. instruction), different verbs, reordered clauses, synonyms for everyday words.

Rules:
- Never add hints or information that gives away the answer, and never make the question vaguer or broader.
- Keep technical terms the answer depends on, numbers, units and notation exactly.
- If the front is a single term or a definition (e.g. the reverse side of a card), use short prompts like "Define X", "What is X?", "Which term means: ...".
- Keep any <img ...> and [sound:...] tags exactly as they are.
- Plain text, optionally with <b>, <i>, <u>, <sub>, <sup>, <br>. Write in the card's language.

Reply with JSON only: {"results":[{"id":"<card id>","fronts":["...", "..."]}]}`;

/** Cards whose front can be reworded: not cloze or image occlusion (their
 * fronts are made of blanks and masks) and not smart cards (their wordings
 * live in the smart note). */
export function canReword(card: Card): boolean {
  const note = card.noteId !== undefined ? col.notes.get(card.noteId) : undefined;
  if (note && (note.kind === 'cloze' || note.kind === 'imageOcclusion' || note.kind === 'smart')) return false;
  return !/class="(io-card|cloze)"/.test(card.front) && stripHtml(card.front).trim() !== '';
}

/** The answer text of a card, without the repeated question. */
function answerText(card: Card): string {
  const m = /<hr id=["']?answer["']?\s*\/?>/i.exec(card.back);
  return m ? card.back.slice(m.index + m[0].length) : card.back;
}

const same = (a: string, b: string) => stripHtml(a).replace(/\s+/g, ' ').trim().toLowerCase() === stripHtml(b).replace(/\s+/g, ' ').trim().toLowerCase();

/** Rough cost in USD, from a model's per-token prices. */
export function estimateWordingCost(cards: Card[], count: number, prompt?: string, completion?: string): number | null {
  const pIn = Number(prompt);
  const pOut = Number(completion);
  if (!Number.isFinite(pIn) || !Number.isFinite(pOut)) return null;
  const chars = cards.reduce((n, c) => n + c.front.length + answerText(c).length + 30, 0);
  const frontChars = cards.reduce((n, c) => n + c.front.length + 10, 0);
  const batches = Math.ceil(cards.length / BATCH_SIZE);
  return ((batches * SYSTEM_PROMPT.length + chars) / 4) * pIn + ((frontChars * count * 1.3) / 4) * pOut;
}

export interface WordingProgress {
  done: number;
  total: number;
}

/** Asks for `count` wordings per card and saves them on the cards as each
 * batch comes back. Returns how many cards got wordings. */
export async function generateWordings(
  cards: Card[],
  count: number,
  key: string,
  model: ModelOptions,
  signal: AbortSignal,
  onProgress: (p: WordingProgress) => void,
): Promise<number> {
  const n = Math.max(1, Math.min(MAX_WORDINGS, count));
  const batches: Card[][] = [];
  for (let i = 0; i < cards.length; i += BATCH_SIZE) batches.push(cards.slice(i, i + BATCH_SIZE));
  let done = 0;
  let updated = 0;
  let next = 0;
  let fatal: Error | null = null;
  onProgress({ done, total: cards.length });

  const runBatch = async (batch: Card[], retry: boolean): Promise<void> => {
    const ids = new Map(batch.map((c, i) => [`c${i + 1}`, c]));
    const user = JSON.stringify({
      wordings_per_card: n,
      cards: [...ids].map(([id, c]) => ({ id, front: c.front, back: answerText(c) })),
    });
    const reply = await askModel(key, model, user, signal, SYSTEM_PROMPT);
    const results = parseReply(reply.text) as unknown as { id?: unknown; fronts?: unknown }[];
    const got = new Map<Card, string[]>();
    for (const r of results) {
      const card = ids.get(String(r.id ?? '').replace(/[[\]\s"]/g, '').toLowerCase());
      if (!card || !Array.isArray(r.fronts)) continue;
      const fronts: string[] = [];
      for (const f of r.fronts) {
        const html = cleanHtml(String(f ?? ''));
        if (stripHtml(html).trim() && !same(html, card.front) && !fronts.some((x) => same(x, html))) fronts.push(html);
      }
      if (fronts.length) got.set(card, fronts.slice(0, n));
    }
    if (got.size) {
      // the cards may have changed while waiting
      const fresh = [...got].map(([c, fronts]) => ({ ...(col.cards.get(c.id) ?? c), altFronts: fronts }));
      await col.updateCards(fresh);
      updated += fresh.length;
      done += fresh.length;
      onProgress({ done, total: cards.length });
    }
    const missing = batch.filter((c) => !got.has(c));
    if (!missing.length || signal.aborted) return;
    if (retry) return runBatch(missing, false);
    done += missing.length;
    onProgress({ done, total: cards.length });
  };

  const worker = async () => {
    while (next < batches.length && !fatal && !signal.aborted) {
      const batch = batches[next++];
      try {
        await runBatch(batch, true);
      } catch (e) {
        if (signal.aborted) return;
        // a bad key or no credits stops everything; other errors skip the batch
        if ((e as { fatal?: boolean }).fatal) fatal = e as Error;
        done += batch.length;
        onProgress({ done: Math.min(done, cards.length), total: cards.length });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
  if (fatal) throw fatal;
  return updated;
}
