import { unzipSync } from 'fflate';

function strFromU8(u8: Uint8Array): string {
  return new TextDecoder().decode(u8);
}

async function webCryptoSha256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function posixDirname(p: string): string {
  const idx = p.lastIndexOf('/');
  if (idx === -1) return '.';
  return p.substring(0, idx);
}

function posixJoin(a: string, b: string): string {
  if (b.startsWith('/')) return b;
  if (!a || a === '.') return b;
  return a.endsWith('/') ? `${a}${b}` : `${a}/${b}`;
}

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}

export interface OfflineChapter {
  language: string;
  book: string;
  chapter: string;
  title?: string;
  verses: Record<string, string>;
}

export interface ImportResult {
  success: boolean;
  error?: string;
  metadata?: { language: string; fileName: string; checksum: string; chapterCount: number };
}

export class EpubImportService {
  constructor(private repository: any) {}

  private getRootFilePath(archive: Map<string, string>): string | null {
    const container = archive.get('META-INF/container.xml');
    if (!container) return null;
    const match = container.match(/full-path="([^"]+)"/);
    return match ? match[1] : null;
  }

  private findNavPath(opfDoc: Document, rootDir: string): string | null {
    // Try to find <item properties="nav" href="..."/>
    const items = Array.from(opfDoc.getElementsByTagName('item')) as Element[];
    for (const item of items) {
      const props = item.getAttribute('properties') || '';
      const href = item.getAttribute('href');
      if (props.includes('nav') && href) return posixJoin(rootDir, href);
    }

    // fallback: find any file with 'nav' in href
    for (const item of items) {
      const href = item.getAttribute('href') || '';
      if (href.toLowerCase().includes('nav')) return posixJoin(rootDir, href);
    }
    return null;
  }

  private extractNavEntries(navContent: string, rootDir: string) {
    const doc = parseXml(navContent);
    const anchors = Array.from(doc.querySelectorAll('nav a')) as HTMLAnchorElement[];
    const entries: Array<{ href: string; text: string }> = [];
    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      const text = a.textContent?.trim() || '';
      entries.push({ href, text });
    }
    return entries;
  }

  async importEpub(fileData: Uint8Array, sourceFileName = 'imported.epub', overwriteExisting = false): Promise<ImportResult> {
    try {
      if (!fileData || fileData.length === 0) return { success: false, error: 'No EPUB file provided.' };
      const checksum = `sha256:${await webCryptoSha256(fileData)}`;
      const raw = unzipSync(fileData);
      const archive = new Map(Object.entries(raw).map(([p, v]) => [p, strFromU8(v as Uint8Array)]));

      const rootFile = this.getRootFilePath(archive);
      if (!rootFile) return { success: false, error: 'Invalid EPUB: missing container root.' };
      const rootDir = posixDirname(rootFile);
      const opfText = archive.get(rootFile);
      if (!opfText) return { success: false, error: 'Invalid EPUB: missing package document.' };
      const opfDoc = parseXml(opfText);

      // language detection
      const langNode = opfDoc.querySelector('metadata > language, dc\:language, language');
      const language = langNode?.textContent?.trim() || 'und';

      const existing = await this.repository.getMetadata(language).catch(() => null);
      if (existing && !overwriteExisting) return { success: false, error: `An offline corpus for ${language} already exists.` };

      const navPath = this.findNavPath(opfDoc, rootDir);
      const chapters: OfflineChapter[] = [];

      if (navPath && archive.has(navPath)) {
        const navContent = archive.get(navPath)!;
        const entries = this.extractNavEntries(navContent, rootDir);
        // translate entries into chapter documents. This is a best-effort approach.
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          const [filePart, anchor] = entry.href.split('#');
          const contentPath = filePart ? posixJoin(rootDir, filePart) : navPath;
          const chapterDocText = archive.get(contentPath);
          let verseText = '';
          if (chapterDocText) {
            try {
              const doc = parseXml(chapterDocText);
              if (anchor) {
                const el = doc.getElementById(anchor);
                verseText = el ? (el.textContent || '').trim() : (doc.body?.textContent || '').trim();
              } else {
                verseText = doc.body?.textContent?.trim() || '';
              }
            } catch (_) {
              verseText = chapterDocText;
            }
          }

          const ch: OfflineChapter = {
            language,
            book: entry.text || 'Unknown',
            chapter: String(i + 1),
            title: entry.text,
            verses: { '1': verseText || '' },
          };
          chapters.push(ch);
        }
      } else {
        // fallback: collect all .xhtml/.html files
        for (const [path, txt] of archive.entries()) {
          if (path.endsWith('.xhtml') || path.endsWith('.html') || path.endsWith('.htm')) {
            const doc = parseXml(txt);
            const title = doc.querySelector('title')?.textContent || path;
            chapters.push({ language, book: title, chapter: path, title: title, verses: { '1': doc.body?.textContent?.trim() || '' } });
          }
        }
      }

      if (chapters.length === 0) return { success: false, error: 'Unsupported EPUB structure: no chapters found.' };

      const metadata = { language, fileName: sourceFileName, checksum, chapterCount: chapters.length };
      await this.repository.saveCorpus(metadata, chapters);

      return { success: true, metadata };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
