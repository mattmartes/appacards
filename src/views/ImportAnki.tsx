import { useRef, useState } from 'react';
import { importAnki, previewAnkiFile, type ImportPreview, type ImportSummary } from '../lib/importAnki';

/** `bare`: inside a window that has its own title and close button. */
export function ImportAnki({ onClose, bare = false }: { onClose: () => void; bare?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [useFsrs, setUseFsrs] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const choose = async (file: File) => {
    setError(null);
    setPreview(null);
    setSummary(null);
    setStatus(`Reading ${file.name}…`);
    try {
      setPreview(await previewAnkiFile(file));
    } catch (e) {
      setError(`Couldn't read that file: ${(e as Error).message}`);
    } finally {
      setStatus(null);
    }
  };

  const run = async () => {
    if (!preview) return;
    setError(null);
    try {
      setSummary(await importAnki(preview, { importPresets: useFsrs }, setStatus));
      setPreview(null);
    } catch (e) {
      setError(`Import failed: ${(e as Error).message}`);
    } finally {
      setStatus(null);
    }
  };

  const busy = status !== null;

  return (
    <div className={bare ? undefined : 'panel'} style={{ display: 'grid', gap: 12, marginBottom: bare ? 0 : 16 }}>
      {!bare && (
        <div className="row">
          <h2 style={{ margin: 0 }}>Import from Anki</h2>
          <span className="spacer" />
          <button className="link" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
      )}
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Choose an <code>.apkg</code> (File → Export → “Anki Deck Package”, with scheduling information included) or a
        <code> .colpkg</code> collection backup. Cards keep their schedule and review history.
      </p>
      <div className="row">
        <button className="primary" disabled={busy} onClick={() => input.current?.click()}>
          Choose file…
        </button>
        <input
          ref={input}
          type="file"
          accept=".apkg,.colpkg"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) choose(f);
          }}
        />
        {status && <span className="muted">{status}</span>}
      </div>

      {preview && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="num" style={{ fontSize: 14 }}>
            <strong>{preview.fileName}</strong>: {preview.cardCount} cards from {preview.noteCount} notes,{' '}
            {preview.revlogCount} review log entries, {preview.mediaCount} media files.
            {preview.duplicateCount > 0 && (
              <span className="muted"> {preview.duplicateCount} cards are already here and will be skipped.</span>
            )}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            Decks: {preview.deckNames.slice(0, 8).join(', ')}
            {preview.deckNames.length > 8 && ` and ${preview.deckNames.length - 8} more`}
          </div>
          {preview.presets.length > 0 && (
            <div style={{ display: 'grid', gap: 4 }}>
              <label className="row" style={{ gap: 8, fontSize: 14 }}>
                <input type="checkbox" checked={useFsrs} onChange={(e) => setUseFsrs(e.target.checked)} />
                Import deck option presets
              </label>
              <ul className="muted" style={{ margin: 0, fontSize: 13 }}>
                {preview.presets.map((p) => (
                  <li key={p.ankiId}>
                    “{p.config.name}” ({p.deckCount} deck{p.deckCount === 1 ? '' : 's'}, {p.config.newPerDay} new/
                    {p.config.reviewsPerDay} reviews a day,{' '}
                    {p.config.params.length ? `${p.config.params.length} FSRS parameters` : 'default FSRS parameters'}, retention{' '}
                    {p.config.desiredRetention.toFixed(2)}){p.exists && ' — a preset with this name exists and will be used instead'}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="row">
            <button className="primary" disabled={busy} onClick={run}>
              Import {preview.cardCount - preview.duplicateCount} cards
            </button>
          </div>
        </div>
      )}

      {summary && (
        <p className="num" style={{ margin: 0 }}>
          Imported {summary.cards} cards into {summary.decks} new deck(s) and {summary.presets} new preset(s), with{' '}
          {summary.reviews} review log entries and {summary.media} media files.
          {summary.skipped > 0 && ` Skipped ${summary.skipped} cards (already present or missing their note).`}
        </p>
      )}
      {error && <p style={{ margin: 0, color: 'var(--again)' }}>{error}</p>}
    </div>
  );
}
