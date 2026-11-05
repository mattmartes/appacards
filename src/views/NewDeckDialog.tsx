// Making a deck in a class: its name, and optionally a due date that sets
// how many new cards it brings in each day; or importing one into the class
// from Anki or Quizlet instead.

import { useState } from 'react';
import type { DuePlan } from '../lib/types';
import { draftFromPlan, DuePlanFields, planFromDraft } from './DuePlanFields';
import { Modal } from './Modal';

export function NewDeckDialog({
  title,
  validate,
  onSubmit,
  onImport,
  onCancel,
}: {
  title: string;
  validate?: (name: string) => string | null;
  onSubmit: (name: string, plan: DuePlan | null) => void | Promise<void>;
  /** import into the class instead, with the name typed so far */
  onImport?: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [due, setDue] = useState(() => draftFromPlan(null));
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const n = name.trim();
    const problem = !n ? "Deck name can't be empty." : (validate?.(n) ?? null);
    if (problem) return setError(problem);
    const plan = planFromDraft(due);
    if (typeof plan === 'string') return setError(plan);
    try {
      await onSubmit(n, plan);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          {onImport && (
            <button style={{ marginRight: 'auto' }} onClick={() => onImport(name.trim())} title="Bring cards in from an Anki file or a Quizlet set, into this class">
              Import cards…
            </button>
          )}
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={() => void submit()}>
            Create
          </button>
        </>
      }
    >
      <div className="class-dialog">
        <label className="field">
          Deck name
          <input
            type="text"
            value={name}
            data-autofocus
            aria-invalid={!!error}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
          />
        </label>
        <DuePlanFields
          draft={due}
          onChange={(d) => {
            setDue(d);
            setError(null);
          }}
        />
        {error && (
          <p role="alert" style={{ margin: 0, color: 'var(--again)' }}>
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
