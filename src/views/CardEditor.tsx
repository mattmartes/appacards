import { useState } from 'react';
import { useCollection } from '../lib/collection';
import { noteProblem, noteType, textFields } from '../lib/noteTypes';
import { OcclusionEditor } from './OcclusionEditor';
import type { Card } from '../lib/types';
import { NoteEditor } from './NoteEditor';
import { SmartBuilder } from './SmartBuilder';
import { WordingsEditor } from './WordingsEditor';
import { canReword } from '../lib/wordings';

export function parseTags(s: string): string[] {
  return [...new Set(s.split(/[\s,]+/).filter(Boolean))];
}

/** Edits a card: the fields of its note (which updates every sibling card),
 * or, for imported Anki cards without a note here, its rendered HTML. */
export function CardEditor({ card, onDone }: { card: Card; onDone: (updated: Card | null) => void }) {
  const col = useCollection();
  const note = card.noteId !== undefined ? col.notes.get(card.noteId) : undefined;
  const nt = note ? noteType(note.kind) : null;
  const [values, setValues] = useState<Record<string, string>>(note ? { ...note.fields } : { Front: card.front, Back: card.back });
  const [tags, setTags] = useState((note?.tags ?? card.tags).join(' '));
  const [deckId, setDeckId] = useState(card.deckId);
  const [error, setError] = useState<string | null>(null);
  /** this card's other wordings of its front */
  const [wordings, setWordings] = useState<string[]>(card.altFronts ?? []);
  const keptWordings = () => {
    const w = wordings.map((x) => x.trim()).filter(Boolean);
    return w.length ? w : undefined;
  };

  const save = async () => {
    if (note && nt) {
      const updatedNote = { ...note, fields: values, tags: parseTags(tags) };
      const problem = noteProblem(updatedNote);
      if (problem) return setError(problem);
      const cards = await col.updateNote(updatedNote, card.deckId);
      let updated = cards.find((c) => c.id === card.id) ?? card;
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
      <h2 style={{ margin: 0 }}>Edit {nt ? `note · ${nt.name}` : 'card'}</h2>
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
        fields={note ? textFields(note.kind) : ['Front', 'Back']}
        values={values}
        onChange={setValues}
        cloze={(nt?.cloze ?? false) && note?.kind !== 'imageOcclusion'}
      />
      {canReword(card) && (
        <WordingsEditor
          wordings={wordings}
          onChange={setWordings}
          hint="For this card only. Each review shows the front or one of these at random. Edit → AI wordings can write them."
        />
      )}
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
