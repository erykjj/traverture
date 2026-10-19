// common.ts

import { setIcon } from 'obsidian';
import { getAslTimecodes } from './cache';
import { getBookName, decodeScriptures, getLangSymbol } from './engine-wrapper';
import { VerseData, NameFormat } from './types';

export type NavigateCallback = (bcv: string, displayText: string) => void;

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

export function normalizeTargetVerses(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '';
    const parts = trimmed.split('-');
    const normalized = parts.map(p => {
        const t = p.trim();
        if (!/^\d+$/.test(t)) return '';
        if (t.length === 7) return '0' + t;
        if (t.length === 8) return t;
        return '';
    });
    if (normalized.some(p => p === '')) return '';
    return normalized.join('-');
}

export function buildVerseBody(verseData: VerseData | null): HTMLElement {
    const body = createDiv();
    body.id = 'verse-tooltip';
    body.className = 'traverture-pane-body';

    const html = verseData?.html ?? '<p><em>Verse lookup unavailable</em></p>';
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    for (const child of Array.from(parsed.body.childNodes)) {
        body.appendChild(child.cloneNode(true));
    }
    return body;
}

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
    titleFormat: NameFormat,
): string {
    let text = 'Study Notes\n\n';
    for (const c of commentaries) {
        const decoded = decodeScriptures([[c.source, c.source]], outputLang, titleFormat);
        const citation = decoded?.[0] || c.source;

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

        text += `${citation}\n\n${noteText}\n\n`;
    }
    return text.trim();
}

export function buildCommentaryPane(
    commentaries: Array<{ id: number; content: string; source: string }>,
    outputLang: string,
    titleFormat: NameFormat,
    onNavigate: NavigateCallback,
): HTMLElement {
    const pane = createDiv();
    pane.className = 'traverture-pane-commentary';

    const paneHeader = createDiv();
    paneHeader.className = 'traverture-pane-commentary-header';

    const paneTitle = createSpan();
    paneTitle.textContent = 'Study Notes';
    paneHeader.appendChild(paneTitle);

    const paneCopyBtn = createEl('button');
    paneCopyBtn.className = 'traverture-pane-commentary-copy';
    setIcon(paneCopyBtn, 'copy');
    paneCopyBtn.addEventListener('click', () => {
        void navigator.clipboard.writeText(
            buildCommentaryCopyText(commentaries, outputLang, titleFormat)
        );
        setIcon(paneCopyBtn, 'check');
        window.setTimeout(() => { setIcon(paneCopyBtn, 'copy'); }, 1500);
    });
    paneHeader.appendChild(paneCopyBtn);
    pane.appendChild(paneHeader);

    const paneContent = createDiv();
    paneContent.className = 'traverture-pane-commentary-content';

    for (const c of commentaries) {
        const note = createDiv();
        note.className = 'traverture-pane-commentary-note';

        const decoded = decodeScriptures([[c.source, c.source]], outputLang, titleFormat);
        const citation = createDiv();
        citation.className = 'traverture-pane-commentary-citation';
        citation.textContent = decoded?.[0] || c.source;
        note.appendChild(citation);

        const parsed = new DOMParser().parseFromString(c.content, 'text/html');
        stripEmptyClasses(parsed.body);
        relinkAndAppend(parsed.body, note, outputLang, onNavigate);
        paneContent.appendChild(note);
    }

    pane.appendChild(paneContent);
    return pane;
}

function relinkAndAppend(
    source: HTMLElement,
    target: HTMLElement,
    outputLang: string,
    onNavigate: NavigateCallback,
): void {
    source.querySelectorAll('a').forEach(anchor => {
        const el = anchor;
        const targetVerses = el.getAttribute('data-targetverses');

        if (!targetVerses) {
            el.replaceWith(el.textContent || '');
            return;
        }

        const bcv = normalizeTargetVerses(targetVerses);
        const text = el.textContent || '';
        if (!bcv) {
            el.replaceWith(text);
            return;
        }

        const link = createEl('a');
        link.className = 'traverture-ref-link traverture-commentary-ref';
        link.textContent = text;
        link.setAttribute('data-bcv', bcv);
        link.addEventListener('click', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                e.stopPropagation();
                window.open(buildJwLibraryUrl(bcv, outputLang), '_blank');
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            onNavigate(bcv, text);
        });

        el.replaceWith(link);
    });

    while (source.firstChild) {
        target.appendChild(source.firstChild);
    }
}

function stripEmptyClasses(root: HTMLElement): void {
    root.querySelectorAll('[class]').forEach(el => {
        const cls = el.getAttribute('class') || '';
        if (cls.trim() === '') el.removeAttribute('class');
    });
}

export function attachMarkerTooltips(
    body: HTMLElement,
    verseData: VerseData,
    outputLang: string,
    onNavigate: NavigateCallback,
): void {
    body.querySelectorAll('.traverture-footnote-marker').forEach(marker => {
        const el = marker as HTMLElement;
        const fnId = parseInt(el.getAttribute('data-fn-id') || '0');
        const footnote = verseData.footnotes?.find(f => f.id === fnId);
        if (footnote) {
            el.setAttribute('title', stripHtml(footnote.content));
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                showFootnotePopover(el, footnote.content, outputLang, onNavigate);
            });
        }
    });

    body.querySelectorAll('.traverture-xref-marker').forEach(marker => {
        const el = marker as HTMLElement;
        const xrefId = parseInt(el.getAttribute('data-xref-id') || '0');
        const xref = verseData.crossReferences?.find(x => x.id === xrefId);
        if (xref) {
            el.setAttribute('title', xref.targets.map(t => t.standardCitation.replace(/&nbsp;/g, ' ')).join('; '));
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                showXrefPopover(el, xref.targets, outputLang, onNavigate);
            });
        }
    });
}

function showFootnotePopover(
    anchor: HTMLElement,
    content: string,
    outputLang: string,
    onNavigate: NavigateCallback,
): void {
    activeDocument.querySelector('.traverture-marker-popover')?.remove();

    const popover = createDiv();
    popover.className = 'traverture-marker-popover';
    popover.addEventListener('click', (e) => e.stopPropagation());
    popover.addEventListener('mousedown', (e) => e.stopPropagation());

    const parsed = new DOMParser().parseFromString(content, 'text/html');
    stripEmptyClasses(parsed.body);
    relinkAndAppend(parsed.body, popover, outputLang, onNavigate);

    positionPopover(popover, anchor);
    activeDocument.body.appendChild(popover);
    attachCloseHandler(popover);
}

function showXrefPopover(
    anchor: HTMLElement,
    targets: Array<{ vs: string; standardCitation: string; abbreviatedCitation: string }>,
    outputLang: string,
    onNavigate: NavigateCallback,
): void {
    activeDocument.querySelector('.traverture-marker-popover')?.remove();

    const popover = createDiv();
    popover.className = 'traverture-marker-popover';
    popover.addEventListener('click', (e) => e.stopPropagation());
    popover.addEventListener('mousedown', (e) => e.stopPropagation());

    targets.forEach((t, i) => {
        if (i > 0) popover.appendChild(document.createTextNode('; '));
        const bcv = normalizeTargetVerses(t.vs);
        const text = t.standardCitation.replace(/&nbsp;/g, ' ');
        if (!bcv) {
            popover.appendChild(document.createTextNode(text));
            return;
        }
        const link = createEl('a');
        link.className = 'traverture-xref-popover-link';
        link.textContent = text;
        link.setAttribute('data-bcv', bcv);
        link.addEventListener('click', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                e.stopPropagation();
                window.open(buildJwLibraryUrl(bcv, outputLang), '_blank');
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            popover.remove();
            onNavigate(bcv, text);
        });
        popover.appendChild(link);
    });

    positionPopover(popover, anchor);
    activeDocument.body.appendChild(popover);
    attachCloseHandler(popover);
}

function positionPopover(popover: HTMLElement, anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    popover.style.top = `${rect.bottom + 4}px`;
    popover.style.left = `${rect.left}px`;
}

function attachCloseHandler(popover: HTMLElement): void {
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