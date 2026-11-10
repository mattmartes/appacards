import { useEffect, useRef, useState } from 'react';
import { col, useCollection } from './lib/collection';
import { groundLuminance, haloStrength, nextTone } from './lib/groundTone';
import { THEME_EVENT } from './lib/theme';
import { initLocalSave, type UpdateStatus } from './lib/localSave';
import { RELEASES_URL, updateText } from './views/UpdatePrefs';
import type { Id, LessonSource } from './lib/types';

/** What a new lesson starts with when it comes from a deck's Notes. */
export interface LessonStart {
  title: string;
  deckId: Id;
  sources: LessonSource[];
}
import { Home } from './views/Home';
import { Reviewer } from './views/Reviewer';
import { Cram } from './views/Cram';
import { AddCards } from './views/AddCards';
import { Browse } from './views/Browse';
import { SettingsView } from './views/Settings';
import { Stats } from './views/Stats';
import { DeckOptions } from './views/DeckOptions';
import { Learn } from './views/Learn';
import { Quiz } from './views/Quiz';
import { Sidebar } from './views/Sidebar';
import { DeckNotes } from './views/DeckNotes';
import { ClassHome } from './views/ClassHome';
import { GridLab } from './views/GridLab';
import { GridNotePage } from './views/GridNotePage';

export type View =
  /** Home: today's stats; decks are in the sidebar */
  | { name: 'decks' }
  | { name: 'review'; deckId: Id }
  /** practice every card in a deck, without changing its schedule */
  | { name: 'cram'; deckId: Id }
  /** a class's homepage: its decks and notes */
  | { name: 'class'; deckId: Id }
  /** a deck's uploaded files */
  | { name: 'notes'; deckId: Id }
  | { name: 'add'; deckId?: Id }
  | { name: 'browse'; query?: string }
  /** start: a new lesson filled in from a deck's Notes */
  | { name: 'learn'; start?: LessonStart }
  /** setId: open that quiz set, ready to start */
  | { name: 'quiz'; setId?: Id }
  | { name: 'stats' }
  /** experiments: grid notes */
  | { name: 'lab' }
  /** a note written in a deck's Notes, open in the grid editor */
  | { name: 'note'; fileId: string }
  | { name: 'options'; deckId: Id }
  | { name: 'settings' };

const LAB_SIDEBAR = 'appa-lab-sidebar-hidden';

function readLabSidebar(): boolean {
  try {
    return localStorage.getItem(LAB_SIDEBAR) === '1';
  } catch {
    return false;
  }
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ name: 'decks' });
  const mainRef = useRef<HTMLElement>(null);
  /** in the Lab, the sidebar can fold away so the notes get the room */
  const [labSidebarHidden, setLabSidebarHidden] = useState(readLabSidebar);
  const toggleLabSidebar = () => {
    const next = !labSidebarHidden;
    setLabSidebarHidden(next);
    try {
      localStorage.setItem(LAB_SIDEBAR, next ? '1' : '0');
    } catch {
      // shown again next time
    }
  };
  useCollection();

  useEffect(() => {
    col.open().then(
      () => {
        setReady(true);
        void initLocalSave();
        // the desktop app: this version started properly
        void window.desktop?.updates?.ready();
      },
      (e) => setError(`${(e as Error)?.name ?? ''}: ${(e as Error)?.message ?? String(e)}`),
    );
  }, []);

  // the desktop app tells us about new versions. A new one shows in the
  // corner for a few seconds; once you choose to update, it stays until the
  // restart. Older installers download by themselves and just say "ready".
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [updating, setUpdating] = useState(false);
  const updatingRef = useRef(false);
  updatingRef.current = updating;
  useEffect(
    () =>
      window.desktop?.updates?.onStatus((s) => {
        if (s.state === 'available' || s.state === 'needs-installer' || s.state === 'ready') setUpdate(s);
        else if (updatingRef.current && (s.state === 'downloading' || s.state === 'failed')) setUpdate(s);
      }),
    [],
  );
  useEffect(() => {
    if (!update || updating || update.state === 'ready') return;
    const t = setTimeout(() => setUpdate(null), 10_000);
    return () => clearTimeout(t);
  }, [update, updating]);

  // Text on a custom background takes dark or light ink to match it.
  const bgUrl = ready ? col.backgroundUrl : null;
  const bgOpacity = col.prefs.backgroundOpacity;
  useEffect(() => {
    const root = document.documentElement;
    if (!bgUrl) {
      delete root.dataset.ground;
      root.style.removeProperty('--halo-strength');
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      const ground = getComputedStyle(document.body).backgroundColor;
      const left = mainRef.current?.getBoundingClientRect().left ?? 0;
      groundLuminance(bgUrl, bgOpacity, ground, left).then(
        (seen) => {
          if (!live) return;
          root.dataset.ground = nextTone(seen, root.dataset.ground as 'light' | 'dark' | undefined);
          root.style.setProperty('--halo-strength', haloStrength(seen).toFixed(3));
        },
        () => live && delete root.dataset.ground,
      );
    };
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(measure, 150);
    };
    measure();
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', later);
    window.addEventListener(THEME_EVENT, later);
    window.addEventListener('resize', later);
    return () => {
      live = false;
      clearTimeout(timer);
      scheme.removeEventListener('change', later);
      window.removeEventListener(THEME_EVENT, later);
      window.removeEventListener('resize', later);
    };
  }, [bgUrl, bgOpacity]);

  // each screen starts at its top
  const go = (v: View) => {
    setView(v);
    mainRef.current?.scrollTo({ top: 0 });
    // in a narrow window the whole column (the shell) is what scrolls
    mainRef.current?.parentElement?.scrollTo({ top: 0 });
  };

  if (error)
    return (
      <main className="panel">
        {/VersionError|requested version .* less than/i.test(error) ? (
          <>
            <h2 style={{ marginTop: 0 }}>Your collection was saved by a newer version of Appa</h2>
            <p>
              This version ({__APP_VERSION__}) is older and can't open it, so it hasn't touched it: nothing is changed or
              lost. Restart Appa so it can update, or install the newest version from the website.
            </p>
          </>
        ) : (
          <>Could not open the database: {error}</>
        )}
      </main>
    );
  if (!ready) return <main className="muted">Loading…</main>;

  return (
    <>
      {col.backgroundUrl && (
        <div
          className="app-bg"
          aria-hidden="true"
          style={{ backgroundImage: `url("${col.backgroundUrl}")`, opacity: col.prefs.backgroundOpacity }}
        />
      )}
      <span className="app-version" title="Appa's version">
        v{__APP_VERSION__}
      </span>
      {update && (
        <div className="update-toast" role="status">
          <span>{updateText(update)}</span>
          {update.state === 'available' && window.desktop?.updates?.install && (
            <button
              className="primary"
              onClick={() => {
                setUpdating(true);
                void window.desktop?.updates?.install?.().then(setUpdate);
              }}
            >
              Update
            </button>
          )}
          {update.state === 'ready' && (
            <button className="primary" onClick={() => void window.desktop?.updates?.restart()}>
              Restart
            </button>
          )}
          {update.state === 'needs-installer' && (
            <a className="button-like" href={RELEASES_URL} target="_blank" rel="noreferrer">
              Download
            </a>
          )}
          {update.state !== 'downloading' && (
            <button
              className="link"
              onClick={() => {
                setUpdate(null);
                setUpdating(false);
              }}
            >
              Later
            </button>
          )}
        </div>
      )}
      <div className={`app-shell ${(view.name === 'lab' || view.name === 'note') && labSidebarHidden ? 'sidebar-hidden' : ''}`}>
        <Sidebar view={view} go={go} />
        {(view.name === 'lab' || view.name === 'note') && (
            <button
              className="sidebar-toggle"
              onClick={toggleLabSidebar}
              aria-label={labSidebarHidden ? 'Show the sidebar' : 'Hide the sidebar'}
              title={labSidebarHidden ? 'Show the sidebar' : 'Hide the sidebar for more room'}
              aria-expanded={!labSidebarHidden}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M9 4v16" />
                <path d={labSidebarHidden ? 'M13 10l2 2-2 2' : 'M15 10l-2 2 2 2'} />
              </svg>
            </button>
        )}
        <main className="app-main" ref={mainRef}>
          <div className="app-content">
            {view.name === 'decks' && <Home go={go} />}
            {view.name === 'review' && <Reviewer key={view.deckId} deckId={view.deckId} go={go} />}
            {view.name === 'cram' && <Cram key={view.deckId} deckId={view.deckId} go={go} />}
            {view.name === 'class' && <ClassHome key={view.deckId} deckId={view.deckId} go={go} />}
            {view.name === 'notes' &&<DeckNotes key={view.deckId} deckId={view.deckId} go={go} />}
            {view.name === 'add' && <AddCards key={view.deckId} initialDeckId={view.deckId} />}
            {view.name === 'browse' && <Browse initialQuery={view.query} />}
            {view.name === 'learn' && <Learn key={view.start ? 'start' : 'learn'} start={view.start} />}
            {view.name === 'quiz' && <Quiz key={view.setId ?? 'quiz'} setId={view.setId} />}
            {view.name === 'stats' && <Stats />}
            {view.name === 'lab' && <GridLab />}
            {view.name === 'note' && <GridNotePage key={view.fileId} fileId={view.fileId} go={go} />}
            {view.name === 'options' && <DeckOptions key={view.deckId} deckId={view.deckId} go={go} />}
            {view.name === 'settings' && <SettingsView />}
          </div>
        </main>
      </div>
    </>
  );
}
