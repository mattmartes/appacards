// Quiz → From your material: quiz sets built from your own files. Study
// material (slides, notes) is what questions are written from; practice
// quizzes and past exams show the AI the course's style and difficulty.

import { useState, type ReactNode } from 'react';
import { useCollection } from '../lib/collection';
import { MATERIAL_ACCEPT, readMaterial, sourceStats } from '../lib/materials';
import { quizSections } from '../lib/quiz';
import type { QuizSet, QuizSetSource } from '../lib/types';
import { ConfirmDialog } from './Modal';

export function QuizSets({
  typePicker,
  model,
  initialChosen,
  onStart,
}: {
  typePicker: ReactNode;
  model: string;
  /** a set to have selected on arrival */
  initialChosen?: QuizSet['id'];
  onStart: (set: QuizSet) => void;
}) {
  const col = useCollection();
  const sets = [...col.quizSets.values()].sort((a, b) => b.updated - a.updated);
  const [editing, setEditing] = useState<QuizSet | null>(null);
  const [chosen, setChosen] = useState<QuizSet['id'] | null>(initialChosen ?? null);
  const [deleting, setDeleting] = useState<QuizSet | null>(null);

  if (editing) return <QuizSetEditor initial={editing} onDone={() => setEditing(null)} />;

  const blank = (): QuizSet => ({ id: Date.now(), title: '', created: Date.now(), updated: Date.now(), sources: [], stats: {}, missed: [] });
  const set = chosen !== null ? col.quizSets.get(chosen) : undefined;

  return (
    <>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        Quiz yourself on material that isn't in flashcards: upload lecture slides or notes, and add old practice quizzes or past exams
        so the AI writes questions in the same style and at the same level. Each question targets a slide or page you haven't been
        quizzed on yet, and questions you get wrong come back later.
      </p>
      <div className="row">
        <button className="primary" onClick={() => setEditing(blank())}>
          New quiz set
        </button>
      </div>
      {sets.length === 0 ? (
        <p className="muted">No quiz sets yet.</p>
      ) : (
        <div className="quiz-decks" role="listbox" aria-label="Quiz set">
          {sets.map((s) => {
            const sections = quizSections(s);
            const quizzed = sections.filter((x) => (s.stats[x.ref]?.asked ?? 0) > 0).length;
            const refs = s.sources.filter((x) => x.role === 'reference').length;
            return (
              <div key={s.id} className={`quiz-set-row ${chosen === s.id ? 'active' : ''}`}>
                <button role="option" aria-selected={chosen === s.id} className="quiz-deck" onClick={() => setChosen(s.id)}>
                  <span>
                    <b>{s.title}</b>
                    <span className="muted" style={{ display: 'block', fontSize: 13, fontWeight: 400 }}>
                      {s.sources.length - refs} material file{s.sources.length - refs === 1 ? '' : 's'}, {refs} practice quiz
                      {refs === 1 ? '' : 'zes'} · {quizzed} of {sections.length} sections quizzed
                      {s.missed.length > 0 && ` · ${s.missed.length} missed to revisit`}
                    </span>
                  </span>
                </button>
                <button className="link" onClick={() => setEditing(s)}>
                  Edit
                </button>
                <button className="icon-button danger" aria-label={`Delete ${s.title}`} title="Delete" onClick={() => setDeleting(s)}>
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
      {set && (
        <div className="quiz-setup">
          <div className="grid-2">{typePicker}</div>
          <div className="row">
            <button className="primary" disabled={!quizSections(set).length} onClick={() => onStart(set)}>
              Start quiz on {set.title}
            </button>
            <span className="muted" style={{ fontSize: 13 }}>
              Uses {model} (Preferences → AI)
            </span>
          </div>
          {!quizSections(set).length && <div className="polish-error">This set has no readable text yet. Edit it to add files.</div>}
        </div>
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete quiz set"
          message={`Delete “${deleting.title}”, its files and its quiz history?`}
          confirmLabel="Delete"
          danger
          onConfirm={async () => {
            await col.deleteQuizSet(deleting.id);
            if (chosen === deleting.id) setChosen(null);
            setDeleting(null);
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}

const ROLE_INFO: Record<QuizSetSource['role'], { title: string; hint: string }> = {
  material: { title: 'Study material', hint: 'Lecture slides, notes, readings: questions are written from these.' },
  reference: {
    title: 'Practice quizzes and past exams',
    hint: 'Optional. The AI matches their style, difficulty and what they test, without copying them.',
  },
};

function QuizSetEditor({ initial, onDone }: { initial: QuizSet; onDone: () => void }) {
  const col = useCollection();
  const [title, setTitle] = useState(initial.title);
  const [sources, setSources] = useState<QuizSetSource[]>(initial.sources);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (files: FileList | File[], role: QuizSetSource['role']) => {
    setReading(true);
    setError(null);
    const problems: string[] = [];
    const added: QuizSetSource[] = [];
    // ids keep counting up so section refs (M3.4) never clash after removals
    let next = Math.max(0, ...sources.map((s) => Number(s.id.slice(1)) || 0));
    for (const f of [...files]) {
      try {
        added.push({ ...(await readMaterial(f, next++)), role });
      } catch (e) {
        problems.push((e as Error).message);
      }
    }
    setSources((s) => [...s, ...added]);
    if (!title && added[0]) setTitle(added[0].name.replace(/\.[^.]+$/, ''));
    if (problems.length) setError(problems.join(' '));
    setReading(false);
  };

  const save = async () => {
    await col.saveQuizSet({ ...initial, title: title.trim() || 'Quiz set', sources });
    onDone();
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="row">
        <button className="link" onClick={onDone}>
          ← Quiz sets
        </button>
        <h2 style={{ margin: 0 }}>{initial.title ? 'Edit quiz set' : 'New quiz set'}</h2>
      </div>
      <label className="field">
        Title
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Midterm 2: Topics 4-7" />
      </label>
      <div className="grid-2">
        {(['material', 'reference'] as const).map((role) => (
          <div key={role} className="quiz-set-files">
            <b>{ROLE_INFO[role].title}</b>
            <span className="muted" style={{ fontSize: 13 }}>
              {ROLE_INFO[role].hint}
            </span>
            <label
              className="material-drop"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void add(e.dataTransfer.files, role);
              }}
            >
              <input type="file" multiple accept={MATERIAL_ACCEPT} hidden onChange={(e) => e.target.files && void add(e.target.files, role)} />
              <b>{reading ? 'Reading…' : 'Choose or drop files'}</b>
              <span className="muted" style={{ fontSize: 12 }}>
                PowerPoint, PDF, Word or text
              </span>
            </label>
            <ul className="material-list">
              {sources
                .filter((s) => s.role === role)
                .map((s) => {
                  const st = sourceStats(s);
                  return (
                    <li key={s.id}>
                      <span className="smart-chip">{s.id}</span> {s.name}{' '}
                      <span className="muted">
                        · {s.sections.length} {s.kind === 'slides' ? 'slide' : s.kind === 'pdf' ? 'page' : 'section'}
                        {s.sections.length === 1 ? '' : 's'}
                        {st.empty > 0 && ` · ${st.empty} without text (images aren't read)`}
                      </span>{' '}
                      <button
                        className="link"
                        onClick={() => setSources((list) => list.map((x) => (x === s ? { ...x, role: role === 'material' ? 'reference' : 'material' } : x)))}
                      >
                        Move to {role === 'material' ? 'practice quizzes' : 'material'}
                      </button>{' '}
                      <button className="link" onClick={() => setSources((list) => list.filter((x) => x !== s))}>
                        Remove
                      </button>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </div>
      {error && <div className="polish-error">{error}</div>}
      <div className="row">
        <button className="primary" disabled={!sources.length || reading} onClick={() => void save()}>
          Save quiz set
        </button>
        <button onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
