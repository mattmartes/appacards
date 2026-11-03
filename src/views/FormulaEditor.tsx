// Editing a formula in Grid notes: its LaTeX, with a live preview of how
// it'll look.

import katex from 'katex';
import { useMemo, useState } from 'react';
import { Modal } from './Modal';

export function FormulaEditor({
  tex,
  isNew,
  onSave,
  onDelete,
  onClose,
}: {
  tex: string;
  isNew: boolean;
  onSave: (tex: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState(tex);
  const preview = useMemo(() => {
    if (!code.trim()) return { html: '' };
    try {
      return { html: katex.renderToString(code, { displayMode: true, throwOnError: true, output: 'html' }) };
    } catch (e) {
      return { error: (e instanceof Error ? e.message : String(e)).replace(/^KaTeX parse error:\s*/, '') };
    }
  }, [code]);
  const save = () => code.trim() && !preview.error && onSave(code.trim());

  return (
    <Modal
      title={isNew ? 'New formula' : 'Edit formula'}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button className="link danger" onClick={onDelete}>
              Delete
            </button>
          )}
          <span className="formula-push" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!code.trim() || !!preview.error} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <label className="formula-label" htmlFor="formula-code">
        LaTeX
      </label>
      <textarea
        id="formula-code"
        data-autofocus
        className="formula-code"
        value={code}
        rows={4}
        spellCheck={false}
        placeholder={'e.g. \\frac{dy}{dx} = 2x'}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            save();
          }
        }}
      />
      <div className="formula-preview" aria-live="polite">
        {preview.error ? (
          <p className="formula-error">{preview.error}</p>
        ) : preview.html ? (
          <div dangerouslySetInnerHTML={{ __html: preview.html }} />
        ) : (
          <p className="muted">The formula shows here as you type.</p>
        )}
      </div>
      <p className="muted formula-hint">Ctrl+Enter saves.</p>
    </Modal>
  );
}
