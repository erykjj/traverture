// @ts-ignore
import * as wasmModule from './engine.js';
import { VerseData } from './types';
import { getAvailableLanguages } from './languages';

export class VerseModal {
    private modalEl: HTMLElement | null = null;

    show(verseData: VerseData, bcv: string, outputLang: string) {
        this.hide();

        const languages = getAvailableLanguages();
        const langObj = languages.find(l => l.code === outputLang);
        const langSymbol = langObj ? wasmModule.ObsidianEngine.get_lang_symbol(outputLang) : 'E';

        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:1000;display:flex;align-items:center;justify-content:center;';
        modal.addEventListener('click', (e) => { if (e.target === modal) this.hide(); });

        const dialog = document.createElement('div');
        dialog.style.cssText = 'background:var(--background-primary,white);border:2px solid var(--background-modifier-border,#d1d5db);border-radius:8px;box-shadow:0 10px 25px rgba(0,0,0,0.2);width:900px;max-height:85vh;display:flex;flex-direction:column;user-select:text;';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:0.75rem 1rem;border-bottom:1px solid var(--background-modifier-border,#e5e7eb);flex-shrink:0;gap:0.5rem;flex-wrap:wrap;';

        const title = document.createElement('span');
        title.style.cssText = 'font-weight:600;font-size:1rem;color:var(--text-normal,#333);';
        title.textContent = verseData.citation;
        header.appendChild(title);

        const buttonGroup = document.createElement('div');
        buttonGroup.style.cssText = 'display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;';

        const jwlibUrl = `jwlibrary:///finder?wtlocale=${langSymbol}&bible=${bcv}`;
        const jwlibBtn = this.createHeaderButton('JW Library');
        jwlibBtn.addEventListener('click', () => { window.open(jwlibUrl, '_blank'); navigator.clipboard.writeText(jwlibUrl); });
        buttonGroup.appendChild(jwlibBtn);

        const jworgUrl = `https://www.jw.org/finder?wtlocale=${langSymbol}&bible=${bcv}`;
        const jworgBtn = this.createHeaderButton('JW.ORG');
        jworgBtn.addEventListener('click', () => { window.open(jworgUrl, '_blank'); navigator.clipboard.writeText(jworgUrl); });
        buttonGroup.appendChild(jworgBtn);

        const copyBtn = this.createHeaderButton('COPY');
        copyBtn.addEventListener('click', () => {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = verseData.html;
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
            navigator.clipboard.writeText(`${verseData.citation}\n\n${text}`);
            copyBtn.textContent = 'COPIED';
            setTimeout(() => { copyBtn.textContent = 'COPY'; }, 1500);
        });
        buttonGroup.appendChild(copyBtn);

        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'color:var(--text-muted,#6b7280);font-size:1.125rem;border:none;background:none;cursor:pointer;line-height:1;padding:0 0.25rem;';
        closeBtn.textContent = '\u2715';
        closeBtn.addEventListener('click', () => this.hide());
        buttonGroup.appendChild(closeBtn);

        header.appendChild(buttonGroup);
        dialog.appendChild(header);

        const body = document.createElement('div');
        body.id = 'verse-tooltip';
        body.style.cssText = 'padding:1rem 1.25rem;overflow-y:auto;flex:1;line-height:1.6;';
        body.innerHTML = verseData.html;
        dialog.appendChild(body);

        modal.appendChild(dialog);
        document.body.appendChild(modal);
        this.modalEl = modal;
    }

    private createHeaderButton(text: string): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.style.cssText = 'font-size:0.72rem;font-weight:600;letter-spacing:0.3px;border:1px solid var(--background-modifier-border,#9ca3af);color:var(--text-normal,#374151);padding:0.3rem 0.6rem;border-radius:4px;background:var(--background-secondary,#f3f3f3);cursor:pointer;white-space:nowrap;width:85px;text-align:center;';
        btn.textContent = text;
        return btn;
    }

    hide() {
        if (this.modalEl) { this.modalEl.remove(); this.modalEl = null; }
    }
}