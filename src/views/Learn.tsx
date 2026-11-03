// The Learn tab: upload course material, review the AI's teaching plan,
// then learn it in short chunks with a question after each. Concepts you
// show you understand unlock flashcards to approve into a deck.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCollection } from '../lib/collection';
import { depth } from '../lib/deckTree';
import { applyTurn, currentIndex, learnId, planLesson, teachTurn, type TurnKind, type TurnPartial } from '../lib/learn';
import { renderMarkdown } from '../lib/markdown';
import { MATERIAL_ACCEPT, readMaterial, sourceStats } from '../lib/materials';
import { savedKey, type ModelOptions } from '../lib/polish';
import type { Id, Lesson, LessonMessage, LessonSource } from '../lib/types';
import type { LessonStart } from '../App';
import { useModels } from './AiPrefs';
import { LessonCards } from './LessonCards';
import { ConfirmDialog } from './Modal';

/** The model settings saved in Preferences → AI. */
function useModelOptions(): { key: string; options: ModelOptions } {
  const { models, initial } = useModels();
  const info = models.find((m) => m.id === initial);
  return {
    key: savedKey(),
    options: { model: initial, maxTokens: info?.top_provider?.max_completion_tokens ?? undefined },
  };
}

export function Learn({ start }: { start?: LessonStart } = {}) {
  const col = useCollection();
  const [openId, setOpenId] = useState<Id | null>(null);
  const [creating, setCreating] = useState(!!start);
  const lesson = openId !== null ? col.lessons.get(openId) : undefined;

  if (creating) {
    return (
      <NewLesson
        start={start}
        onCancel={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          setOpenId(id);
        }}
      />
    );
  }
  if (lesson) {
    const back = () => setOpenId(null);
    return lesson.stage === 'plan' ? <PlanReview lesson={lesson} onBack={back} /> : <LessonView lesson={lesson} onBack={back} />;
  }
  return <LessonList onOpen={setOpenId} onNew={() => setCreating(true)} />;
}

// ---------------------------------------------------------------- list

function progressOf(l: Lesson) {
  const done = l.plan.filter((p) => p.status === 'understood' || p.status === 'skipped').length;
  return { done, total: l.plan.length };
}

function LessonList({ onOpen, onNew }: { onOpen: (id: Id) => void; onNew: () => void }) {
  const col = useCollection();
  const lessons = [...col.lessons.values()].sort((a, b) => b.updated - a.updated);
  const [deleting, setDeleting] = useState<Lesson | null>(null);
  return (
    <div className="panel" style={{ display: 'grid', gap: 14 }}>
      <div className="row">
        <h1 style={{ margin: 0 }}>Learn</h1>
        <span className="spacer" />
        <button className="primary" onClick={onNew}>
          New lesson
        </button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        Upload your lecture slides or notes. An AI tutor orders them into a teaching plan, teaches each concept in short steps and checks
        your understanding with questions, adjusting as you go. Each concept you show you understand unlocks flashcards you can add to a
        deck.
      </p>
      {lessons.length === 0 ? (
        <p className="muted">No lessons yet.</p>
      ) : (
        <div className="lesson-list">
          {lessons.map((l) => {
            const p = progressOf(l);
            const pending = l.cards.filter((c) => c.status === 'pending').length;
            return (
              <div key={l.id} className="lesson-row">
                <button className="lesson-open" onClick={() => onOpen(l.id)}>
                  <b>{l.title}</b>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {l.stage === 'plan'
                      ? 'Plan ready to review'
                      : l.stage === 'done'
                        ? `Finished · ${p.total} concepts`
                        : `${p.done} of ${p.total} concepts`}
                    {' · '}
                    {l.cards.filter((c) => c.status === 'approved').length} flashcards added
                    {pending > 0 && ` · ${pending} waiting for review`}
                  </span>
                  {p.total > 0 && (
                    <div className="progress" style={{ marginTop: 6 }}>
                      <div style={{ width: `${(p.done / p.total) * 100}%` }} />
                    </div>
                  )}
                </button>
                <button className="icon-button danger" aria-label={`Delete ${l.title}`} title="Delete lesson" onClick={() => setDeleting(l)}>
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete lesson"
          message={`Delete “${deleting.title}” and its conversation? Flashcards already added to decks stay.`}
          confirmLabel="Delete"
          danger
          onConfirm={async () => {
            await col.deleteLesson(deleting.id);
            setDeleting(null);
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- new lesson

function NewLesson({ start, onCancel, onCreated }: { start?: LessonStart; onCancel: () => void; onCreated: (id: Id) => void }) {
  const col = useCollection();
  const decks = col.deckList();
  const { key, options } = useModelOptions();
  const [title, setTitle] = useState(start?.title ?? '');
  const [deckId, setDeckId] = useState<Id | undefined>(start?.deckId ?? decks[0]?.id);
  const [sources, setSources] = useState<LessonSource[]>(start?.sources ?? []);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const addFiles = async (files: FileList | File[]) => {
    setReading(true);
    setError(null);
    const added: LessonSource[] = [];
    const problems: string[] = [];
    for (const f of [...files]) {
      try {
        added.push(await readMaterial(f, sources.length + added.length));
      } catch (e) {
        problems.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    setSources((s) => [...s, ...added]);
    if (!title && added[0]) setTitle(added[0].name.replace(/\.[^.]+$/, ''));
    if (problems.length) setError(problems.join(' '));
    setReading(false);
  };

  const makePlan = async () => {
    if (!key) return setError('Add your OpenRouter API key in Preferences → AI first.');
    setBusy(true);
    setError(null);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const draft: Lesson = {
      id: Date.now(),
      title: title.trim() || 'Lesson',
      created: Date.now(),
      updated: Date.now(),
      sources,
      stage: 'plan',
      plan: [],
      planNote: '',
      messages: [],
      cards: [],
      cardStyle: [],
      deckId,
    };
    try {
      const { plan, note } = await planLesson(key, options, draft, ctrl.signal);
      const saved = await col.saveLesson({ ...draft, plan, planNote: note });
      onCreated(saved.id);
    } catch (e) {
      if (!ctrl.signal.aborted) setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const totalChars = sources.reduce((n, s) => n + sourceStats(s).chars, 0);

  return (
    <div className="panel" style={{ display: 'grid', gap: 14 }}>
      <div className="row">
        <button className="link" onClick={onCancel}>
          ← Lessons
        </button>
        <h1 style={{ margin: 0 }}>New lesson</h1>
      </div>
      <div className="grid-2">
        <label className="field">
          Title
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Topic 4: Gene interactions" />
        </label>
        <label className="field">
          Deck for its flashcards
          <select value={deckId ?? ''} onChange={(e) => setDeckId(Number(e.target.value))}>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {'  '.repeat(depth(d.name))}
                {d.name.split('::').pop()}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label
        className="material-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void addFiles(e.dataTransfer.files);
        }}
      >
        <input type="file" multiple accept={MATERIAL_ACCEPT} onChange={(e) => e.target.files && void addFiles(e.target.files)} hidden />
        <b>{reading ? 'Reading…' : 'Choose or drop files'}</b>
        <span className="muted" style={{ fontSize: 13 }}>
          PowerPoint (.pptx), PDF, Word (.docx), or text. Add several files for one lesson.
        </span>
      </label>
      {sources.length > 0 && (
        <ul className="material-list">
          {sources.map((s) => {
            const st = sourceStats(s);
            return (
              <li key={s.id}>
                <span className="smart-chip">{s.id}</span> {s.name}{' '}
                <span className="muted">
                  · {s.sections.length} {s.kind === 'slides' ? 'slide' : s.kind === 'pdf' ? 'page' : 'section'}
                  {s.sections.length === 1 ? '' : 's'} ·{' '}
                  {st.chars.toLocaleString()} characters
                  {st.empty > 0 && ` · ${st.empty} with no text (images aren't read)`}
                </span>{' '}
                <button className="link" onClick={() => setSources((list) => list.filter((x) => x !== s))}>
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {sources.length > 0 && totalChars < 200 && (
        <div className="polish-error">
          Almost no text could be read. Slides that are pictures or scanned pages can't be taught from yet.
        </div>
      )}
      <div className="row">
        <button className="primary" disabled={!sources.length || busy || reading} onClick={() => void makePlan()}>
          {busy ? 'Planning… (this can take a minute)' : 'Make a teaching plan'}
        </button>
        {busy && <button onClick={() => abort.current?.abort()}>Cancel</button>}
        <span className="muted" style={{ fontSize: 13 }}>
          Uses {options.model} (Preferences → AI)
        </span>
      </div>
      {error && <div className="polish-error">{error}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- plan

function PlanReview({ lesson, onBack }: { lesson: Lesson; onBack: () => void }) {
  const col = useCollection();
  const [plan, setPlan] = useState(lesson.plan);
  const move = (i: number, d: -1 | 1) => {
    const next = [...plan];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setPlan(next);
  };
  const titles = useMemo(() => new Map(lesson.sources.flatMap((s) => s.sections.map((x) => [x.ref, `${s.name}: ${x.title}`]))), [lesson]);

  return (
    <div className="panel" style={{ display: 'grid', gap: 14 }}>
      <div className="row">
        <button className="link" onClick={onBack}>
          ← Lessons
        </button>
        <h1 style={{ margin: 0 }}>{lesson.title}: teaching plan</h1>
      </div>
      {lesson.planNote && <div className="plan-note">{lesson.planNote}</div>}
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        {plan.length} concepts, taught in this order. Reorder, rename or remove any before you start; the tutor can also add concepts
        during the lesson if you need a prerequisite.
      </p>
      <ol className="plan-edit">
        {plan.map((p, i) => (
          <li key={p.id}>
            <div className="plan-edit-main">
              <input
                type="text"
                value={p.title}
                aria-label={`Concept ${i + 1}`}
                onChange={(e) => setPlan(plan.map((x) => (x === p ? { ...x, title: e.target.value } : x)))}
              />
              <span className="muted" style={{ fontSize: 13 }}>
                {p.summary}
              </span>
              <span className="plan-refs">
                {p.refs.map((r) => (
                  <span key={r} className="smart-chip" title={titles.get(r)}>
                    {r}
                  </span>
                ))}
              </span>
            </div>
            <div className="plan-edit-actions">
              <button className="icon-button" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up" title="Move up">
                ↑
              </button>
              <button className="icon-button" disabled={i === plan.length - 1} onClick={() => move(i, 1)} aria-label="Move down" title="Move down">
                ↓
              </button>
              <button className="icon-button" onClick={() => setPlan(plan.filter((x) => x !== p))} aria-label="Remove" title="Remove">
                ✕
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="row">
        <button
          className="primary"
          disabled={!plan.length}
          onClick={() =>
            void col.saveLesson({
              ...lesson,
              plan: plan.map((p, i) => ({ ...p, status: i === 0 ? 'active' : 'todo' })),
              stage: 'learning',
            })
          }
        >
          Start learning
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- lesson

const STATUS_ICON = { todo: '○', active: '●', understood: '✓', skipped: '–' } as const;

/** How often the typing effect advances. Each tick reveals a share of what's
 * still hidden, so it types steadily and catches up smoothly when text
 * arrives in bursts. */
const TYPE_TICK_MS = 16;

/** Characters revealed so far per message, so a reply keeps its place when it
 * changes from streaming to saved. */
type Revealed = Map<string, number>;

/** Closes a **bold** cut off mid-reveal, so the asterisks don't flash. */
const closeMarks = (md: string) => ((md.split('**').length - 1) % 2 ? `${md}**` : md);

function Typed({
  id,
  text,
  animate,
  revealed,
  paused,
  onTick,
  onDone,
  className,
}: {
  id: string;
  text: string;
  animate: boolean;
  revealed: Revealed;
  /** waits (e.g. the question waits for the explanation) */
  paused?: boolean;
  onTick?: () => void;
  onDone?: () => void;
  className?: string;
}) {
  const [n, setN] = useState(() => (animate ? Math.min(revealed.get(id) ?? 0, text.length) : text.length));
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    if (!animate) {
      setN(textRef.current.length);
      return;
    }
    if (paused) return;
    const timer = setInterval(() => {
      setN((prev) => {
        const target = textRef.current.length;
        if (prev >= target) return prev;
        const next = Math.min(target, prev + Math.max(1, Math.min(14, Math.ceil((target - prev) / 18))));
        revealed.set(id, next);
        return next;
      });
    }, TYPE_TICK_MS);
    return () => clearInterval(timer);
  }, [animate, paused, id, revealed]);

  const done = n >= text.length;
  useEffect(() => {
    onTick?.();
  }, [n, onTick]);
  useEffect(() => {
    if (done) onDone?.();
  }, [done, onDone]);

  if (paused && n === 0) return null;
  return <div className={className} dangerouslySetInnerHTML={{ __html: renderMarkdown(closeMarks(text.slice(0, n))) }} />;
}

function TeacherMessage({
  m,
  animate,
  revealed,
  onTick,
}: {
  m: Pick<LessonMessage, 'id' | 'text' | 'question' | 'verdict'>;
  animate: boolean;
  revealed: Revealed;
  onTick: () => void;
}) {
  const [explained, setExplained] = useState(!animate);
  const onDone = useCallback(() => setExplained(true), []);
  return (
    <div className="msg teacher">
      {m.verdict && <span className={`verdict ${m.verdict}`}>{m.verdict === 'understood' ? '✓ Understood' : 'Not quite yet'}</span>}
      <Typed id={m.id} text={m.text} animate={animate} revealed={revealed} onTick={onTick} onDone={onDone} />
      {m.question && (
        <Typed id={`${m.id}:q`} text={m.question} animate={animate} paused={!explained} revealed={revealed} onTick={onTick} className="msg-question" />
      )}
    </div>
  );
}

function LessonView({ lesson, onBack }: { lesson: Lesson; onBack: () => void }) {
  const col = useCollection();
  const { key, options } = useModelOptions();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; retry: () => void } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  /** the tutor's reply as it streams in */
  const [live, setLive] = useState<({ id: string } & TurnPartial) | null>(null);
  /** the reply that types itself in (older ones show in full) */
  const [animateId, setAnimateId] = useState<string | null>(null);
  const revealed = useRef<Revealed>(new Map()).current;
  const abort = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const latest = useRef(lesson);
  latest.current = lesson;
  /** one request at a time, even from effects that run twice */
  const inFlight = useRef(false);
  // A reply still arriving after you leave is saved to the lesson; only Stop cancels it.

  // The lesson fills the content area (see .learn-shell); only the conversation scrolls.

  /** Keeps the newest text in view, unless you've scrolled up to read. */
  const follow = useCallback(() => {
    const el = listRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, []);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lesson.id]);
  useEffect(follow, [lesson.messages.length, busy, follow]);

  /** One exchange: saves the student's message, asks the tutor, saves its reply. */
  const send = async (kind: TurnKind, text?: string) => {
    if (inFlight.current) return;
    if (!key) return setError({ message: 'Add your OpenRouter API key in Preferences → AI first.', retry: () => void send(kind) });
    inFlight.current = true;
    let l = latest.current;
    if (text) {
      const item = l.plan[currentIndex(l)]?.id;
      l = await col.saveLesson({ ...l, messages: [...l.messages, { id: learnId('m'), role: 'student', text, item, at: Date.now() }] });
      requestAnimationFrame(() => {
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
    setBusy(true);
    setError(null);
    const id = learnId('m');
    setAnimateId(id);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const r = await teachTurn(key, options, l, kind, ctrl.signal, (part) => setLive({ id, ...part }));
      if (ctrl.signal.aborted) return;
      await col.saveLesson(applyTurn(latest.current, kind, r, id));
    } catch (e) {
      if (!ctrl.signal.aborted) setError({ message: (e as Error).message, retry: () => void send(kind) });
    } finally {
      inFlight.current = false;
      setLive(null);
      setBusy(false);
    }
  };

  // The first concept starts as soon as the lesson opens.
  useEffect(() => {
    if (lesson.stage === 'learning' && lesson.messages.length === 0) void send('start');
  }, [lesson.id, lesson.stage, lesson.messages.length]);

  const submit = () => {
    const t = input.trim();
    if (!t || busy) return;
    setInput('');
    void send('answer', t);
  };

  const cur = currentIndex(lesson);
  const p = progressOf(lesson);
  const pending = lesson.cards.filter((c) => c.status === 'pending');
  const approved = lesson.cards.filter((c) => c.status === 'approved').length;
  const titleOf = new Map(lesson.plan.map((x, i) => [x.id, `${i + 1}. ${x.title}`]));
  const showLive = live && live.teach && !lesson.messages.some((m) => m.id === live.id);

  return (
    <div className="learn-shell">
      <div className="learn-layout">
        <section className="panel learn-chat">
          <div className="learn-chat-head">
            <button className="link" onClick={onBack}>
              ← Lessons
            </button>
            <b>{lesson.title}</b>
          </div>

          <div className="learn-messages" ref={listRef}>
            {lesson.messages.map((m, i) => {
              const prev = lesson.messages[i - 1];
              const newItem = m.role === 'teacher' && m.item && m.item !== prev?.item && titleOf.get(m.item);
              return (
                <div key={m.id} className="msg-wrap">
                  {newItem && <div className="learn-concept">{newItem}</div>}
                  {m.role === 'student' ? (
                    <div className="msg student">{m.text}</div>
                  ) : (
                    <TeacherMessage m={m} animate={m.id === animateId} revealed={revealed} onTick={follow} />
                  )}
                </div>
              );
            })}
            {showLive && (
              <div className="msg-wrap">
                <TeacherMessage m={{ id: live.id, text: live.teach, question: live.question }} animate revealed={revealed} onTick={follow} />
              </div>
            )}
            {busy && !showLive && (
              <div className="msg teacher thinking" aria-label="The tutor is thinking">
                <span />
                <span />
                <span />
              </div>
            )}
            {lesson.stage === 'done' && !busy && (
              <div className="plan-note">
                <b>Lesson complete.</b> You can keep asking questions about anything in it.
              </div>
            )}
            {error && (
              <div className="polish-error">
                {error.message}{' '}
                <button className="link" onClick={error.retry}>
                  Try again
                </button>
              </div>
            )}
          </div>

          {pending.length > 0 && !reviewing && (
            <button className="unlock-banner" onClick={() => setReviewing(true)}>
              {pending.length} flashcard{pending.length === 1 ? '' : 's'} unlocked. Review and add them →
            </button>
          )}

          <div className="learn-composer">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={lesson.stage === 'done' ? 'Ask anything about this lesson…' : 'Your answer, or a question (Enter sends, Shift+Enter for a new line)'}
              disabled={busy}
              aria-label="Your answer"
            />
            <div className="row" style={{ gap: 6 }}>
              <button className="primary" onClick={submit} disabled={busy || !input.trim()}>
                Send
              </button>
              {lesson.stage !== 'done' && (
                <>
                  <button disabled={busy} onClick={() => void send('confused', "I don't get it.")}>
                    I don't get it
                  </button>
                  <button disabled={busy} onClick={() => void send('skip', 'I already know this.')}>
                    I know this
                  </button>
                  <button disabled={busy} onClick={() => void send('next', "Let's move on to the next concept.")}>
                    Next concept
                  </button>
                </>
              )}
              {busy && (
                <button className="link" onClick={() => abort.current?.abort()}>
                  Stop
                </button>
              )}
            </div>
          </div>
        </section>

        <aside className="panel learn-side">
          <div className="muted num" style={{ fontSize: 13 }}>
            {p.done} of {p.total} concepts
          </div>
          <div className="progress">
            <div style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} />
          </div>
          <ol className="plan-list">
            {lesson.plan.map((item, i) => (
              <li key={item.id} className={`plan-${item.status} ${i === cur ? 'current' : ''}`} title={item.summary}>
                <span className="plan-icon" aria-hidden="true">
                  {STATUS_ICON[item.status]}
                </span>
                <span>
                  {item.title}
                  {item.added && <span className="muted"> (added)</span>}
                </span>
              </li>
            ))}
          </ol>
          <div className="learn-cards-box">
            <b>Flashcards</b>
            <span className="muted" style={{ fontSize: 13 }}>
              {approved} added to {col.decks.get(lesson.deckId ?? -1)?.name ?? 'a deck'}
            </span>
            <button disabled={!pending.length} onClick={() => setReviewing(true)}>
              {pending.length ? `Review ${pending.length} unlocked` : 'None waiting'}
            </button>
          </div>
        </aside>
      </div>

      {reviewing && <LessonCards lesson={lesson} onClose={() => setReviewing(false)} />}
    </div>
  );
}
