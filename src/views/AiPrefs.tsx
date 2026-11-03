// Preferences → AI: the OpenRouter key and model used by AI Polish.

import { useEffect, useState } from 'react';
import { defaultModel, fetchModels, FALLBACK_MODEL, modelPrice, savedKey, savedModel, saveKey, saveModel, topModels, type ModelInfo } from '../lib/polish';

const OTHER = '__other__';

/** OpenRouter's model list, the top models from it, and the model to use
 * (the saved one, else the default). */
export function useModels() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetchModels().then(setModels, () => setFailed(true));
  }, []);
  const fallback = models.length ? defaultModel(models) : FALLBACK_MODEL;
  return { models, top: topModels(models), failed, initial: savedModel() || fallback };
}

/** A list of the top models, plus "Other…" for typing any OpenRouter model id. */
export function ModelPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { models, top: newest, failed } = useModels();
  // keep the chosen model (e.g. the default Gemini 3.5) in the list even if a newer one replaced it there
  const chosen = models.find((m) => m.id === value);
  const top = chosen && !newest.includes(chosen) ? [...newest, chosen] : newest;
  const listed = top.some((m) => m.id === value);
  const [other, setOther] = useState(false);
  const showOther = other || (models.length > 0 && !listed) || failed;
  const current = chosen;

  const groups = new Map<string, ModelInfo[]>();
  for (const m of top) {
    const org = m.id.split('/')[0];
    groups.set(org, [...(groups.get(org) ?? []), m]);
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {!failed && (
        <select
          aria-label="Model"
          value={showOther ? OTHER : value}
          onChange={(e) => {
            if (e.target.value === OTHER) setOther(true);
            else {
              setOther(false);
              onChange(e.target.value);
            }
          }}
        >
          {!models.length && <option value={value}>{value} (loading list…)</option>}
          {[...groups].map(([org, list]) => (
            <optgroup key={org} label={org}>
              {list.map((m) => (
                <option key={m.id} value={m.id}>
                  {`${m.name.replace(/^[^:]+:\s*/, '').trim()} · ${modelPrice(m)}`}
                </option>
              ))}
            </optgroup>
          ))}
          {models.length > 0 && <option value={OTHER}>Other model…</option>}
        </select>
      )}
      {showOther && (
        <>
          <input
            type="text"
            list="openrouter-models"
            value={value}
            onChange={(e) => onChange(e.target.value.trim())}
            placeholder="provider/model, e.g. anthropic/claude-sonnet-5.5"
            spellCheck={false}
            aria-label="OpenRouter model id"
          />
          <datalist id="openrouter-models">
            {models.map((m) => (
              <option key={m.id} value={m.id} />
            ))}
          </datalist>
        </>
      )}
      <span className="hint">
        {failed
          ? "Couldn't load OpenRouter's model list; type a model id."
          : current
            ? `${current.id} · ${modelPrice(current)}`
            : models.length && value
              ? 'Not a model OpenRouter lists right now.'
              : ''}
      </span>
    </div>
  );
}

/** A password box with Show/Hide. */
export function KeyField({ value, onChange }: { value: string; onChange: (k: string) => void }) {
  const [show, setShow] = useState(false);
  return (
    <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
        placeholder="sk-or-…"
        autoComplete="off"
        spellCheck={false}
        aria-label="OpenRouter API key"
        style={{ flex: 1 }}
      />
      <button type="button" onClick={() => setShow((s) => !s)}>
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

/** Preferences → AI. Changes save immediately. */
export function AiPrefs() {
  const { initial } = useModels();
  const [key, setKey] = useState(savedKey);
  const [model, setModel] = useState<string | null>(null);

  return (
    <div className="panel" style={{ display: 'grid', gap: 14 }}>
      <h2 style={{ margin: 0 }}>AI</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Used by Edit → AI Polish. Runs are billed to your OpenRouter account. The key is saved on this computer only: it isn't
        included in backups or your save folder.
      </p>
      <div className="grid-2">
        <label className="field">
          OpenRouter API key
          <span className="hint">Create one at openrouter.ai/keys</span>
          <KeyField
            value={key}
            onChange={(k) => {
              setKey(k);
              saveKey(k);
            }}
          />
        </label>
        <label className="field">
          Model
          <span className="hint">Newest models from the major labs, priced per million tokens</span>
          <ModelPicker
            value={model ?? initial}
            onChange={(m) => {
              setModel(m);
              saveModel(m);
            }}
          />
        </label>
      </div>
    </div>
  );
}
