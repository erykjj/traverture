import { requestUrl } from 'obsidian';
import { VerseData } from './types';
import { getLangSuffix } from './languages';

const CACHE_TTL_MS = 60 * 60 * 1000;

interface CacheEntry {
    data: VerseData;
    ts: number;
}

const verseCache = new Map<string, CacheEntry>();

function isCacheFresh(entry: CacheEntry): boolean {
    return Date.now() - entry.ts < CACHE_TTL_MS;
}

function getCachedVerse(key: string): VerseData | null {
    const entry = verseCache.get(key);
    if (entry && isCacheFresh(entry)) return entry.data;
    if (entry) verseCache.delete(key);
    return null;
}

function setCachedVerse(key: string, data: VerseData): void {
    verseCache.set(key, { data, ts: Date.now() });
}

export async function fetchVerseWithExtras(range: string, langCode: string): Promise<VerseData | null> {
    const cacheKey = `${langCode}:${range}:extras`;
    const cached = getCachedVerse(cacheKey);
    if (cached) return cached;

    const suffix = getLangSuffix(langCode);
    const rangeParts = range.split('-');
    const apiRange = rangeParts.map(p => {
        const book = p.substring(0, 2).replace(/^0+/, '');
        return book + p.substring(2);
    }).join('-');
    const url = `https://www.jw.org/${suffix}json/html/${apiRange}`;

    try {
        const response = await requestUrl({ url });
        const data = response.json;
        const verseData = data.ranges?.[apiRange];
        if (verseData) {
            const result: VerseData = {
                html: cleanVerseHtml(verseData.html, true),
                citation: (verseData.citation || '').replace(/&nbsp;/g, ' ').replace(/\u00A0/g, ' '),
                footnotes: verseData.footnotes || [],
                crossReferences: verseData.crossReferences || [],
                commentaries: verseData.commentaries?.filter((c: any) => c.content) || [],
            };
            setCachedVerse(cacheKey, result);
            return result;
        }
    } catch (e) {
        console.error(`tra.VER:ture: Error fetching verse "${apiRange}":`, e);
    }
    return null;
}

function cleanVerseHtml(rawHtml: string, keepMarkers: boolean = false): string {
    let cleaned = rawHtml;
    
    if (keepMarkers) {
        cleaned = cleaned.replace(/<a class="footnoteLink"[^>]*id="footnotesource(\d+)"[^>]*>\*<\/a>/g, 
            '<sup class="traverture-footnote-marker" data-fn-id="$1">*</sup>');
        cleaned = cleaned.replace(/<a class="xrefLink jsBibleLink"[^>]*id="xreflink(\d+)"[^>]*>\+<\/a>/g,
            '<sup class="traverture-xref-marker" data-xref-id="$1">+</sup>');
    }

    cleaned = cleaned
        .replace(/<a[^>]*>/g, '')
        .replace(/<\/a>/g, '')
        .replace(/\r\n/g, '')
        .replace(/\u00A0/g, ' ')
        .replace(/\u202F/g, ' ');

    if (!keepMarkers) {
        cleaned = cleaned.replace(/\+/g, '').replace(/\*/g, '');
    }

    cleaned = cleaned.replace(/class="style-b first"/g, 'class=""');
    cleaned = cleaned.replace(/class="style-b"/g, 'class=""');
    cleaned = cleaned.replace(/<span class="verse" id="[^"]*">/g, '<span class="verse">');
    cleaned = cleaned.replace(/class=""/g, '');

    if (!cleaned.includes('superscription')) {
        cleaned = '<sup class="superscription"><span class="style-w"> </span></sup>' + cleaned;
    }

    return cleaned;
}

export function escapeHtml(text: string): string {
    const div = activeDocument.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export async function fetchVerse(range: string, langCode: string): Promise<VerseData | null> {
    const cacheKey = `${langCode}:${range}`;
    const cached = getCachedVerse(cacheKey);
    if (cached) return cached;

    const suffix = getLangSuffix(langCode);
    const rangeParts = range.split('-');
    const apiRange = rangeParts.map(p => {
        const book = p.substring(0, 2).replace(/^0+/, '');
        return book + p.substring(2);
    }).join('-');
    const url = `https://www.jw.org/${suffix}json/html/${apiRange}`;

    try {
        const response = await requestUrl({ url });
        const data = response.json;
        const verseData = data.ranges?.[apiRange];
        if (verseData) {
            const result: VerseData = {
                html: cleanVerseHtml(verseData.html),
                citation: (verseData.citation || '').replace(/&nbsp;/g, ' ').replace(/\u00A0/g, ' '),
            };
            setCachedVerse(cacheKey, result);
            return result;
        }
    } catch (e) {
        console.error(`tra.VER:ture: Error fetching verse "${apiRange}":`, e);
    }
    return null;
}