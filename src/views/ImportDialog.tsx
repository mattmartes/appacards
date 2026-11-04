// Import, from the sidebar: an Anki deck file, or a Quizlet set pasted as
// text. Quizlet cards are previewed as they'll come in, and then you choose
// the class and deck they go to.

import { useMemo, useState } from 'react';
import { useCollection } from '../lib/collection';
import { baseName } from '../lib/deckTree';
import { DEFAULT_QUIZLET, parseQuizlet, toHtml, type QuizletOptions } from '../lib/quizlet';
import type { Id } from '../lib/types';
import { Modal } from './Modal';

const PREVIEW_ROWS = 100;
const NEW = -1;

export function ImportDialog({ onAnki, onDone, onClose }: { onAnki: () => void; onDone: (classId: Id) => void; onClose: () => void }) {
  const col = useCollection();
  const [step, setStep] = useState<'choose' | 'quizlet'>('choose');
  const [text, setText] = useState('');
  const [opts, setOpts] = useState<QuizletOptions>(DEFAULT_QUIZLET);
  const [classId, setClassId] = useState<Id>(() => col.deckList().find((d) => !d.name.includes('::'))?.id ?? NEW);
  const [className, setClassName] = useState('');
  const [deckId, setDeckId] = useState<Id>(NEW);
  const [deckName, setDeckName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseQuizlet(text, opts), [text, opts]);
  const classes = col.deckList().filter((d) => !d.name.includes('::'));
  const cls = classId === NEW ? undefined : col.decks.get(classId);
  const decksInClass = cls ? col.deckList().filter((d) => d.name.startsWith(`${cls.name}::`)) : [];

  const run = async () => {
    setError(null);
    if (!parsed.cards.length) return setError('No cards found yet. Paste the text from Quizlet’s Export box.');
    const clsName = cls ? cls.name : className.trim();
    if (!clsName) return setError('Give the new class a name.');
    if (clsName.includes('::')) return setError('A class name can’t contain “::”.');
    const target = deckId === NEW ? deckName.trim() : null;
    if (deckId === NEW && !target) return setError('Give the new deck a name.');
    setBusy(true);
    try {
      const c = cls ?? (await col.addDeck(clsName));
      const deck = deckId === NEW ? await col.addDeck(`${c.name}::${target}`) : col.decks.get(deckId)!;
      await col.addCards(
        deck.id,
        parsed.cards.map((x) => ({ front: toHtml(x.front), back: toHtml(x.back) })),
      );
      onDone(c.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (step === 'choose') {
    return (
      <Modal title="Import cards" onClose={onClose}>
        <div className="import-choices">
          <button className="import-choice" onClick={onAnki}>
            <span className="import-choice-icon" aria-hidden="true">
              📦
            </span>
            <span>
              <b>Anki deck</b>
              <span className="muted">An .apkg or .colpkg file, with its review history</span>
            </span>
          </button>
          <button className="import-choice" onClick={() => setStep('quizlet')}>
            <span className="import-choice-icon" aria-hidden="true">
              📋
            </span>
            <span>
              <b>Quizlet set</b>
              <span className="muted">Paste the text from a set’s Export box</span>
            </span>
          </button>
        </div>
      </Modal>
    );
  }

  const setOpt = (patch: Partial<QuizletOptions>) => setOpts({ ...opts, ...patch });

  return (
    <Modal
      title="Import from Quizlet"
      onClose={onClose}
      wide
      footer={
        <>
          <button onClick={() => setStep('choose')}>Back</button>
          <span className="spacer" />
          {error && <span style={{ color: 'var(--again)', marginRight: 'auto' }}>{error}</span>}
          <button className="primary" onClick={() => void run()} disabled={busy || !parsed.cards.length}>
            {busy ? 'Importing…' : `Import ${parsed.cards.length || ''} card${parsed.cards.length === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <div className="import-quizlet">
        <label className="field">
          Quizlet text
          <span className="hint">In Quizlet, open the set’s ⋯ menu → Export, then copy everything in the box and paste it here.</span>
          <textarea
            value={text}
            data-autofocus
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            placeholder={'What are endocrine glands?\tDuctless organs that secrete hormones…\nWhat does the pancreas secrete?\tInsulin…'}
            rows={6}
          />
        </label>

        <div className="import-options">
          <label className="field">
            Between term and definition
            <select value={opts.term} onChange={(e) => setOpt({ term: e.target.value as QuizletOptions['term'] })}>
              <option value="tab">Tab</option>
              <option value="comma">Comma</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          {opts.term === 'custom' && (
            <label className="field">
              Custom
              <input type="text" value={opts.customTerm ?? ''} onChange={(e) => setOpt({ customTerm: e.target.value })} placeholder="e.g. -" />
            </label>
          )}
          <label className="field">
            Between rows
            <select value={opts.row} onChange={(e) => setOpt({ row: e.target.value as QuizletOptions['row'] })}>
              <option value="newline">New line</option>
              <option value="semicolon">Semicolon</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          {opts.row === 'custom' && (
            <label className="field">
              Custom
              <input type="text" value={opts.customRow ?? ''} onChange={(e) => setOpt({ customRow: e.target.value })} placeholder="e.g. ##" />
            </label>
          )}
          <label className="row import-strip">
            <input type="checkbox" checked={opts.stripLabels} onChange={(e) => setOpt({ stripLabels: e.target.checked })} />
            Remove “Q:” and “A:” labels
          </label>
        </div>

        <div className="import-preview">
          <div className="up-next-head">
            <h2>Preview</h2>
            <span className="muted">
              {parsed.cards.length} card{parsed.cards.length === 1 ? '' : 's'}
              {parsed.skipped > 0 && ` · ${parsed.skipped} line${parsed.skipped === 1 ? '' : 's'} without a term and definition left out`}
            </span>
          </div>
          {parsed.cards.length === 0 ? (
            <p className="muted import-empty">The cards will show here as they’ll be made: the term on the front, the definition on the back.</p>
          ) : (
            <div className="import-preview-list">
              {parsed.cards.slice(0, PREVIEW_ROWS).map((c, i) => (
                <div key={i} className="import-card">
                  <span className="import-n num muted">{i + 1}</span>
                  <span className="import-side">
                    <span className="import-label">Front</span>
                    {c.front}
                  </span>
                  <span className="import-side">
                    <span className="import-label">Back</span>
                    {c.back}
                  </span>
                </div>
              ))}
              {parsed.cards.length > PREVIEW_ROWS && <p className="muted import-more">…and {parsed.cards.length - PREVIEW_ROWS} more</p>}
            </div>
          )}
        </div>

        {parsed.cards.length > 0 && (
          <div className="import-where">
            <h2>Add them to</h2>
            <div className="grid-2">
              <label className="field">
                Class
                <select
                  value={classId}
                  onChange={(e) => {
                    setClassId(Number(e.target.value));
                    setDeckId(NEW);
                  }}
                >
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.icon ? `${c.icon} ` : ''}
                      {c.name}
                    </option>
                  ))}
                  <option value={NEW}>New class…</option>
                </select>
              </label>
              {classId === NEW && (
                <label className="field">
                  New class name
                  <input type="text" value={className} onChange={(e) => setClassName(e.target.value)} placeholder="e.g. Biology 30" />
                </label>
              )}
              <label className="field">
                Deck
                <select value={deckId} onChange={(e) => setDeckId(Number(e.target.value))}>
                  <option value={NEW}>New deck…</option>
                  {decksInClass.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name.slice((cls?.name.length ?? 0) + 2).split('::').join(' › ') || baseName(d.name)}
                    </option>
                  ))}
                </select>
              </label>
              {deckId === NEW && (
                <label className="field">
                  New deck name
                  <input type="text" value={deckName} onChange={(e) => setDeckName(e.target.value)} placeholder="e.g. Endocrine system" />
                </label>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
