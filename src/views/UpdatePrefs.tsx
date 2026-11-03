// Preferences → Updates: the version you're on, and updating when you choose
// to (desktop app). The web version is always the newest, so it has nothing here.

import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../lib/localSave';

/** The releases page, where new installers are. */
export const RELEASES_URL = __RELEASES_URL__;

export function updateText(s: UpdateStatus | null): string {
  switch (s?.state) {
    case 'checking':
      return 'Checking for updates…';
    case 'up-to-date':
      return "You're on the newest version.";
    case 'available':
      return `Appa ${s.version} is available.${s.notes ? ` ${s.notes}` : ''}`;
    case 'downloading':
      return `Downloading Appa ${s.version}…`;
    case 'ready':
      return `Appa ${s.version} is downloaded. Restart Appa to use it.`;
    case 'needs-installer':
      return `Appa ${s.version} is out, but it needs the new installer: download it from the releases page.`;
    case 'failed':
      return `Couldn't check for updates: ${s.message ?? 'no connection'}.`;
    case 'off':
      return "This copy of Appa doesn't check for updates.";
    default:
      return '';
  }
}

export function UpdatePrefs() {
  const updates = window.desktop?.updates;
  const [versions, setVersions] = useState<{ app: string; installer: string } | null>(null);
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    if (!updates) return;
    void updates.version().then(setVersions);
    void updates.status?.().then(setStatus);
    return updates.onStatus(setStatus);
  }, [updates]);

  if (!updates) return null;
  const chooses = !!updates.install;
  return (
    <section className="panel settings-section">
      <h2>Updates</h2>
      <p style={{ margin: 0 }}>
        You're on Appa <strong>{versions?.app ?? __APP_VERSION__}</strong>
        {versions && versions.installer !== versions.app && <span className="muted"> (installed as {versions.installer})</span>}.
      </p>
      {chooses ? (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Appa looks for new versions when it starts and every few hours, and tells you in the corner. Nothing downloads
          until you choose to update; your data is backed up before a new version first runs.
        </p>
      ) : (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          This installer downloads updates by itself. Install the newest one from the releases page to choose when to
          update instead.
        </p>
      )}
      {status && status.state !== 'idle' && <p style={{ margin: 0 }}>{updateText(status)}</p>}
      <div className="row">
        {chooses && status?.state !== 'available' && status?.state !== 'ready' && (
          <button disabled={status?.state === 'checking' || status?.state === 'downloading'} onClick={() => void updates.check?.().then(setStatus)}>
            Check for updates
          </button>
        )}
        {status?.state === 'available' && chooses && (
          <button className="primary" onClick={() => void updates.install?.().then(setStatus)}>
            Update to {status.version}
          </button>
        )}
        {status?.state === 'ready' && (
          <button className="primary" onClick={() => void updates.restart()}>
            Restart to update
          </button>
        )}
        <a className="button-like" href={RELEASES_URL} target="_blank" rel="noreferrer">
          Releases page
        </a>
      </div>
    </section>
  );
}
