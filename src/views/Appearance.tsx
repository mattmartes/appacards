import { useRef, useState } from 'react';
import { useCollection } from '../lib/collection';

/** Background image for the app, with an opacity slider. */
export function Appearance() {
  const col = useCollection();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const pct = Math.round(col.prefs.backgroundOpacity * 100);

  const choose = async (file: File) => {
    setError(null);
    if (!file.type.startsWith('image/')) return setError('Please choose an image file.');
    await col.setBackground(file);
  };

  return (
    <div className="panel" style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>Appearance</h2>
      <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
        <div
          className="bg-thumb"
          aria-label={col.backgroundUrl ? 'Current background image' : 'No background image'}
          role="img"
          style={col.backgroundUrl ? { backgroundImage: `url("${col.backgroundUrl}")` } : undefined}
        >
          {!col.backgroundUrl && <span className="muted">None</span>}
        </div>
        <div style={{ display: 'grid', gap: 10, flex: 1, minWidth: 220 }}>
          <div className="row">
            <button onClick={() => input.current?.click()}>
              {col.backgroundUrl ? 'Change background…' : 'Choose background image…'}
            </button>
            {col.backgroundUrl && (
              <button onClick={() => col.setBackground(null)} className="danger">
                Remove
              </button>
            )}
            <input
              ref={input}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void choose(f);
              }}
            />
          </div>
          <label className="field">
            <span className="row" style={{ justifyContent: 'space-between' }}>
              Background opacity <span className="num">{pct}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={pct}
              disabled={!col.backgroundUrl}
              aria-valuetext={`${pct}%`}
              onChange={(e) => col.previewPrefs({ backgroundOpacity: Number(e.target.value) / 100 })}
            />
          </label>
          {error && <span style={{ color: 'var(--again)' }}>{error}</span>}
        </div>
      </div>
    </div>
  );
}
