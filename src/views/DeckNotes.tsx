// A deck's Notes: the files you've uploaded for it (lecture slides, PDFs,
// documents, images), shown as a grid like a file explorer. Click a file to
// preview it; rename, move, download or delete it from there.

import { useEffect, useRef, useState } from 'react';
import type { View } from '../App';
import { useCollection } from '../lib/collection';
import { depth } from '../lib/deckTree';
import { isReadable, quizSetFromDeck, readDeckFiles } from '../lib/deckNotes';
import { readMaterial } from '../lib/materials';
import { mediaUrl } from '../lib/media';
import { pdfThumbnail, renderPdfPages } from '../lib/pdfRender';
import { GRID_NOTE_EXT, GRID_NOTE_TYPE, type DeckFile, type Id, type LessonSection } from '../lib/types';
import { ConfirmDialog, Modal, PromptDialog } from './Modal';

type Kind = 'note' | 'pdf' | 'slides' | 'doc' | 'image' | 'text' | 'other';

export function kindOf(f: DeckFile): Kind {
  const ext = f.name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'gridnote' || f.type === GRID_NOTE_TYPE) return 'note';
  if (ext === 'pdf' || f.type === 'application/pdf') return 'pdf';
  if (['ppt', 'pptx', 'key', 'odp'].includes(ext)) return 'slides';
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'doc';
  if (f.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (['txt', 'md', 'markdown', 'csv'].includes(ext)) return 'text';
  return 'other';
}

const KIND_LABEL: Record<Kind, string> = { note: 'Note', pdf: 'PDF', slides: 'Slides', doc: 'Document', image: 'Image', text: 'Text', other: 'File' };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const formatDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function DeckNotes({ deckId, go }: { deckId: Id; go: (v: View) => void }) {
  const col = useCollection();
  const deck = col.decks.get(deckId);
  const files = col.deckFilesFor(deckId);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  /** files ticked for a lesson or quiz; none ticked means every readable file */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState<'lesson' | 'quiz' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const depthCount = useRef(0);

  if (!deck) return <div className="panel">Deck not found.</div>;
  const preview = previewId ? col.deckFiles.get(previewId) : undefined;

  const chosen = files.filter((f) => (selected.size ? selected.has(f.id) : true)).filter(isReadable);
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  /** Reads the chosen files, then opens Learn or Quiz with them. */
  const openWith = async (target: 'lesson' | 'quiz') => {
    setWorking(target);
    setNote(null);
    try {
      const { sources, skipped } = await readDeckFiles(chosen);
      if (!sources.length) return setNote('None of these files could be read. Learn and Quiz use PowerPoint, PDF, Word and text files.');
      if (target === 'lesson') {
        go({ name: 'learn', start: { title: deck.name.split('::').pop() ?? deck.name, deckId, sources } });
      } else {
        const set = await quizSetFromDeck(deckId, sources);
        go({ name: 'quiz', setId: set.id });
      }
      if (skipped.length) console.info('Not used (no text could be read):', skipped);
    } finally {
      setWorking(null);
    }
  };
  const countLabel = selected.size ? ` (${chosen.length})` : '';

  /** A blank note, opened in the editor. */
  const newNote = async () => {
    const taken = new Set(files.map((f) => f.name));
    let title = 'Untitled note';
    for (let n = 2; taken.has(`${title}${GRID_NOTE_EXT}`); n++) title = `Untitled note ${n}`;
    const f = await col.addGridNote(deckId, title, { items: [] });
    go({ name: 'note', fileId: f.id });
  };

  const upload = async (list: FileList | File[]) => {
    const arr = [...list];
    if (!arr.length) return;
    setUploading(true);
    try {
      await col.addDeckFiles(deckId, arr);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      className={`notes ${dragging ? 'dragging' : ''}`}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        depthCount.current++;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depthCount.current = Math.max(0, depthCount.current - 1);
        if (!depthCount.current) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depthCount.current = 0;
        setDragging(false);
        void upload(e.dataTransfer.files);
      }}
    >
      <header className="page-head home-head">
        <div>
          <h1>Notes</h1>
          <p className="muted">
            {deck.name.split('::').join(' › ')} · {files.length} file{files.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="row">
          <button onClick={() => void openWith('lesson')} disabled={!chosen.length || !!working} title="Open a new lesson in Learn made from these files">
            {working === 'lesson' ? 'Reading…' : `Start a lesson${countLabel}`}
          </button>
          <button onClick={() => void openWith('quiz')} disabled={!chosen.length || !!working} title="Quiz yourself on these files; practice quizzes and exams set the style">
            {working === 'quiz' ? 'Reading…' : `Quiz me on these${countLabel}`}
          </button>
          <button onClick={() => input.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading…' : 'Upload files'}
          </button>
          <button className="primary" onClick={() => void newNote()} title="Write a note here in the grid editor">
            New note
          </button>
          <input ref={input} type="file" multiple hidden onChange={(e) => e.target.files && void upload(e.target.files).then(() => (e.target.value = ''))} />
        </div>
      </header>

      {(selected.size > 0 || note) && (
        <div className="notes-bar">
          {selected.size > 0 && (
            <>
              <span>
                {selected.size} selected{chosen.length < selected.size && ` · ${selected.size - chosen.length} can't be read (images and other files)`}
              </span>
              <button className="link" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </>
          )}
          {note && <span className="polish-error">{note}</span>}
        </div>
      )}

      {files.length === 0 ? (
        <button className="notes-empty" onClick={() => input.current?.click()}>
          <b>Drop lecture slides, PDFs, documents or images here</b>
          <span className="muted">or click to choose files. They stay with this deck and are saved with your collection.</span>
        </button>
      ) : (
        <div className="file-grid" role="list">
          {files.map((f) => (
            <FileTile key={f.id} file={f} selected={selected.has(f.id)} selecting={selected.size > 0} onToggle={() => toggle(f.id)} onOpen={() => (kindOf(f) === 'note' ? go({ name: 'note', fileId: f.id }) : setPreviewId(f.id))} />
          ))}
        </div>
      )}

      {dragging && (
        <div className="notes-drop" aria-hidden="true">
          <b>Drop to add to {deck.name.split('::').pop()}</b>
        </div>
      )}
      {preview && <FilePreview file={preview} onClose={() => setPreviewId(null)} />}
    </div>
  );
}

export function FileTile({
  file,
  selected,
  selecting,
  onToggle,
  onOpen,
}: {
  file: DeckFile;
  selected: boolean;
  /** some files are ticked: a click ticks rather than opens */
  selecting: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const col = useCollection();
  const kind = kindOf(file);
  const [thumb, setThumb] = useState<string | null>(kind === 'image' ? (mediaUrl(file.media) ?? null) : null);

  useEffect(() => {
    if (kind !== 'pdf') return;
    let live = true;
    void (async () => {
      const blob = await col.getMedia(file.media);
      if (!blob) return;
      const url = await pdfThumbnail(file.media, blob);
      if (live) setThumb(url);
    })();
    return () => {
      live = false;
    };
  }, [file.media, kind, col]);

  return (
    <div className={`file-tile-wrap ${selected ? 'selected' : ''}`} role="listitem">
    <input
      type="checkbox"
      className="file-check"
      checked={selected}
      onChange={onToggle}
      aria-label={`Select ${file.name}`}
    />
    <button className="file-tile" onClick={selecting ? onToggle : onOpen} title={file.name}>
      <span className={`file-thumb kind-${kind}`}>
        {thumb ? <img src={thumb} alt="" loading="lazy" /> : <span className="file-badge">{KIND_LABEL[kind]}</span>}
      </span>
      <span className="file-name">{kind === 'note' ? file.name.slice(0, -GRID_NOTE_EXT.length) : file.name}</span>
      <span className="file-meta muted num">
        {kind === 'note' ? `Note · ${formatDate(file.updated ?? file.added)}` : `${formatSize(file.size)} · ${formatDate(file.added)}`}
      </span>
    </button>
    </div>
  );
}

function FilePreview({ file, onClose }: { file: DeckFile; onClose: () => void }) {
  const col = useCollection();
  const kind = kindOf(file);
  const [pages, setPages] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [sections, setSections] = useState<LessonSection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const url = mediaUrl(file.media);

  useEffect(() => {
    const ctrl = new AbortController();
    void (async () => {
      const blob = await col.getMedia(file.media);
      if (!blob) return setError('This file is missing.');
      try {
        if (kind === 'pdf') {
          await renderPdfPages(
            blob,
            760,
            (i, u, n) => {
              setTotal(n);
              setPages((p) => {
                const next = [...p];
                next[i] = u;
                return next;
              });
            },
            { maxPages: 80, signal: ctrl.signal },
          );
        } else if (kind === 'slides' || kind === 'doc' || kind === 'text') {
          const source = await readMaterial(new File([blob], file.name, { type: file.type }), 0);
          setSections(source.sections);
        }
      } catch (e) {
        if (!ctrl.signal.aborted) setError(`Can't preview this file: ${(e as Error).message}`);
      }
    })();
    return () => ctrl.abort();
  }, [file.media, file.name, file.type, kind, col]);

  const decks = col.deckList();

  return (
    <Modal
      title={file.name}
      wide
      onClose={onClose}
      footer={
        <>
          <select
            aria-label="Move to deck"
            value={file.deckId}
            onChange={(e) => {
              void col.moveDeckFile(file.id, Number(e.target.value));
              onClose();
            }}
            style={{ width: 'auto', marginRight: 'auto' }}
          >
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.id === file.deckId ? 'In ' : 'Move to '}
                {' '.repeat(depth(d.name) * 2)}
                {d.name.split('::').pop()}
              </option>
            ))}
          </select>
          <button onClick={() => setRenaming(true)}>Rename</button>
          {url && (
            <a className="button-like" href={url} download={file.name}>
              Download
            </a>
          )}
          <button className="danger" onClick={() => setDeleting(true)}>
            Delete
          </button>
        </>
      }
    >
      <div className="file-preview">
        {error ? (
          <p className="polish-error">{error}</p>
        ) : kind === 'image' && url ? (
          <img src={url} alt={file.name} className="file-preview-image" />
        ) : kind === 'pdf' ? (
          <>
            {pages.map((p, i) => (p ? <img key={i} src={p} alt={`Page ${i + 1}`} className="file-preview-page" /> : null))}
            {pages.filter(Boolean).length < Math.min(total || 1, 80) && <p className="muted">Loading pages…</p>}
            {total > 80 && <p className="muted">Showing the first 80 of {total} pages. Download the file to see the rest.</p>}
          </>
        ) : sections ? (
          sections.length ? (
            sections.map((s) => (
              <section key={s.ref} className="file-preview-section">
                <span className="muted num">{s.ref.split('.')[1]}</span>
                <div>
                  <b>{s.title}</b>
                  {s.text !== s.title && <p>{s.text.startsWith(s.title) ? s.text.slice(s.title.length).trim() : s.text}</p>}
                </div>
              </section>
            ))
          ) : (
            <p className="muted">No text could be read from this file.</p>
          )
        ) : kind === 'other' ? (
          <p className="muted">There's no preview for this kind of file. Download it to open it.</p>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </div>
      {renaming && (
        <PromptDialog
          title="Rename file"
          label="Name"
          initial={file.name}
          submitLabel="Rename"
          onSubmit={async (name) => {
            await col.renameDeckFile(file.id, name);
            setRenaming(false);
          }}
          onCancel={() => setRenaming(false)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete file"
          message={`Delete “${file.name}” from this deck's Notes?`}
          confirmLabel="Delete"
          danger
          onConfirm={async () => {
            await col.deleteDeckFile(file.id);
            setDeleting(false);
            onClose();
          }}
          onCancel={() => setDeleting(false)}
        />
      )}
    </Modal>
  );
}
