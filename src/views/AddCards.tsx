import { useState } from 'react';
import { useCollection } from '../lib/collection';
import { NOTE_TYPES, noteProblem, noteType, generateCards, textFields } from '../lib/noteTypes';
import { OcclusionEditor } from './OcclusionEditor';
import type { Id, NoteKind } from '../lib/types';
import { parseTags } from './CardEditor';
import { NoteEditor } from './NoteEditor';
import { SmartBuilder } from './SmartBuilder';

const LAST_TYPE_KEY = 'fsrs-cards-last-note-type';

/** Splits pasted text into front/back rows: tab-separated, else ';', else ','. */
function parseBulk(text: string) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  const sep = lines.some((l) => l.includes('\t')) ? '\t' : lines.some((l) => l.includes(';')) ? ';' : ',';
  return lines
    .map((l) => {
      const [front, back = '', tags = ''] = l.split(sep).map((s) => s.trim());
      return { front, back, tags: parseTags(tags) };
    })
    .filter((r) => r.front);
}

function readLastType(): NoteKind {
  try {
    const v = localStorage.getItem(LAST_TYPE_KEY) as NoteKind | null;
    return v && NOTE_TYPES.some((t) => t.kind === v) ? v : 'basic';
  } catch {
    return 'basic';
  }
}

/** `bare`: inside a window that has its own title (the sidebar's + on a deck). */
export function AddCards({ initialDeckId, bare = false }: { initialDeckId?: Id; bare?: boolean }) {
  const col = useCollection();
  const decks = col.deckList();
  const [deckId, setDeckId] = useState<Id>(initialDeckId ?? decks[0]?.id);
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [kind, setKind] = useState<NoteKind>(readLastType);
  const [values, setValues] = useState<Record<string, string>>({});
  const [sticky, setSticky] = useState<Record<string, boolean>>({});
  const [tags, setTags] = useState('');
  const [bulk, setBulk] = useState('');
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  /** bumped after adding a smart note, for a fresh editor */
  const [smartKey, setSmartKey] = useState(0);
  const nt = noteType(kind);

  const changeKind = (k: NoteKind) => {
    // carry content over by field position, as Anki does when switching types
    // (Image Occlusion only shares fields by name: its first fields hold masks and the image)
    const next = noteType(k);
    const old = nt.fields.map((f) => values[f] ?? '');
    const byName = k === 'imageOcclusion' || kind === 'imageOcclusion';
    setValues(Object.fromEntries(next.fields.map((f, i) => [f, (byName ? values[f] : old[i]) ?? ''])));
    setKind(k);
    try {
      localStorage.setItem(LAST_TYPE_KEY, k);
    } catch {
      // not remembered next time
    }
  };

  const draft = { id: 0, kind, fields: values, tags: parseTags(tags), mtime: 0 };
  const cardCount = generateCards(draft, '').length;

  const add = async () => {
    const problem = noteProblem(draft);
    if (problem) return setStatus({ text: problem, error: true });
    const cards = await col.addNote(kind, { ...values }, parseTags(tags), deckId);
    // Clear every field that isn't pinned (sticky), as Anki does.
    setValues(Object.fromEntries(nt.fields.map((f) => [f, sticky[f] ? (values[f] ?? '') : ''])));
    setStatus({ text: `Added ${cards.length} card${cards.length === 1 ? '' : 's'} to ${col.decks.get(deckId)?.name}.` });
    // Back to the first field once the cleared form has rendered.
    setTimeout(() => (document.querySelector('.rich-field') as HTMLElement | null)?.focus(), 0);
  };

  const addBulk = async () => {
    const rows = parseBulk(bulk);
    if (!rows.length) return;
    const n = await col.addCards(deckId, rows);
    setBulk('');
    setStatus({ text: `Imported ${n} card(s) into ${col.decks.get(deckId)?.name}.` });
  };

  return (
    <div className={bare ? undefined : 'panel'} style={{ display: 'grid', gap: 14 }}>
      <div className="row">
        {!bare && <h1 style={{ margin: 0 }}>Add</h1>}
        <span className="spacer" />
        <div className="seg" role="tablist" aria-label="How to add">
          <button role="tab" aria-selected={mode === 'single'} className={mode === 'single' ? 'active' : ''} onClick={() => setMode('single')}>
            Note
          </button>
          <button role="tab" aria-selected={mode === 'bulk'} className={mode === 'bulk' ? 'active' : ''} onClick={() => setMode('bulk')}>
            Bulk text import
          </button>
        </div>
      </div>

      <div className="grid-2">
        {mode === 'single' && (
          <label className="field">
            Type
            <select value={kind} onChange={(e) => changeKind(e.target.value as NoteKind)}>
              {NOTE_TYPES.map((t) => (
                <option key={t.kind} value={t.kind}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          Deck
          <select value={deckId} onChange={(e) => setDeckId(Number(e.target.value))}>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {mode === 'single' && kind === 'smart' ? (
        <>
          <SmartBuilder
            key={smartKey}
            saveLabel="Add"
            onSave={async (spec) => {
              const cards = await col.addNote('smart', { Title: spec.title }, parseTags(tags), deckId, true, { smart: spec });
              setStatus({ text: `Added “${spec.title}”: ${cards.length} card${cards.length === 1 ? '' : 's'} to ${col.decks.get(deckId)?.name}.` });
              setSmartKey((k) => k + 1);
            }}
          />
          <label className="field">
            Tags <span className="hint">Space-separated</span>
            <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          {status && <span style={{ color: status.error ? 'var(--again)' : 'var(--text-2)' }}>{status.text}</span>}
        </>
      ) : mode === 'single' ? (
        <div
          style={{ display: 'grid', gap: 14 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              add();
            }
          }}
        >
          {kind === 'imageOcclusion' && (
            <OcclusionEditor
              image={values.Image ?? ''}
              occlusion={values.Occlusion ?? ''}
              onChange={(patch) =>
                setValues((v) => ({
                  ...v,
                  ...(patch.image !== undefined ? { Image: patch.image } : {}),
                  ...(patch.occlusion !== undefined ? { Occlusion: patch.occlusion } : {}),
                }))
              }
            />
          )}
          <NoteEditor
            fields={textFields(kind)}
            values={values}
            onChange={setValues}
            cloze={nt.cloze && kind !== 'imageOcclusion'}
            sticky={sticky}
            onToggleSticky={(f) => setSticky((s) => ({ ...s, [f]: !s[f] }))}
          />
          <label className="field">
            Tags <span className="hint">Space-separated</span>
            <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          <div className="row">
            <button className="primary" onClick={add}>
              Add <span style={{ opacity: 0.7, fontSize: 12 }}>(Ctrl+Enter)</span>
            </button>
            <span className="muted num" style={{ fontSize: 13 }}>
              {cardCount} card{cardCount === 1 ? '' : 's'} will be created
            </span>
            {status && <span style={{ color: status.error ? 'var(--again)' : 'var(--text-2)' }}>{status.text}</span>}
          </div>
        </div>
      ) : (
        <>
          <label className="field">
            One card per line: <code>front⇥back⇥tags</code>. Tabs, semicolons or commas work as separators — the
            same format as Anki's “Notes in Plain Text” export. Each line becomes a Basic note.
            <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} style={{ minHeight: 220 }} />
          </label>
          <div className="row">
            <button className="primary" onClick={addBulk} disabled={!bulk.trim()}>
              Import {parseBulk(bulk).length || ''} card(s)
            </button>
            <label className="row" style={{ cursor: 'pointer' }}>
              <input
                type="file"
                accept=".txt,.tsv,.csv"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setBulk(await f.text());
                }}
              />
            </label>
            {status && <span className="muted">{status.text}</span>}
          </div>
        </>
      )}
    </div>
  );
}
