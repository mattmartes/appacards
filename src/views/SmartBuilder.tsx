// Creates and edits smart notes: ask the AI for one (or start from an
// example), check it runs and its worked examples pass, preview random
// versions of each card, and reword the cards, which must keep their
// placeholders.

import { useEffect, useRef, useState } from 'react';
import { useCollection } from '../lib/collection';
import { savedKey } from '../lib/polish';
import { checkSpec, designWithAi, placeholders, renderRun, runCase, type SmartCheck, type SmartFace } from '../lib/smart';
import { SMART_EXAMPLES } from '../lib/smartExamples';
import { randomSeed } from '../lib/smartLib';
import { renderMedia } from '../lib/media';
import type { Id, SmartCase, SmartSpec } from '../lib/types';
import { useModels } from './AiPrefs';
import { WordingsEditor } from './WordingsEditor';

export function SmartBuilder({
  initial,
  noteId,
  saveLabel,
  onSave,
  onCancel,
}: {
  initial?: SmartSpec;
  /** the note being edited, so it isn't offered as its own prerequisite */
  noteId?: Id;
  saveLabel: string;
  onSave: (spec: SmartSpec) => Promise<void> | void;
  onCancel?: () => void;
}) {
  const col = useCollection();
  const { models, initial: model } = useModels();
  const [spec, setSpec] = useState<SmartSpec | null>(initial ?? null);
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [notes, setNotes] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<SmartCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  // Re-check shortly after each change.
  useEffect(() => {
    if (!spec) {
      setCheck(null);
      return;
    }
    let stale = false;
    setChecking(true);
    const t = setTimeout(() => {
      checkSpec(spec).then(
        (c) => !stale && (setCheck(c), setChecking(false)),
        (e: Error) => !stale && (setCheck({ errors: [e.message], warnings: [], cases: [], tests: [], missing: [] }), setChecking(false)),
      );
    }, 500);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [spec]);

  const askAi = async (changes: boolean) => {
    const key = savedKey();
    if (!key) return setError('Add your OpenRouter API key in Preferences → AI first.');
    if (!changes && !prompt.trim()) return setError('Describe what you want to practise first.');
    setError(null);
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const info = models.find((m) => m.id === model);
    try {
      const next = await designWithAi(
        key,
        {
          model,
          jsonMode: info?.supported_parameters?.includes('response_format'),
          maxTokens: info?.top_provider?.max_completion_tokens ?? undefined,
        },
        changes && spec ? { prompt: spec.prompt || prompt, current: spec, feedback } : { prompt, notes },
        ctrl.signal,
      );
      // fixed reports were sent as counterexamples
      setSpec({ ...next, requires: spec?.requires, reports: changes ? [] : undefined });
      setFeedback('');
    } catch (e) {
      if (!ctrl.signal.aborted) setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const update = (patch: Partial<SmartSpec>) => spec && setSpec({ ...spec, ...patch });

  if (!spec) {
    return (
      <div className="smart-builder">
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          A smart card shows new values every time, so you practise the skill instead of remembering one example. Describe what you want
          to practise; the AI splits it into one card per skill and writes the generator. You'll check and reword the cards before
          they're added.
        </p>
        <label className="field">
          What do you want to practise?
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Predicting phenotypic ratios of crosses where one parent is heterozygous and the other homozygous, for different dominance types"
            style={{ minHeight: 90 }}
          />
        </label>
        <details>
          <summary className="muted" style={{ fontSize: 14 }}>
            Add course notes (optional)
          </summary>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Paste lecture text so the cards use your course's terms and notation."
            style={{ minHeight: 120, marginTop: 6 }}
          />
        </details>
        <div className="row">
          <button className="primary" onClick={() => void askAi(false)} disabled={busy}>
            {busy ? 'Designing… (this can take a minute)' : 'Create with AI'}
          </button>
          {busy && <button onClick={() => abort.current?.abort()}>Cancel</button>}
          <span className="muted" style={{ fontSize: 13 }}>
            Uses {model} (Preferences → AI)
          </span>
          {onCancel && (
            <>
              <span className="spacer" />
              <button onClick={onCancel}>Cancel</button>
            </>
          )}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            Or start from an example:
          </span>
          {SMART_EXAMPLES.map((ex) => (
            <button key={ex.title} onClick={() => setSpec(structuredClone(ex))}>
              {ex.title}
            </button>
          ))}
        </div>
        {error && <div className="polish-error">{error}</div>}
      </div>
    );
  }

  const otherSmart = [...col.notes.values()].filter((n) => n.kind === 'smart' && n.id !== noteId && n.smart);
  const canSave = !!check && !checking && check.errors.length === 0 && !busy;

  return (
    <div className="smart-builder">
      <div className="grid-2">
        <label className="field">
          Title
          <input type="text" value={spec.title} onChange={(e) => update({ title: e.target.value })} />
        </label>
        <label className="field">
          Description
          <input type="text" value={spec.description} onChange={(e) => update({ description: e.target.value })} />
        </label>
      </div>

      <div>
        <div className="field-label">Placeholders</div>
        <table className="smart-legend">
          <tbody>
            {spec.vars.map((v, i) => (
              <tr key={v.name}>
                <td>
                  <span className={`smart-chip ${v.role}`}>[{v.name}]</span>
                </td>
                <td style={{ width: '100%' }}>
                  <input
                    type="text"
                    value={v.label}
                    aria-label={`What [${v.name}] is`}
                    onChange={(e) => update({ vars: spec.vars.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                  />
                </td>
                <td className="muted" style={{ whiteSpace: 'nowrap', fontSize: 13 }}>
                  {v.role === 'input' ? 'shown on the front' : 'computed answer'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CheckSummary check={check} checking={checking} />

      {spec.cases.map((_, i) => (
        <CaseEditor
          key={i}
          spec={spec}
          index={i}
          missing={check?.missing[i]}
          onChange={(patch) => update({ cases: spec.cases.map((x, j) => (j === i ? { ...x, ...patch } : x)) })}
          onRemove={
            spec.cases.length > 1
              ? () =>
                  update({
                    cases: spec.cases.filter((_, j) => j !== i),
                    // tests refer to cases by position
                    tests: spec.tests.filter((t) => t.case !== i).map((t) => (t.case > i ? { ...t, case: t.case - 1 } : t)),
                  })
              : undefined
          }
        />
      ))}

      {otherSmart.length > 0 && (
        <details>
          <summary style={{ fontSize: 14 }}>Combination card: unlock after other smart notes are learned</summary>
          <p className="muted" style={{ fontSize: 13 }}>
            These cards stay hidden until every card of the notes you tick has a stability of at least a week, so a miss means
            combining the skills is hard, not that one of them is new.
          </p>
          {otherSmart.map((n) => (
            <label key={n.id} className="row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={spec.requires?.includes(n.id) ?? false}
                onChange={(e) =>
                  update({ requires: e.target.checked ? [...(spec.requires ?? []), n.id] : (spec.requires ?? []).filter((x) => x !== n.id) })
                }
              />
              {n.smart!.title}
            </label>
          ))}
        </details>
      )}

      {spec.reports && spec.reports.length > 0 && (
        <div className="smart-reports">
          <b>Reported as wrong in review ({spec.reports.length})</b>
          <ul>
            {spec.reports.map((r, i) => (
              <li key={i}>
                {spec.cases[r.case]?.name ?? `Card ${r.case + 1}`}: “{r.comment}”{' '}
                <span className="muted">({Object.entries(r.vars).filter(([k]) => spec.vars.some((v) => v.name === k && v.role === 'answer')).map(([k, v]) => `${k} = ${v}`).join(', ')})</span>
              </li>
            ))}
          </ul>
          <span className="muted" style={{ fontSize: 13 }}>
            Update with AI sends these as counterexamples to fix.
          </span>{' '}
          <button className="link" onClick={() => update({ reports: [] })}>
            Clear
          </button>
        </div>
      )}

      <details>
        <summary style={{ fontSize: 14 }}>Generator code and worked examples (advanced)</summary>
        <textarea className="html-editor" value={spec.code} onChange={(e) => update({ code: e.target.value })} style={{ minHeight: 260, marginTop: 6 }} spellCheck={false} />
        {spec.tests.map((t, i) => {
          const r = check?.tests[i];
          return (
            <div key={i} className={`smart-test ${r ? (r.pass ? 'pass' : 'fail') : ''}`}>
              <b>
                {r ? (r.pass ? '✓' : '✗') : '…'} Example {i + 1}
              </b>{' '}
              ({spec.cases[t.case]?.name}) expects {Object.entries(t.expected).map(([k, v]) => `${k} = ${v}`).join(', ')}
              {r && !r.pass && <div>Got: {r.error ?? Object.entries(r.got).map(([k, v]) => `${k} = ${v}`).join(', ')}</div>}
            </div>
          );
        })}
      </details>

      <div className="smart-ai-change">
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Ask the AI for changes, e.g. “also add a testcross card” or “use Drosophila only”"
          style={{ minHeight: 60 }}
        />
        <div className="row">
          <button onClick={() => void askAi(true)} disabled={busy || (!feedback.trim() && !spec.reports?.length)}>
            {busy ? 'Updating… (this can take a minute)' : 'Update with AI'}
          </button>
          {busy && <button onClick={() => abort.current?.abort()}>Cancel</button>}
          <button className="link" onClick={() => !busy && confirm('Discard this smart card and start over?') && setSpec(null)}>
            Start over
          </button>
        </div>
      </div>

      {error && <div className="polish-error">{error}</div>}
      <div className="row">
        <button className="primary" disabled={!canSave} onClick={() => void onSave(spec)}>
          {saveLabel} ({spec.cases.length} card{spec.cases.length === 1 ? '' : 's'})
        </button>
        {onCancel && <button onClick={onCancel}>Cancel</button>}
        {!canSave && !checking && check && check.errors.length > 0 && (
          <span className="polish-error">Fix the problems above to save.</span>
        )}
      </div>
    </div>
  );
}

function CheckSummary({ check, checking }: { check: SmartCheck | null; checking: boolean }) {
  if (!check || checking) return <div className="smart-check muted">Checking the generator…</div>;
  const passed = check.tests.filter((t) => t.pass).length;
  const runs = check.cases.reduce((n, c) => n + c.runs, 0);
  return (
    <div className={`smart-check ${check.errors.length ? 'bad' : 'good'}`}>
      {check.errors.length === 0 ? (
        <b>
          ✓ Ready: {runs} random versions ran cleanly
          {check.tests.length > 0 && `, and ${passed} of ${check.tests.length} worked examples match`}.
        </b>
      ) : (
        <>
          <b>Needs fixing:</b>
          <ul>
            {check.errors.slice(0, 8).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </>
      )}
      {check.warnings.length > 0 && (
        <ul className="muted">
          {check.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CaseEditor({
  spec,
  index,
  missing,
  onChange,
  onRemove,
}: {
  spec: SmartSpec;
  index: number;
  missing?: { front: string[]; back: string[]; alts: string[][] };
  onChange: (patch: Partial<SmartCase>) => void;
  onRemove?: () => void;
}) {
  const c = spec.cases[index];
  const alts = c.altFronts ?? [];
  const frontRef = useRef<HTMLTextAreaElement>(null);
  const backRef = useRef<HTMLTextAreaElement>(null);
  /** the field last edited, and how to change it */
  const lastField = useRef<{ el: HTMLTextAreaElement; set: (v: string) => void } | null>(null);
  const used = new Set([...placeholders(c.front), ...placeholders(c.back)]);
  const missingAll = new Set([...(missing?.front ?? []), ...(missing?.back ?? []), ...(missing?.alts?.flat() ?? [])]);
  const field = (el: HTMLTextAreaElement | null, set: (v: string) => void) => {
    if (el) lastField.current = { el, set };
  };

  /** Puts [name] at the cursor of the field last edited (else inputs on the front, answers on the back). */
  const insert = (name: string, role: 'input' | 'answer') => {
    const target =
      lastField.current ??
      (role === 'input'
        ? frontRef.current && { el: frontRef.current, set: (v: string) => onChange({ front: v }) }
        : backRef.current && { el: backRef.current, set: (v: string) => onChange({ back: v }) });
    if (!target) return;
    const { el, set } = target;
    const text = el.value;
    const at = el.selectionStart ?? text.length;
    set(`${text.slice(0, at)}[${name}]${text.slice(el.selectionEnd ?? at)}`);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + name.length + 2, at + name.length + 2);
    });
  };

  return (
    <section className="smart-case">
      <div className="row">
        <span className="muted num">Card {index + 1}</span>
        <input type="text" value={c.name} onChange={(e) => onChange({ name: e.target.value })} aria-label="Skill this card tests" style={{ flex: 1 }} />
        {onRemove && (
          <button className="icon-button" onClick={onRemove} aria-label="Remove this card" title="Remove this card">
            ✕
          </button>
        )}
      </div>
      <div className="row" style={{ gap: 4 }}>
        {spec.vars.map((v) => (
          <button
            key={v.name}
            type="button"
            className={`smart-chip ${v.role} ${missingAll.has(v.name) ? 'missing' : used.has(v.name) ? 'used' : ''}`}
            title={`${v.label}${missingAll.has(v.name) ? ' (required here)' : ''}. Click to insert.`}
            onClick={() => insert(v.name, v.role)}
          >
            [{v.name}]
          </button>
        ))}
      </div>
      <div className="smart-case-grid">
        <div>
          <label className="field">
            Front
            <textarea
              ref={frontRef}
              value={c.front}
              onFocus={(e) => field(e.currentTarget, (v) => onChange({ front: v }))}
              onChange={(e) => onChange({ front: e.target.value })}
              className={missing?.front.length ? 'invalid' : ''}
            />
          </label>
          <WordingsEditor
            wordings={alts}
            onChange={(next) => onChange({ altFronts: next.length ? next : undefined })}
            onFocusField={(el, i) => field(el, (v) => onChange({ altFronts: alts.map((x, j) => (j === i ? v : x)) }))}
            invalid={alts.map((_, i) => (missing?.alts?.[i]?.length ? `Must include ${missing.alts[i].map((n) => `[${n}]`).join(', ')}` : null))}
            hint="Each review uses the front or one of these at random. They need the same placeholders as the front."
          />
          <label className="field">
            Back
            <textarea
              ref={backRef}
              value={c.back}
              onFocus={(e) => field(e.currentTarget, (v) => onChange({ back: v }))}
              onChange={(e) => onChange({ back: e.target.value })}
              className={missing?.back.length ? 'invalid' : ''}
            />
          </label>
        </div>
        <CasePreview spec={spec} index={index} />
      </div>
    </section>
  );
}

/** A random version of the card, with a button for another. */
function CasePreview({ spec, index }: { spec: SmartSpec; index: number }) {
  const [seed, setSeed] = useState(randomSeed);
  const [face, setFace] = useState<SmartFace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const c = spec.cases[index];

  useEffect(() => {
    let stale = false;
    const t = setTimeout(() => {
      runCase(spec, index, seed).then(
        (run) => {
          if (stale) return;
          // rotate through the wordings as the values change
          const fronts = [c.front, ...(c.altFronts ?? []).filter((x) => x.trim())];
          setFace(renderRun({ ...c, front: fronts[seed % fronts.length] }, run));
          setError(null);
        },
        (e: Error) => !stale && setError(e.message),
      );
    }, 300);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [spec, index, seed, c]);

  return (
    <div className="smart-preview">
      <div className="row">
        <span className="field-label" style={{ margin: 0 }}>
          Preview
        </span>
        <span className="spacer" />
        <button className="link" onClick={() => setSeed(randomSeed())}>
          ↻ Other values
        </button>
      </div>
      {error ? (
        <div className="polish-error">{error}</div>
      ) : face ? (
        <div className="card-face smart-preview-face">
          <div dangerouslySetInnerHTML={{ __html: renderMedia(face.front) }} />
          <hr />
          <div dangerouslySetInnerHTML={{ __html: renderMedia(face.back) }} />
        </div>
      ) : (
        <div className="muted">…</div>
      )}
    </div>
  );
}
