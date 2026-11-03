import { useState, useSyncExternalStore } from 'react';
import {
  chooseFolder,
  forgetFolder,
  getStatus,
  isDesktop,
  openFolder,
  reconnectFolder,
  restoreFromFolder,
  saveNow,
  subscribeStatus,
} from '../lib/localSave';

function ago(ms: number) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} minute${m === 1 ? '' : 's'} ago` : new Date(ms).toLocaleString();
}

/** Where progress and settings are saved, and the auto-save folder. */
export function LocalSaving() {
  const st = useSyncExternalStore(subscribeStatus, getStatus);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const run = async (fn: () => Promise<string | void>) => {
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ text });
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return; // picker cancelled
      setMsg({ text: (e as Error).message, error: true });
    }
  };

  const pick = () =>
    run(async () => {
      const result = await chooseFolder();
      if (result === 'cancelled') return;
      if (result === 'found-backup') {
        if (confirm('This folder already has a saved collection. Load it, replacing what is in this browser?\n\nChoose Cancel to overwrite the folder with this browser\'s collection instead.')) {
          const n = await restoreFromFolder();
          return `Loaded ${n} cards from the folder. Changes will now save there automatically.`;
        }
        await saveNow();
      }
      return 'Saved. Changes will now save to this folder automatically.';
    });

  const restore = () =>
    run(async () => {
      if (!confirm('Replace everything in the app with the copy saved in the folder?')) return;
      return `Loaded ${await restoreFromFolder()} cards from the folder.`;
    });

  const lastSavedText = st.saving ? 'Saving…' : st.lastSaved ? `last saved ${ago(st.lastSaved)}` : 'not saved yet';

  if (isDesktop) {
    return (
      <div className="panel" style={{ display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Saving</h2>
        <p style={{ margin: 0 }}>
          Everything saves automatically to a folder on this computer a couple of seconds after each change: cards,
          review history, deck options, preferences, media and the background image.
        </p>
        <div style={{ display: 'grid', gap: 4 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            Save folder
          </span>
          <code style={{ overflowWrap: 'anywhere' }}>{st.folderName}</code>
          <span className="muted" style={{ fontSize: 13 }}>
            {lastSavedText}
          </span>
        </div>
        <div className="row">
          <button onClick={() => run(async () => (await saveNow(), 'Saved.'))}>Save now</button>
          <button onClick={() => void openFolder()}>Open folder</button>
          <button onClick={pick}>Change folder…</button>
          <button onClick={restore}>Load from folder</button>
        </div>
        {st.error && <span style={{ color: 'var(--again)' }}>Last save failed: {st.error}</span>}
        {msg && <span style={{ color: msg.error ? 'var(--again)' : 'var(--text-2)' }}>{msg.text}</span>}
      </div>
    );
  }

  return (
    <div className="panel" style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>Saving</h2>
      <p style={{ margin: 0 }}>
        Your progress, cards and settings save automatically in this browser as you go.
        {st.persistent === true && ' The browser has marked this storage as persistent, so it won’t be cleared to free up space.'}
        {st.persistent === false &&
          ' The browser hasn’t granted persistent storage, so it could clear this data if the disk fills up — saving to a folder below protects against that.'}
      </p>

      <h3 className="subhead">Save to a folder on this computer</h3>
      {st.folderState === 'unsupported' ? (
        <p className="muted" style={{ margin: 0 }}>
          This browser can't write to folders. Open the app in Chrome or Edge to use this, or use Export backup below.
        </p>
      ) : (
        <>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Keeps a copy of everything (cards, history, presets, preferences, media and background) in a folder you
            choose, updated automatically a couple of seconds after each change. It survives clearing browser data, and
            you can load it in another browser.
          </p>
          {st.folderState === 'none' && (
            <div className="row">
              <button className="primary" onClick={pick}>
                Choose folder…
              </button>
            </div>
          )}
          {st.folderState === 'needs-permission' && (
            <div className="row">
              <span>
                Saving to <strong>{st.folderName}</strong> is paused until you allow access again.
              </span>
              <button className="primary" onClick={() => run(async () => (await reconnectFolder(), 'Reconnected and saved.'))}>
                Allow access
              </button>
              <button onClick={() => run(async () => void (await forgetFolder()))}>Stop saving to folder</button>
            </div>
          )}
          {st.folderState === 'ready' && (
            <div style={{ display: 'grid', gap: 8 }}>
              <div className="row">
                <span>
                  Saving to <strong>{st.folderName}</strong>
                  {' · '}
                  <span className="muted">{lastSavedText}</span>
                </span>
              </div>
              <div className="row">
                <button onClick={() => run(async () => (await saveNow(), 'Saved.'))}>Save now</button>
                <button onClick={restore}>Load from folder</button>
                <button onClick={pick}>Change folder…</button>
                <button onClick={() => run(async () => void (await forgetFolder()))}>Stop saving to folder</button>
              </div>
            </div>
          )}
        </>
      )}
      {st.error && <span style={{ color: 'var(--again)' }}>Last save failed: {st.error}</span>}
      {msg && <span style={{ color: msg.error ? 'var(--again)' : 'var(--text-2)' }}>{msg.text}</span>}
    </div>
  );
}
