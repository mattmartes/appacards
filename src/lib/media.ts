// Resolves media filenames in card HTML (as Anki stores them) to object URLs
// for blobs kept in IndexedDB.

const urls = new Map<string, string>();
const names = new Map<string, string>();

export function setMediaUrl(name: string, blob: Blob) {
  const old = urls.get(name);
  if (old) {
    URL.revokeObjectURL(old);
    names.delete(old);
  }
  const url = URL.createObjectURL(blob);
  urls.set(name, url);
  names.set(url, name);
}

export function mediaCount() {
  return urls.size;
}

function resolve(name: string): string | undefined {
  return urls.get(name) ?? urls.get(decodeURIComponent(name));
}

/** Display URL for a stored media file, if it exists. */
export function mediaUrl(name: string): string | undefined {
  return resolve(name);
}

const escapeAttr = (s: string) => s.replace(/"/g, '&quot;');

function withImageUrls(html: string): string {
  return html.replace(/(\ssrc=)(["'])(.*?)\2/gi, (whole, attr: string, q: string, name: string) => {
    const url = resolve(name);
    return url ? `${attr}${q}${url}${q}` : whole;
  });
}

/** For the editor: images point at their blobs, [sound:…] stays as text. */
export const toEditorHtml = withImageUrls;

/** Back from the editor: blob URLs become filenames again. */
export function fromEditorHtml(html: string): string {
  return html.replace(/blob:[^"' )]+/g, (url) => names.get(url) ?? url);
}

/** Rewrites src="file" attributes and [sound:file] tags for display. */
export function renderMedia(html: string): string {
  return withImageUrls(html)
    .replace(/\[sound:(.+?)\]/g, (_, name: string) => {
      const url = resolve(name);
      return url ? `<audio controls preload="none" src="${escapeAttr(url)}"></audio>` : '';
    });
}
