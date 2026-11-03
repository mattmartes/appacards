// Mask editor for Image Occlusion notes, after Anki's (ts/routes/image-occlusion):
// draw rectangles/ellipses over an image; each mask or group of masks
// becomes one card.

import { useEffect, useRef, useState } from 'react';
import { col } from '../lib/collection';
import { parseOcclusions, serializeOcclusions, type Shape, type ShapeKind } from '../lib/imageOcclusion';
import { mediaUrl } from '../lib/media';

type Tool = 'select' | ShapeKind;

interface Props {
  /** Image field: an <img> tag */
  image: string;
  /** Occlusion field */
  occlusion: string;
  onChange: (patch: { image?: string; occlusion?: string }) => void;
}

const MIN_SIZE = 0.01;
const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

/** Smallest positive ordinal not used yet (Anki fills gaps first). */
function freeOrdinal(shapes: Shape[], exclude: Set<number> = new Set()) {
  const used = new Set([...shapes.map((s) => s.ordinal), ...exclude]);
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

export function OcclusionEditor({ image, occlusion, onChange }: Props) {
  const initial = parseOcclusions(occlusion);
  const [shapes, setShapes] = useState<Shape[]>(initial.shapes);
  const [hideAll, setHideAll] = useState(initial.occludeInactive || !occlusion);
  const [tool, setTool] = useState<Tool>('rect');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [draft, setDraft] = useState<Shape | null>(null);
  const lastSerialized = useRef(occlusion);
  const svgRef = useRef<SVGSVGElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** The gesture in progress. `latest` holds the shape being drawn or the
   * moved shapes, updated synchronously so a quick release never reads a
   * value from before the last pointer move. */
  const drag = useRef<{ mode: 'draw' | 'move'; x: number; y: number; orig: Shape[]; latest: Shape[] | Shape | null } | null>(null);

  // Outside changes (e.g. the form being cleared after adding) reset the editor.
  useEffect(() => {
    if (occlusion !== lastSerialized.current) {
      const parsed = parseOcclusions(occlusion);
      setShapes(parsed.shapes);
      if (occlusion) setHideAll(parsed.occludeInactive);
      setSelected(new Set());
      lastSerialized.current = occlusion;
    }
  }, [occlusion]);

  const commit = (next: Shape[], nextHideAll = hideAll) => {
    setShapes(next);
    const text = serializeOcclusions({ shapes: next, occludeInactive: nextHideAll });
    lastSerialized.current = text;
    onChange({ occlusion: text });
  };

  const src = /src=["']([^"']+)["']/i.exec(image)?.[1];
  const url = src ? mediaUrl(src) : undefined;

  const chooseImage = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const name = await col.addMedia(file, file.name);
    onChange({ image: `<img src="${name}">` });
  };

  const point = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const { x, y } = point(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (tool === 'select') {
      const idx = Number((e.target as Element).getAttribute('data-index'));
      if (Number.isNaN(idx) || (e.target as Element).getAttribute('data-index') === null) {
        setSelected(new Set());
        return;
      }
      const next = new Set(e.shiftKey ? selected : selected.has(idx) ? selected : []);
      if (e.shiftKey && next.has(idx)) next.delete(idx);
      else next.add(idx);
      setSelected(next);
      drag.current = { mode: 'move', x, y, orig: shapes, latest: null };
      return;
    }
    const start: Shape = { kind: tool, ordinal: freeOrdinal(shapes), left: x, top: y, width: 0, height: 0 };
    drag.current = { mode: 'draw', x, y, orig: shapes, latest: start };
    setDraft(start);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const { x, y } = point(e);
    if (d.mode === 'draw') {
      const s = d.latest as Shape;
      const next = { ...s, left: Math.min(x, d.x), top: Math.min(y, d.y), width: Math.abs(x - d.x), height: Math.abs(y - d.y) };
      d.latest = next;
      setDraft(next);
    } else {
      const dx = x - d.x;
      const dy = y - d.y;
      const moved = d.orig.map((s, i) => {
        if (!selected.has(i)) return s;
        const nx = clamp01(Math.min(s.left + dx, 1 - s.width));
        const ny = clamp01(Math.min(s.top + dy, 1 - s.height));
        const points = s.points?.map(([px, py]) => [px + (nx - s.left), py + (ny - s.top)] as [number, number]);
        return { ...s, left: nx, top: ny, ...(points ? { points } : {}) };
      });
      d.latest = moved;
      setShapes(moved);
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.mode === 'draw') {
      // include the release position in case no move event arrived
      const { x, y } = point(e);
      const s = d.latest as Shape;
      const final = { ...s, left: Math.min(x, d.x), top: Math.min(y, d.y), width: Math.abs(x - d.x), height: Math.abs(y - d.y) };
      setDraft(null);
      if (final.width >= MIN_SIZE && final.height >= MIN_SIZE) {
        const next = [...d.orig, final];
        commit(next);
        setSelected(new Set([next.length - 1]));
      }
    } else if (d.latest) {
      commit(d.latest as Shape[]);
    }
  };

  const removeSelected = () => {
    if (!selected.size) return;
    commit(shapes.filter((_, i) => !selected.has(i)));
    setSelected(new Set());
  };

  /** All selected masks become one card (the lowest number among them). */
  const group = () => {
    if (selected.size < 2) return;
    const ord = Math.min(...[...selected].map((i) => shapes[i].ordinal));
    commit(shapes.map((s, i) => (selected.has(i) ? { ...s, ordinal: ord } : s)));
  };

  /** Each selected mask becomes its own card again. */
  const ungroup = () => {
    const taken = new Set<number>();
    const seen = new Set<number>();
    const next = shapes.map((s, i) => {
      if (!selected.has(i)) return s;
      if (!seen.has(s.ordinal)) {
        seen.add(s.ordinal);
        taken.add(s.ordinal);
        return s;
      }
      const ord = freeOrdinal(shapes, taken);
      taken.add(ord);
      return { ...s, ordinal: ord };
    });
    commit(next);
  };

  const setMode = (all: boolean) => {
    setHideAll(all);
    if (shapes.length) commit(shapes, all);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeSelected();
    } else if (ctrl && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      if (e.shiftKey) ungroup();
      else group();
    } else if (ctrl && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSelected(new Set(shapes.map((_, i) => i)));
    }
  };

  const cardCount = new Set(shapes.map((s) => s.ordinal)).size;
  const shapeEl = (s: Shape, i: number | null, cls: string) => {
    const common = { className: cls, vectorEffect: 'non-scaling-stroke' as const, ...(i !== null ? { 'data-index': i } : {}) };
    if (s.kind === 'ellipse') {
      return <ellipse key={i ?? 'draft'} {...common} cx={s.left + s.width / 2} cy={s.top + s.height / 2} rx={s.width / 2} ry={s.height / 2} />;
    }
    if (s.kind === 'polygon' && s.points) {
      return <polygon key={i ?? 'draft'} {...common} points={s.points.map((p) => p.join(',')).join(' ')} />;
    }
    return <rect key={i ?? 'draft'} {...common} x={s.left} y={s.top} width={s.width} height={s.height} />;
  };

  if (!url) {
    return (
      <div
        className="io-dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) void chooseImage(f);
        }}
        onPaste={(e) => {
          const f = e.clipboardData.files[0];
          if (f) void chooseImage(f);
        }}
        tabIndex={0}
      >
        <p style={{ margin: 0 }}>Drop an image here, paste one, or</p>
        <button className="primary" onClick={() => fileRef.current?.click()}>
          Choose image…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void chooseImage(f);
          }}
        />
      </div>
    );
  }

  return (
    <div className="io-editor" onKeyDown={onKeyDown}>
      <div className="editor-toolbar" role="toolbar" aria-label="Mask tools">
        <div className="tool-group">
          {(
            [
              ['select', 'Select', '⬚↖'],
              ['rect', 'Rectangle', '▭'],
              ['ellipse', 'Ellipse', '◯'],
            ] as [Tool, string, string][]
          ).map(([t, label, icon]) => (
            <button key={t} type="button" className={`tool ${tool === t ? 'active' : ''}`} aria-pressed={tool === t} title={label} onClick={() => setTool(t)}>
              {icon} <span className="tool-label">{label}</span>
            </button>
          ))}
        </div>
        <div className="tool-group">
          <button type="button" className="tool" title="Group: selected masks become one card (Ctrl+G)" disabled={selected.size < 2} onClick={group}>
            Group
          </button>
          <button type="button" className="tool" title="Ungroup (Ctrl+Shift+G)" disabled={!selected.size} onClick={ungroup}>
            Ungroup
          </button>
          <button type="button" className="tool" title="Delete selected masks (Delete)" disabled={!selected.size} onClick={removeSelected}>
            Delete
          </button>
        </div>
        <div className="tool-group">
          <button type="button" className={`tool ${hideAll ? 'active' : ''}`} aria-pressed={hideAll} onClick={() => setMode(true)} title="Other masks stay covered while you answer">
            Hide all, guess one
          </button>
          <button type="button" className={`tool ${!hideAll ? 'active' : ''}`} aria-pressed={!hideAll} onClick={() => setMode(false)} title="Only the asked mask is covered">
            Hide one, guess one
          </button>
        </div>
        <div className="tool-group">
          <button type="button" className="tool" onClick={() => fileRef.current?.click()}>
            Change image…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void chooseImage(f);
            }}
          />
        </div>
      </div>
      <div className="io-stage" tabIndex={0} aria-label="Image with masks. Drag to draw a mask.">
        <img src={url} alt="" draggable={false} />
        <svg
          ref={svgRef}
          className={`io-masks io-edit tool-${tool}`}
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {shapes.map((s, i) => shapeEl(s, i, `io-active ${selected.has(i) ? 'io-selected' : ''}`))}
          {draft && shapeEl(draft, null, 'io-active io-draft')}
        </svg>
        {shapes.map((s, i) => (
          <span
            key={i}
            className="io-label num"
            style={{ left: `${(s.left + s.width / 2) * 100}%`, top: `${(s.top + s.height / 2) * 100}%` }}
          >
            {s.ordinal}
          </span>
        ))}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        {shapes.length
          ? `${shapes.length} mask${shapes.length === 1 ? '' : 's'} → ${cardCount} card${cardCount === 1 ? '' : 's'}. Masks with the same number are one card.`
          : 'Drag on the image to cover the parts you want to be asked about.'}{' '}
        Select masks to move, group (Ctrl+G) or delete them.
      </p>
    </div>
  );
}
