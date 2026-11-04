// A web browser beside Grid notes, in the desktop app: Claude or anything
// else open while you write. It's an Electron <webview> in its own sandboxed
// session (see setUpBrowserPanel in electron/main.cjs), so sign-ins stay
// there and the sites can't reach the app. Browsers can't show sites like
// claude.ai inside a page, so this is desktop only.

import { useEffect, useRef, useState, type ReactNode } from 'react';

const HOME = 'https://claude.ai/new';
const URL_STORE = 'appa-notes-browser-url';
const PARTITION = 'persist:notes-browser';

/** The parts of Electron's <webview> element used here. */
interface WebviewElement extends HTMLElement {
  src: string;
  loadURL(url: string): Promise<void>;
  getURL(): string;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
}

/** True when this desktop app can show the browser (installers from 1.1.16). */
export const canShowBrowser = () => !!window.desktop?.browserPanel;

function lastUrl(): string {
  try {
    const u = localStorage.getItem(URL_STORE);
    if (u && /^https?:\/\//i.test(u)) return u;
  } catch {
    // storage blocked
  }
  return HOME;
}

/** What's typed in the address bar to a page: an address, or a search. */
function toUrl(typed: string): string {
  const t = typed.trim();
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[^\s]+\.[a-z]{2,}(\/\S*)?$/i.test(t)) return `https://${t}`;
  return `https://www.google.com/search?q=${encodeURIComponent(t)}`;
}

const svg = (d: string) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

export function NotesBrowser({ extra, onClose }: { extra?: ReactNode; onClose: () => void }) {
  const view = useRef<WebviewElement>(null);
  // the page it starts on; after that the webview goes where it's taken
  const [start] = useState(lastUrl);
  const [url, setUrl] = useState(start);
  const [typed, setTyped] = useState(start);
  const [editingUrl, setEditingUrl] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nav, setNav] = useState({ back: false, forward: false });
  // the webview's listeners read whether the address is being typed in
  const editingRef = useRef(false);
  useEffect(() => {
    editingRef.current = editingUrl;
  }, [editingUrl]);

  useEffect(() => {
    const w = view.current;
    if (!w) return;
    const moved = () => {
      const now = w.getURL();
      setUrl(now);
      if (!editingRef.current) setTyped(now);
      setNav({ back: w.canGoBack(), forward: w.canGoForward() });
      try {
        localStorage.setItem(URL_STORE, now);
      } catch {
        // back to the start page next time
      }
    };
    const startLoad = () => setLoading(true);
    const stopLoad = () => {
      setLoading(false);
      moved();
    };
    w.addEventListener('did-navigate', moved);
    w.addEventListener('did-navigate-in-page', moved);
    w.addEventListener('did-start-loading', startLoad);
    w.addEventListener('did-stop-loading', stopLoad);
    return () => {
      w.removeEventListener('did-navigate', moved);
      w.removeEventListener('did-navigate-in-page', moved);
      w.removeEventListener('did-start-loading', startLoad);
      w.removeEventListener('did-stop-loading', stopLoad);
    };
  }, []);

  const go = (to: string) => {
    const next = toUrl(to);
    setTyped(next);
    void view.current?.loadURL(next).catch(() => undefined);
  };

  return (
    <div className="notes-browser">
      <div className="notes-browser-bar">
        <button className="icon-button" onClick={() => view.current?.goBack()} disabled={!nav.back} aria-label="Back" title="Back">
          {svg('M15 18l-6-6 6-6')}
        </button>
        <button className="icon-button" onClick={() => view.current?.goForward()} disabled={!nav.forward} aria-label="Forward" title="Forward">
          {svg('M9 18l6-6-6-6')}
        </button>
        <button
          className="icon-button"
          onClick={() => (loading ? view.current?.stop() : view.current?.reload())}
          aria-label={loading ? 'Stop' : 'Reload'}
          title={loading ? 'Stop' : 'Reload'}
        >
          {loading ? svg('M18 6L6 18M6 6l12 12') : svg('M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5')}
        </button>
        <form
          className="notes-browser-address"
          onSubmit={(e) => {
            e.preventDefault();
            go(typed);
            (document.activeElement as HTMLElement | null)?.blur();
          }}
        >
          <input
            type="text"
            value={typed}
            aria-label="Address"
            spellCheck={false}
            onChange={(e) => setTyped(e.target.value)}
            onFocus={(e) => {
              setEditingUrl(true);
              e.currentTarget.select();
            }}
            onBlur={() => {
              setEditingUrl(false);
              setTyped(url);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setTyped(url);
                e.currentTarget.blur();
              }
            }}
          />
        </form>
        <button className="icon-button" onClick={() => go(HOME)} aria-label="Claude" title="Go to Claude">
          {svg('M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z')}
        </button>
        <button className="icon-button" onClick={() => window.open(url, '_blank')} aria-label="Open in your browser" title="Open this page in your own browser">
          {svg('M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5')}
        </button>
        {extra}
        <button className="icon-button" onClick={onClose} aria-label="Close the browser" title="Close the browser">
          {svg('M18 6 6 18M6 6l12 12')}
        </button>
      </div>
      <webview
        ref={view as unknown as React.Ref<HTMLWebViewElement>}
        className="notes-browser-view"
        src={start}
        partition={PARTITION}
        // Electron wants the attribute itself, which React only writes for a string
        {...({ allowpopups: 'true' } as unknown as { allowpopups: boolean })}
      />
    </div>
  );
}
