// The PDFs beside Grid notes: a tab for each, and the showing one's pages,
// one under another, to read while writing. Pinch on a trackpad (or Ctrl and
// the scroll wheel) or the buttons zoom; pages are drawn again sharper as
// they grow.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LabPdf } from '../lib/labPdf';
import { renderPdfPages } from '../lib/pdfRender';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
/** button steps */
const STEP = 1.25;
/** widths pages are drawn at, in CSS pixels; the smallest that's at least as
 * wide as the pages show is used */
const SHARPNESS = [800, 1400, 2200];

const tabName = (name: string) => name.replace(/\.pdf$/i, '');

export function GridPdf({
  pdfs,
  active,
  onSelect,
  onAdd,
  onClose,
}: {
  pdfs: LabPdf[];
  active: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onClose: (id: string) => void;
}) {
  const pdf = pdfs.find((p) => p.id === active) ?? pdfs[0];
  const [zoom, setZoom] = useState(1);
  const [paneWidth, setPaneWidth] = useState(400);
  const [pages, setPages] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** the point to keep under the pointer while zooming: in unzoomed page pixels, and where it is in the pane */
  const anchor = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  /** pages already drawn, by PDF and sharpness */
  const drawn = useRef(new Map<string, string[]>());

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPaneWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown = Math.max(1, paneWidth - 24) * zoom;
  const sharpness = SHARPNESS.find((w) => w >= shown) ?? SHARPNESS[SHARPNESS.length - 1];

  // a new tab starts at its top, with no pages from the last one
  useEffect(() => {
    setPages([]);
    setTotal(0);
    scrollRef.current?.scrollTo({ top: 0, left: 0 });
  }, [pdf?.id]);

  useEffect(() => {
    if (!pdf) return;
    const key = `${pdf.id}@${sharpness}`;
    const done = drawn.current.get(key);
    if (done) {
      setPages(done);
      setTotal(done.length);
      return;
    }
    const ctrl = new AbortController();
    setFailed(false);
    // keep the blurrier pages showing until the sharper ones replace them
    const sharper: string[] = [];
    renderPdfPages(
      pdf.blob,
      sharpness,
      (i, url, count) => {
        setTotal(count);
        sharper[i] = url;
        setPages((list) => {
          const next = [...list];
          next[i] = url;
          return next;
        });
      },
      { signal: ctrl.signal },
    ).then(
      () => !ctrl.signal.aborted && drawn.current.set(key, sharper),
      () => !ctrl.signal.aborted && setFailed(true),
    );
    return () => ctrl.abort();
  }, [pdf, sharpness]);

  /** Zooms to `next`, keeping the point at (px, py) in the pane where it is. */
  const zoomTo = (next: number, px?: number, py?: number) => {
    const el = scrollRef.current;
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    if (el) {
      const x = px ?? el.clientWidth / 2;
      const y = py ?? el.clientHeight / 2;
      anchor.current = { x: (el.scrollLeft + x) / zoom, y: (el.scrollTop + y) / zoom, px: x, py: y };
    }
    setZoom(z);
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = anchor.current;
    if (!el || !a) return;
    el.scrollLeft = a.x * zoom - a.px;
    el.scrollTop = a.y * zoom - a.py;
    anchor.current = null;
  }, [zoom]);

  // a pinch on a trackpad arrives as a wheel event with Ctrl held
  const zoomRef = useRef(zoomTo);
  zoomRef.current = zoomTo;
  const zoomNow = useRef(zoom);
  zoomNow.current = zoom;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomRef.current(zoomNow.current * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  return (
    <aside className="grid-pdf" aria-label="PDFs">
      <div className="grid-pdf-tabs" role="tablist" aria-label="Open PDFs">
        {pdfs.map((p) => (
          <div key={p.id} className={`grid-pdf-tab ${p.id === pdf?.id ? 'active' : ''}`} title={p.name}>
            <button role="tab" aria-selected={p.id === pdf?.id} className="grid-pdf-tab-name" onClick={() => onSelect(p.id)}>
              {tabName(p.name)}
            </button>
            <button className="grid-pdf-tab-close" aria-label={`Close ${p.name}`} onClick={() => onClose(p.id)}>
              ×
            </button>
          </div>
        ))}
        <button className="grid-pdf-add" aria-label="Open another PDF" title="Open another PDF" onClick={onAdd}>
          +
        </button>
      </div>
      <div className="grid-pdf-head">
        <span className="muted">{total ? `${total} page${total === 1 ? '' : 's'}` : ''}</span>
        <span className="grid-pdf-zoom">
          <button aria-label="Zoom out" title="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => zoomTo(zoom / STEP)}>
            −
          </button>
          <button className="grid-pdf-zoom-level" title="Fit the width" onClick={() => zoomTo(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button aria-label="Zoom in" title="Zoom in (or pinch)" disabled={zoom >= MAX_ZOOM} onClick={() => zoomTo(zoom * STEP)}>
            +
          </button>
        </span>
      </div>
      <div className="grid-pdf-pages" ref={scrollRef}>
        <div className="grid-pdf-sheet" style={{ width: shown }}>
          {failed && <p className="polish-error">This PDF couldn't be opened.</p>}
          {pages.map((url, i) => (
            <figure key={i} className="grid-pdf-page">
              <img src={url} alt={`Page ${i + 1}`} draggable={false} />
              <figcaption>{i + 1}</figcaption>
            </figure>
          ))}
          {!failed && pages.length < total && <p className="muted">Loading page {pages.length + 1}…</p>}
          {!failed && !total && <p className="muted">Opening…</p>}
        </div>
      </div>
    </aside>
  );
}
