// Renders PDF pages to images with pdf.js, for Notes thumbnails and previews.
// Works the same in the browser and the desktop app (no built-in viewer needed).

async function pdfjs() {
  const lib = await import('pdfjs-dist');
  if (!lib.GlobalWorkerOptions.workerSrc) {
    lib.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  }
  return lib;
}

/** Page images as data URLs, one call per page as each is ready; a call
 * that returns a promise holds back the next page until it settles. */
export async function renderPdfPages(
  blob: Blob,
  width: number,
  onPage: (index: number, url: string, total: number) => void | Promise<void>,
  opts: { maxPages?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  try {
    const pdf = await task.promise;
    const count = Math.min(pdf.numPages, opts.maxPages ?? pdf.numPages);
    for (let i = 1; i <= count; i++) {
      if (opts.signal?.aborted) return;
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (width * (window.devicePixelRatio || 1)) / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      await onPage(i - 1, canvas.toDataURL('image/jpeg', 0.85), pdf.numPages);
    }
  } finally {
    await task.destroy();
  }
}

const thumbs = new Map<string, Promise<string | null>>();

/** A first-page thumbnail, cached for the session. */
export function pdfThumbnail(key: string, blob: Blob, width = 200): Promise<string | null> {
  let p = thumbs.get(key);
  if (!p) {
    p = new Promise<string | null>((resolve) => {
      let url: string | null = null;
      renderPdfPages(blob, width, (_, u) => void (url = u), { maxPages: 1 }).then(
        () => resolve(url),
        () => resolve(null),
      );
    });
    thumbs.set(key, p);
  }
  return p;
}
