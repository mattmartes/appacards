// Making a class, or changing its icon: a name (when making one) and an
// emoji picked from a grid of school-ish ones, or any emoji typed in.

import { useState } from 'react';
import { Modal } from './Modal';

const EMOJI = [
  '📚', '📖', '📝', '✏️', '🎓', '🏫', '🧠', '💡',
  '🔬', '🧪', '🧬', '⚗️', '🔭', '🌍', '🌱', '🦠',
  '➗', '📐', '📊', '📈', '💻', '🤖', '⚙️', '🔧',
  '🏛️', '⚖️', '🗺️', '📜', '💬', '🗣️', '🎨', '🎵',
  '🩺', '💊', '❤️', '🫀', '💰', '🏦', '📦', '🧾',
  '⚽', '🏃', '🍎', '☕', '⭐', '🔥', '🚀', '🌈',
];

export function ClassDialog({
  title,
  submitLabel,
  askName,
  initialIcon,
  validate,
  onSubmit,
  onCancel,
}: {
  title: string;
  submitLabel: string;
  /** making a class: ask for its name too */
  askName?: boolean;
  initialIcon?: string;
  validate?: (name: string) => string | null;
  onSubmit: (name: string, icon: string | undefined) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string | undefined>(initialIcon);
  const [typed, setTyped] = useState(initialIcon && !EMOJI.includes(initialIcon) ? initialIcon : '');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const n = name.trim();
    const problem = askName && !n ? "Class name can't be empty." : askName ? (validate?.(n) ?? null) : null;
    if (problem) return setError(problem);
    try {
      await onSubmit(n, icon);
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
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={() => void submit()}>
            {submitLabel}
          </button>
        </>
      }
    >
      <div className="class-dialog">
        {askName && (
          <label className="field">
            Class name
            <span className="hint">e.g. Biology 241. Add decks to it from its Decks row.</span>
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
        )}
        <div className="field">
          <span>Icon</span>
          <div className="emoji-grid" role="radiogroup" aria-label="Class icon">
            <button type="button" role="radio" aria-checked={!icon} className={`emoji-option emoji-none ${!icon ? 'active' : ''}`} onClick={() => setIcon(undefined)} title="No icon (shows its first letter)">
              Aa
            </button>
            {EMOJI.map((e) => (
              <button type="button" key={e} role="radio" aria-checked={icon === e} className={`emoji-option ${icon === e ? 'active' : ''}`} onClick={() => setIcon(e)}>
                {e}
              </button>
            ))}
          </div>
          <label className="emoji-own">
            <span className="hint">Or type any emoji (Windows: Win + .)</span>
            <input
              type="text"
              value={typed}
              maxLength={16}
              placeholder="🙂"
              aria-label="Your own emoji"
              onChange={(e) => {
                setTyped(e.target.value);
                // keep the first character the person sees, whatever it's made of
                const first = [...new Intl.Segmenter().segment(e.target.value.trim())][0]?.segment;
                setIcon(first || undefined);
              }}
            />
          </label>
        </div>
        {error && <span style={{ color: 'var(--again)' }}>{error}</span>}
      </div>
    </Modal>
  );
}
