// common.ts

import { setIcon } from 'obsidian';
import { getLangSymbol, getBookName, decodeScriptures } from './engine-wrapper';
import { getAslTimecodes } from './cache';
import { VerseData, NameFormat } from './types';

// ──────────────────────────────────────────────
// URL builders
// ──────────────────────────────────────────────

export function buildJwLibraryUrl(bcv: string, outputLang: string, timecodes?: string): string {
    const langSymbol = getLangSymbol(outputLang);
    return timecodes
        ? `jwlibrary:///finder?wtlocale=${langSymbol}&bible=${bcv}&ts=${timecodes}`
        : `jwlibrary:///finder?wtlocale=${langSymbol}&bible=${bcv}`;
}

export function buildJwOrgUrl(bcv: string, outputLang: string, timecodes?: string): string {
    const langSymbol = getLangSymbol(outputLang);
    return timecodes
        ? `https://www.jw.org/finder?wtlocale=${langSymbol}&bible=${bcv}&ts=${timecodes}`
        : `https://www.jw.org/finder?wtlocale=${langSymbol}&bible=${bcv}`;
}

// ──────────────────────────────────────────────
// Click context resolution
// (decode the display title and, if needed, fetch ASL timecodes)
// ──────────────────────────────────────────────

export interface ClickContext {
    refText: string;
    timecodes?: string;
}

export async function resolveClickContext(
    bcv: string,
    outputLang: string,
    titleFormat: NameFormat,
    fallbackText?: string,
): Promise<ClickContext> {
    const parts = bcv.split('-');
    const startBcv = parts[0];
    const endBcv = parts.length > 1 ? parts[1] : parts[0];
    const decoded = decodeScriptures([[startBcv, endBcv]], outputLang, titleFormat);
    const refText = decoded?.[0] || fallbackText || bcv;
    const timecodes = outputLang === 'ase' ? await getAslTimecodes(bcv) : undefined;
    return { refText, timecodes };
}

// ──────────────────────────────────────────────
// Verse body builder
// ──────────────────────────────────────────────

/**
 * Builds the verse-text container used by both the modal and the scripture pane.
 * Caller is responsible for calling attachMarkerTooltips() on the result.
 */
export function buildVerseBody(verseData: VerseData | null): HTMLElement {
    const body = createDiv();
    body.id = 'verse-tooltip';
    body.className = 'traverture-modal-body';

    const html = verseData?.html ?? '<p><em>Verse lookup unavailable</em></p>';
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    for (const child of Array.from(parsed.body.childNodes)) {
        body.appendChild(child.cloneNode(true));
    }
    return body;
}

// ──────────────────────────────────────────────
// Copy text builders
// ──────────────────────────────────────────────

/**
 * Plain-text version of the verse HTML for clipboard, respecting paragraph breaks.
 * Does not include the citation — the caller prepends it.
 */
export function htmlToPlainText(html: string): string {
    const tempDiv = createDiv();
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    for (const child of Array.from(parsed.body.childNodes)) {
        tempDiv.appendChild(child.cloneNode(true));
    }

    const lines: string[] = [];
    let currentParagraph: string[] = [];

    const walkNode = (node: Node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;
            if (el.classList.contains('parabreak')) {
                if (currentParagraph.length > 0) {
                    lines.push(currentParagraph.join(' '));
                    currentParagraph = [];
                    lines.push('');
                }
                return;
            }
            if (el.classList.contains('newblock')) {
                if (currentParagraph.length > 0) {
                    lines.push(currentParagraph.join(' '));
                    currentParagraph = [];
                }
                return;
            }
        }
        if (node.nodeType === Node.TEXT_NODE) {
            const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
            if (text) currentParagraph.push(text);
            return;
        }
        for (const child of Array.from(node.childNodes)) walkNode(child);
    };

    for (const child of Array.from(tempDiv.childNodes)) walkNode(child);
    if (currentParagraph.length > 0) lines.push(currentParagraph.join(' '));

    return lines.join('\n')
        .replace(/\u00A0/g, ' ')
        .replace(/\u202F/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function buildCopyText(verseData: VerseData | null, displayText: string): string {
    if (!verseData) return displayText;

    const cleanHtml = verseData.html
        .replace(/<sup class="traverture-footnote-marker"[^>]*>\*<\/sup>/g, '')
        .replace(/<sup class="traverture-xref-marker"[^>]*>\+<\/sup>/g, '');

    const text = htmlToPlainText(cleanHtml);
    return `${displayText}\n\n${text}`;
}

export function buildCommentaryCopyText(
    commentaries: Array<{ id: number; content: string; source: string }>,
    outputLang: string,
): string {
    let text = '';
    for (const c of commentaries) {
        const bookNum = parseInt(c.source.substring(0, 2));
        const bookName = getBookName(bookNum, outputLang, 'full', false);
        const ch = parseInt(c.source.substring(2, 5));
        const vs = parseInt(c.source.substring(5, 8));

        const tempDiv = createDiv();
        const parsedContent = new DOMParser().parseFromString(c.content, 'text/html');
        parsedContent.body.querySelectorAll('a').forEach(a => a.replaceWith(a.textContent || ''));
        for (const child of Array.from(parsedContent.body.childNodes)) {
            tempDiv.appendChild(child.cloneNode(true));
        }

        const paras = tempDiv.querySelectorAll('p');
        let noteText = '';
        if (paras.length > 0) {
            noteText = Array.from(paras)
                .map(p => (p.textContent || '').replace(/[ \t]+/g, ' ').trim())
                .join('\n\n');
        } else {
            noteText = (tempDiv.textContent || '').replace(/[ \t]+/g, ' ').trim();
        }

        text += `${bookName} ${ch}:${vs}\n\n${noteText}\n\n`;
    }
    return text.trim();
}

// ──────────────────────────────────────────────
// Commentary pane (Study Notes) renderer
// ──────────────────────────────────────────────

export function buildCommentaryPane(
    commentaries: Array<{ id: number; content: string; source: string }>,
    outputLang: string,
): HTMLElement {
    const pane = createDiv();
    pane.className = 'traverture-modal-commentary';

    const paneHeader = createDiv();
    paneHeader.className = 'traverture-modal-commentary-header';

    const paneTitle = createSpan();
    paneTitle.textContent = 'Study Notes';
    paneHeader.appendChild(paneTitle);

    const paneCopyBtn = createEl('button');
    paneCopyBtn.className = 'traverture-modal-commentary-copy';
    setIcon(paneCopyBtn, 'copy');
    paneCopyBtn.addEventListener('click', () => {
        void navigator.clipboard.writeText(buildCommentaryCopyText(commentaries, outputLang));
        setIcon(paneCopyBtn, 'check');
        window.setTimeout(() => { setIcon(paneCopyBtn, 'copy'); }, 1500);
    });
    paneHeader.appendChild(paneCopyBtn);
    pane.appendChild(paneHeader);

    const paneContent = createDiv();
    paneContent.className = 'traverture-modal-commentary-content';

    for (const c of commentaries) {
        const note = createDiv();
        note.className = 'traverture-modal-commentary-note';

        const bookNum = parseInt(c.source.substring(0, 2));
        const bookName = getBookName(bookNum, outputLang, 'full', false);
        const ch = parseInt(c.source.substring(2, 5));
        const vs = parseInt(c.source.substring(5, 8));
        const citation = createDiv();
        citation.className = 'traverture-modal-commentary-citation';
        citation.textContent = `${bookName} ${ch}:${vs}`;
        note.appendChild(citation);

        const parsed = new DOMParser().parseFromString(c.content, 'text/html');
        parsed.body.querySelectorAll('a').forEach(a => a.replaceWith(a.textContent || ''));
        for (const child of Array.from(parsed.body.childNodes)) {
            note.appendChild(child.cloneNode(true));
        }
        paneContent.appendChild(note);
    }

    pane.appendChild(paneContent);
    return pane;
}

// ──────────────────────────────────────────────
// Marker tooltips (footnotes / cross-references)
// ──────────────────────────────────────────────

export function attachMarkerTooltips(body: HTMLElement, verseData: VerseData): void {
    body.querySelectorAll('.traverture-footnote-marker').forEach(marker => {
        const el = marker as HTMLElement;
        const fnId = parseInt(el.getAttribute('data-fn-id') || '0');
        const footnote = verseData.footnotes?.find(f => f.id === fnId);
        if (footnote) {
            el.setAttribute('title', stripHtml(footnote.content));
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                showMarkerPopover(el, footnote.content);
            });
        }
    });

    body.querySelectorAll('.traverture-xref-marker').forEach(marker => {
        const el = marker as HTMLElement;
        const xrefId = parseInt(el.getAttribute('data-xref-id') || '0');
        const xref = verseData.crossReferences?.find(x => x.id === xrefId);
        if (xref) {
            const targets = xref.targets.map(t => t.standardCitation.replace(/&nbsp;/g, ' ')).join('; ');
            el.setAttribute('title', targets);
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                showMarkerPopover(el, targets);
            });
        }
    });
}

export function showMarkerPopover(anchor: HTMLElement, content: string): void {
    activeDocument.querySelector('.traverture-marker-popover')?.remove();

    const popover = createDiv();
    popover.className = 'traverture-marker-popover';
    popover.textContent = content;
    popover.addEventListener('click', (e) => e.stopPropagation());
    popover.addEventListener('mousedown', (e) => e.stopPropagation());

    const rect = anchor.getBoundingClientRect();
    popover.style.top = `${rect.bottom + 4}px`;
    popover.style.left = `${rect.left}px`;

    activeDocument.body.appendChild(popover);

    const closePopover = (e: MouseEvent) => {
        if (!popover.contains(e.target as Node)) {
            popover.remove();
            activeDocument.removeEventListener('click', closePopover);
        }
    };
    window.setTimeout(() => activeDocument.addEventListener('click', closePopover), 10);
}

function stripHtml(html: string): string {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    return (parsed.body.textContent || '').replace(/\s+/g, ' ').trim();
}