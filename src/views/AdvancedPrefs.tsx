import { useState } from 'react';
import { BASE_CARD_FONT_PX, pickVariation, VARIATION_FONTS } from '../lib/cardVariation';
import { useCollection } from '../lib/collection';
import type { CardVariation, VariationFontSet } from '../lib/types';

const MIN_PCT = 50;
const MAX_PCT = 200;
const clampPct = (n: number) => Math.min(Math.max(Math.round(n) || MIN_PCT, MIN_PCT), MAX_PCT);

/** A % box you can type in freely: in-range values apply as you type, and
 * anything else is clamped when you leave the box. */
function PctField({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <label className="field">
      {label}
      <span className="hint">% of normal</span>
      <input
        type="number"
        min={MIN_PCT}
        max={MAX_PCT}
        step={5}
        value={text ?? value}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== '' && n >= MIN_PCT && n <= MAX_PCT) onCommit(Math.round(n));
        }}
        onBlur={() => {
          if (text !== null) onCommit(clampPct(Number(text)));
          setText(null);
        }}
      />
    </label>
  );
}

/** Preferences → Advanced. Changes apply and save immediately. */
export function AdvancedPrefs() {
  const col = useCollection();
  const v = col.prefs.cardVariation;
  const [sample, setSample] = useState(() => pickVariation(v));

  const set = (patch: Partial<CardVariation>) => {
    const next = { ...v, ...patch };
    col.previewPrefs({ cardVariation: next });
    setSample(pickVariation(next));
  };

  const fonts = VARIATION_FONTS[v.fontSet].fonts;
  const lo = Math.min(v.minSizePct, v.maxSizePct);
  const hi = Math.max(v.minSizePct, v.maxSizePct);

  return (
    <div className="panel" style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>Advanced</h2>
      <label className="row" style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <input type="checkbox" checked={v.enabled} onChange={(e) => set({ enabled: e.target.checked })} style={{ marginTop: 4 }} />
        <span>
          Card variation
          <span className="muted" style={{ display: 'block', fontSize: 13 }}>
            Each time a card is shown, its text gets one of three similar fonts and a random size, so you learn what the
            card says rather than what it looks like.
          </span>
        </span>
      </label>

      <fieldset className="variation-options" disabled={!v.enabled}>
        <legend className="visually-hidden">Card variation options</legend>
        <div className="grid-2">
          <label className="field">
            Font style
            <select value={v.fontSet} onChange={(e) => set({ fontSet: e.target.value as VariationFontSet })}>
              {(Object.keys(VARIATION_FONTS) as VariationFontSet[]).map((k) => (
                <option key={k} value={k}>
                  {VARIATION_FONTS[k].label}: {VARIATION_FONTS[k].fonts.map((f) => f.name).join(', ')}
                </option>
              ))}
            </select>
          </label>
          <div className="grid-2" style={{ gap: 8 }}>
            <PctField label="Smallest size" value={v.minSizePct} onCommit={(n) => set({ minSizePct: n })} />
            <PctField label="Largest size" value={v.maxSizePct} onCommit={(n) => set({ maxSizePct: n })} />
          </div>
        </div>

        <div className="variation-preview">
          <div className="variation-fonts" aria-label="The three fonts">
            {fonts.map((f) => (
              <span key={f.name} style={{ fontFamily: f.stack }}>
                {f.name}
              </span>
            ))}
          </div>
          <div className="panel card-face variation-sample" style={{ fontFamily: sample.fontFamily, fontSize: sample.fontSize }}>
            <div>What is the powerhouse of the cell?</div>
          </div>
          <div className="row">
            <button type="button" onClick={() => setSample(pickVariation(v))}>
              Shuffle sample
            </button>
            <span className="muted num" style={{ fontSize: 13 }}>
              {sample.fontName}, {sample.sizePct}% · sizes range {Math.round((BASE_CARD_FONT_PX * lo) / 100)}–
              {Math.round((BASE_CARD_FONT_PX * hi) / 100)}px
            </span>
          </div>
        </div>
      </fieldset>

      <label className="row" style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <input
          type="checkbox"
          checked={col.prefs.varyWording}
          onChange={(e) => void col.setPrefs({ ...col.prefs, varyWording: e.target.checked })}
          style={{ marginTop: 4 }}
        />
        <span>
          Vary question wording
          <span className="muted" style={{ display: 'block', fontSize: 13 }}>
            Cards with other wordings of their question show one at random each time. Edit → AI wordings writes them for
            regular cards; smart cards get them from their editor.
          </span>
        </span>
      </label>
    </div>
  );
}
