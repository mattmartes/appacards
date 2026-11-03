// Reads Anki .apkg/.colpkg packages (rslib/src/import_export/package):
// legacy "collection.anki2"/"collection.anki21" (schema 11, JSON in `col`) and
// the current zstd-compressed "collection.anki21b" (schema 18, protobuf
// configs in their own tables).

import { decompress as zstdDecompress } from 'fzstd';
import type JSZip from 'jszip';
import type { Database, SqlValue } from 'sql.js';
import { decodeMessage, pbFloats, pbMessage, pbNumber, pbString } from './protobuf';
import { DEFAULT_PRESET, type NewGatherPriority, type NewSortOrder, type Preset, type ReviewMix, type ReviewOrder } from './types';

export interface AnkiNoteType {
  name: string;
  cloze: boolean;
  fields: string[];
  templates: { name: string; qfmt: string; afmt: string }[];
}

export interface AnkiCard {
  id: number;
  nid: number;
  did: number;
  ord: number;
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  left: number;
  odue: number;
  odid: number;
  flags: number;
  data: string;
}

export interface AnkiRevlog {
  id: number;
  cid: number;
  ease: number;
  ivl: number;
  lastIvl: number;
  factor: number;
  time: number;
  type: number;
}

/** The parts of an Anki deck config (preset) this app uses. */
export type AnkiDeckConfig = Omit<Preset, 'id' | 'mtime'>;

export interface AnkiDeck {
  name: string;
  configId: number | null;
  reviewLimit: number | null;
  newLimit: number | null;
}

export interface AnkiPackage {
  /** collection creation time (secs), the origin of review due days */
  crt: number;
  noteTypes: Map<number, AnkiNoteType>;
  decks: Map<number, AnkiDeck>;
  deckConfigs: Map<number, AnkiDeckConfig>;
  notes: Map<number, { guid: string; mid: number; fields: string[]; tags: string[] }>;
  cards: AnkiCard[];
  revlog: AnkiRevlog[];
  /** media filename -> loader */
  media: Map<string, () => Promise<Blob>>;
}

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

function maybeZstd(bytes: Uint8Array): Uint8Array {
  return ZSTD_MAGIC.every((b, i) => bytes[i] === b) ? zstdDecompress(bytes) : bytes;
}

async function openSql(bytes: Uint8Array): Promise<Database> {
  const [{ default: initSqlJs }, { default: wasmUrl }] = await Promise.all([
    import('sql.js'),
    import('sql.js/dist/sql-wasm.wasm?url'),
  ]);
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  return new SQL.Database(bytes);
}

function rows(db: Database, sql: string): SqlValue[][] {
  const res = db.exec(sql);
  return res.length ? res[0].values : [];
}

const num = (v: SqlValue) => Number(v ?? 0);
const str = (v: SqlValue) => (v === null || v === undefined ? '' : String(v));
const bytes = (v: SqlValue) => (v instanceof Uint8Array ? v : new Uint8Array());

// proto/anki/deck_config.proto enum orders
const GATHER: NewGatherPriority[] = ['deck', 'lowestPosition', 'highestPosition', 'randomNotes', 'randomCards', 'deckThenRandomNotes'];
const NEW_SORT: NewSortOrder[] = ['template', 'noSort', 'templateThenRandom', 'randomNoteThenTemplate', 'randomCard'];
const REVIEW_ORDER: ReviewOrder[] = [
  'day',
  'dayThenDeck',
  'deckThenDay',
  'intervalsAscending',
  'intervalsDescending',
  'easeAscending',
  'easeDescending',
  'retrievabilityAscending',
  'random',
  'added',
  'reverseAdded',
  'retrievabilityDescending',
  'relativeOverdueness',
];
const MIX: ReviewMix[] = ['mixWithReviews', 'afterReviews', 'beforeReviews'];

/** Schema 11 dconf JSON (rslib/src/deckconfig/schema11.rs). */
function parseLegacyConfig(name: string, conf: Record<string, any>): AnkiDeckConfig {
  const arr = (k: string) => (Array.isArray(conf[k]) && conf[k].length ? (conf[k] as number[]) : null);
  const d = DEFAULT_PRESET;
  return {
    name,
    newPerDay: conf.new?.perDay ?? d.newPerDay,
    reviewsPerDay: conf.rev?.perDay ?? d.reviewsPerDay,
    learnSteps: conf.new?.delays ?? d.learnSteps,
    newInsertOrder: conf.new?.order === 0 ? 'random' : 'due',
    relearnSteps: conf.lapse?.delays ?? d.relearnSteps,
    leechThreshold: conf.lapse?.leechFails ?? d.leechThreshold,
    leechAction: conf.lapse?.leechAction === 0 ? 'suspend' : 'tag',
    newGatherPriority: GATHER[conf.newGatherPriority] ?? d.newGatherPriority,
    newSortOrder: NEW_SORT[conf.newSortOrder] ?? d.newSortOrder,
    newMix: MIX[conf.newMix] ?? d.newMix,
    interdayLearningMix: MIX[conf.interdayLearningMix] ?? d.interdayLearningMix,
    reviewOrder: REVIEW_ORDER[conf.reviewOrder] ?? d.reviewOrder,
    params: arr('fsrsParams6') ?? arr('fsrsParams5') ?? arr('fsrsWeights') ?? [],
    desiredRetention: typeof conf.desiredRetention === 'number' ? conf.desiredRetention : d.desiredRetention,
    buryNew: conf.new?.bury ?? d.buryNew,
    buryReviews: conf.rev?.bury ?? d.buryReviews,
    buryInterdayLearning: conf.buryInterdayLearning ?? d.buryInterdayLearning,
    autoplay: conf.autoplay ?? d.autoplay,
    showTimer: conf.timer === 1 ? true : d.showTimer,
    capAnswerTimeSecs: conf.maxTaken ?? d.capAnswerTimeSecs,
    maxInterval: conf.rev?.maxIvl ?? d.maxInterval,
  };
}

/** Schema 18 DeckConfig.Config protobuf. proto3 omits zero values, so an
 * absent field means 0 / false / empty, not "default". */
function parseConfigProto(name: string, m: ReturnType<typeof decodeMessage>): AnkiDeckConfig {
  const d = DEFAULT_PRESET;
  const n = (f: number) => pbNumber(m, f) ?? 0;
  const b = (f: number) => n(f) === 1;
  const p6 = pbFloats(m, 6);
  const p5 = pbFloats(m, 5);
  const p4 = pbFloats(m, 3);
  const dr = n(37);
  return {
    name,
    learnSteps: pbFloats(m, 1),
    relearnSteps: pbFloats(m, 2),
    newPerDay: n(9),
    reviewsPerDay: n(10),
    maxInterval: Math.max(n(16), 1),
    newInsertOrder: n(20) === 1 ? 'random' : 'due',
    leechAction: n(21) === 0 ? 'suspend' : 'tag',
    leechThreshold: n(22),
    autoplay: !b(23),
    capAnswerTimeSecs: n(24) || d.capAnswerTimeSecs,
    showTimer: b(25),
    buryNew: b(27),
    buryReviews: b(28),
    buryInterdayLearning: b(29),
    newMix: MIX[n(30)] ?? d.newMix,
    interdayLearningMix: MIX[n(31)] ?? d.interdayLearningMix,
    newSortOrder: NEW_SORT[n(32)] ?? d.newSortOrder,
    reviewOrder: REVIEW_ORDER[n(33)] ?? d.reviewOrder,
    newGatherPriority: GATHER[n(34)] ?? d.newGatherPriority,
    params: p6.length ? p6 : p5.length ? p5 : p4,
    desiredRetention: dr >= 0.7 && dr <= 0.99 ? Math.round(dr * 100) / 100 : d.desiredRetention,
  };
}

function readSchema11(db: Database, pkg: AnkiPackage) {
  const [[models, decks, dconf]] = rows(db, 'SELECT models, decks, dconf FROM col');
  for (const [id, m] of Object.entries(JSON.parse(str(models) || '{}') as Record<string, any>)) {
    pkg.noteTypes.set(Number(id), {
      name: m.name,
      cloze: m.type === 1,
      fields: [...m.flds].sort((a: any, b: any) => a.ord - b.ord).map((f: any) => f.name),
      templates: [...m.tmpls].sort((a: any, b: any) => a.ord - b.ord).map((t: any) => ({ name: t.name, qfmt: t.qfmt, afmt: t.afmt })),
    });
  }
  for (const [id, d] of Object.entries(JSON.parse(str(decks) || '{}') as Record<string, any>)) {
    pkg.decks.set(Number(id), {
      name: d.name,
      configId: d.dyn ? null : Number(d.conf ?? 1),
      reviewLimit: d.reviewLimit ?? null,
      newLimit: d.newLimit ?? null,
    });
  }
  for (const [id, c] of Object.entries(JSON.parse(str(dconf) || '{}') as Record<string, any>)) {
    pkg.deckConfigs.set(Number(id), parseLegacyConfig(c.name ?? 'Default', c));
  }
}

function readSchema18(db: Database, pkg: AnkiPackage) {
  const fields = new Map<number, string[]>();
  for (const [ntid, ord, name] of rows(db, 'SELECT ntid, ord, name FROM fields ORDER BY ntid, ord')) {
    const list = fields.get(num(ntid)) ?? [];
    list[num(ord)] = str(name);
    fields.set(num(ntid), list);
  }
  const templates = new Map<number, AnkiNoteType['templates']>();
  for (const [ntid, ord, name, config] of rows(db, 'SELECT ntid, ord, name, config FROM templates ORDER BY ntid, ord')) {
    const m = decodeMessage(bytes(config));
    const list = templates.get(num(ntid)) ?? [];
    list[num(ord)] = { name: str(name), qfmt: pbString(m, 1), afmt: pbString(m, 2) };
    templates.set(num(ntid), list);
  }
  for (const [id, name, config] of rows(db, 'SELECT id, name, config FROM notetypes')) {
    const m = decodeMessage(bytes(config));
    pkg.noteTypes.set(num(id), {
      name: str(name),
      cloze: pbNumber(m, 1) === 1,
      fields: fields.get(num(id)) ?? [],
      templates: templates.get(num(id)) ?? [],
    });
  }
  for (const [id, name, kind] of rows(db, 'SELECT id, name, kind FROM decks')) {
    // Deck.KindContainer { Normal normal = 1 { int64 config_id = 1;
    //   optional uint32 review_limit = 6; optional uint32 new_limit = 7 } }
    const normal = pbMessage(decodeMessage(bytes(kind)), 1);
    pkg.decks.set(num(id), {
      name: str(name).split('\x1f').join('::'),
      configId: normal ? (pbNumber(normal, 1) ?? 1) : null,
      reviewLimit: normal ? (pbNumber(normal, 6) ?? null) : null,
      newLimit: normal ? (pbNumber(normal, 7) ?? null) : null,
    });
  }
  for (const [id, name, config] of rows(db, 'SELECT id, name, config FROM deck_config')) {
    pkg.deckConfigs.set(num(id), parseConfigProto(str(name), decodeMessage(bytes(config))));
  }
}

export async function readAnkiPackage(file: Blob): Promise<AnkiPackage> {
  const { default: JSZipCtor } = await import('jszip');
  const zip: JSZip = await JSZipCtor.loadAsync(file);

  // meta: PackageMetadata { Version version = 1 } (1 legacy1, 2 legacy2, 3 latest)
  let version = zip.file('collection.anki21') ? 2 : 1;
  const metaFile = zip.file('meta');
  if (metaFile) version = pbNumber(decodeMessage(await metaFile.async('uint8array')), 1) ?? version;
  if (version > 3) throw new Error('This package was made by a newer Anki version than this importer understands.');
  const collectionName = ['collection.anki2', 'collection.anki2', 'collection.anki21', 'collection.anki21b'][version];
  const collectionFile = zip.file(collectionName);
  if (!collectionFile) throw new Error('No Anki collection found in this file. Is it an .apkg or .colpkg?');

  const db = await openSql(maybeZstd(await collectionFile.async('uint8array')));
  try {
    const pkg: AnkiPackage = {
      crt: num(rows(db, 'SELECT crt FROM col')[0]?.[0]),
      noteTypes: new Map(),
      decks: new Map(),
      deckConfigs: new Map(),
      notes: new Map(),
      cards: [],
      revlog: [],
      media: new Map(),
    };
    const tables = new Set(rows(db, "SELECT name FROM sqlite_master WHERE type='table'").map((r) => str(r[0])));
    if (tables.has('notetypes')) readSchema18(db, pkg);
    else readSchema11(db, pkg);

    for (const [id, guid, mid, tags, flds] of rows(db, 'SELECT id, guid, mid, tags, flds FROM notes')) {
      pkg.notes.set(num(id), {
        guid: str(guid),
        mid: num(mid),
        fields: str(flds).split('\x1f'),
        tags: str(tags).trim().split(/\s+/).filter(Boolean),
      });
    }
    pkg.cards = rows(
      db,
      'SELECT id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data FROM cards',
    ).map(([id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data]) => ({
      id: num(id),
      nid: num(nid),
      did: num(did),
      ord: num(ord),
      type: num(type),
      queue: num(queue),
      due: num(due),
      ivl: num(ivl),
      factor: num(factor),
      reps: num(reps),
      lapses: num(lapses),
      left: num(left),
      odue: num(odue),
      odid: num(odid),
      flags: num(flags),
      data: str(data),
    }));
    pkg.revlog = rows(db, 'SELECT id, cid, ease, ivl, lastIvl, factor, time, type FROM revlog ORDER BY id').map(
      ([id, cid, ease, ivl, lastIvl, factor, time, type]) => ({
        id: num(id),
        cid: num(cid),
        ease: num(ease),
        ivl: num(ivl),
        lastIvl: num(lastIvl),
        factor: num(factor),
        time: num(time),
        type: num(type),
      }),
    );

    // Media index: JSON {"0": "name"} in legacy packages, otherwise a
    // zstd-compressed MediaEntries protobuf whose entry i is zip file "i".
    const mediaFile = zip.file('media');
    if (mediaFile) {
      const raw = maybeZstd(await mediaFile.async('uint8array'));
      const names: [string, string][] = [];
      if (raw[0] === 0x7b /* '{' */) {
        for (const [zipName, name] of Object.entries(JSON.parse(new TextDecoder().decode(raw)) as Record<string, string>)) {
          names.push([zipName, name]);
        }
      } else {
        (decodeMessage(raw).get(1) ?? []).forEach((entry, i) => {
          const m = decodeMessage(entry as Uint8Array);
          names.push([String(pbNumber(m, 255) ?? i), pbString(m, 1)]);
        });
      }
      for (const [zipName, name] of names) {
        const f = zip.file(zipName);
        if (f && name) pkg.media.set(name, async () => new Blob([maybeZstd(await f.async('uint8array')) as BlobPart]));
      }
    }
    return pkg;
  } finally {
    db.close();
  }
}
