// A note written in a deck's Notes, open in the grid editor. It's saved as
// it's typed, into the note's file in the deck.

import { useEffect, useState } from 'react';
import type { View } from '../App';
import { useCollection } from '../lib/collection';
import { GRID_NOTE_EXT } from '../lib/types';
import { GridEditor, type GridNoteData } from './GridLab';

export function GridNotePage({ fileId, go }: { fileId: string; go: (v: View) => void }) {
  const col = useCollection();
  const file = col.deckFiles.get(fileId);
  const [data, setData] = useState<GridNoteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(() => (file ? file.name.slice(0, -GRID_NOTE_EXT.length) : ''));

  const media = file?.media;
  useEffect(() => {
    if (!media) return;
    let live = true;
    void (async () => {
      const blob = await col.getMedia(media);
      if (!live) return;
      if (!blob) return setError("This note's file is missing.");
      try {
        const parsed = JSON.parse(await blob.text()) as Partial<GridNoteData>;
        if (live) setData({ items: Array.isArray(parsed.items) ? parsed.items : [], paper: parsed.paper });
      } catch {
        if (live) setError("This note couldn't be read.");
      }
    })();
    return () => {
      live = false;
    };
    // the note's content is read once; it's saved from the editor from then on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media]);

  if (!file) return <div className="panel">This note was deleted.</div>;
  const deck = col.decks.get(file.deckId);
  const back = (
    <button className="link note-back" onClick={() => go({ name: 'notes', deckId: file.deckId })}>
      ← {deck?.name.split('::').pop() ?? 'Deck'} notes
    </button>
  );
  if (error)
    return (
      <div className="panel">
        {back}
        <p className="polish-error">{error}</p>
      </div>
    );
  if (!data) return <p className="muted">Opening the note…</p>;

  const rename = () => {
    const name = title.trim() || 'Untitled note';
    setTitle(name);
    if (`${name}${GRID_NOTE_EXT}` !== file.name) void col.renameDeckFile(file.id, `${name}${GRID_NOTE_EXT}`);
  };

  return (
    <GridEditor
      header={
        <header className="page-head note-head">
          <div>
            {back}
            <input
              className="note-title"
              value={title}
              aria-label="Note title"
              placeholder="Untitled note"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={rename}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <p className="muted">Saved with the deck as you type. Learn and Quiz can use it like your other notes.</p>
          </div>
        </header>
      }
      open={() => data}
      onSave={(d) => col.saveGridNote(file.id, d)}
    />
  );
}
