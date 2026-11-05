import { useRef, useState } from 'react';
import { useCollection } from '../lib/collection';
import {
  ACCENTS,
  FONTS,
  PANEL_COLOURS,
  readAccent,
  readPanelColour,
  readPanelOpacity,
  readCustomColour,
  readFont,
  readTextWeight,
  readTheme,
  setAccent,
  setFont,
  setPanelColour,
  setPanelOpacity,
  setTextWeight,
  setTheme,
  TEXT_WEIGHTS,
  THEMES,
  type Theme,
} from '../lib/theme';

/** A colour of your own over the theme's: the theme's own, a few presets, or any colour. */
function ColourChoice({ label, hint, value, presets, onChange }: { label: string; hint: string; value: string | null; presets: { name: string; value: string }[]; onChange: (hex: string | null) => void }) {
  const picker = useRef<HTMLInputElement>(null);
  const isPreset = !!value && presets.some((p) => p.value.toLowerCase() === value.toLowerCase());
  return (
    <div className="field colour-field">
      <span>{label}</span>
      <span className="hint">{hint}</span>
      <div className="colour-choice" role="radiogroup" aria-label={label}>
        <button role="radio" aria-checked={!value} className={`colour-own ${!value ? 'active' : ''}`} onClick={() => onChange(null)}>
          Theme's own
        </button>
        {presets.map((p) => (
          <button
            key={p.value}
            role="radio"
            aria-checked={value?.toLowerCase() === p.value.toLowerCase()}
            aria-label={p.name}
            title={p.name}
            className={`colour-dot ${value?.toLowerCase() === p.value.toLowerCase() ? 'active' : ''}`}
            style={{ background: p.value }}
            onClick={() => onChange(p.value)}
          />
        ))}
        <button
          role="radio"
          aria-checked={!!value && !isPreset}
          aria-label="Another colour"
          title="Another colour"
          className={`colour-dot colour-any ${value && !isPreset ? 'active' : ''}`}
          style={value && !isPreset ? { background: value } : undefined}
          onClick={() => picker.current?.click()}
        >
          {!(value && !isPreset) && '+'}
        </button>
        <input ref={picker} type="color" className="theme-colour-input" tabIndex={-1} value={value ?? '#2f6fd1'} aria-label={`${label}: another colour`} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

/** The colour theme, accent and panel colours, panel opacity, the app's font
 * and its thickness, and a background image for the app with an opacity slider. */
export function Appearance() {
  const col = useCollection();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [custom, setCustom] = useState(readCustomColour);
  const colourInput = useRef<HTMLInputElement>(null);
  const [font, setFontState] = useState(readFont);
  const [accent, setAccentState] = useState(readAccent);
  const [panel, setPanelState] = useState(readPanelColour);
  const [panelOpacity, setPanelOpacityState] = useState(readPanelOpacity);
  const opacityPct = Math.round(panelOpacity * 100);
  const [weight, setWeightState] = useState(readTextWeight);
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
              // a preset comes with its own accent and panels: your own ones are cleared
              if (t.key !== 'custom') {
                setAccent(null);
                setAccentState(null);
                setPanelColour(null);
                setPanelState(null);
              }
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
      <ColourChoice
        label="Accent colour"
        hint="Buttons, toggles, selections, focus and the calendar's chosen days"
        value={accent}
        presets={ACCENTS}
        onChange={(hex) => {
          setAccent(hex);
          setAccentState(hex);
        }}
      />
      <ColourChoice
        label="Panel colour"
        hint="Panels, cards, dialogs, the calendar and the selected item in the sidebar"
        value={panel}
        presets={PANEL_COLOURS}
        onChange={(hex) => {
          setPanelColour(hex);
          setPanelState(hex);
        }}
      />
      <label className="field">
        <span className="row" style={{ justifyContent: 'space-between' }}>
          Panel opacity <span className="num">{opacityPct}%</span>
        </span>
        <span className="hint">Lower lets the background (or a background image) show through panels and cards</span>
        <input
          type="range"
          min={20}
          max={100}
          step={5}
          value={opacityPct}
          aria-valuetext={`${opacityPct}%`}
          onChange={(e) => {
            const v = Number(e.target.value) / 100;
            setPanelOpacity(v);
            setPanelOpacityState(v);
          }}
        />
      </label>
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
      <div className="field">
        <span>Text thickness</span>
        <div className="weight-picker" role="radiogroup" aria-label="Text thickness">
          {TEXT_WEIGHTS.map((w) => (
            <button
              key={w.value}
              role="radio"
              aria-checked={weight === w.value}
              className={`weight-option ${weight === w.value ? 'active' : ''}`}
              style={{ fontWeight: w.value }}
              onClick={() => {
                setTextWeight(w.value);
                setWeightState(w.value);
              }}
            >
              {w.name}
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
