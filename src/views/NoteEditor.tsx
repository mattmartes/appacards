// A rich-text note editor modelled on Anki's: one contenteditable per field,
// a shared toolbar acting on the focused field, Anki's shortcuts, cloze
// buttons, media attach/paste, and a per-field HTML view.

import { useEffect, useRef, useState } from 'react';
import { col } from '../lib/collection';
import { fromEditorHtml, toEditorHtml } from '../lib/media';
import { clozeOrdinals } from '../lib/template';

const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'SUP', 'SUB', 'BR', 'DIV', 'P', 'UL', 'OL', 'LI', 'IMG', 'A', 'SPAN', 'FONT', 'RUBY', 'RT', 'RB', 'TABLE', 'TBODY', 'TR', 'TD', 'TH', 'HR']);

/** Keeps basic formatting from pasted HTML and drops everything else, much
 * like Anki's default paste behaviour. */
function sanitizePaste(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walk = (node: Element) => {
    for (const child of [...node.children]) {
      walk(child);
      if (!ALLOWED.has(child.tagName)) {
        if (['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE'].includes(child.tagName)) child.remove();
        else child.replaceWith(...child.childNodes);
        continue;
      }
      const keep: [string, string][] = [];
      if (child.tagName === 'IMG' && child.getAttribute('src')) keep.push(['src', child.getAttribute('src')!]);
      if (child.tagName === 'A' && child.getAttribute('href')) keep.push(['href', child.getAttribute('href')!]);
      const style = (child as HTMLElement).style;
      const css = [style.color && `color: ${style.color}`, style.backgroundColor && `background-color: ${style.backgroundColor}`]
        .filter(Boolean)
        .join('; ');
      if (css) keep.push(['style', css]);
      for (const a of [...child.attributes]) child.removeAttribute(a.name);
      keep.forEach(([k, v]) => child.setAttribute(k, v));
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

function exec(command: string, value?: string) {
  document.execCommand('styleWithCSS', false, command === 'hiliteColor' || command === 'foreColor' ? 'true' : 'false');
  document.execCommand(command, false, value);
}

function isImage(file: File) {
  return file.type.startsWith('image/');
}

async function insertFiles(files: File[]) {
  for (const f of files) {
    const name = await col.addMedia(f, f.name);
    if (isImage(f)) exec('insertHTML', toEditorHtml(`<img src="${name}">`));
    else exec('insertText', `[sound:${name}]`);
  }
}

function RichField({
  name,
  value,
  onChange,
  onFocus,
  html,
  sticky,
  onToggleSticky,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  onFocus: (el: HTMLElement) => void;
  html: boolean;
  sticky?: boolean;
  onToggleSticky?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string | null>(null);

  // Only overwrite the DOM for outside changes, so the caret isn't lost.
  useEffect(() => {
    if (ref.current && value !== lastEmitted.current) {
      ref.current.innerHTML = toEditorHtml(value);
      lastEmitted.current = value;
    }
  }, [value, html]);

  // Report only real edits. (Blur also calls this; if it re-sent unchanged
  // text it could overwrite the form being cleared after adding a note.)
  const emit = () => {
    if (!ref.current) return;
    const v = fromEditorHtml(ref.current.innerHTML === '<br>' ? '' : ref.current.innerHTML);
    if (v === lastEmitted.current) return;
    lastEmitted.current = v;
    onChange(v);
  };

  return (
    <div className="field-editor">
      <div className="field-label">
        <span>{name}</span>
        {onToggleSticky && (
          <button
            type="button"
            className={`pin ${sticky ? 'on' : ''}`}
            title="Keep this field's content after adding (sticky)"
            aria-pressed={!!sticky}
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onToggleSticky}
          >
            📌
          </button>
        )}
      </div>
      {html ? (
        <textarea
          className="html-editor"
          autoFocus
          aria-label={`${name} (HTML)`}
          value={value}
          onChange={(e) => {
            lastEmitted.current = null;
            onChange(e.target.value);
          }}
          spellCheck={false}
        />
      ) : (
        <div
          ref={ref}
          className="rich-field card-face-text"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={name}
          onFocus={(e) => onFocus(e.currentTarget)}
          onInput={emit}
          onBlur={emit}
          onPaste={async (e) => {
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              await insertFiles(files);
              emit();
              return;
            }
            const pasted = e.clipboardData.getData('text/html');
            if (pasted) {
              e.preventDefault();
              exec('insertHTML', sanitizePaste(pasted));
              emit();
            }
          }}
          onDrop={async (e) => {
            const files = [...e.dataTransfer.files];
            if (!files.length) return;
            e.preventDefault();
            ref.current?.focus();
            await insertFiles(files);
            emit();
          }}
        />
      )}
    </div>
  );
}

export interface NoteEditorProps {
  fields: string[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  cloze: boolean;
  sticky?: Record<string, boolean>;
  onToggleSticky?: (field: string) => void;
}

const COLORS_KEY = 'fsrs-cards-editor-colors';

export function NoteEditor({ fields, values, onChange, cloze, sticky, onToggleSticky }: NoteEditorProps) {
  const focused = useRef<HTMLElement | null>(null);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [htmlView, setHtmlView] = useState<Record<string, boolean>>({});
  const [colors, setColors] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(COLORS_KEY) ?? '') as { text: string; highlight: string };
    } catch {
      return { text: '#c8312f', highlight: '#fff176' };
    }
  });
  const textPicker = useRef<HTMLInputElement>(null);
  const highlightPicker = useRef<HTMLInputElement>(null);
  const attach = useRef<HTMLInputElement>(null);
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const saveColors = (c: typeof colors) => {
    setColors(c);
    try {
      localStorage.setItem(COLORS_KEY, JSON.stringify(c));
    } catch {
      // storage unavailable: colors just won't persist
    }
  };

  const refocus = () => focused.current?.focus();
  const changed = () => focused.current?.dispatchEvent(new Event('input', { bubbles: true }));
  const run = (command: string, value?: string) => {
    refocus();
    exec(command, value);
    changed();
  };

  /** Wraps the selection in {{cN::…}}; `same` reuses the highest number. */
  const insertCloze = (same: boolean) => {
    const el = focused.current;
    if (!el) return;
    el.focus();
    const max = Math.max(0, ...Object.values(valuesRef.current).flatMap((v) => clozeOrdinals(v)));
    const n = same ? Math.max(max, 1) : max + 1;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !el.contains(sel.anchorNode)) return;
    const range = sel.getRangeAt(0);
    const empty = range.collapsed;
    const inner = range.extractContents();
    const close = document.createTextNode('}}');
    range.insertNode(close);
    range.insertNode(inner);
    const open = document.createTextNode(`{{c${n}::`);
    range.insertNode(open);
    // put the caret inside an empty cloze, or after a wrapped one
    const caret = document.createRange();
    if (empty) caret.setStart(open, open.length);
    else caret.setStartAfter(close);
    caret.collapse(true);
    sel.removeAllRanges();
    sel.addRange(caret);
    changed();
  };

  const toggleHtml = () => {
    if (!focusedField) return;
    setHtmlView((h) => ({ ...h, [focusedField]: !h[focusedField] }));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const handle = (fn: () => void) => {
      e.preventDefault();
      fn();
    };
    if (ctrl && e.shiftKey && key === 'c' && cloze) return handle(() => insertCloze(e.altKey));
    if (ctrl && e.shiftKey && key === 'x') return handle(toggleHtml);
    if (ctrl && e.shiftKey && (key === '=' || key === '+')) return handle(() => run('superscript'));
    if (ctrl && !e.shiftKey && key === '=') return handle(() => run('subscript'));
    if (ctrl && e.shiftKey && (key === '>' || key === '.')) return handle(() => run('indent'));
    if (ctrl && e.shiftKey && (key === '<' || key === ',')) return handle(() => run('outdent'));
    if (ctrl && !e.shiftKey && key === 'r') return handle(() => run('removeFormat'));
    if (ctrl && !e.shiftKey && key === 'b') return handle(() => run('bold'));
    if (ctrl && !e.shiftKey && key === 'i') return handle(() => run('italic'));
    if (ctrl && !e.shiftKey && key === 'u') return handle(() => run('underline'));
    if (e.key === 'F7') return handle(() => run('foreColor', colors.text));
    if (e.key === 'F8') return handle(() => textPicker.current?.click());
    if (e.key === 'F3') return handle(() => attach.current?.click());
  };

  const Btn = ({ label, title, onPress, active }: { label: React.ReactNode; title: string; onPress: () => void; active?: boolean }) => (
    <button
      type="button"
      className={`tool ${active ? 'active' : ''}`}
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
    >
      {label}
    </button>
  );

  return (
    <div className="note-editor" onKeyDown={onKeyDown}>
      <div className="editor-toolbar" role="toolbar" aria-label="Formatting">
        <div className="tool-group">
          <Btn label={<b>B</b>} title="Bold (Ctrl+B)" onPress={() => run('bold')} />
          <Btn label={<i>I</i>} title="Italic (Ctrl+I)" onPress={() => run('italic')} />
          <Btn label={<u>U</u>} title="Underline (Ctrl+U)" onPress={() => run('underline')} />
          <Btn label={<span>x<sup>2</sup></span>} title="Superscript (Ctrl+Shift+=)" onPress={() => run('superscript')} />
          <Btn label={<span>x<sub>2</sub></span>} title="Subscript (Ctrl+=)" onPress={() => run('subscript')} />
          <Btn label="⌫" title="Remove formatting (Ctrl+R)" onPress={() => run('removeFormat')} />
        </div>
        <div className="tool-group">
          <Btn
            label={<span style={{ borderBottom: `3px solid ${colors.text}` }}>A</span>}
            title="Text color (F7)"
            onPress={() => run('foreColor', colors.text)}
          />
          <Btn label="▾" title="Change text color (F8)" onPress={() => textPicker.current?.click()} />
          <input
            ref={textPicker}
            type="color"
            className="hidden-picker"
            value={colors.text}
            onChange={(e) => {
              saveColors({ ...colors, text: e.target.value });
              run('foreColor', e.target.value);
            }}
          />
          <Btn
            label={<span style={{ background: colors.highlight, color: '#000', padding: '0 3px' }}>A</span>}
            title="Highlight color"
            onPress={() => run('hiliteColor', colors.highlight)}
          />
          <Btn label="▾" title="Change highlight color" onPress={() => highlightPicker.current?.click()} />
          <input
            ref={highlightPicker}
            type="color"
            className="hidden-picker"
            value={colors.highlight}
            onChange={(e) => {
              saveColors({ ...colors, highlight: e.target.value });
              run('hiliteColor', e.target.value);
            }}
          />
        </div>
        <div className="tool-group">
          <Btn label="•≡" title="Unordered list" onPress={() => run('insertUnorderedList')} />
          <Btn label="1≡" title="Ordered list" onPress={() => run('insertOrderedList')} />
          <Btn label="⇤" title="Align left" onPress={() => run('justifyLeft')} />
          <Btn label="≡" title="Center" onPress={() => run('justifyCenter')} />
          <Btn label="⇥" title="Align right" onPress={() => run('justifyRight')} />
          <Btn label="⇠" title="Outdent (Ctrl+Shift+,)" onPress={() => run('outdent')} />
          <Btn label="⇢" title="Indent (Ctrl+Shift+.)" onPress={() => run('indent')} />
        </div>
        <div className="tool-group">
          <Btn label="📎" title="Attach image or audio (F3)" onPress={() => attach.current?.click()} />
          <input
            ref={attach}
            type="file"
            accept="image/*,audio/*,video/*"
            multiple
            hidden
            onChange={async (e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              refocus();
              await insertFiles(files);
              changed();
            }}
          />
          {cloze && (
            <>
              <Btn label="[…]" title="Cloze deletion (Ctrl+Shift+C)" onPress={() => insertCloze(false)} />
              <Btn label="[…]=" title="Cloze deletion, same card (Ctrl+Alt+Shift+C)" onPress={() => insertCloze(true)} />
            </>
          )}
          <Btn label="</>" title="Toggle HTML editor (Ctrl+Shift+X)" onPress={toggleHtml} active={!!(focusedField && htmlView[focusedField])} />
        </div>
      </div>
      {fields.map((f) => (
        <div key={f} onFocusCapture={() => setFocusedField(f)}>
          <RichField
            name={f}
            value={values[f] ?? ''}
            html={!!htmlView[f]}
            onChange={(v) => onChange({ ...valuesRef.current, [f]: v })}
            onFocus={(el) => (focused.current = el)}
            sticky={sticky?.[f]}
            onToggleSticky={onToggleSticky ? () => onToggleSticky(f) : undefined}
          />
        </div>
      ))}
    </div>
  );
}
