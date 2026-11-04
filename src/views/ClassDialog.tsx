// A class's emoji: a small square button showing it, which opens a window
// of emoji to pick from (or any emoji typed in). Used when making a class,
// in its settings and on its homepage. Also the New class dialog itself.

import { useState } from 'react';
import { ALL_EMOJI, EMOJI_GROUPS } from '../lib/emoji';
import { Modal } from './Modal';


/** The window of emoji. Picking one closes it; "No icon" clears it. */
export function EmojiPicker({ value, onPick, onClose }: { value?: string; onPick: (emoji: string | undefined) => void; onClose: () => void }) {
  const [typed, setTyped] = useState(value && !ALL_EMOJI.includes(value) ? value : '');
  // open on the category holding the current icon
  const [group, setGroup] = useState(() => Math.max(0, EMOJI_GROUPS.findIndex((g) => value && g.emoji.includes(value))));
  const choose = (e: string | undefined) => {
    onPick(e);
    onClose();
  };
  // the first character the person sees, whatever it's made of
  const firstTyped = [...new Intl.Segmenter().segment(typed.trim())][0]?.segment;
  return (
    <Modal title="Choose an icon" onClose={onClose}>
      <div className="emoji-tabs" role="tablist" aria-label="Emoji categories">
        {EMOJI_GROUPS.map((g, i) => (
          <button type="button" key={g.name} role="tab" aria-selected={group === i} className={group === i ? 'active' : ''} onClick={() => setGroup(i)} title={g.name}>
            <span aria-hidden="true">{g.emoji[0]}</span>
            <span className="emoji-tab-name">{g.name}</span>
          </button>
        ))}
      </div>
      <div className="emoji-grid emoji-grid-lg" role="radiogroup" aria-label={`${EMOJI_GROUPS[group].name} emoji`}>
        {EMOJI_GROUPS[group].emoji.map((e) => (
          <button type="button" key={e} role="radio" aria-checked={value === e} className={`emoji-option ${value === e ? 'active' : ''}`} onClick={() => choose(e)}>
            {e}
          </button>
        ))}
      </div>
      <div className="emoji-own-row">
        <label className="emoji-own">
          <span className="hint">Or type any emoji (Windows: Win + .)</span>
          <input
            type="text"
            value={typed}
            maxLength={16}
            placeholder="🙂"
            aria-label="Your own emoji"
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && firstTyped) {
                e.preventDefault();
                choose(firstTyped);
              }
            }}
          />
        </label>
        <span className="spacer" />
        {firstTyped && (
          <button type="button" className="primary" onClick={() => choose(firstTyped)}>
            Use {firstTyped}
          </button>
        )}
        <button type="button" onClick={() => choose(undefined)} disabled={!value}>
          No icon
        </button>
      </div>
    </Modal>
  );
}

/** The class's icon as a small square; click it to choose another. */
export function EmojiButton({ value, fallback, onChange, size = 'md' }: { value?: string; fallback?: string; onChange: (emoji: string | undefined) => void; size?: 'md' | 'lg' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`emoji-button emoji-button-${size} ${value ? 'has-icon' : ''}`}
        onClick={() => setOpen(true)}
        aria-label={value ? `Icon ${value}. Change it` : 'Choose an icon'}
        title={value ? 'Change icon' : 'Choose an icon'}
      >
        {value ?? (
          fallback ?? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" />
            </svg>
          )
        )}
      </button>
      {open && <EmojiPicker value={value} onPick={onChange} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Making a class: its icon beside its name. */
export function ClassDialog({
  validate,
  onSubmit,
  onCancel,
}: {
  validate?: (name: string) => string | null;
  onSubmit: (name: string, icon: string | undefined) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const n = name.trim();
    const problem = !n ? "Class name can't be empty." : (validate?.(n) ?? null);
    if (problem) return setError(problem);
    try {
      await onSubmit(n, icon);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal
      title="New class"
      onClose={onCancel}
      footer={
        <>
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={() => void submit()}>
            Create class
          </button>
        </>
      }
    >
      <div className="class-dialog">
        <div className="class-name-row">
          <EmojiButton value={icon} onChange={setIcon} />
          <input
            type="text"
            value={name}
            data-autofocus
            placeholder="Class name, e.g. Biology 241"
            aria-label="Class name"
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
        </div>
        <span className="hint">Add decks to it from its Decks row in the sidebar.</span>
        {error && (
          <p role="alert" style={{ margin: 0, color: 'var(--again)' }}>
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
