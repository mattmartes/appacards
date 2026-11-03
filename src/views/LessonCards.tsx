// Reviews the flashcards a lesson has unlocked: edit, keep or drop each, pick
// the deck, and tell the tutor how you like flashcards written. That feedback
// applies for the rest of the lesson and can rewrite the cards waiting here.

import { useRef, useState } from 'react';
import { useCollection } from '../lib/collection';
import { depth } from '../lib/deckTree';
import { rewriteCards } from '../lib/learn';
import { savedKey } from '../lib/polish';
import type { Id, Lesson } from '../lib/types';
import { useModels } from './AiPrefs';
import { Modal } from './Modal';

interface Draft {
  id: string;
  front: string;
  back: string;
  keep: boolean;
  item: string;
}

/** "Topic 4: Gene interactions" -> "learn::Topic_4_Gene_interactions" */
const lessonTag = (title: string) => `learn::${title.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '') || 'lesson'}`;

export function LessonCards({ lesson, onClose }: { lesson: Lesson; onClose: () => void }) {
  const col = useCollection();
  const decks = col.deckList();
  const { models, initial } = useModels();
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    lesson.cards.filter((c) => c.status === 'pending').map((c) => ({ id: c.id, front: c.front, back: c.back, keep: true, item: c.item })),
  );
  const [deckId, setDeckId] = useState<Id | undefined>(lesson.deckId ?? decks[0]?.id);
  const [style, setStyle] = useState<string[]>(lesson.cardStyle);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const concept = new Map(lesson.plan.map((p) => [p.id, p.title]));

  /** Saves the preferences on the lesson, so the tutor follows them from now on. */
  const saveStyle = async (next: string[]) => {
    setStyle(next);
    await col.saveLesson({ ...(col.lessons.get(lesson.id) ?? lesson), cardStyle: next });
  };

  const applyFeedback = async () => {
    const text = feedback.trim();
    if (!text) return;
    const next = [...style, text];
    await saveStyle(next);
    setFeedback('');
    const key = savedKey();
    if (!key || !drafts.length) return;
    setBusy(true);
    setError(null);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const info = models.find((m) => m.id === initial);
    try {
      const rewritten = await rewriteCards(
        key,
        { model: initial, jsonMode: info?.supported_parameters?.includes('response_format'), maxTokens: info?.top_provider?.max_completion_tokens ?? undefined },
        { ...lesson, cardStyle: next },
        drafts.map((d) => ({ id: d.id, front: d.front, back: d.back, item: d.item, status: 'pending' })),
        ctrl.signal,
      );
      setDrafts((ds) => ds.map((d) => ({ ...d, ...(rewritten.get(d.id) ?? {}) })));
    } catch (e) {
      if (!ctrl.signal.aborted) setError(`Saved your preference, but rewriting failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (deckId === undefined) return;
    const current = col.lessons.get(lesson.id) ?? lesson;
    const byId = new Map(drafts.map((d) => [d.id, d]));
    const tag = lessonTag(lesson.title);
    const cards = [...current.cards];
    for (let i = 0; i < cards.length; i++) {
      const d = byId.get(cards[i].id);
      if (!d) continue;
      if (d.keep && d.front.trim() && d.back.trim()) {
        const made = await col.addNote('basic', { Front: d.front.trim(), Back: d.back.trim() }, [tag], deckId, false);
        cards[i] = { ...cards[i], front: d.front.trim(), back: d.back.trim(), status: 'approved', noteId: made[0]?.noteId };
      } else {
        cards[i] = { ...cards[i], status: 'rejected' };
      }
    }
    await col.saveLesson({ ...current, cards, deckId, cardStyle: style });
    onClose();
  };

  /** Keeps edits but leaves the cards waiting. */
  const later = async () => {
    const current = col.lessons.get(lesson.id) ?? lesson;
    const byId = new Map(drafts.map((d) => [d.id, d]));
    await col.saveLesson({
      ...current,
      deckId,
      cards: current.cards.map((c) => {
        const d = byId.get(c.id);
        return d ? { ...c, front: d.front, back: d.back } : c;
      }),
    });
    onClose();
  };

  const kept = drafts.filter((d) => d.keep).length;

  return (
    <Modal
      title="Unlocked flashcards"
      wide
      onClose={() => void later()}
      footer={
        <>
          <button onClick={() => void later()} disabled={busy}>
            Decide later
          </button>
          <button className="primary" onClick={() => void finish()} disabled={busy || deckId === undefined}>
            {kept ? `Add ${kept} to deck` : 'Discard all'}
            {kept > 0 && drafts.length > kept ? `, discard ${drafts.length - kept}` : ''}
          </button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        You unlocked these by showing you understand them. Edit them, untick any you don't want, then add them to a deck.
      </p>
      <label className="field">
        Deck
        <select value={deckId ?? ''} onChange={(e) => setDeckId(Number(e.target.value))}>
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {'  '.repeat(depth(d.name))}
              {d.name.split('::').pop()}
            </option>
          ))}
        </select>
      </label>

      <div className="lesson-card-list">
        {drafts.map((d, i) => (
          <div key={d.id} className={`lesson-card ${d.keep ? '' : 'dimmed'}`}>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={d.keep} onChange={(e) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))} />
              <span className="muted" style={{ fontSize: 12 }}>
                {concept.get(d.item) ?? 'Lesson'}
              </span>
            </label>
            <textarea
              aria-label="Front"
              value={d.front}
              onChange={(e) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, front: e.target.value } : x)))}
            />
            <textarea
              aria-label="Back"
              value={d.back}
              onChange={(e) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, back: e.target.value } : x)))}
            />
          </div>
        ))}
      </div>

      <div className="card-style">
        <b>How do you want your flashcards?</b>
        <span className="muted" style={{ fontSize: 13 }}>
          Applies to every card the tutor makes for the rest of this lesson.
        </span>
        {style.length > 0 && (
          <div className="row" style={{ gap: 6 }}>
            {style.map((s, i) => (
              <span key={i} className="style-chip">
                {s}
                <button className="icon-button" aria-label={`Remove “${s}”`} onClick={() => void saveStyle(style.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input
            type="text"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void applyFeedback()}
            placeholder="e.g. less wordy · put an example on the back · ask in my own words"
            style={{ flex: 1 }}
          />
          <button onClick={() => void applyFeedback()} disabled={busy || !feedback.trim()}>
            {busy ? 'Rewriting…' : drafts.length ? 'Save and rewrite these' : 'Save'}
          </button>
        </div>
        {error && <div className="polish-error">{error}</div>}
      </div>
    </Modal>
  );
}
