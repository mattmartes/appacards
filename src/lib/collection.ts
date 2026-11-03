// In-memory collection backed by IndexedDB. Every mutation is written through
// to the database and bumps `version` so React re-renders.

import { openDB, type IDBPDatabase } from 'idb';
import { useSyncExternalStore } from 'react';
import { ancestorNames, isWithin, sortDecks } from './deckTree';
import type { FSRS, Rating } from './fsrs';
import { groupRevlogByCard, reviewsForFsrs, toFsrsReviews } from './fsrsDataset';
import { setMediaUrl } from './media';
import { generateCards } from './noteTypes';
import { buildQueue, type BuiltQueue } from './queue';
import { answerCard, fsrsFor, nextStates, retrievabilityNow } from './scheduler';
import { nowSecs, setRolloverHour, today } from './time';
import {
  DEFAULT_PREFERENCES,
  DEFAULT_PRESET,
  DEFAULT_PRESET_ID,
  type Card,
  type Deck,
  type Id,
  type DeckFile,
  GRID_NOTE_EXT,
  GRID_NOTE_TYPE,
  type Lesson,
  type MissedQuestion,
  type QuizQuestion,
  type QuizSet,
  type Note,
  type NoteKind,
  type Preferences,
  type Preset,
  type RevlogEntry,
  type Settings,
} from './types';

const DB_NAME = 'fsrs-cards';

interface UndoEntry {
  card: Card;
  /** decks whose counters changed, before the answer */
  decks: Deck[];
  /** siblings buried by this answer, before burying */
  buried: Card[];
  revlogId: Id;
}

export interface QueueCounts {
  newCount: number;
  learnCount: number;
  reviewCount: number;
}

export interface Backup {
  format: 'fsrs-cards-backup';
  version: 1 | 2;
  /** version 1 only: the old global settings */
  settings?: Partial<Preset> & Partial<Preferences>;
  presets?: Preset[];
  prefs?: Preferences;
  decks: Deck[];
  cards: Card[];
  /** absent in backups made before notes existed */
  notes?: Note[];
  revlog: RevlogEntry[];
  /** Learn tab lessons; absent in older backups */
  lessons?: Lesson[];
  /** custom quizzes; absent in older backups */
  quizSets?: QuizSet[];
  /** files in decks' Notes (their bytes are saved with media); absent in older backups */
  deckFiles?: DeckFile[];
}

let lastId = 0;
/** Millisecond-timestamp ids like Anki, kept unique within this session. */
/** right answers in a row that retire a missed question */
export const MISSED_RETIRE_STREAK = 2;

export interface QuizStat {
  asked: number;
  wrong: number;
  /** epoch ms */
  last: number;
}

/** meta-store key prefix for lessons */
const LESSON_KEY = 'lesson:';
/** meta-store key prefix for custom quiz sets */
const QUIZ_SET_KEY = 'quizset:';

/** stability (days) a smart note's cards need before combination cards built on it are shown */
export const UNLOCK_STABILITY_DAYS = 7;

export function newId(): Id {
  lastId = Math.max(Date.now(), lastId + 1);
  return lastId;
}

/** Old single-settings format -> Default preset + preferences. */
function migrateSettings(old: Record<string, unknown> | undefined): { preset: Preset; prefs: Preferences } {
  const pick = <T,>(k: string, fallback: T): T => (old && k in old ? (old[k] as T) : fallback);
  return {
    preset: {
      ...DEFAULT_PRESET,
      params: pick('params', DEFAULT_PRESET.params),
      desiredRetention: pick('desiredRetention', DEFAULT_PRESET.desiredRetention),
      learnSteps: pick('learnSteps', DEFAULT_PRESET.learnSteps),
      relearnSteps: pick('relearnSteps', DEFAULT_PRESET.relearnSteps),
      maxInterval: pick('maxInterval', DEFAULT_PRESET.maxInterval),
      newPerDay: pick('newPerDay', DEFAULT_PRESET.newPerDay),
      reviewsPerDay: pick('reviewsPerDay', DEFAULT_PRESET.reviewsPerDay),
      leechThreshold: pick('leechThreshold', DEFAULT_PRESET.leechThreshold),
      leechAction: pick('leechAction', DEFAULT_PRESET.leechAction),
    },
    prefs: {
      ...DEFAULT_PREFERENCES,
      learnAheadMins: pick('learnAheadMins', DEFAULT_PREFERENCES.learnAheadMins),
      fuzz: pick('fuzz', DEFAULT_PREFERENCES.fuzz),
    },
  };
}

class Collection {
  db!: IDBPDatabase;
  prefs: Preferences = DEFAULT_PREFERENCES;
  presets = new Map<Id, Preset>();
  decks = new Map<Id, Deck>();
  cards = new Map<Id, Card>();
  notes = new Map<Id, Note>();
  lessons = new Map<Id, Lesson>();
  /** per card: how often quizzes asked about it and got it wrong */
  quizStats = new Map<Id, QuizStat>();
  /** quiz questions answered wrong, by question text, to ask again */
  quizMissed = new Map<string, MissedQuestion>();
  /** custom quizzes from your own files */
  quizSets = new Map<Id, QuizSet>();
  /** files uploaded to decks' Notes */
  deckFiles = new Map<string, DeckFile>();
  revlog: RevlogEntry[] = [];
  version = 0;
  /** object URL of the UI background image, if one is set */
  backgroundUrl: string | null = null;
  private listeners = new Set<() => void>();
  private undoStack: UndoEntry[] = [];
  private fsrsCache = new Map<string, FSRS>();
  /** study session: the main queue is built once and consumed, as in Anki */
  private session: { rootId: Id; day: number; main: Id[]; counts: QueueCounts } | null = null;

  async open() {
    this.db = await openDB(DB_NAME, 3, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('meta');
          db.createObjectStore('decks', { keyPath: 'id' });
          db.createObjectStore('cards', { keyPath: 'id' });
          db.createObjectStore('revlog', { keyPath: 'id' });
        }
        if (oldVersion < 2) db.createObjectStore('media');
        if (oldVersion < 3) {
          db.createObjectStore('notes', { keyPath: 'id' });
          db.createObjectStore('presets', { keyPath: 'id' });
        }
      },
    });
    for (const p of await this.db.getAll('presets')) this.presets.set(p.id, { ...DEFAULT_PRESET, ...p });
    const savedPrefs = await this.db.get('meta', 'prefs');
    if (this.presets.size === 0) {
      const { preset, prefs } = migrateSettings(await this.db.get('meta', 'settings'));
      await this.savePreset(preset, false);
      await this.setPrefs(savedPrefs ?? prefs, false);
    } else {
      this.prefs = { ...DEFAULT_PREFERENCES, ...(savedPrefs ?? {}) };
    }
    setRolloverHour(this.prefs.rolloverHour);
    for (const d of await this.db.getAll('decks')) this.decks.set(d.id, d);
    for (const c of await this.db.getAll('cards')) this.cards.set(c.id, c);
    for (const n of await this.db.getAll('notes')) this.notes.set(n.id, n);
    this.revlog = await this.db.getAll('revlog');
    const quiz = (await this.db.get('meta', 'quizStats')) as [Id, QuizStat][] | undefined;
    if (Array.isArray(quiz)) this.quizStats = new Map(quiz);
    const files = (await this.db.get('meta', 'deckFiles')) as DeckFile[] | undefined;
    if (Array.isArray(files)) this.deckFiles = new Map(files.map((f) => [f.id, f]));
    const missed = (await this.db.get('meta', 'quizMissed')) as MissedQuestion[] | undefined;
    if (Array.isArray(missed)) this.quizMissed = new Map(missed.map((m) => [m.q.question, m]));
    for (const key of await this.db.getAllKeys('meta')) {
      if (String(key).startsWith(LESSON_KEY)) {
        const l = (await this.db.get('meta', key)) as Lesson | undefined;
        if (l) this.lessons.set(l.id, l);
      } else if (String(key).startsWith(QUIZ_SET_KEY)) {
        const q = (await this.db.get('meta', key)) as QuizSet | undefined;
        if (q) this.quizSets.set(q.id, q);
      }
    }
    let cursor = await this.db.transaction('media').store.openCursor();
    while (cursor) {
      setMediaUrl(String(cursor.key), cursor.value as Blob);
      cursor = await cursor.continue();
    }
    const bg = await this.db.get('meta', 'backgroundImage');
    if (bg instanceof Blob) this.backgroundUrl = URL.createObjectURL(bg);
    if (this.decks.size === 0) await this.addDeck('Default');
    await this.ensureParents();
    await this.unburyIfNewDay();
    this.bump();
  }

  // ---------------------------------------------------------- reactivity

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private bump() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  private async putCards(cards: Card[]) {
    const tx = this.db.transaction('cards', 'readwrite');
    for (const c of cards) {
      this.cards.set(c.id, c);
      tx.store.put(c);
    }
    await tx.done;
  }

  private async putDecks(decks: Deck[]) {
    const tx = this.db.transaction('decks', 'readwrite');
    for (const d of decks) {
      this.decks.set(d.id, d);
      tx.store.put(d);
    }
    await tx.done;
  }

  private async unburyIfNewDay() {
    const t = today();
    if ((await this.db.get('meta', 'lastUnburyDay')) === t) return;
    const buried = [...this.cards.values()].filter((c) => c.queue === -3);
    await this.putCards(buried.map((c) => ({ ...c, queue: queueForType(c) })));
    await this.db.put('meta', t, 'lastUnburyDay');
  }

  // ---------------------------------------------------------- preferences & presets

  async setPrefs(prefs: Preferences, notify = true) {
    this.prefs = prefs;
    setRolloverHour(prefs.rolloverHour);
    await this.db.put('meta', prefs, 'prefs');
    this.session = null;
    if (notify) this.bump();
  }

  private prefsWrite: ReturnType<typeof setTimeout> | null = null;

  /** Updates preferences immediately on screen and saves them shortly after,
   * for controls like sliders that change continuously. */
  previewPrefs(patch: Partial<Preferences>) {
    this.prefs = { ...this.prefs, ...patch };
    this.bump();
    if (this.prefsWrite) clearTimeout(this.prefsWrite);
    this.prefsWrite = setTimeout(() => this.db.put('meta', this.prefs, 'prefs'), 300);
  }

  /** Sets or clears (null) the UI background image. */
  async setBackground(blob: Blob | null) {
    if (this.backgroundUrl) URL.revokeObjectURL(this.backgroundUrl);
    this.backgroundUrl = blob ? URL.createObjectURL(blob) : null;
    if (blob) await this.db.put('meta', blob, 'backgroundImage');
    else await this.db.delete('meta', 'backgroundImage');
    this.bump();
  }

  async backgroundBlob(): Promise<Blob | null> {
    const b = await this.db.get('meta', 'backgroundImage');
    return b instanceof Blob ? b : null;
  }

  presetList(): Preset[] {
    return [...this.presets.values()].sort((a, b) => (a.id === DEFAULT_PRESET_ID ? -1 : b.id === DEFAULT_PRESET_ID ? 1 : a.name.localeCompare(b.name)));
  }

  presetFor(deck: Deck | Id | undefined): Preset {
    const d = typeof deck === 'number' ? this.decks.get(deck) : deck;
    return this.presets.get(d?.configId ?? DEFAULT_PRESET_ID) ?? this.presets.get(DEFAULT_PRESET_ID) ?? DEFAULT_PRESET;
  }

  /** Scheduler settings for cards in `deckId`: its preset, with the deck's
   * desired-retention override and the fuzz preference. */
  configFor(deckId: Id): Settings {
    const deck = this.decks.get(deckId);
    const p = this.presetFor(deck);
    return {
      params: p.params,
      desiredRetention: deck?.desiredRetention ?? p.desiredRetention,
      learnSteps: p.learnSteps,
      relearnSteps: p.relearnSteps,
      maxInterval: p.maxInterval,
      leechThreshold: p.leechThreshold,
      leechAction: p.leechAction,
      fuzz: this.prefs.fuzz,
    };
  }

  /** FSRS model for a deck's preset (cached). */
  fsrsFor(deckId: Id): FSRS {
    const s = this.configFor(deckId);
    const key = `${s.params.join(',')}|${s.relearnSteps.length}`;
    let f = this.fsrsCache.get(key);
    if (!f) {
      f = fsrsFor(s);
      this.fsrsCache.set(key, f);
    }
    return f;
  }

  retrievability(card: Card): number | null {
    return retrievabilityNow(card, this.fsrsFor(card.deckId));
  }

  async savePreset(p: Preset, notify = true) {
    fsrsFor({ ...this.configFor(0), params: p.params, relearnSteps: p.relearnSteps }); // throws on invalid params
    const saved = { ...p, mtime: nowSecs() };
    this.presets.set(p.id, saved);
    await this.db.put('presets', saved);
    this.session = null;
    if (notify) this.bump();
    return saved;
  }

  async addPreset(name: string, cloneFrom?: Preset): Promise<Preset> {
    return this.savePreset({ ...(cloneFrom ?? DEFAULT_PRESET), id: newId(), name });
  }

  /** Decks using a removed preset go back to Default, as in Anki. */
  async deletePreset(id: Id) {
    if (id === DEFAULT_PRESET_ID) throw new Error('The Default preset cannot be removed.');
    this.presets.delete(id);
    await this.db.delete('presets', id);
    const users = [...this.decks.values()].filter((d) => d.configId === id);
    await this.putDecks(users.map((d) => ({ ...d, configId: DEFAULT_PRESET_ID })));
    this.session = null;
    this.bump();
  }

  decksUsingPreset(id: Id): Deck[] {
    return [...this.decks.values()].filter((d) => (d.configId ?? DEFAULT_PRESET_ID) === id);
  }

  /** Rebuilds reviewed cards' memory states by replaying their review history
   * with their preset's parameters, as Anki does when params change. Cards
   * whose history doesn't reach back to their last learning step (e.g.
   * imported with partial history) keep their current state. */
  async recomputeMemoryStates(onlyIds?: Set<Id>): Promise<number> {
    const updated: Card[] = [];
    for (const [cardId, all] of groupRevlogByCard(this.revlog)) {
      if (onlyIds && !onlyIds.has(cardId)) continue;
      const card = this.cards.get(cardId);
      if (!card || card.type === 0) continue;
      const entries = reviewsForFsrs(all, false);
      if (!entries?.length || entries[0].kind !== 0) continue;
      const m = this.fsrsFor(card.deckId).memoryStateFromHistory(
        toFsrsReviews(entries).map((r) => ({ rating: r.rating as Rating, daysElapsed: r.deltaT })),
      );
      if (m) updated.push({ ...card, stability: m.stability, difficulty: m.difficulty, stabilityFast: m.stabilityFast });
    }
    await this.putCards(updated);
    this.bump();
    return updated.length;
  }

  // ---------------------------------------------------------- decks

  /** Decks in tree order. */
  deckList(): Deck[] {
    return sortDecks([...this.decks.values()]);
  }

  deckByName(name: string) {
    return [...this.decks.values()].find((d) => d.name === name);
  }

  /** Creates a deck and any missing parents (Anki does the same). New decks
   * use the Default preset. */
  async addDeck(name: string, notify = true): Promise<Deck> {
    const clean = name
      .split('::')
      .map((s) => s.trim())
      .filter(Boolean)
      .join('::');
    let deck: Deck | undefined;
    for (const n of ancestorNames(clean)) {
      deck = this.deckByName(n);
      if (!deck) {
        deck = { id: newId(), name: n, description: '', configId: DEFAULT_PRESET_ID, today: { day: today(), newDone: 0, revDone: 0 } };
        await this.putDecks([deck]);
      }
    }
    if (notify) this.bump();
    return deck!;
  }

  private async ensureParents() {
    for (const d of [...this.decks.values()]) {
      for (const n of ancestorNames(d.name).slice(0, -1)) if (!this.deckByName(n)) await this.addDeck(n, false);
    }
  }

  /** Renames a deck and moves its subdecks with it. */
  async renameDeck(id: Id, name: string) {
    const deck = this.decks.get(id);
    if (!deck || !name.trim()) return;
    const target = name
      .split('::')
      .map((s) => s.trim())
      .filter(Boolean)
      .join('::');
    if (isWithin(target, deck.name) && target !== deck.name) throw new Error("A deck can't be moved inside itself.");
    const existing = this.deckByName(target);
    if (existing && existing.id !== id) throw new Error(`A deck named "${target}" already exists.`);
    const moved = [...this.decks.values()]
      .filter((d) => isWithin(d.name, deck.name))
      .map((d) => ({ ...d, name: target + d.name.slice(deck.name.length) }));
    await this.putDecks(moved);
    await this.ensureParents();
    this.session = null;
    this.bump();
  }

  async updateDeck(deck: Deck) {
    await this.putDecks([deck]);
    this.session = null;
    this.bump();
  }

  /** Deletes a deck, its subdecks and all their cards. */
  async deleteDeck(id: Id) {
    const deck = this.decks.get(id);
    if (!deck) return;
    const doomed = [...this.decks.values()].filter((d) => isWithin(d.name, deck.name));
    const ids = new Set(doomed.map((d) => d.id));
    await this.deleteCards([...this.cards.values()].filter((c) => ids.has(c.deckId)).map((c) => c.id));
    for (const d of doomed) {
      this.decks.delete(d.id);
      await this.db.delete('decks', d.id);
    }
    // its Notes files go with it
    const files = [...this.deckFiles.values()].filter((f) => ids.has(f.deckId));
    for (const f of files) {
      this.deckFiles.delete(f.id);
      await this.db.delete('media', f.media);
    }
    if (files.length) await this.db.put('meta', [...this.deckFiles.values()], 'deckFiles');
    if (this.decks.size === 0) await this.addDeck('Default', false);
    this.bump();
  }

  /** Cards in a deck and its subdecks. */
  subtreeCards(deckId: Id): Card[] {
    const deck = this.decks.get(deckId);
    if (!deck) return [];
    const ids = new Set([...this.decks.values()].filter((d) => isWithin(d.name, deck.name)).map((d) => d.id));
    return [...this.cards.values()].filter((c) => ids.has(c.deckId));
  }

  // ---------------------------------------------------------- cards

  private nextNewPosition() {
    return [...this.cards.values()].reduce((m, c) => (c.type === 0 ? Math.max(m, c.due) : m), 0) + 1;
  }

  private newCard(deckId: Id, front: string, back: string, tags: string[], due: number): Card {
    const now = nowSecs();
    return {
      id: newId(),
      deckId,
      front,
      back,
      tags,
      type: 0,
      queue: 0,
      due,
      ivl: 0,
      reps: 0,
      lapses: 0,
      left: 0,
      stability: null,
      difficulty: null,
      stabilityFast: null,
      lastReview: null,
      flag: 0,
      created: now,
      mtime: now,
    };
  }

  /** Adds Basic notes from front/back rows (bulk text import). */
  async addCards(deckId: Id, rows: { front: string; back: string; tags?: string[] }[]) {
    let n = 0;
    for (const r of rows) n += (await this.addNote('basic', { Front: r.front, Back: r.back }, r.tags ?? [], deckId, false)).length;
    this.bump();
    return n;
  }

  /** Adds a new, unscheduled card with another card's content. For imported
   * cards, which have no note to copy. */
  async copyCard(src: Card, deckId: Id, notify = true): Promise<Card> {
    const card: Card = {
      ...this.newCard(deckId, src.front, src.back, [...src.tags], this.nextNewPosition()),
      answerReplacesFront: src.answerReplacesFront,
    };
    await this.putCards([card]);
    this.session = null;
    if (notify) this.bump();
    return card;
  }

  // ---------------------------------------------------------- notes

  /** Adds a note and the cards it generates; returns the new cards. */
  async addNote(
    kind: NoteKind,
    fields: Record<string, string>,
    tags: string[],
    deckId: Id,
    notify = true,
    extra: Pick<Note, 'smart'> = {},
  ): Promise<Card[]> {
    const note: Note = { id: newId(), kind, fields, tags, mtime: nowSecs(), ...extra };
    const deckName = this.decks.get(deckId)?.name ?? '';
    // Siblings share a new-card position, as in Anki; "random" insertion
    // order places the note at a random position instead.
    const preset = this.presetFor(deckId);
    const due =
      preset.newInsertOrder === 'random' ? 1 + Math.floor(Math.random() * Math.max(this.nextNewPosition(), 1)) : this.nextNewPosition();
    const cards = generateCards(note, deckName).map((g) => ({
      ...this.newCard(deckId, g.front, g.back, tags, due),
      noteId: note.id,
      ord: g.ord,
      answerReplacesFront: g.answerReplacesFront || undefined,
    }));
    this.notes.set(note.id, note);
    await this.db.put('notes', note);
    await this.putCards(cards);
    this.session = null;
    if (notify) this.bump();
    return cards;
  }

  noteCards(noteId: Id): Card[] {
    return [...this.cards.values()].filter((c) => c.noteId === noteId).sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0));
  }

  /** Saves a note and re-renders its cards. New cloze numbers (or newly
   * filled reverse fields) get new cards in `deckForNewCards`; cards whose
   * cloze/template no longer applies are kept, as Anki keeps "empty cards". */
  async updateNote(note: Note, deckForNewCards: Id) {
    const updated: Note = { ...note, mtime: nowSecs() };
    const existing = new Map(this.noteCards(note.id).map((c) => [c.ord ?? 0, c]));
    const deckName = (id: Id) => this.decks.get(id)?.name ?? '';
    const generated = generateCards(updated, deckName(deckForNewCards));
    const due = this.nextNewPosition();
    const cards: Card[] = [];
    for (const g of generated) {
      const old = existing.get(g.ord);
      // Re-render with the card's own deck so {{Deck}} stays right.
      const r = old && old.deckId !== deckForNewCards ? generateCards(updated, deckName(old.deckId)).find((x) => x.ord === g.ord)! : g;
      cards.push(
        old
          ? {
              ...old,
              front: r.front,
              back: r.back,
              answerReplacesFront: r.answerReplacesFront || undefined,
              tags: updated.tags,
              // other wordings of an old question no longer fit
              altFronts: old.front === r.front ? old.altFronts : undefined,
            }
          : {
              ...this.newCard(deckForNewCards, g.front, g.back, updated.tags, due),
              noteId: note.id,
              ord: g.ord,
              answerReplacesFront: g.answerReplacesFront || undefined,
            },
      );
    }
    this.notes.set(note.id, updated);
    await this.db.put('notes', updated);
    await this.putCards(cards.map((c) => ({ ...c, mtime: nowSecs() })));
    this.bump();
    return cards;
  }

  async updateCards(cards: Card[]) {
    const now = nowSecs();
    await this.putCards(cards.map((c) => ({ ...c, mtime: now })));
    this.bump();
  }

  async deleteCards(ids: Id[]) {
    const idSet = new Set(ids);
    const tx = this.db.transaction(['cards', 'revlog'], 'readwrite');
    for (const id of ids) {
      this.cards.delete(id);
      tx.objectStore('cards').delete(id);
    }
    for (const r of this.revlog) if (idSet.has(r.cardId)) tx.objectStore('revlog').delete(r.id);
    await tx.done;
    this.revlog = this.revlog.filter((r) => !idSet.has(r.cardId));
    // Notes left without cards are removed, as in Anki.
    const remaining = new Set([...this.cards.values()].map((c) => c.noteId));
    for (const noteId of [...this.notes.keys()]) {
      if (!remaining.has(noteId)) {
        this.notes.delete(noteId);
        await this.db.delete('notes', noteId);
      }
    }
    this.undoStack = this.undoStack.filter((u) => !idSet.has(u.card.id));
    this.bump();
  }

  async setSuspended(ids: Id[], suspended: boolean) {
    const cards = ids.map((id) => this.cards.get(id)!).filter(Boolean);
    await this.updateCards(cards.map((c) => ({ ...c, queue: suspended ? -1 : queueForType(c) })));
  }

  async bury(ids: Id[]) {
    const cards = ids.map((id) => this.cards.get(id)!).filter(Boolean);
    await this.updateCards(cards.map((c) => ({ ...c, queue: -3 as const })));
  }

  /** Reset to new, like Anki's "Forget". Review history is kept, and a reset
   * entry is logged so FSRS ignores the history before it. */
  async forget(ids: Id[]) {
    let due = this.nextNewPosition() - 1;
    const cards = ids.map((id) => this.cards.get(id)!).filter(Boolean);
    const resets: RevlogEntry[] = cards.map((c) => ({
      id: newId(),
      cardId: c.id,
      rating: 0,
      ivl: 0,
      lastIvl: c.ivl,
      stability: 0,
      difficulty: 0,
      retrievability: null,
      elapsedDays: 0,
      time: 0,
      kind: 4,
    }));
    const tx = this.db.transaction('revlog', 'readwrite');
    resets.forEach((r) => tx.store.put(r));
    await tx.done;
    this.revlog.push(...resets);
    await this.updateCards(
      cards.map((c) => ({
        ...c,
        type: 0 as const,
        queue: 0 as const,
        due: ++due,
        ivl: 0,
        left: 0,
        stability: null,
        difficulty: null,
        stabilityFast: null,
        lastReview: null,
      })),
    );
  }

  // ---------------------------------------------------------- studying

  /** Combination smart cards wait until the smart notes they build on are
   * learned: every card of those notes has a stability of a week or more. */
  lockedNotes(): Set<Id> {
    const locked = new Set<Id>();
    for (const note of this.notes.values()) {
      const requires = note.smart?.requires;
      if (!requires?.length) continue;
      const learned = requires.every((id) => {
        const cards = this.noteCards(id);
        return cards.length > 0 && cards.every((c) => (c.stability ?? 0) >= UNLOCK_STABILITY_DAYS);
      });
      if (!learned) locked.add(note.id);
    }
    return locked;
  }

  private queueFor(rootId: Id): BuiltQueue {
    const locked = this.lockedNotes();
    return buildQueue(rootId, {
      decks: [...this.decks.values()],
      cards: locked.size ? [...this.cards.values()].filter((c) => c.noteId === undefined || !locked.has(c.noteId)) : this.cards.values(),
      presetFor: (d) => this.presetFor(d),
      prefs: this.prefs,
      retrievability: (c) => this.retrievability(c) ?? 1,
    });
  }

  counts(deckId: Id): QueueCounts {
    return this.queueFor(deckId).counts;
  }

  /** Next card to study in a deck and its subdecks. Like Anki, the main
   * queue (reviews, interday learning, new) is built once per session and
   * consumed; due intraday learning cards always come first, and learn-ahead
   * cards are shown when nothing else is left. */
  nextCard(rootId: Id): { card: Card | null; nextLearnAt: number | null; counts: QueueCounts } {
    const t = today();
    const built = this.queueFor(rootId);
    if (!this.session || this.session.rootId !== rootId || this.session.day !== t) {
      this.session = { rootId, day: t, main: built.main.map((c) => c.id), counts: built.counts };
    }
    // Drop cards that were answered, buried, suspended, moved or deleted.
    const stillQueued = new Set(built.main.map((c) => c.id));
    this.session.main = this.session.main.filter((id) => stillQueued.has(id));
    if (this.session.main.length === 0 && built.main.length) this.session.main = built.main.map((c) => c.id);
    const counts = built.counts;
    if (built.learnNow.length) return { card: built.learnNow[0], nextLearnAt: null, counts };
    const nextMain = this.session.main[0];
    if (nextMain !== undefined) return { card: this.cards.get(nextMain)!, nextLearnAt: null, counts };
    if (built.learnAhead.length) return { card: built.learnAhead[0], nextLearnAt: null, counts };
    return { card: null, nextLearnAt: built.nextLearnAt, counts };
  }

  endSession() {
    this.session = null;
  }

  previewStates(card: Card) {
    return nextStates(card, this.configFor(card.deckId), this.fsrsFor(card.deckId));
  }

  async answer(card: Card, rating: Rating, timeMs: number, seed?: number) {
    const preset = this.presetFor(card.deckId);
    const { card: updated, revlog: entry } = answerCard(card, rating, this.configFor(card.deckId), Math.min(timeMs, preset.capAnswerTimeSecs * 1000));
    const revlog = seed === undefined ? entry : { ...entry, seed };

    // Count the answer against the card's deck and all its parents.
    const deck = this.decks.get(card.deckId)!;
    const touched = ancestorNames(deck.name)
      .map((n) => this.deckByName(n))
      .filter((d): d is Deck => !!d);
    const t = today();
    const bumped = touched.map((d) => {
      const c = d.today.day === t ? { ...d.today } : { day: t, newDone: 0, revDone: 0 };
      if (card.type === 0) c.newDone++;
      else if (card.type === 2) c.revDone++;
      return { ...d, today: c };
    });

    // Bury siblings after answering, per the preset's burying options.
    const siblings =
      card.noteId === undefined
        ? []
        : this.noteCards(card.noteId).filter(
            (s) =>
              s.id !== card.id &&
              ((s.queue === 0 && preset.buryNew) ||
                (s.queue === 2 && s.due <= t && preset.buryReviews) ||
                (s.queue === 3 && s.due <= t && preset.buryInterdayLearning)),
          );

    this.undoStack.push({ card, decks: touched, buried: siblings, revlogId: revlog.id });
    if (this.undoStack.length > 30) this.undoStack.shift();
    this.revlog.push(revlog);
    if (this.session) this.session.main = this.session.main.filter((id) => id !== card.id);
    await Promise.all([
      this.putCards([updated, ...siblings.map((s) => ({ ...s, queue: -3 as const }))]),
      this.putDecks(bumped),
      this.db.put('revlog', revlog),
    ]);
    this.bump();
    return updated;
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  async undo(): Promise<Card | null> {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.revlog = this.revlog.filter((r) => r.id !== entry.revlogId);
    if (this.session) this.session.main = [entry.card.id, ...this.session.main.filter((id) => id !== entry.card.id)];
    await Promise.all([
      this.putCards([entry.card, ...entry.buried]),
      this.putDecks(entry.decks),
      this.db.delete('revlog', entry.revlogId),
    ]);
    this.bump();
    return entry.card;
  }

  // ---------------------------------------------------------- media

  /** Stores a file in the media folder and returns its name. Like Anki,
   * pasted files are named after a hash of their contents. */
  async addMedia(blob: Blob, preferredName?: string): Promise<string> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-1', bytes))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const ext = (preferredName?.match(/\.([a-z0-9]+)$/i)?.[1] ?? blob.type.split('/')[1] ?? 'bin').toLowerCase();
    const base = preferredName?.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-');
    const name = base ? `${base}-${hash.slice(0, 8)}.${ext}` : `paste-${hash}.${ext}`;
    await this.db.put('media', blob, name);
    setMediaUrl(name, blob);
    return name;
  }

  async mediaNames(): Promise<string[]> {
    return (await this.db.getAllKeys('media')).map(String);
  }

  async getMedia(name: string): Promise<Blob | null> {
    const b = await this.db.get('media', name);
    return b instanceof Blob ? b : null;
  }

  async putMedia(entries: Map<string, Blob>) {
    const tx = this.db.transaction('media', 'readwrite');
    for (const [name, blob] of entries) tx.store.put(blob, name);
    await tx.done;
    for (const [name, blob] of entries) setMediaUrl(name, blob);
    this.bump();
  }

  // ---------------------------------------------------------- import

  /** Adds presets, decks, cards, review history and media in bulk (used by
   * the Anki importer). Existing ids are left untouched. */
  async bulkImport(data: { presets: Preset[]; decks: Deck[]; cards: Card[]; revlog: RevlogEntry[]; media: Map<string, Blob> }) {
    const knownRevlog = new Set(this.revlog.map((r) => r.id));
    const revlog = data.revlog.filter((r) => !knownRevlog.has(r.id));
    const tx = this.db.transaction(['presets', 'decks', 'cards', 'revlog', 'media'], 'readwrite');
    data.presets.forEach((p) => tx.objectStore('presets').put(p));
    data.decks.forEach((d) => tx.objectStore('decks').put(d));
    data.cards.forEach((c) => tx.objectStore('cards').put(c));
    revlog.forEach((r) => tx.objectStore('revlog').put(r));
    for (const [name, blob] of data.media) tx.objectStore('media').put(blob, name);
    await tx.done;
    data.presets.forEach((p) => this.presets.set(p.id, p));
    data.decks.forEach((d) => this.decks.set(d.id, d));
    data.cards.forEach((c) => this.cards.set(c.id, c));
    this.revlog.push(...revlog);
    for (const [name, blob] of data.media) setMediaUrl(name, blob);
    await this.ensureParents();
    this.session = null;
    this.bump();
  }

  // ---------------------------------------------------------- backup

  exportBackup(): Backup {
    return {
      format: 'fsrs-cards-backup',
      version: 2,
      presets: [...this.presets.values()],
      prefs: this.prefs,
      decks: [...this.decks.values()],
      cards: [...this.cards.values()],
      notes: [...this.notes.values()],
      revlog: this.revlog,
      lessons: [...this.lessons.values()],
      quizSets: [...this.quizSets.values()],
      deckFiles: [...this.deckFiles.values()],
    };
  }

  // ---------------------------------------------------------- quizzes

  /** Remembers a quiz answer for the cards it was about, so later quizzes
   * start with cards that haven't been quizzed yet. */
  async recordQuiz(cardIds: Id[], right: boolean) {
    const now = Date.now();
    for (const id of cardIds) {
      const s = this.quizStats.get(id) ?? { asked: 0, wrong: 0, last: 0 };
      this.quizStats.set(id, { asked: s.asked + 1, wrong: s.wrong + (right ? 0 : 1), last: now });
    }
    await this.db.put('meta', [...this.quizStats], 'quizStats');
  }

  /** Saves a question answered wrong, to come back in later quizzes. */
  async saveMissedQuestion(q: QuizQuestion) {
    const old = this.quizMissed.get(q.question);
    const { replay: _replay, ...stored } = q;
    void _replay;
    this.quizMissed.set(q.question, { q: old?.q ?? stored, misses: (old?.misses ?? 0) + 1, streak: 0, last: Date.now() });
    await this.db.put('meta', [...this.quizMissed.values()], 'quizMissed');
  }

  /** A returning question answered right: retired after two in a row. */
  async missedQuestionRight(q: QuizQuestion) {
    const m = this.quizMissed.get(q.question);
    if (!m) return;
    if (m.streak + 1 >= MISSED_RETIRE_STREAK) this.quizMissed.delete(q.question);
    else this.quizMissed.set(q.question, { ...m, streak: m.streak + 1, last: Date.now() });
    await this.db.put('meta', [...this.quizMissed.values()], 'quizMissed');
  }

  // ---------------------------------------------------------- deck notes

  /** Files in a deck's Notes, newest first. */
  deckFilesFor(deckId: Id): DeckFile[] {
    return [...this.deckFiles.values()].filter((f) => f.deckId === deckId).sort((a, b) => b.added - a.added);
  }

  private async saveDeckFiles() {
    await this.db.put('meta', [...this.deckFiles.values()], 'deckFiles');
    this.bump();
  }

  async addDeckFiles(deckId: Id, files: File[]): Promise<DeckFile[]> {
    const added: DeckFile[] = [];
    for (const file of files) {
      const id = newId().toString(36);
      const media = await this.addMedia(file, `notes-${id}-${file.name}`);
      const entry: DeckFile = { id, deckId, name: file.name, type: file.type, size: file.size, added: Date.now(), media };
      this.deckFiles.set(id, entry);
      added.push(entry);
    }
    await this.saveDeckFiles();
    return added;
  }

  /** A new note, written in the grid editor, in a deck's Notes. */
  async addGridNote(deckId: Id, title: string, data: unknown): Promise<DeckFile> {
    const file = new File([JSON.stringify(data)], `${title}${GRID_NOTE_EXT}`, { type: GRID_NOTE_TYPE });
    const [entry] = await this.addDeckFiles(deckId, [file]);
    return entry;
  }

  /** Saves a note's content. Quietly: it's saved as it's typed, and nothing
   * else on screen depends on it. */
  async saveGridNote(id: string, data: unknown) {
    const f = this.deckFiles.get(id);
    if (!f) return;
    const blob = new Blob([JSON.stringify(data)], { type: GRID_NOTE_TYPE });
    await this.db.put('media', blob, f.media);
    setMediaUrl(f.media, blob);
    this.deckFiles.set(id, { ...f, size: blob.size, updated: Date.now() });
    await this.db.put('meta', [...this.deckFiles.values()], 'deckFiles');
  }

  async renameDeckFile(id: string, name: string) {
    const f = this.deckFiles.get(id);
    if (!f) return;
    this.deckFiles.set(id, { ...f, name });
    await this.saveDeckFiles();
  }

  async moveDeckFile(id: string, deckId: Id) {
    const f = this.deckFiles.get(id);
    if (!f) return;
    this.deckFiles.set(id, { ...f, deckId });
    await this.saveDeckFiles();
  }

  async deleteDeckFile(id: string) {
    const f = this.deckFiles.get(id);
    if (!f) return;
    this.deckFiles.delete(id);
    await this.db.delete('media', f.media);
    await this.saveDeckFiles();
  }

  async saveQuizSet(set: QuizSet, notify = true) {
    const saved = { ...set, updated: Date.now() };
    this.quizSets.set(saved.id, saved);
    await this.db.put('meta', saved, QUIZ_SET_KEY + saved.id);
    if (notify) this.bump();
    return saved;
  }

  /** Changes a quiz set from its latest saved state (answers arrive one by one). */
  async updateQuizSet(id: Id, change: (set: QuizSet) => QuizSet) {
    const set = this.quizSets.get(id);
    if (set) await this.saveQuizSet(change(set), false);
  }

  async deleteQuizSet(id: Id) {
    this.quizSets.delete(id);
    await this.db.delete('meta', QUIZ_SET_KEY + id);
    this.bump();
  }

  // ---------------------------------------------------------- lessons

  async saveLesson(lesson: Lesson, notify = true) {
    const saved = { ...lesson, updated: Date.now() };
    this.lessons.set(saved.id, saved);
    await this.db.put('meta', saved, LESSON_KEY + saved.id);
    if (notify) this.bump();
    return saved;
  }

  async deleteLesson(id: Id) {
    this.lessons.delete(id);
    await this.db.delete('meta', LESSON_KEY + id);
    this.bump();
  }

  async importBackup(b: Backup) {
    if (b.format !== 'fsrs-cards-backup') throw new Error('Not a backup file from this app');
    const notes = b.notes ?? [];
    const migrated = migrateSettings(b.settings as Record<string, unknown> | undefined);
    const presets = b.presets?.length ? b.presets : [migrated.preset];
    // older backups lack newer preferences
    const prefs = { ...DEFAULT_PREFERENCES, ...(b.prefs ?? migrated.prefs) };
    const tx = this.db.transaction(['meta', 'presets', 'decks', 'cards', 'notes', 'revlog'], 'readwrite');
    await Promise.all(['presets', 'decks', 'cards', 'notes', 'revlog'].map((s) => tx.objectStore(s).clear()));
    tx.objectStore('meta').put(prefs, 'prefs');
    presets.forEach((p) => tx.objectStore('presets').put(p));
    b.decks.forEach((d) => tx.objectStore('decks').put(d));
    b.cards.forEach((c) => tx.objectStore('cards').put(c));
    notes.forEach((n) => tx.objectStore('notes').put(n));
    b.revlog.forEach((r) => tx.objectStore('revlog').put(r));
    await tx.done;
    this.prefs = { ...DEFAULT_PREFERENCES, ...prefs };
    setRolloverHour(this.prefs.rolloverHour);
    this.presets = new Map(presets.map((p) => [p.id, { ...DEFAULT_PRESET, ...p }]));
    this.decks = new Map(b.decks.map((d) => [d.id, d]));
    this.cards = new Map(b.cards.map((c) => [c.id, c]));
    this.notes = new Map(notes.map((n) => [n.id, n]));
    this.revlog = b.revlog;
    // a backup from before lessons existed leaves the current ones alone
    if (b.lessons) {
      for (const id of [...this.lessons.keys()]) await this.db.delete('meta', LESSON_KEY + id);
      this.lessons = new Map();
      for (const l of b.lessons) await this.saveLesson(l, false);
    }
    if (b.deckFiles) {
      this.deckFiles = new Map(b.deckFiles.map((f) => [f.id, f]));
      await this.db.put('meta', b.deckFiles, 'deckFiles');
    }
    if (b.quizSets) {
      for (const id of [...this.quizSets.keys()]) await this.db.delete('meta', QUIZ_SET_KEY + id);
      this.quizSets = new Map();
      for (const q of b.quizSets) await this.saveQuizSet(q, false);
    }
    this.undoStack = [];
    this.session = null;
    this.bump();
  }
}

function queueForType(c: Card): Card['queue'] {
  switch (c.type) {
    case 0:
      return 0;
    case 2:
      return 2;
    default:
      return c.due > 1_000_000_000 ? 1 : 3;
  }
}

export const col = new Collection();

/** Re-render whenever the collection changes. */
export function useCollection() {
  useSyncExternalStore(col.subscribe, () => col.version);
  return col;
}
