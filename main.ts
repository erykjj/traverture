// main.ts

import { Plugin, WorkspaceLeaf, Notice, Menu, MarkdownView, Editor, MenuItem, TFile, TAbstractFile } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { initEngine, prewarmEngines, clearEnginePool, decodeScriptures, getAvailableLanguagesCached as getAvailableLanguages, getLangSymbol, createMainEngine, parseFrontmatterLanguage } from './engine-wrapper';
import { fetchVerseWithExtras, getAslTimecodes } from './cache';
import { createTravertureEditorPlugin } from './editor';
import { VerseModal } from './modal';
import { TravertureSettingTab } from './settings';
import { TravertureSidebarView } from './sidebar';
import { DEFAULT_SETTINGS, VIEW_TYPE_TRAVERTURE_SIDEBAR, SidebarRef, TravertureEngineInstance, NameFormat, ParsedReference, TravertureSettings } from './types';

function getSubmenu(item: MenuItem): Menu {
    return (item as unknown as { setSubmenu(): Menu }).setSubmenu();
}

export default class TraverturePlugin extends Plugin {
    settings = DEFAULT_SETTINGS;
    engine: TravertureEngineInstance | null = null;
    private processingElements = new Set<HTMLElement>();
    private sourceLangCache = new Map<string, string>();
    private sourceLangInFlight = new Map<string, Promise<string>>();
    private processedLangCache = new Map<string, string>();
    public editorRefreshGeneration = 0;

    async loadSettings() { 
        const savedData = await this.loadData() as Partial<TravertureSettings> | null;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, savedData); 
    }
    async saveSettings() { await this.saveData(this.settings); }

    createEngine() {
        this.engine = createMainEngine(this.settings.sourceLanguage, this.settings.outputLanguage);
        prewarmEngines(this.settings.sourceLanguage, this.settings.outputLanguage);
    }

    safeParse(text: string): string | null {
        return this.safeParseWith(text, this.settings.sourceLanguage);
    }

    safeParseWith(text: string, sourceLanguage: string): string | null {
        if (!this.engine) return null;
        return this.engine.parse(
            sourceLanguage,
            this.settings.outputLanguage,
            'full',
            false,
            text
        );
    }

    // ──────────────────────────────────────────────
    // Effective source language
    // ──────────────────────────────────────────────

    getEffectiveSourceLanguage(file: TFile | null, docText?: string): string {
        if (docText !== undefined) {
            const fromDoc = parseFrontmatterLanguage(docText);
            if (fromDoc) return fromDoc;
        } else if (file) {
            const cached = this.app.metadataCache.getFileCache(file);
            const raw = cached?.frontmatter?.language;
            if (typeof raw === 'string' && raw.trim()) {
                const resolved = parseFrontmatterLanguage(`---\nlanguage: ${raw}\n---`);
                if (resolved) return resolved;
            }
        }
        return this.settings.sourceLanguage;
    }

    getSourceLanguageForEditor(view: EditorView): string {
        const viewDom = view.dom;
        const leaves = this.app.workspace.getLeavesOfType('markdown');
        for (const leaf of leaves) {
            const mdView = leaf.view as MarkdownView;
            const cmDom = (mdView.editor as unknown as { cm?: { dom?: HTMLElement } })?.cm?.dom;
            if (cmDom !== viewDom) continue;
            const text = view.state.doc.sliceString(0, Math.min(2048, view.state.doc.length));
            return this.getEffectiveSourceLanguage(mdView.file, text);
        }
        return this.settings.sourceLanguage;
    }

    async getSourceLanguageForPath(sourcePath: string | null | undefined): Promise<string> {
        if (!sourcePath) return this.settings.sourceLanguage;

        const cached = this.sourceLangCache.get(sourcePath);
        if (cached !== undefined) return cached;

        const inFlight = this.sourceLangInFlight.get(sourcePath);
        if (inFlight !== undefined) return inFlight;

        const promise = (async (): Promise<string> => {
            const file = this.app.vault.getAbstractFileByPath(sourcePath);
            if (!(file instanceof TFile)) return this.settings.sourceLanguage;

            try {
                const text = await this.app.vault.read(file);
                const resolved = parseFrontmatterLanguage(text);
                if (resolved) return resolved;
            } catch {
                // fall through
            }

            return this.settings.sourceLanguage;
        })();

        this.sourceLangInFlight.set(sourcePath, promise);
        try {
            const resolved = await promise;
            this.sourceLangCache.set(sourcePath, resolved);
            return resolved;
        } finally {
            this.sourceLangInFlight.delete(sourcePath);
        }
    }

    private invalidateSourceLangCache(sourcePath: string): void {
        this.sourceLangCache.delete(sourcePath);
        this.sourceLangInFlight.delete(sourcePath);
    }

    private pruneCachesForPath(sourcePath: string): void {
        this.invalidateSourceLangCache(sourcePath);
        this.processedLangCache.delete(sourcePath);
    }

    // ──────────────────────────────────────────────
    // Refresh triggers
    // ──────────────────────────────────────────────

    public onSourceLanguageChanged(): void {
        this.sourceLangCache.clear();
        this.sourceLangInFlight.clear();
        this.editorRefreshGeneration++;
        this.refreshEditorViews();
        this.refreshReadingViews();
    }

    private refreshEditorViews(): void {
        const leaves = this.app.workspace.getLeavesOfType('markdown');
        for (const leaf of leaves) {
            const view = leaf.view as MarkdownView;
            if (!view) continue;
            const cm = (view.editor as unknown as { cm?: { dispatch?: (spec: unknown) => void } }).cm;
            if (cm?.dispatch) {
                cm.dispatch({});
            }
        }
    }

    public refreshReadingViews(): void {
        const leaves = this.app.workspace.getLeavesOfType('markdown');
        for (const leaf of leaves) {
            const view = leaf.view as MarkdownView;
            if (!view || view.getMode() !== 'preview') continue;
            const path = view.file?.path;
            if (!path) continue;

            void this.getSourceLanguageForPath(path).then((lang) => {
                const lastLang = this.processedLangCache.get(path);
                if (lastLang === lang) return;

                // Optimistically mark as processed so layout-change events
                // from the leaf rebuild below do not loop.
                this.processedLangCache.set(path, lang);

                void this.forceRerenderLeaf(leaf);
            });
        }
    }

    private async forceRerenderLeaf(leaf: WorkspaceLeaf): Promise<void> {
        const view = leaf.view as MarkdownView;
        if (!view) return;

        const state = view.getState();
        const viewType = view.getViewType();

        const container = view.previewMode?.containerEl;
        const scroller = container?.querySelector('.markdown-preview-view');
        const scrollTop = scroller instanceof HTMLElement ? scroller.scrollTop : 0;

        await leaf.setViewState({ type: 'empty' });
        await leaf.setViewState({ type: viewType, state });

        window.setTimeout(() => {
            const newView = leaf.view as MarkdownView;
            const newContainer = newView?.previewMode?.containerEl;
            const newScroller = newContainer?.querySelector('.markdown-preview-view');
            if (newScroller instanceof HTMLElement) {
                newScroller.scrollTop = scrollTop;
            }
        }, 100);
    }

    private stripFrontmatter(content: string): string {
        if (content.startsWith('---')) {
            const endIndex = content.indexOf('---', 3);
            if (endIndex !== -1) {
                return content.substring(endIndex + 3);
            }
        }
        return content;
    }

    // ──────────────────────────────────────────────
    // Parsing / sidebar results
    // ──────────────────────────────────────────────

    async parseReferences(text: string, sourceLang: string): Promise<SidebarRef[]> {
        const results: SidebarRef[] = [];
        if (!this.engine) return results;

        text = this.stripFrontmatter(text);
        const engineText = text.replace(/\{\{(.+?)\}\}/g, '⟪$1⟫');
        const parsed = this.safeParseWith(engineText, sourceLang);
        if (!parsed) return results;

        const clauses = JSON.parse(parsed) as ParsedReference[];
        if (clauses.length === 0) return results;

        for (const [clauseText] of clauses) {
            const ranges = clauses.find(c => c[0] === clauseText)?.[3] || [];
            if (ranges.length === 0) continue;

            for (const range of ranges) {
                const singleRange: Array<[string, string]> = [[range[0], range[1]]];
                const fullDecoded = decodeScriptures(singleRange, 'en', 'full');
                const stdDecoded = decodeScriptures(singleRange, 'en', 'standard');
                const offDecoded = decodeScriptures(singleRange, 'en', 'official');
                const startBcv = range[0], endBcv = range[1];
                const bookNum = parseInt(startBcv.substring(0, 2));

                results.push({
                    scripture: clauseText,
                    fullRef: fullDecoded?.[0] || clauseText,
                    standardRef: stdDecoded?.[0] || '',
                    officialRef: offDecoded?.[0] || '',
                    startBcv, endBcv,
                    startCh: parseInt(startBcv.substring(2, 5)),
                    endCh: parseInt(endBcv.substring(2, 5)),
                    startVerse: parseInt(startBcv.substring(5, 8)),
                    endVerse: parseInt(endBcv.substring(5, 8)),
                    bookNum,
                    sourceLanguage: sourceLang,
                });
            }
        }
        return results;
    }

    async parseBcvs(bcvs: string[]): Promise<SidebarRef[]> {
        const results: SidebarRef[] = [];
        for (const bcv of bcvs) {
            const parts = bcv.split('-');
            const startBcv = parts[0];
            const endBcv = parts.length > 1 ? parts[1] : parts[0];
            const singleRange: Array<[string, string]> = [[startBcv, endBcv]];
            const fullDecoded = decodeScriptures(singleRange, 'en', 'full');
            const stdDecoded = decodeScriptures(singleRange, 'en', 'standard');
            const offDecoded = decodeScriptures(singleRange, 'en', 'official');
            const bookNum = parseInt(startBcv.substring(0, 2));
            results.push({
                scripture: fullDecoded?.[0] || bcv,
                fullRef: fullDecoded?.[0] || bcv,
                standardRef: stdDecoded?.[0] || '',
                officialRef: offDecoded?.[0] || '',
                startBcv, endBcv,
                startCh: parseInt(startBcv.substring(2, 5)),
                endCh: parseInt(endBcv.substring(2, 5)),
                startVerse: parseInt(startBcv.substring(5, 8)),
                endVerse: parseInt(endBcv.substring(5, 8)),
                bookNum,
                sourceLanguage: 'en',
            });
        }
        return results;
    }

    async showSidebarWithResults(refs: SidebarRef[]) {
        const { workspace } = this.app;
        let leaves = workspace.getLeavesOfType(VIEW_TYPE_TRAVERTURE_SIDEBAR);
        let leaf: WorkspaceLeaf;
        if (leaves.length > 0) { leaf = leaves[0]; }
        else { const rightLeaf = workspace.getRightLeaf(false); if (!rightLeaf) return; await rightLeaf.setViewState({ type: VIEW_TYPE_TRAVERTURE_SIDEBAR, active: true }); leaf = rightLeaf; }
        await leaf.loadIfDeferred();
        void workspace.revealLeaf(leaf);
        void (leaf.view as TravertureSidebarView).displayResults(refs);
    }

    // ──────────────────────────────────────────────
    // Reading View post-processor
    // ──────────────────────────────────────────────

    async processElement(el: HTMLElement, sourcePath?: string) {
        if (el.querySelector('.callout, svg')) return;
        if (this.processingElements.has(el)) return;
        this.processingElements.add(el);

        const sourceLang = await this.getSourceLanguageForPath(sourcePath);
        let html = el.innerHTML;

        // Process {{ }} blocks (forced parsing)
        if (/\{\{(.+?)\}\}/g.test(html)) {
            html = html.replace(/\{\{(.+?)\}\}/g, (_fullMatch: string, inner: string) => {
                if (!this.engine) return _fullMatch;

                const refText = inner.replace(/\*\*/g, '').replace(/\*/g, '');
                const engineInput = '⟪⟪' + refText + '⟫⟫';
                const parsed = this.safeParseWith(engineInput, sourceLang);
                if (!parsed) return inner;
                const clauses = JSON.parse(parsed) as ParsedReference[];
                if (clauses.length === 0) return inner;

                let result = inner;
                let bookName = '';
                const sorted = [...clauses].sort((a, b) => b[0].length - a[0].length);

                for (let i = 0; i < sorted.length; i++) {
                    const [clauseText, , , ranges] = sorted[i];
                    const origIndex = clauses.indexOf(sorted[i]);

                    if (origIndex === 0) {
                        const match = clauseText.match(/^(.+?)\s+\d/);
                        if (match) bookName = match[1];
                    }

                    let displayText = clauseText;
                    if (/^\d/.test(clauseText) && !/^\d+\s*[a-zA-Z]/.test(clauseText) && bookName && !clauseText.startsWith(bookName)) {
                        displayText = `${bookName} ${clauseText}`;
                    }

                    for (const range of ranges) {
                        const bcv = range[0] === range[1] ? range[0] : `${range[0]}-${range[1]}`;
                        const link = `<a class="traverture-ref-link" data-bcv="${bcv}" data-ref="${displayText}">${clauseText}</a>`;
                        const escaped = clauseText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                        if (/^\d+$/.test(clauseText)) {
                            const regex = new RegExp(`(^|[\\s,;])${escaped}(?=[\\s,;]|$)`, 'g');
                            result = result.replace(regex, `$1${link}`);
                        } else {
                            result = result.replace(new RegExp(escaped), link);
                        }
                        break;
                    }
                }
                return result;
            });
        }

        // Auto-detect references in remaining text
        if (this.settings.autoDetect && this.engine) {
            const tempDiv = createDiv();
            const parsedHtml = new DOMParser().parseFromString(html, 'text/html');
            for (const child of Array.from(parsedHtml.body.childNodes)) {
                tempDiv.appendChild(child.cloneNode(true));
            }
            const walker = activeDocument.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT, {
                acceptNode: (node) => {
                    const parent = node.parentElement;
                    if (parent?.tagName === 'A' && parent.classList.contains('traverture-ref-link')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            });

            const textNodes: Text[] = [];
            let node = walker.nextNode();
            while (node) { textNodes.push(node as Text); node = walker.nextNode(); }

            for (const textNode of textNodes) {
                const text = textNode.nodeValue || '';
                const parsed = this.safeParseWith(text, sourceLang);
                if (!parsed) continue;
                const clauses = JSON.parse(parsed) as ParsedReference[];
                if (clauses.length === 0) continue;

                const linked = this.insertLinks(text, clauses);
                if (linked !== text) {
                    const fragment = createFragment();
                    const span = createSpan();
                    const parsedLinked = new DOMParser().parseFromString(linked, 'text/html');
                    for (const child of Array.from(parsedLinked.body.childNodes)) {
                        fragment.appendChild(child.cloneNode(true));
                    }
                    while (span.firstChild) fragment.appendChild(span.firstChild);
                    textNode.parentNode?.replaceChild(fragment, textNode);
                }
            }
            html = tempDiv.innerHTML;
        }

        // Replace element content
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        while (el.firstChild) el.removeChild(el.firstChild);
        for (const child of Array.from(parsed.body.childNodes)) {
            el.appendChild(child.cloneNode(true));
        }

        // Re-attach click handlers
        el.querySelectorAll('.traverture-ref-link').forEach(link => {
            link.addEventListener('click', (e) => { void (async () => {
                if ((e as MouseEvent).button !== 0) return;
                const bcv = link.getAttribute('data-bcv')!;
                if ((e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey) {
                    const langSymbol = getLangSymbol(this.settings.outputLanguage);
                    window.open(`jwlibrary:///finder?wtlocale=${langSymbol}&bible=${bcv}`, '_blank');
                    return;
                }
                e.preventDefault(); e.stopPropagation();
                const decoded = decodeScriptures([[bcv, bcv]], this.settings.outputLanguage, this.settings.titleFormat);
                const refText = decoded?.[0] || link.textContent || '';
                const timecodes = this.settings.outputLanguage === 'ase'
                    ? await getAslTimecodes(bcv)
                    : undefined;
                const modal = new VerseModal();
                modal.show({ html: `<p><em>Loading...</em></p>`, citation: refText }, bcv, this.settings.outputLanguage, refText, timecodes);
                const verseData = await fetchVerseWithExtras(bcv, this.settings.outputLanguage, modal.getSignal());
                if (!modal.isVisible()) return;
                modal.show(verseData || { html: `<p><em>Verse lookup unavailable</em></p>`, citation: refText }, bcv, this.settings.outputLanguage, refText, timecodes);
            })(); });
        });

        if (sourcePath) {
            this.processedLangCache.set(sourcePath, sourceLang);
        }

        this.processingElements.delete(el);
    }

    private insertLinks(text: string, clauses: ParsedReference[]): string {
        if (clauses.length === 0) return text;

        const positions: Array<{ start: number; end: number; displayText: string; bcv: string; clauseText: string }> = [];
        let bookName = '';

        for (let i = 0; i < clauses.length; i++) {
            const [clauseText, startPos, endPos, ranges] = clauses[i];

            if (i === 0 || !/^\d/.test(clauseText)) {
                const match = clauseText.match(/^(.+?)\s+\d/);
                if (match) bookName = match[1];
            }

            let displayText = clauseText;
            if (/^\d/.test(clauseText) && !/^\d+\s*[a-zA-Z]/.test(clauseText) && bookName && !clauseText.startsWith(bookName)) {
                displayText = `${bookName} ${clauseText}`;
            }

            if (ranges.length === 0) continue;
            const bcv = ranges[0][0] === ranges[0][1] ? ranges[0][0] : `${ranges[0][0]}-${ranges[0][1]}`;

            positions.push({ start: startPos, end: endPos, displayText, bcv, clauseText });
        }

        if (positions.length === 0) return text;
        positions.sort((a, b) => a.start - b.start);

        let result = '';
        let pos = 0;

        for (const p of positions) {
            if (p.start < pos) continue;
            result += text.substring(pos, p.start);
            const link = `<a class="traverture-ref-link" data-bcv="${p.bcv}" data-ref="${p.displayText}">${text.substring(p.start, p.end)}</a>`;
            result += link;
            pos = p.end;
        }
        result += text.substring(pos);
        return result;
    }

    // ──────────────────────────────────────────────
    // Reformat / insert
    // ──────────────────────────────────────────────

    reformatReferences(editor: Editor, text: string, format: NameFormat, sourceLang: string, wholeDoc: boolean = false) {
        const parsed = this.safeParseWith(text, sourceLang);
        if (!parsed) return;

        const clauses = JSON.parse(parsed) as ParsedReference[];
        if (clauses.length === 0) return;

        let processed = text;

        for (let i = clauses.length - 1; i >= 0; i--) {
            const [, startPos, endPos, ranges] = clauses[i];
            if (ranges.length === 0) continue;

            const decoded = decodeScriptures([ranges[0] as [string, string]], sourceLang, format);
            const formattedRef = decoded?.[0] || '';
            if (!formattedRef) continue;

            const before = processed.substring(0, startPos);
            const after = processed.substring(endPos);
            processed = before + formattedRef + after;
        }

        if (wholeDoc) { editor.setValue(processed); }
        else { editor.replaceSelection(processed); }
    }

    async insertCitation(editor: Editor, text: string, withRef: boolean, sourceLang: string) {
        const engineText = text.replace(/\{\{(.+?)\}\}/g, '⟪$1⟫');
        const parsed = this.safeParseWith(engineText, sourceLang);
        if (!parsed) { new Notice('No scripture references found.'); return; }
        const clauses = JSON.parse(parsed) as ParsedReference[];
        if (clauses.length === 0) { new Notice('No scripture references found.'); return; }
        let result = text;
        const fetchedCache = new Map<string, string>();
        for (let i = clauses.length - 1; i >= 0; i--) {
            const [clauseText, , , ranges] = clauses[i];
            if (ranges.length === 0) continue;
            let origStart = text.indexOf('{{' + clauseText + '}}');
            let origLength: number;
            let originalRef: string;
            if (origStart !== -1) {
                origLength = clauseText.length + 4;
                originalRef = '{{' + clauseText + '}}';
            } else {
                origStart = text.indexOf(clauseText);
                if (origStart === -1) continue;
                origLength = clauseText.length;
                originalRef = clauseText;
            }
            const bcv = ranges[0][0] === ranges[0][1] ? ranges[0][0] : `${ranges[0][0]}-${ranges[0][1]}`;
            const cacheKey = `${this.settings.outputLanguage}:${bcv}`;
            let verseText = fetchedCache.get(cacheKey);
            if (verseText === undefined) {
                const verseData = await fetchVerseWithExtras(bcv, this.settings.outputLanguage);
                if (verseData) {
                    let html = verseData.html.replace(/<span class="parabreak"><\/span>/g, ' ').replace(/<span class="newblock"><\/span>/g, ' ');
                    const tempDiv = createDiv();
                    const parsedHtml = new DOMParser().parseFromString(html, 'text/html');
                    for (const child of Array.from(parsedHtml.body.childNodes)) {
                        tempDiv.appendChild(child.cloneNode(true));
                    }
                    if (withRef) {
                        tempDiv.querySelectorAll('sup.verseNum, .chapterNum').forEach(el => el.remove());
                    } else {
                        tempDiv.querySelectorAll('.chapterNum').forEach(el => {
                            const textNode = el.querySelector('a') || el;
                            if (textNode) textNode.textContent = '1 ';
                        });
                    }
                    verseText = (tempDiv.textContent || '').replace(/\u00A0/g, ' ').replace(/\u202F/g, ' ').replace(/\+/g, '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
                    fetchedCache.set(cacheKey, verseText);
                } else {
                    fetchedCache.set(cacheKey, '');
                }
            }
            if (verseText) {
                const before = result.substring(0, origStart);
                const after = result.substring(origStart + origLength);
                result = before + (withRef ? `"${verseText}" (${originalRef})` : `${originalRef}: "${verseText}"`) + after;
            }
        }
        editor.replaceSelection(result);
    }

    // ──────────────────────────────────────────────
    // Menu
    // ──────────────────────────────────────────────

    showTravertureMenu(sourceLang: string): Menu {
        const file = this.app.workspace.getActiveFile();
        const editor = this.app.workspace.activeEditor?.editor;
        const sel = editor?.getSelection();
        const menu = new Menu();

        if (sel) {
            menu.addItem((item: MenuItem) => item.setTitle('Parse selection').setIcon('sidebar-right').onClick(async () => {
                await this.showSidebarWithResults(await this.parseReferences(sel, sourceLang));
            }));
            menu.addItem((item: MenuItem) => {
                item.setTitle('Insert citation').setIcon('quote-glyph');
                const citeMenu = getSubmenu(item);
                citeMenu.addItem((citeItem: MenuItem) => citeItem.setTitle('Reference: "verse"').onClick(async () => {
                    if (editor && sel) await this.insertCitation(editor, sel, false, sourceLang);
                }));
                citeMenu.addItem((citeItem: MenuItem) => citeItem.setTitle('"verse" (Reference)').onClick(async () => {
                    if (editor && sel) await this.insertCitation(editor, sel, true, sourceLang);
                }));
            });
            menu.addItem((item: MenuItem) => {
                item.setTitle('Reformat selection').setIcon('pencil');
                const submenu = getSubmenu(item);
                submenu.addItem((fmtItem: MenuItem) => fmtItem.setTitle('Full (1 Corinthians)').onClick(() => this.reformatReferences(editor!, sel, 'full', sourceLang)));
                submenu.addItem((fmtItem: MenuItem) => fmtItem.setTitle('Standard (1 Cor.)').onClick(() => this.reformatReferences(editor!, sel, 'standard', sourceLang)));
                submenu.addItem((fmtItem: MenuItem) => fmtItem.setTitle('Official (1Co)').onClick(() => this.reformatReferences(editor!, sel, 'official', sourceLang)));
            });
            menu.addSeparator();
        }

        menu.addItem((item: MenuItem) => item.setTitle('Parse document').setIcon('sidebar-right').onClick(async () => {
            if (!file) { new Notice('No file open.'); return; }
            const content = this.stripFrontmatter(await this.app.vault.read(file));
            await this.showSidebarWithResults(await this.parseReferences(content, sourceLang));
        }));
        menu.addItem((item: MenuItem) => {
            item.setTitle('Reformat document').setIcon('pencil');
            const submenu = getSubmenu(item);
            submenu.addItem((fmtItem: MenuItem) => fmtItem.setTitle('Full (1 Corinthians)').onClick(() => {
                if (editor) this.reformatReferences(editor, editor.getValue(), 'full', sourceLang, true);
            }));
            submenu.addItem((fmtItem: MenuItem) => fmtItem.setTitle('Standard (1 Cor.)').onClick(() => {
                if (editor) this.reformatReferences(editor, editor.getValue(), 'standard', sourceLang, true);
            }));
            submenu.addItem((fmtItem: MenuItem) => fmtItem.setTitle('Official (1Co)').onClick(() => {
                if (editor) this.reformatReferences(editor, editor.getValue(), 'official', sourceLang, true);
            }));
        });
        menu.addSeparator();

        menu.addItem((item: MenuItem) => {
            item.setTitle('Source language').setIcon('book-open');
            const langMenu = getSubmenu(item);
            const languages = getAvailableLanguages().filter(l => l.code !== 'ase');
            for (const lang of languages) {
                langMenu.addItem((langItem: MenuItem) => langItem
                    .setTitle(`${lang.vernacularName} (${lang.code})`)
                    .setChecked(lang.code === this.settings.sourceLanguage)
                    .onClick(async () => {
                        this.settings.sourceLanguage = lang.code;
                        await this.saveSettings();
                        this.createEngine();
                        this.onSourceLanguageChanged();
                        new Notice(`Source language: ${lang.vernacularName}`);
                    }));
            }
        });

        menu.addItem((item: MenuItem) => {
            item.setTitle('Output language').setIcon('languages');
            const langMenu = getSubmenu(item);
            const languages = getAvailableLanguages();
            for (const lang of languages) {
                langMenu.addItem((langItem: MenuItem) => langItem
                    .setTitle(`${lang.vernacularName} (${lang.code})`)
                    .setChecked(lang.code === this.settings.outputLanguage)
                    .onClick(async () => {
                        this.settings.outputLanguage = lang.code;
                        await this.saveSettings();
                        this.createEngine();
                        new Notice(`Output language: ${lang.vernacularName}`);
                    }));
            }
        });

        return menu;
    }

    // ──────────────────────────────────────────────
    // Lifecycle
    // ──────────────────────────────────────────────

    applyLinkColor(): void {
        const color = this.settings.linkColor;
        const root = activeDocument.documentElement;
        if (color && color.trim() !== '') {
            root.style.setProperty('--traverture-link-color', color.trim());
        } else {
            root.style.removeProperty('--traverture-link-color');
        }
    }

    async onload() {
        await this.loadSettings();
        this.applyLinkColor();

        try { await initEngine(this.app); this.createEngine(); }
        catch (e) { console.error('tra.VER:ture: WASM error:', e); }

        this.addSettingTab(new TravertureSettingTab(this.app, this));
        this.registerView(VIEW_TYPE_TRAVERTURE_SIDEBAR, (leaf) => new TravertureSidebarView(leaf, this));

        this.registerEditorExtension(createTravertureEditorPlugin(this));

        this.registerMarkdownPostProcessor((element, ctx) => {
            void this.processElement(element, ctx.sourcePath);
        });

        this.registerEvent(this.app.workspace.on('layout-change', () => {
            this.refreshReadingViews();
        }));

        this.registerEvent(this.app.metadataCache.on('changed', (file) => {
            this.invalidateSourceLangCache(file.path);
            this.refreshReadingViews();
        }));

        this.registerEvent(this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
            this.pruneCachesForPath(oldPath);
            if (file instanceof TFile) this.pruneCachesForPath(file.path);
        }));

        this.registerEvent(this.app.vault.on('delete', (file: TAbstractFile) => {
            this.pruneCachesForPath(file.path);
        }));

        this.registerEvent(this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, _view) => {
            const selection = editor.getSelection();
            const activeFile = this.app.workspace.getActiveFile();
            const sourceLang = this.getEffectiveSourceLanguage(activeFile, editor.getValue());
            menu.addItem((item: MenuItem) => {
                item.setTitle('tra.VER:ture').setIcon('book-open');
                const submenu = getSubmenu(item);

                if (selection) {
                    submenu.addItem((subItem: MenuItem) => subItem.setTitle('Parse selection').setIcon('sidebar-right').onClick(async () => { await this.showSidebarWithResults(await this.parseReferences(selection, sourceLang)); }));
                    submenu.addItem((subItem: MenuItem) => {
                        subItem.setTitle('Insert citation').setIcon('quote-glyph');
                        const citeMenu = getSubmenu(subItem);
                        citeMenu.addItem((citeItem: MenuItem) => citeItem.setTitle('Reference: "verse"').onClick(async () => { await this.insertCitation(editor, selection, false, sourceLang); }));
                        citeMenu.addItem((citeItem: MenuItem) => citeItem.setTitle('"verse" (Reference)').onClick(async () => { await this.insertCitation(editor, selection, true, sourceLang); }));
                    });
                    submenu.addItem((subItem: MenuItem) => {
                        subItem.setTitle('Reformat selection').setIcon('pencil');
                        const reformatMenu = getSubmenu(subItem);
                        reformatMenu.addItem((fmtItem: MenuItem) => fmtItem.setTitle('Full (1 Corinthians)').onClick(() => this.reformatReferences(editor, selection, 'full', sourceLang)));
                        reformatMenu.addItem((fmtItem: MenuItem) => fmtItem.setTitle('Standard (1 Cor.)').onClick(() => this.reformatReferences(editor, selection, 'standard', sourceLang)));
                        reformatMenu.addItem((fmtItem: MenuItem) => fmtItem.setTitle('Official (1Co)').onClick(() => this.reformatReferences(editor, selection, 'official', sourceLang)));
                    });
                    submenu.addSeparator();
                }

                submenu.addItem((subItem: MenuItem) => subItem.setTitle('Parse document').setIcon('sidebar-right').onClick(async () => { await this.showSidebarWithResults(await this.parseReferences(editor.getValue(), sourceLang)); }));
                submenu.addItem((subItem: MenuItem) => {
                    subItem.setTitle('Reformat document').setIcon('pencil');
                    const reformatMenu = getSubmenu(subItem);
                    reformatMenu.addItem((fmtItem: MenuItem) => fmtItem.setTitle('Full (1 Corinthians)').onClick(() => this.reformatReferences(editor, editor.getValue(), 'full', sourceLang, true)));
                    reformatMenu.addItem((fmtItem: MenuItem) => fmtItem.setTitle('Standard (1 Cor.)').onClick(() => this.reformatReferences(editor, editor.getValue(), 'standard', sourceLang, true)));
                    reformatMenu.addItem((fmtItem: MenuItem) => fmtItem.setTitle('Official (1Co)').onClick(() => this.reformatReferences(editor, editor.getValue(), 'official', sourceLang, true)));
                });

                submenu.addSeparator();

                submenu.addItem((subItem: MenuItem) => {
                    subItem.setTitle('Source language').setIcon('book-open');
                    const langMenu = getSubmenu(subItem);
                    const languages = getAvailableLanguages().filter(l => l.code !== 'ase');
                    for (const lang of languages) {
                        langMenu.addItem((langItem: MenuItem) => langItem
                            .setTitle(`${lang.vernacularName} (${lang.code})`)
                            .setChecked(lang.code === this.settings.sourceLanguage)
                            .onClick(async () => {
                                this.settings.sourceLanguage = lang.code;
                                await this.saveSettings();
                                this.createEngine();
                                this.onSourceLanguageChanged();
                                new Notice(`Source language: ${lang.vernacularName}`);
                            }));
                    }
                });

                submenu.addItem((subItem: MenuItem) => {
                    subItem.setTitle('Output language').setIcon('languages');
                    const langMenu = getSubmenu(subItem);
                    const languages = getAvailableLanguages();
                    for (const lang of languages) {
                        langMenu.addItem((langItem: MenuItem) => langItem
                            .setTitle(`${lang.vernacularName} (${lang.code})`)
                            .setChecked(lang.code === this.settings.outputLanguage)
                            .onClick(async () => {
                                this.settings.outputLanguage = lang.code;
                                await this.saveSettings();
                                this.createEngine();
                                new Notice(`Output language: ${lang.vernacularName}`);
                            }));
                    }
                });
            });
        }));

        this.registerDomEvent(activeDocument, 'contextmenu', (evt: MouseEvent) => {
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!view || view.getMode() !== 'preview') return;
            const sourceLang = view.file ? this.getEffectiveSourceLanguage(view.file) : this.settings.sourceLanguage;
            const domSelection = activeDocument.getSelection();
            let bcvs: string[] = [];
            let hasSelection = false;
            if (domSelection && domSelection.rangeCount > 0 && !domSelection.isCollapsed) {
                hasSelection = true;
                const range = domSelection.getRangeAt(0);
                const container = range.commonAncestorContainer;
                const parentEl = container.nodeType === Node.TEXT_NODE ? container.parentElement : container as HTMLElement;
                const links = parentEl?.querySelectorAll?.('.traverture-ref-link') || [];
                links.forEach((link: Element) => {
                    if (domSelection.containsNode(link, true)) {
                        const bcv = link.getAttribute('data-bcv');
                        if (bcv) bcvs.push(bcv);
                    }
                });
            }

            evt.preventDefault();
            evt.stopPropagation();

            const menu = new Menu();
            menu.addItem((item: MenuItem) => {
                item.setTitle('tra.VER:ture').setIcon('book-open');
                const submenu = getSubmenu(item);
                if (hasSelection) {
                    submenu.addItem((subItem: MenuItem) => subItem.setTitle('Parse selection').setIcon('sidebar-right').onClick(async () => {
                        if (bcvs.length > 0) {
                            await this.showSidebarWithResults(await this.parseBcvs(bcvs));
                        } else {
                            const textSelection = domSelection?.toString() || '';
                            await this.showSidebarWithResults(await this.parseReferences(textSelection, sourceLang));
                        }
                    }));
                }

                submenu.addItem((subItem: MenuItem) => subItem.setTitle('Parse document').setIcon('sidebar-right').onClick(async () => {
                    const file = view.file;
                    if (!file) return;
                    const content = this.stripFrontmatter(await this.app.vault.read(file));
                    await this.showSidebarWithResults(await this.parseReferences(content, sourceLang));
                }));

                submenu.addSeparator();

                submenu.addItem((subItem: MenuItem) => {
                    subItem.setTitle('Source language').setIcon('book-open');
                    const langMenu = getSubmenu(subItem);
                    const languages = getAvailableLanguages().filter(l => l.code !== 'ase');
                    for (const lang of languages) {
                        langMenu.addItem((langItem: MenuItem) => langItem
                            .setTitle(`${lang.vernacularName} (${lang.code})`)
                            .setChecked(lang.code === this.settings.sourceLanguage)
                            .onClick(async () => {
                                this.settings.sourceLanguage = lang.code;
                                await this.saveSettings();
                                this.createEngine();
                                this.onSourceLanguageChanged();
                                new Notice(`Source language: ${lang.vernacularName}`);
                            }));
                    }
                });

                submenu.addItem((subItem: MenuItem) => {
                    subItem.setTitle('Output language').setIcon('languages');
                    const langMenu = getSubmenu(subItem);
                    const languages = getAvailableLanguages();
                    for (const lang of languages) {
                        langMenu.addItem((langItem: MenuItem) => langItem
                            .setTitle(`${lang.vernacularName} (${lang.code})`)
                            .setChecked(lang.code === this.settings.outputLanguage)
                            .onClick(async () => {
                                this.settings.outputLanguage = lang.code;
                                await this.saveSettings();
                                this.createEngine();
                                new Notice(`Output language: ${lang.vernacularName}`);
                            }));
                    }
                });
            });
            menu.showAtMouseEvent(evt);
        });

        this.addRibbonIcon('scroll', 'tra.VER:ture', () => {
            const sourceLang = this.getEffectiveSourceLanguage(this.app.workspace.getActiveFile());
            this.showTravertureMenu(sourceLang).showAtMouseEvent({ clientX: 100, clientY: 100 } as MouseEvent);
        });

        this.addCommand({ id: 'open-menu', name: 'tra.VER:ture: Open menu', icon: 'scroll', editorCallback: (editor: Editor) => {
            const sourceLang = this.getEffectiveSourceLanguage(this.app.workspace.getActiveFile(), editor.getValue());
            this.showTravertureMenu(sourceLang).showAtMouseEvent({ clientX: 100, clientY: 100 } as MouseEvent);
        }});

        this.addCommand({ id: 'parse-document-references', name: 'tra.VER:ture: Parse document', icon: 'file-text', callback: async () => {
            const file = this.app.workspace.getActiveFile(); if (!file) return;
            const sourceLang = this.getEffectiveSourceLanguage(file);
            const content = this.stripFrontmatter(await this.app.vault.read(file));
            await this.showSidebarWithResults(await this.parseReferences(content, sourceLang));
        }});

        this.addCommand({ id: 'parse-selection-references', name: 'tra.VER:ture: Parse selection', icon: 'sidebar-right', editorCallback: async (editor: Editor) => {
            const selection = editor.getSelection(); if (!selection) return;
            const sourceLang = this.getEffectiveSourceLanguage(this.app.workspace.getActiveFile(), editor.getValue());
            await this.showSidebarWithResults(await this.parseReferences(selection, sourceLang));
        }});

        this.addCommand({ id: 'insert-citation-ref', name: 'tra.VER:ture: Insert citation (Reference)', icon: 'quote-glyph', editorCallback: async (editor: Editor) => {
            const selection = editor.getSelection(); if (!selection) return;
            const sourceLang = this.getEffectiveSourceLanguage(this.app.workspace.getActiveFile(), editor.getValue());
            await this.insertCitation(editor, selection, false, sourceLang);
        }});

        this.addCommand({ id: 'insert-citation-verse', name: 'tra.VER:ture: Insert citation (verse)', icon: 'quote-glyph', editorCallback: async (editor: Editor) => {
            const selection = editor.getSelection(); if (!selection) return;
            const sourceLang = this.getEffectiveSourceLanguage(this.app.workspace.getActiveFile(), editor.getValue());
            await this.insertCitation(editor, selection, true, sourceLang);
        }});

        this.addCommand({ id: 'reformat-full', name: 'tra.VER:ture: Reformat (Full)', icon: 'pencil', editorCallback: (editor: Editor) => {
            const selection = editor.getSelection(); if (!selection) return;
            const sourceLang = this.getEffectiveSourceLanguage(this.app.workspace.getActiveFile(), editor.getValue());
            this.reformatReferences(editor, selection, 'full', sourceLang);
        }});

        this.addCommand({ id: 'reformat-standard', name: 'tra.VER:ture: Reformat (Standard)', icon: 'pencil', editorCallback: (editor: Editor) => {
            const selection = editor.getSelection(); if (!selection) return;
            const sourceLang = this.getEffectiveSourceLanguage(this.app.workspace.getActiveFile(), editor.getValue());
            this.reformatReferences(editor, selection, 'standard', sourceLang);
        }});

        this.addCommand({ id: 'reformat-official', name: 'tra.VER:ture: Reformat (Official)', icon: 'pencil', editorCallback: (editor: Editor) => {
            const selection = editor.getSelection(); if (!selection) return;
            const sourceLang = this.getEffectiveSourceLanguage(this.app.workspace.getActiveFile(), editor.getValue());
            this.reformatReferences(editor, selection, 'official', sourceLang);
        }});
    }

    onunload() {
        clearEnginePool();
    }
}