import { useRef, useState } from 'react';
import { useCollection } from '../lib/collection';
import { FONTS, readCustomColour, readFont, readTheme, setFont, setTheme, THEMES, type Theme } from '../lib/theme';

/** The colour theme, the app's font, and a background image for the app with an opacity slider. */
export function Appearance() {
  const col = useCollection();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [custom, setCustom] = useState(readCustomColour);
  const colourInput = useRef<HTMLInputElement>(null);
  const [font, setFontState] = useState(readFont);
  const pct = Math.round(col.prefs.backgroundOpacity * 100);

  const choose = async (file: File) => {
    setError(null);
    if (!file.type.startsWith('image/')) return setError('Please choose an image file.');
    await col.setBackground(file);
  };

  return (
    <div className="panel" style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>Appearance</h2>
      <div className="theme-picker" role="radiogroup" aria-label="Colour theme">
        {THEMES.map((t) => (
          <button
            key={t.key}
            role="radio"
            aria-checked={theme === t.key}
            className={`theme-option ${theme === t.key ? 'active' : ''}`}
            onClick={() => {
              setTheme(t.key);
              setThemeState(t.key);
              // Custom opens the colour picker straight away
              if (t.key === 'custom') colourInput.current?.click();
            }}
          >
            <span className="theme-swatch" style={{ background: t.key === 'custom' ? custom : t.swatch }} aria-hidden="true" />
            {t.name}
          </button>
        ))}
        <input
          ref={colourInput}
          type="color"
          className="theme-colour-input"
          value={custom}
          aria-label="Custom theme colour"
          tabIndex={-1}
          onChange={(e) => {
            setCustom(e.target.value);
            setTheme('custom', e.target.value);
            setThemeState('custom');
          }}
        />
      </div>
      {theme === 'custom' && (
        <div className="theme-custom-row">
          <button className="theme-custom-swatch" style={{ background: custom }} onClick={() => colourInput.current?.click()} aria-label="Change the custom colour" />
          <span className="muted">
            Custom colour <span className="num">{custom.toUpperCase()}</span>: the background, panels and text take its shade, and buttons and highlights use it.
          </span>
        </div>
      )}
      <div className="field">
        <span>Font</span>
        <div className="font-picker" role="radiogroup" aria-label="Font">
          {FONTS.map((f) => (
            <button
              key={f.key}
              role="radio"
              aria-checked={font === f.key}
              className={`font-option ${font === f.key ? 'active' : ''}`}
              style={{ fontFamily: f.stack }}
              onClick={() => {
                setFont(f.key);
                setFontState(f.key);
              }}
            >
              <span className="font-sample" aria-hidden="true">
                Aa
              </span>
              {f.name}
            </button>
          ))}
        </div>
      </div>
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
