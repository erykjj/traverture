// modal.ts

import {
    buildJwLibraryUrl,
    buildJwOrgUrl,
    buildVerseBody,
    buildCopyText,
    buildCommentaryPane,
    attachMarkerTooltips,
} from './common';
import { VerseData } from './types';

export class VerseModal {
    private modalEl: HTMLElement | null = null;
    private currentTitle: string = '';
    private hidden: boolean = false;
    private abortController: AbortController | null = null;

    show(verseData: VerseData, bcv: string, outputLang: string, titleOverride?: string, timecodes?: string) {
        if (this.hidden) return;
        this.hide();
        this.hidden = false;
        this.abortController = new AbortController();

        this.currentTitle = titleOverride || verseData.citation;

        const jwlibUrl = buildJwLibraryUrl(bcv, outputLang, timecodes);
        const jworgUrl = buildJwOrgUrl(bcv, outputLang, timecodes);

        const modal = createDiv();
        modal.className = 'traverture-modal';
        modal.addEventListener('click', (e) => { if (e.target === modal) this.hide(); });

        const dialog = createDiv();
        dialog.className = 'traverture-modal-dialog';

        const header = createDiv();
        header.className = 'traverture-modal-header';

        const title = createSpan();
        title.className = 'traverture-modal-title';
        title.textContent = titleOverride || verseData.citation;
        header.appendChild(title);

        const buttonGroup = createDiv();
        buttonGroup.className = 'traverture-modal-buttons';

        const jwlibBtn = this.createHeaderButton('JW Library');
        jwlibBtn.addEventListener('click', () => {
            window.open(jwlibUrl, '_blank');
            void navigator.clipboard.writeText(jwlibUrl);
        });
        buttonGroup.appendChild(jwlibBtn);

        const jworgBtn = this.createHeaderButton('JW.ORG');
        jworgBtn.addEventListener('click', () => {
            window.open(jworgUrl, '_blank');
            void navigator.clipboard.writeText(jworgUrl);
        });
        buttonGroup.appendChild(jworgBtn);

        const copyBtn = this.createHeaderButton('COPY');
        copyBtn.addEventListener('click', () => {
            void navigator.clipboard.writeText(buildCopyText(verseData, this.currentTitle));
            copyBtn.textContent = 'COPIED';
            window.setTimeout(() => { copyBtn.textContent = 'COPY'; }, 1500);
        });
        buttonGroup.appendChild(copyBtn);

        const closeBtn = createEl('button');
        closeBtn.className = 'traverture-modal-close';
        closeBtn.textContent = '\u2715';
        closeBtn.addEventListener('click', () => this.hide());
        buttonGroup.appendChild(closeBtn);

        header.appendChild(buttonGroup);
        dialog.appendChild(header);

        const contentArea = createDiv();
        contentArea.className = 'traverture-modal-content';

        const body = buildVerseBody(verseData);
        attachMarkerTooltips(body, verseData);
        contentArea.appendChild(body);

        if (verseData.commentaries && verseData.commentaries.length > 0) {
            contentArea.appendChild(buildCommentaryPane(verseData.commentaries, outputLang));
        }

        dialog.appendChild(contentArea);
        modal.appendChild(dialog);
        activeDocument.body.appendChild(modal);
        this.modalEl = modal;
    }

    private createHeaderButton(text: string): HTMLButtonElement {
        const btn = createEl('button');
        btn.className = 'traverture-modal-btn';
        btn.textContent = text;
        return btn;
    }

    hide() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.hidden = true;
        if (this.modalEl) { this.modalEl.remove(); this.modalEl = null; }
    }

    isVisible(): boolean {
        return !this.hidden;
    }

    getSignal(): AbortSignal | undefined {
        return this.abortController?.signal;
    }
}