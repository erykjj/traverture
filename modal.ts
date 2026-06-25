import { setIcon } from 'obsidian';
// @ts-ignore
import * as wasmModule from './engine.js';
import { getAvailableLanguages } from './languages';
import { VerseData } from './types';

export class VerseModal {
    private modalEl: HTMLElement | null = null;
    private currentTitle: string = '';

    show(verseData: VerseData, bcv: string, outputLang: string, titleOverride?: string) {
        this.hide();

        const languages = getAvailableLanguages();
        const langObj = languages.find(l => l.code === outputLang);
        const langSymbol = langObj ? wasmModule.ObsidianEngine.get_lang_symbol(outputLang) : 'E';
        this.currentTitle = titleOverride || verseData.citation;

        const modal = activeDocument.createElement('div');
        modal.className = 'traverture-modal';
        modal.addEventListener('click', (e) => { if (e.target === modal) this.hide(); });

        const dialog = activeDocument.createElement('div');
        dialog.className = 'traverture-modal-dialog';

        const header = activeDocument.createElement('div');
        header.className = 'traverture-modal-header';

        const title = activeDocument.createElement('span');
        title.className = 'traverture-modal-title';
        title.textContent = titleOverride || verseData.citation;
        header.appendChild(title);

        const buttonGroup = activeDocument.createElement('div');
        buttonGroup.className = 'traverture-modal-buttons';

        const jwlibUrl = `jwlibrary:///finder?wtlocale=${langSymbol}&bible=${bcv}`;
        const jwlibBtn = this.createHeaderButton('JW Library');
        jwlibBtn.addEventListener('click', () => { window.open(jwlibUrl, '_blank'); void navigator.clipboard.writeText(jwlibUrl); });
        buttonGroup.appendChild(jwlibBtn);

        const jworgUrl = `https://www.jw.org/finder?wtlocale=${langSymbol}&bible=${bcv}`;
        const jworgBtn = this.createHeaderButton('JW.ORG');
        jworgBtn.addEventListener('click', () => { window.open(jworgUrl, '_blank'); void navigator.clipboard.writeText(jworgUrl); });
        buttonGroup.appendChild(jworgBtn);

        const copyBtn = this.createHeaderButton('COPY');
        copyBtn.addEventListener('click', () => {
            const tempDiv = activeDocument.createElement('div');
            const cleanHtml = verseData.html.replace(/<sup class="traverture-footnote-marker"[^>]*>\*<\/sup>/g, '')
                                           .replace(/<sup class="traverture-xref-marker"[^>]*>\+<\/sup>/g, '');
            const parsed = new DOMParser().parseFromString(cleanHtml, 'text/html');
            for (const child of Array.from(parsed.body.childNodes)) {
                tempDiv.appendChild(child.cloneNode(true));
            }
            const lines: string[] = [];
            let currentParagraph: string[] = [];
            const walkNode = (node: Node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    const el = node as Element;
                    if (el.classList.contains('parabreak')) {
                        if (currentParagraph.length > 0) { lines.push(currentParagraph.join(' ')); currentParagraph = []; lines.push(''); }
                        return;
                    }
                    if (el.classList.contains('newblock')) {
                        if (currentParagraph.length > 0) { lines.push(currentParagraph.join(' ')); currentParagraph = []; }
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
            let text = lines.join('\n').replace(/\u00A0/g, ' ').replace(/\u202F/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
            void navigator.clipboard.writeText(`${this.currentTitle}\n\n${text}`);
            copyBtn.textContent = 'COPIED';
            window.setTimeout(() => { copyBtn.textContent = 'COPY'; }, 1500);
        });
        buttonGroup.appendChild(copyBtn);

        const closeBtn = activeDocument.createElement('button');
        closeBtn.className = 'traverture-modal-close';
        closeBtn.textContent = '\u2715';
        closeBtn.addEventListener('click', () => this.hide());
        buttonGroup.appendChild(closeBtn);

        header.appendChild(buttonGroup);
        dialog.appendChild(header);

        const contentArea = activeDocument.createElement('div');
        contentArea.className = 'traverture-modal-content';

        const body = activeDocument.createElement('div');
        body.id = 'verse-tooltip';
        body.className = 'traverture-modal-body';
        const parsed = new DOMParser().parseFromString(verseData.html, 'text/html');
        for (const child of Array.from(parsed.body.childNodes)) {
            body.appendChild(child.cloneNode(true));
        }

        this.attachMarkerTooltips(body, verseData);

        contentArea.appendChild(body);

        if (verseData.commentaries && verseData.commentaries.length > 0) {
            const sidePane = this.createCommentaryPane(verseData.commentaries, outputLang);
            contentArea.appendChild(sidePane);
        }

        dialog.appendChild(contentArea);
        modal.appendChild(dialog);
        activeDocument.body.appendChild(modal);
        this.modalEl = modal;
    }

        private attachMarkerTooltips(body: HTMLElement, verseData: VerseData) {
        body.querySelectorAll('.traverture-footnote-marker').forEach(marker => {
            const el = marker as HTMLElement;
            const fnId = parseInt(el.getAttribute('data-fn-id') || '0');
            const footnote = verseData.footnotes?.find(f => f.id === fnId);
            if (footnote) {
                el.setAttribute('title', this.stripHtml(footnote.content));
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showMarkerPopover(el, footnote.content, 'Footnote');
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
                    this.showMarkerPopover(el, targets, 'Cross References');
                });
            }
        });
    }

    private showMarkerPopover(anchor: HTMLElement, content: string, label: string) {
        activeDocument.querySelector('.traverture-marker-popover')?.remove();

        const popover = activeDocument.createElement('div');
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

    private createCommentaryPane(commentaries: Array<{ id: number; content: string; source: string }>, outputLang: string): HTMLElement {
        const pane = activeDocument.createElement('div');
        pane.className = 'traverture-modal-commentary';

        const paneHeader = activeDocument.createElement('div');
        paneHeader.className = 'traverture-modal-commentary-header';

        const paneTitle = activeDocument.createElement('span');
        paneTitle.textContent = 'Study Notes';
        paneHeader.appendChild(paneTitle);

        const paneCopyBtn = activeDocument.createElement('button');
        paneCopyBtn.className = 'traverture-modal-commentary-copy';
        setIcon(paneCopyBtn, 'copy');
        paneCopyBtn.addEventListener('click', () => {
            let text = '';
            for (const c of commentaries) {
                const note = activeDocument.createElement('div');
                note.className = 'traverture-modal-commentary-note';

                const bookNum = parseInt(c.source.substring(0, 2));
                const bookName = wasmModule.ObsidianEngine.get_book_name(bookNum, outputLang, 'full', false);
                const ch = parseInt(c.source.substring(2, 5));
                const vs = parseInt(c.source.substring(5, 8));
                const citation = activeDocument.createElement('div');
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
            void navigator.clipboard.writeText(text.trim());
            setIcon(paneCopyBtn, 'check');
            window.setTimeout(() => { setIcon(paneCopyBtn, 'copy'); }, 1500);
        });
        paneHeader.appendChild(paneCopyBtn);
        pane.appendChild(paneHeader);

        const paneContent = activeDocument.createElement('div');
        paneContent.className = 'traverture-modal-commentary-content';

        for (const c of commentaries) {
            const note = activeDocument.createElement('div');
            note.className = 'traverture-modal-commentary-note';

            const bookNum = parseInt(c.source.substring(0, 2));
            const bookName = wasmModule.ObsidianEngine.get_book_name(bookNum, outputLang, 'full', false);
            const ch = parseInt(c.source.substring(2, 5));
            const vs = parseInt(c.source.substring(5, 8));
            const citation = activeDocument.createElement('div');
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

    private stripHtml(html: string): string {
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        return (parsed.body.textContent || '').replace(/\s+/g, ' ').trim();
    }

    private createHeaderButton(text: string): HTMLButtonElement {
        const btn = activeDocument.createElement('button');
        btn.className = 'traverture-modal-btn';
        btn.textContent = text;
        return btn;
    }

    hide() {
        if (this.modalEl) { this.modalEl.remove(); this.modalEl = null; }
    }
}