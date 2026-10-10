// scripture-pane.ts

import {
    buildJwLibraryUrl,
    buildJwOrgUrl,
    buildVerseBody,
    buildCopyText,
    buildCommentaryPane,
    attachMarkerTooltips,
} from './common';
import { fetchVerseWithExtras, getAslTimecodes } from './cache';
import { VerseData } from './types';
import type TraverturePlugin from './main';

/**
 * Vertical scripture pane intended for the sidebar.
 * Self-contained: owns its fetch lifecycle, mirrors the modal's UX.
 *
 * Usage:
 *   const pane = new ScripturePane(containerEl, plugin);
 *   await pane.render(bcv, displayText, timecodes?);
 *   pane.clear();  // to wipe
 */
export class ScripturePane {
    private container: HTMLElement;
    private plugin: TraverturePlugin;
    private abortController: AbortController | null = null;
    private currentBcv: string = '';
    private currentDisplayText: string = '';
    private currentTimecodes: string | undefined;

    constructor(container: HTMLElement, plugin: TraverturePlugin) {
        this.container = container;
        this.plugin = plugin;
    }

    clear(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.currentBcv = '';
        this.currentDisplayText = '';
        this.currentTimecodes = undefined;
        this.container.empty();
    }

    /**
     * Renders the scripture pane for the given BCV.
     * Immediately shows a loading state, then swaps in real content when the fetch resolves.
     * A second call aborts any in-flight fetch and starts fresh.
     */
    async render(bcv: string, displayText: string, timecodes?: string): Promise<void> {
        if (this.abortController) {
            this.abortController.abort();
        }
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        this.currentBcv = bcv;
        this.currentDisplayText = displayText;
        this.currentTimecodes = timecodes;

        this.renderLoading();

        let resolvedTimecodes = timecodes;
        if (this.plugin.settings.outputLanguage === 'ase' && !resolvedTimecodes) {
            resolvedTimecodes = await getAslTimecodes(bcv);
            if (signal.aborted) return;
            this.currentTimecodes = resolvedTimecodes;
        }

        const verseData = await fetchVerseWithExtras(bcv, this.plugin.settings.outputLanguage, signal);
        if (signal.aborted) return;

        this.renderContent(verseData, displayText, resolvedTimecodes);
    }

    // ──────────────────────────────────────────────
    // Rendering
    // ──────────────────────────────────────────────

    private renderLoading(): void {
        this.container.empty();
        this.container.addClass('traverture-scripture-pane');

        const header = this.container.createDiv({ cls: 'traverture-scripture-header' });
        header.createSpan({ text: this.currentDisplayText, cls: 'traverture-modal-title' });

        const body = this.container.createDiv({ cls: 'traverture-modal-body' });
        body.innerHTML = '<p><em>Loading...</em></p>';
    }

    private renderContent(verseData: VerseData | null, displayText: string, timecodes?: string): void {
        this.container.empty();
        this.container.addClass('traverture-scripture-pane');

        // ── Header ──
        const header = this.container.createDiv({ cls: 'traverture-scripture-header' });
        header.createSpan({ text: displayText, cls: 'traverture-modal-title' });

        // ── Buttons row ──
        const buttonRow = this.container.createDiv({ cls: 'traverture-scripture-buttons' });
        this.buildButtons(buttonRow, verseData, displayText, timecodes);

        // ── Verse text ──
        const body = buildVerseBody(verseData);
        if (verseData) {
            attachMarkerTooltips(body, verseData);
        }
        this.container.appendChild(body);

        // ── Study Notes ──
        if (verseData?.commentaries && verseData.commentaries.length > 0) {
            const pane = buildCommentaryPane(verseData.commentaries, this.plugin.settings.outputLanguage);
            this.container.appendChild(pane);
        }
    }

    // ──────────────────────────────────────────────
    // Buttons
    // ──────────────────────────────────────────────

    private buildButtons(
        parent: HTMLElement,
        verseData: VerseData | null,
        displayText: string,
        timecodes?: string,
    ): void {
        const bcv = this.currentBcv;
        const outputLang = this.plugin.settings.outputLanguage;

        const jwlibUrl = buildJwLibraryUrl(bcv, outputLang, timecodes);
        const jworgUrl = buildJwOrgUrl(bcv, outputLang, timecodes);

        const jwlibBtn = this.createButton('JW Library');
        jwlibBtn.addEventListener('click', () => {
            window.open(jwlibUrl, '_blank');
            void navigator.clipboard.writeText(jwlibUrl);
        });
        parent.appendChild(jwlibBtn);

        const jworgBtn = this.createButton('JW.ORG');
        jworgBtn.addEventListener('click', () => {
            window.open(jworgUrl, '_blank');
            void navigator.clipboard.writeText(jworgUrl);
        });
        parent.appendChild(jworgBtn);

        const copyBtn = this.createButton('COPY');
        copyBtn.addEventListener('click', () => {
            void navigator.clipboard.writeText(buildCopyText(verseData, displayText));
            copyBtn.textContent = 'COPIED';
            window.setTimeout(() => { copyBtn.textContent = 'COPY'; }, 1500);
        });
        parent.appendChild(copyBtn);
    }

    private createButton(text: string): HTMLButtonElement {
        const btn = createEl('button');
        btn.className = 'traverture-modal-btn';
        btn.textContent = text;
        return btn;
    }
}