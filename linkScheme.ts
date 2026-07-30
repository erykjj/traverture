export type LinkScheme = 'jwlibrary' | 'jworg';

export const DEFAULT_LINK_SCHEME: LinkScheme = 'jwlibrary';

export function buildJwLibraryFinderUrlForReference(params: {
  bibleId?: string;
  book?: string;
  chapter?: number;
  verseStart?: number;
  verseEnd?: number;
  extra?: Record<string, string>;
}): string {
  const q = new URLSearchParams();
  if (params.bibleId) q.set('bible', params.bibleId);
  if (params.book) q.set('book', params.book);
  if (params.chapter !== undefined) q.set('chapter', String(params.chapter));
  if (params.verseStart !== undefined) {
    if (params.verseEnd !== undefined) {
      q.set('verse', `${params.verseStart}-${params.verseEnd}`);
    } else {
      q.set('verse', String(params.verseStart));
    }
  }
  if (params.extra) {
    for (const [k, v] of Object.entries(params.extra)) q.set(k, v);
  }
  return `jwlibrary:///finder?${q.toString()}`;
}

export function buildJwOrgFinderUrlForReference(params: {
  bibleId?: string;
  book?: string;
  chapter?: number;
  verseStart?: number;
  verseEnd?: number;
  extra?: Record<string, string>;
}): string {
  const q = new URLSearchParams();
  if (params.bibleId) q.set('bible', params.bibleId);
  if (params.book) q.set('book', params.book);
  if (params.chapter !== undefined) q.set('chapter', String(params.chapter));
  if (params.verseStart !== undefined) {
    if (params.verseEnd !== undefined) {
      q.set('verse', `${params.verseStart}-${params.verseEnd}`);
    } else {
      q.set('verse', String(params.verseStart));
    }
  }
  if (params.extra) {
    for (const [k, v] of Object.entries(params.extra)) q.set(k, v);
  }
  return `https://www.jw.org/finder?${q.toString()}`;
}
