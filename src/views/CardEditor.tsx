import { useMemo, useState } from 'react';
import { useCollection } from '../lib/collection';
import { generateCards, NOTE_TYPES, noteProblem, noteType, textFields } from '../lib/noteTypes';
import { OcclusionEditor } from './OcclusionEditor';
import type { Card, NoteKind } from '../lib/types';
import { NoteEditor } from './NoteEditor';
import { SmartBuilder } from './SmartBuilder';

/** Types a note can be switched between: the ones made of text fields alone
 * (smart cards and image occlusion are built differently). */
const SWITCHABLE = NOTE_TYPES.filter((t) => t.kind !== 'smart' && t.kind !== 'imageOcclusion');

/** What saving a type change will do, as a sentence. */
function typeChangeNote(added: number, removed: number): string {
  const cards = (n: number) => `${n} card${n === 1 ? '' : 's'}`;
  const parts = [
    added > 0 && `adds ${cards(added)} (into this card's deck)`,
    removed > 0 && `deletes ${cards(removed)} and ${removed === 1 ? 'its' : 'their'} review history`,
  ].filter(Boolean);
  return parts.length ? `Saving ${parts.join(' and ')}; the other cards keep their review history.` : 'Saving keeps every card and its review history.';
}

export function parseTags(s: string): string[] {
  return [...new Set(s.split(/[\s,]+/).filter(Boolean))];
}

/** Edits a card: the fields of its note (which updates every sibling card),
 * or, for imported Anki cards without a note here, its rendered HTML. A
 * note's type can be changed too (Basic to Basic and reversed, say): its
 * cards keep their review history, cards the new type adds are new, and
 * cards it no longer makes are deleted. */
export function CardEditor({ card, onDone }: { card: Card; onDone: (updated: Card | null) => void }) {
  const col = useCollection();
  const note = card.noteId !== undefined ? col.notes.get(card.noteId) : undefined;
  const nt = note ? noteType(note.kind) : null;
  const [values, setValues] = useState<Record<string, string>>(note ? { ...note.fields } : { Front: card.front, Back: card.back });
  const [tags, setTags] = useState((note?.tags ?? card.tags).join(' '));
  const [deckId, setDeckId] = useState(card.deckId);
  const [error, setError] = useState<string | null>(null);
  /** the note's type, which can be changed here */
  const [kind, setKind] = useState<NoteKind | undefined>(note?.kind);
  const switchable = !!note && SWITCHABLE.some((t) => t.kind === note.kind);
  const shown = kind ? noteType(kind) : nt;
  /** Switches type, carrying the fields over by position, as Anki does. */
  const changeKind = (k: NoteKind) => {
    if (!kind) return;
    const from = noteType(kind).fields.map((f) => values[f] ?? '');
    setValues(Object.fromEntries(noteType(k).fields.map((f, i) => [f, from[i] ?? ''])));
    setKind(k);
  };
  /** what changing the type does to this note's cards, by template/cloze number */
  const typeChange = useMemo(() => {
    if (!note || !kind || kind === note.kind) return null;
    const made = new Set(generateCards({ ...note, kind, fields: values }, '').map((g) => g.ord));
    const have = col.noteCards(note.id);
    const had = new Set(have.map((c) => c.ord ?? 0));
    return { added: [...made].filter((o) => !had.has(o)).length, removed: have.filter((c) => !made.has(c.ord ?? 0)) };
  }, [note, kind, values, col]);
  // other wordings of the front aren't edited here any more, but a card keeps any it has
  const keptWordings = () => card.altFronts;

  const save = async () => {
    if (note && nt) {
      const k = kind ?? note.kind;
      // only the new type's fields are kept, once the type has changed
      const fields = k === note.kind ? values : Object.fromEntries(noteType(k).fields.map((f) => [f, values[f] ?? '']));
      const updatedNote = { ...note, kind: k, fields, tags: parseTags(tags) };
      const problem = noteProblem(updatedNote);
      if (problem) return setError(problem);
      const cards = await col.updateNote(updatedNote, card.deckId);
      // cards the new type doesn't make go, with their review history
      if (typeChange?.removed.length) await col.deleteCards(typeChange.removed.map((c) => c.id));
      // the card being edited may be one of them: the note's first card shows instead
      let updated = cards.find((c) => c.id === card.id) ?? cards[0] ?? card;
      updated = { ...updated, deckId, altFronts: keptWordings() };
      await col.updateCards([updated]);
      onDone(updated);
    } else {
      const updated: Card = { ...card, front: values.Front, back: values.Back, tags: parseTags(tags), deckId, altFronts: keptWordings() };
      await col.updateCards([updated]);
      onDone(updated);
    }
  };

  const siblings = note ? col.noteCards(note.id).length : 1;

  if (note?.kind === 'smart' && note.smart) {
    return (
      <div className="panel" style={{ display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Edit smart card</h2>
        {siblings > 1 && (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Changes apply to all {siblings} cards of this note. Each card keeps its review history.
          </p>
        )}
        <SmartBuilder
          initial={note.smart}
          noteId={note.id}
          saveLabel="Save"
          onSave={async (spec) => {
            const cards = await col.updateNote({ ...note, fields: { Title: spec.title }, smart: spec }, card.deckId);
            // cards for removed cases go too
            const removed = col.noteCards(note.id).filter((c) => (c.ord ?? 0) >= spec.cases.length);
            if (removed.length) await col.deleteCards(removed.map((c) => c.id));
            onDone(cards.find((c) => c.id === card.id) ?? cards[0] ?? null);
          }}
          onCancel={() => onDone(null)}
        />
      </div>
    );
  }

  return (
    <div
      className="panel"
      style={{ display: 'grid', gap: 12 }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          save();
        }
        if (e.key === 'Escape') onDone(null);
      }}
    >
      <h2 style={{ margin: 0 }}>Edit {shown ? `note · ${shown.name}` : 'card'}</h2>
      {nt && siblings > 1 && (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Changes apply to all {siblings} cards of this note.
        </p>
      )}
      {!nt && (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Imported from Anki: you're editing this card's rendered question and answer.
        </p>
      )}
      <label className="field">
        Deck (this card)
        <select value={deckId} onChange={(e) => setDeckId(Number(e.target.value))}>
          {col.deckList().map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      {switchable && kind && (
        <label className="field">
          Card type
          <select value={kind} onChange={(e) => changeKind(e.target.value as NoteKind)}>
            {SWITCHABLE.map((t) => (
              <option key={t.kind} value={t.kind}>
                {t.name}
              </option>
            ))}
          </select>
          {typeChange && (
            <span className={`hint ${typeChange.removed.length ? 'type-change-warn' : ''}`}>{typeChangeNote(typeChange.added, typeChange.removed.length)}</span>
          )}
        </label>
      )}
      {note?.kind === 'imageOcclusion' && (
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
        fields={note ? textFields(kind ?? note.kind) : ['Front', 'Back']}
        values={values}
        onChange={setValues}
        cloze={(shown?.cloze ?? false) && note?.kind !== 'imageOcclusion'}
      />
      <label className="field">
        Tags
        <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} />
      </label>
      <div className="row">
        <button className="primary" onClick={save}>
          Save <span style={{ opacity: 0.7, fontSize: 12 }}>(Ctrl+Enter)</span>
        </button>
        <button onClick={() => onDone(null)}>Cancel</button>
        {error && <span style={{ color: 'var(--again)' }}>{error}</span>}
      </div>
    </div>
  );
}
