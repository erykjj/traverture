// @ts-ignore
import * as wasmModule from './engine.js';
import { VerseData } from './types';
import { getAvailableLanguages } from './languages';

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
            const parsed = new DOMParser().parseFromString(verseData.html, 'text/html');
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
            let text = lines.join('\n').replace(/\u00A0/g, ' ').replace(/\u202F/g, ' ').replace(/\+/g, '').replace(/\*/g, '').replace(/\n{3,}/g, '\n\n').trim();
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

        const body = activeDocument.createElement('div');
        body.id = 'verse-tooltip';
        body.className = 'traverture-modal-body';
        const parsed = new DOMParser().parseFromString(verseData.html, 'text/html');
        for (const child of Array.from(parsed.body.childNodes)) {
            body.appendChild(child.cloneNode(true));
        }
        dialog.appendChild(body);

        modal.appendChild(dialog);
        activeDocument.body.appendChild(modal);
        this.modalEl = modal;
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