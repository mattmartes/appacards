// Converts a parsed Anki package into this app's decks, cards and review log.

import { readAnkiPackage, type AnkiDeckConfig, type AnkiPackage } from './apkg';
import { col } from './collection';
import { ancestorNames } from './deckTree';
import { FSRS, FSRS6_DEFAULT_PARAMETERS } from './fsrs';
import { groupRevlogByCard } from './fsrsDataset';
import { renderOcclusionCard } from './imageOcclusion';
import { renderCard } from './template';
import { dayNumber, dayStartMs, nowSecs, today } from './time';
import { DEFAULT_PRESET, DEFAULT_PRESET_ID, type Card, type Deck, type Id, type Preset, type Queue, type RevlogEntry } from './types';

export interface ImportPreview {
  pkg: AnkiPackage;
  fileName: string;
  noteCount: number;
  cardCount: number;
  /** cards already in this collection (same id), which are skipped */
  duplicateCount: number;
  revlogCount: number;
  mediaCount: number;
  deckNames: string[];
  /** deck option presets used by the imported decks */
  presets: { ankiId: number; config: AnkiDeckConfig; deckCount: number; exists: boolean }[];
}

export interface ImportSummary {
  cards: number;
  reviews: number;
  media: number;
  decks: number;
  presets: number;
  skipped: number;
}

export async function previewAnkiFile(file: File): Promise<ImportPreview> {
  const pkg = await readAnkiPackage(file);
  const homeDeck = (c: AnkiPackage['cards'][number]) => (c.odid ? c.odid : c.did);
  const deckIds = new Set(pkg.cards.map(homeDeck));
  // Presets of the imported decks and their parents.
  const usedDecks = [...pkg.decks.entries()].filter(([id, d]) =>
    [...deckIds].some((cid) => {
      const name = pkg.decks.get(cid)?.name ?? '';
      return name === d.name || name.startsWith(d.name + '::') || id === cid;
    }),
  );
  const deckCount = new Map<number, number>();
  for (const [, d] of usedDecks) if (d.configId != null) deckCount.set(d.configId, (deckCount.get(d.configId) ?? 0) + 1);
  // Empty parameters mean "Anki's defaults". Released Anki (25.09) uses FSRS-6
  // defaults, which it records as decay 0.1542 in each card's data.
  const fsrs6Defaults = pkg.cards.some((c) => /"decay":0\.154/.test(c.data));
  const existingNames = new Set(col.presetList().map((p) => p.name));
  const presets = [...deckCount.entries()].flatMap(([ankiId, count]) => {
    const config = pkg.deckConfigs.get(ankiId);
    if (!config) return [];
    const withParams = !config.params.length && fsrs6Defaults ? { ...config, params: [...FSRS6_DEFAULT_PARAMETERS] } : config;
    return [{ ankiId, config: withParams, deckCount: count, exists: existingNames.has(config.name) }];
  });
  return {
    pkg,
    fileName: file.name,
    noteCount: pkg.notes.size,
    cardCount: pkg.cards.length,
    duplicateCount: pkg.cards.filter((c) => col.cards.has(c.id)).length,
    revlogCount: pkg.revlog.length,
    mediaCount: pkg.media.size,
    deckNames: [...deckIds].map((id) => pkg.decks.get(id)?.name ?? 'Default').sort(),
    presets,
  };
}

function mapQueue(queue: number): Queue {
  if (queue === -2 || queue === -3) return -3;
  if (queue === 4) return 1; // preview
  return queue as Queue;
}

export async function importAnki(
  preview: ImportPreview,
  opts: { importPresets: boolean },
  onStatus: (text: string) => void,
): Promise<ImportSummary> {
  const { pkg } = preview;
  let nextId = Date.now();

  // Presets: reuse one with the same name, otherwise create it.
  const newPresets: Preset[] = [];
  const presetIdFor = new Map<number, Id>();
  if (opts.importPresets) {
    const byName = new Map(col.presetList().map((p) => [p.name, p]));
    for (const { ankiId, config } of preview.presets) {
      let preset = byName.get(config.name);
      if (!preset) {
        let params = config.params.map((v) => Math.fround(v));
        try {
          new FSRS(params);
        } catch {
          params = []; // unusable parameters: fall back to defaults
        }
        preset = { ...DEFAULT_PRESET, ...config, params, id: nextId++, mtime: nowSecs() };
        byName.set(config.name, preset);
        newPresets.push(preset);
      }
      presetIdFor.set(ankiId, preset.id);
    }
  }

  // Decks, matched by name and created (with their parents) only when a card
  // needs them.
  const newDecks: Deck[] = [];
  const existingByName = new Map(col.deckList().map((d) => [d.name, d]));
  const pkgDeckByName = new Map([...pkg.decks.values()].map((d) => [d.name, d]));
  const deckFor = (ankiId: number): Deck => {
    const name = pkg.decks.get(ankiId)?.name ?? 'Default';
    let deck: Deck | undefined;
    for (const n of ancestorNames(name)) {
      deck = existingByName.get(n);
      if (!deck) {
        const src = pkgDeckByName.get(n);
        deck = {
          id: nextId++,
          name: n,
          description: '',
          configId: (src?.configId != null && presetIdFor.get(src.configId)) || DEFAULT_PRESET_ID,
          reviewLimit: src?.reviewLimit ?? null,
          newLimit: src?.newLimit ?? null,
          today: { day: today(), newDone: 0, revDone: 0 },
        };
        existingByName.set(n, deck);
        newDecks.push(deck);
      }
    }
    return deck!;
  };

  // Review log: drop cramming and other unrated entries except resets.
  onStatus('Converting review history…');
  const revlog: RevlogEntry[] = [];
  const importingIds = new Set(pkg.cards.filter((c) => !col.cards.has(c.id)).map((c) => c.id));
  for (const r of pkg.revlog) {
    if (!importingIds.has(r.cid)) continue;
    const reset = r.type === 4 && r.factor === 0;
    if (r.ease === 0 && !reset) continue;
    if (r.type === 3 && r.factor === 0) continue; // cramming
    if (r.type > 4) continue; // rescheduled
    revlog.push({
      id: r.id,
      cardId: r.cid,
      rating: reset ? 0 : (Math.min(Math.max(r.ease, 1), 4) as 1 | 2 | 3 | 4),
      ivl: r.ivl,
      lastIvl: r.lastIvl,
      stability: 0,
      difficulty: 0,
      retrievability: null,
      elapsedDays: 0,
      time: r.time,
      kind: reset ? 4 : r.type,
    });
  }
  const historyByCard = groupRevlogByCard(revlog);
  for (const entries of historyByCard.values()) {
    let prev: number | null = null;
    for (const e of entries) {
      if (e.rating === 0) continue;
      const day = dayNumber(e.id);
      e.elapsedDays = prev === null ? 0 : Math.max(0, day - prev);
      prev = day;
    }
  }

  // Cards.
  onStatus('Rendering cards…');
  const crtDay = dayNumber(pkg.crt * 1000);
  // FSRS model of each deck's preset (some presets are new and unsaved yet)
  const fsrsCache = new Map<Id, FSRS>();
  const fsrsForDeck = (deck: Deck) => {
    const id = deck.configId ?? DEFAULT_PRESET_ID;
    let f = fsrsCache.get(id);
    if (!f) {
      const p = newPresets.find((x) => x.id === id) ?? col.presetFor(deck);
      f = new FSRS(p.params, p.relearnSteps.length);
      fsrsCache.set(id, f);
    }
    return f;
  };
  const now = nowSecs();
  const newPosOffset = [...col.cards.values()].reduce((m, c) => (c.type === 0 ? Math.max(m, c.due) : m), 0);
  const cards: Card[] = [];
  let skipped = 0;
  for (const ac of pkg.cards) {
    if (col.cards.has(ac.id)) {
      skipped++;
      continue;
    }
    const note = pkg.notes.get(ac.nid);
    const nt = note && pkg.noteTypes.get(note.mid);
    if (!note || !nt) {
      skipped++;
      continue;
    }
    const tmpl = nt.cloze ? nt.templates[0] : nt.templates[ac.ord];
    if (!tmpl) {
      skipped++;
      continue;
    }
    const homeDid = ac.odid || ac.did;
    const deck = deckFor(homeDid);
    const fields = Object.fromEntries(nt.fields.map((name, i) => [name, note.fields[i] ?? '']));
    // Anki draws image occlusion masks with a template script, which isn't
    // run here, so those notes are rendered with our own mask renderer.
    const isOcclusion = nt.cloze && 'Occlusion' in fields && 'Image' in fields && /image-occlusion/.test(tmpl.qfmt);
    const rendered = isOcclusion
      ? (() => {
          const io = { occlusion: fields.Occlusion, image: fields.Image, header: fields.Header ?? '', backExtra: fields['Back Extra'] ?? '' };
          return {
            front: renderOcclusionCard(io, ac.ord + 1, true),
            back: renderOcclusionCard(io, ac.ord + 1, false),
            answerReplacesFront: true,
          };
        })()
      : renderCard(tmpl.qfmt, tmpl.afmt, {
          fields,
          tags: note.tags,
          noteType: nt.name,
          deck: deck.name,
          cardName: tmpl.name,
          clozeOrd: ac.ord + 1,
        });

    const type = Math.min(Math.max(ac.type, 0), 3) as Card['type'];
    const queue = mapQueue(ac.queue);
    let due = ac.odid ? ac.odue : ac.due;
    // Review days count from the collection's creation; learning cards in
    // queue 1 use epoch seconds; new cards keep their order after ours.
    if (type === 0) due += newPosOffset;
    else if (!(due > 1_000_000_000)) due = crtDay + due;

    let data: { s?: number; d?: number; lrt?: number } = {};
    try {
      data = JSON.parse(ac.data || '{}');
    } catch {
      // ignore malformed card data
    }
    const history = historyByCard.get(ac.id) ?? [];
    const lastRated = [...history].reverse().find((e) => e.rating > 0);
    const lastReview =
      data.lrt ??
      (lastRated ? Math.floor(lastRated.id / 1000) : type === 2 ? Math.floor(dayStartMs(due - ac.ivl) / 1000) : null);

    // Memory state: Anki's stored FSRS state if any, otherwise derived from
    // SM-2 ease/interval. Cards with full history are recomputed below.
    let stability: number | null = null;
    let difficulty: number | null = null;
    let stabilityFast: number | null = null;
    if (type !== 0) {
      if (data.s && data.d) {
        stability = data.s;
        difficulty = data.d;
        stabilityFast = data.s;
      } else {
        const m = fsrsForDeck(deck).memoryStateFromSm2((ac.factor || 2500) / 1000, Math.max(ac.ivl, 1));
        if (m) ({ stability, difficulty, stabilityFast } = m);
      }
    }

    cards.push({
      id: ac.id,
      deckId: deck.id,
      front: rendered.front,
      back: rendered.back,
      answerReplacesFront: rendered.answerReplacesFront || undefined,
      ankiNoteId: ac.nid,
      ord: ac.ord,
      tags: note.tags,
      type,
      queue,
      due,
      ivl: ac.ivl,
      reps: ac.reps,
      lapses: ac.lapses,
      left: ac.left % 1000,
      stability,
      difficulty,
      stabilityFast,
      lastReview,
      flag: ac.flags & 7,
      created: Math.floor(ac.nid / 1000),
      mtime: now,
    });
  }

  // Media referenced by any imported card.
  onStatus('Copying media…');
  const media = new Map<string, Blob>();
  const html = cards.map((c) => c.front + c.back).join('\n');
  for (const [name, load] of pkg.media) {
    if (html.includes(name) || html.includes(encodeURI(name))) media.set(name, await load());
  }

  onStatus('Saving…');
  await col.bulkImport({ presets: newPresets, decks: newDecks, cards, revlog, media });

  onStatus('Computing memory states from history…');
  await col.recomputeMemoryStates(new Set<Id>(cards.map((c) => c.id)));

  return { cards: cards.length, reviews: revlog.length, media: media.size, decks: newDecks.length, presets: newPresets.length, skipped };
}
