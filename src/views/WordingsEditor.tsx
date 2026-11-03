// A list of other wordings of a card's front, each editable and removable.

import { MAX_WORDINGS } from '../lib/types';

export function WordingsEditor({
  wordings,
  onChange,
  onFocusField,
  invalid,
  hint,
}: {
  wordings: string[];
  onChange: (next: string[]) => void;
  /** the textarea that got focus, for inserting placeholders */
  onFocusField?: (el: HTMLTextAreaElement, index: number) => void;
  /** per wording: a problem to show, if any */
  invalid?: (string | null)[];
  hint?: string;
}) {
  return (
    <details className="wordings" open={wordings.length > 0}>
      <summary>
        Other wordings of the front ({wordings.length}/{MAX_WORDINGS})
      </summary>
      {hint && <p className="muted" style={{ margin: '4px 0', fontSize: 13 }}>{hint}</p>}
      {wordings.map((w, i) => (
        <div key={i} className="wording-row">
          <textarea
            value={w}
            aria-label={`Wording ${i + 1}`}
            className={invalid?.[i] ? 'invalid' : ''}
            onFocus={(e) => onFocusField?.(e.currentTarget, i)}
            onChange={(e) => onChange(wordings.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <button className="icon-button" aria-label={`Remove wording ${i + 1}`} title="Remove" onClick={() => onChange(wordings.filter((_, j) => j !== i))}>
            ✕
          </button>
          {invalid?.[i] && <div className="polish-error">{invalid[i]}</div>}
        </div>
      ))}
      {wordings.length < MAX_WORDINGS && (
        <button className="link" onClick={() => onChange([...wordings, ''])}>
          + Add a wording
        </button>
      )}
    </details>
  );
}
