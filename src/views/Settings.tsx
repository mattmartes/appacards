// Collection-wide preferences (Anki's Preferences → Review), plus backups.
// Limits, steps and FSRS settings live in each deck's options.

import { useState } from 'react';
import { useCollection, type Backup } from '../lib/collection';
import { AdvancedPrefs } from './AdvancedPrefs';
import { AiPrefs } from './AiPrefs';
import { ControllerPrefs } from './ControllerPrefs';
import { Appearance } from './Appearance';
import { LocalSaving } from './LocalSaving';

const SECTIONS = [
  ['general', 'General'],
  ['appearance', 'Appearance'],
  ['saving', 'Saving'],
  ['controller', 'Controller'],
  ['ai', 'AI'],
  ['advanced', 'Advanced'],
  ['backup', 'Backup file'],
] as const;

export function SettingsView() {
  const col = useCollection();
  const p = col.prefs;
  const [learnAhead, setLearnAhead] = useState(String(p.learnAheadMins));
  const [rollover, setRollover] = useState(String(p.rolloverHour));
  const [ignoreReviewLimit, setIgnoreReviewLimit] = useState(p.newCardsIgnoreReviewLimit);
  const [fuzz, setFuzz] = useState(p.fuzz);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const save = async () => {
    const hour = Number(rollover);
    if (!(hour >= 0 && hour <= 23)) return setMsg({ text: '"Next day starts at" must be an hour from 0 to 23.', error: true });
    await col.setPrefs({
      ...col.prefs,
      learnAheadMins: Math.max(0, Number(learnAhead) || 0),
      rolloverHour: Math.round(hour),
      newCardsIgnoreReviewLimit: ignoreReviewLimit,
      fuzz,
    });
    setMsg({ text: 'Saved.' });
  };

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify(col.exportBackup())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `appa-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importBackup = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as Backup;
      if (!confirm('Replace ALL current decks, cards, presets and history with this backup?')) return;
      await col.importBackup(data);
      setMsg({ text: `Restored ${data.cards.length} cards.` });
    } catch (e) {
      setMsg({ text: `Import failed: ${(e as Error).message}`, error: true });
    }
  };

  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Preferences sections">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} onClick={(e) => {
            e.preventDefault();
            document.getElementById(id)?.scrollIntoView({ block: 'start' });
          }}>
            {label}
          </a>
        ))}
      </nav>
      <div className="settings-sections">
      <header className="page-head">
        <h1>Preferences</h1>
        <p className="muted">
          These apply to the whole collection. Daily limits, learning steps and FSRS settings are per deck: open a deck's
          Options from the Decks screen.
        </p>
      </header>
      <section id="general" className="panel settings-section">
        <h2>General</h2>
        <div className="grid-2">
          <label className="field">
            Next day starts at
            <span className="hint">Hours past midnight</span>
            <input type="number" min={0} max={23} value={rollover} onChange={(e) => setRollover(e.target.value)} />
          </label>
          <label className="field">
            Learn ahead limit
            <span className="hint">Minutes; learning cards due this soon are shown when nothing else is left</span>
            <input type="number" min={0} value={learnAhead} onChange={(e) => setLearnAhead(e.target.value)} />
          </label>
        </div>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={ignoreReviewLimit} onChange={(e) => setIgnoreReviewLimit(e.target.checked)} />
          New cards ignore review limit
        </label>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={fuzz} onChange={(e) => setFuzz(e.target.checked)} />
          Fuzz intervals (Anki always does; turn off only for testing)
        </label>
        <div className="row">
          <button className="primary" onClick={save}>
            Save
          </button>
          {msg && <span style={{ color: msg.error ? 'var(--again)' : 'var(--text-2)' }}>{msg.text}</span>}
        </div>
      </section>

      <div id="appearance"><Appearance /></div>
      <div id="saving"><LocalSaving /></div>
      <div id="controller"><ControllerPrefs /></div>
      <div id="ai"><AiPrefs /></div>
      <div id="advanced"><AdvancedPrefs /></div>

      <section id="backup" className="panel settings-section">
        <h2>Backup file</h2>
        <p className="muted" style={{ margin: 0 }}>
          A single .json file with your notes, cards, presets, preferences and history (not media files).
        </p>
        <div className="row">
          <button onClick={exportBackup}>Export backup (.json)</button>
          <label>
            <button onClick={(e) => (e.currentTarget.nextElementSibling as HTMLInputElement).click()}>Restore backup…</button>
            <input
              type="file"
              accept=".json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) importBackup(f);
              }}
            />
          </label>
        </div>
      </section>
      </div>
    </div>
  );
}
