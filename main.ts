// main.ts

import { Plugin, WorkspaceLeaf, Notice, Menu, MarkdownView, Editor, EditorPosition, MenuItem, TFile, TAbstractFile } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { fetchVerseWithExtras, escapeHtml } from './cache';
import { buildJwLibraryUrl, resolveClickContext } from './common';
import { createTravertureEditorPlugin } from './editor';
import { initEngine, prewarmEngines, clearEnginePool, decodeScriptures, reformatScriptures, getAvailableLanguagesCached as getAvailableLanguages, createMainEngine, parseFrontmatterLanguage, resolveLanguage } from './engine-wrapper';
import { TravertureSettingTab } from './settings';
import { TravertureSidebarView } from './sidebar';
import { DEFAULT_SETTINGS, VIEW_TYPE_TRAVERTURE_SIDEBAR, SidebarRef, TravertureEngineInstance, NameFormat, ParsedReference, TravertureSettings } from './types';

function parseFragment(html: string): Document {
    return new DOMParser().parseFromString('<body>' + html, 'text/html');
}

function getSubmenu(item: MenuItem): Menu {
    return (item as unknown as { setSubmenu(): Menu }).setSubmenu();
}

interface CitationGroup {
    start: number;
    end: number;
    bcvs: string[];
    prefix: string;
}

interface CitationEdit {
    start: number;
    end: number;
    replacement: string;
}

function isInsideTripleEmphasis(node: Node): boolean {
    const el = node.parentElement;
    if (!el) return false;
    return !!el.closest('strong > em, em > strong');
}

function stripMarkup(html: string): { clean: string; origIndex: number[] } {
    let clean = '';
    const origIndex: number[] = [];
    let i = 0;
    while (i < html.length) {
        const ch = html[i];
        if (ch === '<') {
            const close = html.indexOf('>', i);
            if (close !== -1) { i = close + 1; continue; }
        }
        if (ch !== '*') {
            clean += ch;
            origIndex.push(i);
        }
        i++;
    }
    return { clean, origIndex };
}

function toEngineText(original: string): { text: string; origIndex: number[] } {
    let text = '';
    const origIndex: number[] = [];
    let last = 0;
    const blockPattern = /\{\{(.+?)\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = blockPattern.exec(original)) !== null) {
        for (let i = last; i < m.index; i++) { text += original[i]; origIndex.push(i); }
        text += '\u27EA'; origIndex.push(m.index);
        const innerStart = m.index + 2;
        for (let i = 0; i < m[1].length; i++) { text += m[1][i]; origIndex.push(innerStart + i); }
        text += '\u27EB'; origIndex.push(innerStart + m[1].length);
        last = m.index + m[0].length;
    }
    for (let i = last; i < original.length; i++) { text += original[i]; origIndex.push(i); }
    return { text, origIndex };
}

function locateInText(engineText: string, clauses: ParsedReference[]): Array<{ start: number; end: number } | null> {
    const { text, engineIndex } = withoutMarkers(engineText);
    const spans: Array<{ start: number; end: number } | null> = [];
    let searchFrom = 0;
    for (const [clauseText, startPos, endPos] of clauses) {
        let start = startPos;
        let end = endPos;
        if (start < 0 || end > text.length || end <= start || text.substring(start, end) !== clauseText) {
            let found = text.indexOf(clauseText, searchFrom);
            if (found === -1) found = text.indexOf(clauseText);
            if (found === -1) { spans.push(null); continue; }
            start = found;
            end = found + clauseText.length;
        }
        searchFrom = end;
        spans.push({ start: engineIndex[start], end: engineIndex[end - 1] + 1 });
    }
    return spans;
}

function parseBcvSpan(bcv: string): { s: number; e: number } {
    const parts = bcv.split('-');
    const s = parseInt(parts[0], 10);
    const e = parts.length > 1 ? parseInt(parts[1], 10) : s;
    return { s, e };
}

function formatBcvSpan(span: { s: number; e: number }): string {
    const s = String(span.s).padStart(8, '0');
    const e = String(span.e).padStart(8, '0');
    return s === e ? s : `${s}-${e}`;
}

function normalizeCitationBcvs(bcvs: string[], ascending: boolean): string[] {
    const spans = bcvs.map(parseBcvSpan);
    if (ascending) spans.sort((a, b) => (a.s - b.s) || (a.e - b.e));

    let merged = true;
    while (merged) {
        merged = false;
        for (let i = 0; i < spans.length && !merged; i++) {
            for (let j = i + 1; j < spans.length; j++) {
                if (spans[i].s <= spans[j].e && spans[j].s <= spans[i].e) {
                    spans[i] = {
                        s: Math.min(spans[i].s, spans[j].s),
                        e: Math.max(spans[i].e, spans[j].e),
                    };
                    spans.splice(j, 1);
                    merged = true;
                    break;
                }
            }
        }
    }
    return spans.map(formatBcvSpan);
}

function withoutMarkers(engineText: string): { text: string; engineIndex: number[] } {
    let text = '';
    const engineIndex: number[] = [];
    for (let i = 0; i < engineText.length; i++) {
        if (engineText[i] === '\u27EA' || engineText[i] === '\u27EB') continue;
        text += engineText[i];
        engineIndex.push(i);
    }
    return { text, engineIndex };
}

export default class TraverturePlugin extends Plugin {
    settings = DEFAULT_SETTINGS;
    engine: TravertureEngineInstance | null = null;
    private processingElements = new Set<HTMLElement>();
    private sourceLangCache = new Map<string, string>();
    private sourceLangInFlight = new Map<string, Promise<string>>();
    private processedLangCache = new Map<string, string>();
    public editorRefreshGeneration = 0;
    public sessionRestored = false;
    private settingTab: TravertureSettingTab | null = null;
    private engineTimer: number | null = null;
    private contextRefPos: EditorPosition | null = null;
    private sidebarRefsStore = new Map<string, SidebarRef[]>();

    async loadSettings() {
        const savedData = await this.loadData() as Partial<TravertureSettings> | null;
        const settings = Object.assign({}, DEFAULT_SETTINGS, savedData) as TravertureSettings & { autoDetect?: unknown };
        delete settings.autoDetect;
        this.settings = settings;
    }
    async saveSettings() { await this.saveData(this.settings); }

    createEngine() {
        this.engine = createMainEngine(this.settings.sourceLanguage, this.settings.outputLanguage);
        prewarmEngines(this.settings.sourceLanguage, this.settings.outputLanguage);
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
            const raw: unknown = cached?.frontmatter?.language;
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

            const fileCache = this.app.metadataCache.getFileCache(file);
            const raw: unknown = fileCache?.frontmatter?.language;
            if (typeof raw === 'string' && raw.trim()) {
                const resolved = resolveLanguage(raw.trim());
                if (resolved) return resolved;
            }

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

    public notifySidebarOutputLanguageChanged(newLang: string): void {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TRAVERTURE_SIDEBAR);
        for (const leaf of leaves) {
            const view = leaf.view;
            if (view instanceof TravertureSidebarView) {
                view.onOutputLanguageChanged(newLang);
            }
        }
    }

    private async startEngine(): Promise<void> {
        const inrefensOn = (this.app as unknown as {
            plugins?: { enabledPlugins?: Set<string> };
        }).plugins?.enabledPlugins?.has('inrefens') ?? false;

        try {
            await initEngine(this.app, inrefensOn);
            this.createEngine();
        } catch (e) {
            console.error('tra.VER:ture: Failed to initialize engine:', e);
            new Notice('tra.VER:ture: Failed to initialize engine.');
            return;
        }
        if (!this.engine) {
            new Notice('tra.VER:ture: Failed to initialize engine.');
            return;
        }
        this.onEngineReady();
    }

    private onEngineReady(): void {
        this.settingTab?.refreshForEngine();
        this.editorRefreshGeneration++;
        this.refreshEditorViews();
        this.rerenderReadingViews();
    }

    private rerenderReadingViews(): void {
        const leaves = this.app.workspace.getLeavesOfType('markdown');
        for (const leaf of leaves) {
            const view = leaf.view;
            if (!(view instanceof MarkdownView)) continue;
            if (view.getMode() !== 'preview') continue;
            void this.forceRerenderLeaf(leaf);
        }
    }

    private refreshEditorViews(): void {
        const leaves = this.app.workspace.getLeavesOfType('markdown');
        for (const leaf of leaves) {
            const view = leaf.view;
            if (!(view instanceof MarkdownView)) continue;
            const cm = (view.editor as unknown as {
                cm?: {
                    dispatch?: (spec: unknown) => void;
                    state?: { selection?: unknown };
                };
            }).cm;
            if (cm?.dispatch && cm.state) {
                cm.dispatch({ selection: cm.state.selection });
            }
        }
    }

    public refreshReadingViews(): void {
        if (!this.engine) return;
        const leaves = this.app.workspace.getLeavesOfType('markdown');
        for (const leaf of leaves) {
            const view = leaf.view;
            if (!(view instanceof MarkdownView)) continue;
            if (view.getMode() !== 'preview') continue;
            const path = view.file?.path;
            if (!path) continue;

            void this.getSourceLanguageForPath(path).then((lang) => {
                const lastLang = this.processedLangCache.get(path);
                if (lastLang === lang) return;
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

    private splitFrontmatter(content: string): { frontmatter: string; body: string } {
        if (content.startsWith('---')) {
            const endIndex = content.indexOf('---', 3);
            if (endIndex !== -1) {
                const fmEnd = endIndex + 3;
                return {
                    frontmatter: content.substring(0, fmEnd),
                    body: content.substring(fmEnd),
                };
            }
        }
        return { frontmatter: '', body: content };
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

        for (const [clauseText, , , ranges] of clauses) {
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

    async parseBcvs(items: Array<{ bcv: string; text: string }>): Promise<SidebarRef[]> {
        const results: SidebarRef[] = [];
        for (const { bcv, text } of items) {
            const parts = bcv.split('-');
            const startBcv = parts[0];
            const endBcv = parts.length > 1 ? parts[1] : parts[0];
            const singleRange: Array<[string, string]> = [[startBcv, endBcv]];
            const fullDecoded = decodeScriptures(singleRange, 'en', 'full');
            const stdDecoded = decodeScriptures(singleRange, 'en', 'standard');
            const offDecoded = decodeScriptures(singleRange, 'en', 'official');
            const bookNum = parseInt(startBcv.substring(0, 2));
            results.push({
                scripture: text || fullDecoded?.[0] || bcv,
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

    private async getSidebarLeaf(): Promise<WorkspaceLeaf | null> {
        const { workspace } = this.app;
        let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_TRAVERTURE_SIDEBAR)[0] ?? null;
        if (!leaf) {
            leaf = workspace.getRightLeaf(false);
            if (!leaf) return null;
            await leaf.setViewState({ type: VIEW_TYPE_TRAVERTURE_SIDEBAR, active: true });
        }
        await leaf.loadIfDeferred();
        void workspace.revealLeaf(leaf);
        return leaf;
    }

    async showSidebarWithResults(refs: SidebarRef[]) {
        const leaf = await this.getSidebarLeaf();
        if (!leaf) return;
        void (leaf.view as TravertureSidebarView).displayResults(refs);
    }

    async showScripture(bcv: string, displayText: string, timecodes?: string): Promise<void> {
        const leaf = await this.getSidebarLeaf();
        if (!leaf) return;
        void (leaf.view as TravertureSidebarView).displayScripture(bcv, displayText, timecodes);
    }

    // ──────────────────────────────────────────────
    // Reading View post-processor
    // ──────────────────────────────────────────────

    async processElement(el: HTMLElement, sourcePath?: string) {
        if (!this.engine) return;
        if (el.querySelector('.callout')) return;
        const hasRealSvg = [...el.querySelectorAll('svg')].some(
            svg => !svg.closest('.list-bullet')
        );
        if (hasRealSvg && !el.querySelector('h1, h2, h3, h4, h5, h6, ul, ol')) return;
        if (this.processingElements.has(el)) return;
        this.processingElements.add(el);

        try {
            const sourceLang = await this.getSourceLanguageForPath(sourcePath);
            let html = el.innerHTML;

            // Process {{ }} blocks (forced parsing)
            if (/\{\{(.+?)\}\}/.test(html)) {
                html = html.replace(/\{\{(.+?)\}\}/g, (fullMatch: string, inner: string) => {
                    if (!this.engine) return fullMatch;
                    return this.linkBlock(inner, sourceLang);
                });
            }

            if (this.engine) {
                const tempDiv = createDiv();
                const parsedHtml = parseFragment(html);
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
                    const delimited = isInsideTripleEmphasis(textNode);
                    const prefixLen = delimited ? 4 : 0; // '*** '.length
                    const engineInput = delimited ? `*** ${text} ***` : text;

                    const parsed = this.safeParseWith(engineInput, sourceLang);
                    if (!parsed) continue;
                    let clauses = JSON.parse(parsed) as ParsedReference[];
                    if (clauses.length === 0) continue;

                    if (prefixLen > 0) {
                        clauses = clauses.map(c => [c[0], c[1] - prefixLen, c[2] - prefixLen, c[3], c[4], c[5]] as ParsedReference);
                    }

                    const linked = this.insertLinks(text, clauses);
                    if (linked !== text) {
                        const fragment = createFragment();
                        const parsedLinked = parseFragment(linked);
                        for (const child of Array.from(parsedLinked.body.childNodes)) {
                            fragment.appendChild(child.cloneNode(true));
                        }
                        textNode.parentNode?.replaceChild(fragment, textNode);
                    }
                }
                html = tempDiv.innerHTML;
            }

            const parsed = parseFragment(html);
            while (el.firstChild) el.removeChild(el.firstChild);
            for (const child of Array.from(parsed.body.childNodes)) {
                el.appendChild(child.cloneNode(true));
            }

            el.querySelectorAll('.traverture-ref-link').forEach(link => {
                link.addEventListener('click', (e) => { void (async () => {
                    if ((e as MouseEvent).button !== 0) return;
                    const bcv = link.getAttribute('data-bcv')!;
                    if ((e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey) {
                        window.open(buildJwLibraryUrl(bcv, this.settings.outputLanguage), '_blank');
                        return;
                    }
                    e.preventDefault(); e.stopPropagation();
                    const { refText, timecodes } = await resolveClickContext(
                        bcv, this.settings.outputLanguage, this.settings.titleFormat, link.textContent || undefined,
                    );
                    await this.showScripture(bcv, refText, timecodes);
                })(); });
            });

            if (sourcePath) {
                this.processedLangCache.set(sourcePath, sourceLang);
            }
        } finally {
            this.processingElements.delete(el);
        }
    }

    private linkBlock(inner: string, sourceLang: string): string {
        const { clean, origIndex } = stripMarkup(inner);
        const engineText = '\u27EA\u27EA' + clean + '\u27EB\u27EB';
        const parsed = this.safeParseWith(engineText, sourceLang);
        if (!parsed) return inner;
        const clauses = JSON.parse(parsed) as ParsedReference[];
        if (clauses.length === 0) return inner;

        const spans = locateInText(engineText, clauses);
        let result = '';
        let pos = 0;

        for (let i = 0; i < clauses.length; i++) {
            const [clauseText, , , ranges, prefix] = clauses[i];

            const span = spans[i];
            if (ranges.length === 0 || !span) continue;

            const start = origIndex[span.start - 2];
            const end = origIndex[span.end - 3] + 1;
            if (start === undefined || end === undefined || start < pos) continue;
            if (inner.substring(start, end).includes('<')) continue;

            const displayText = prefix + clauseText;

            const bcv = ranges[0][0] === ranges[0][1] ? ranges[0][0] : `${ranges[0][0]}-${ranges[0][1]}`;
            result += inner.substring(pos, start)
                + `<a class="traverture-ref-link" data-bcv="${escapeHtml(bcv)}" data-ref="${escapeHtml(displayText)}">${clauseText}</a>`;
            pos = end;
        }
        return result + inner.substring(pos);
    }

    private insertLinks(text: string, clauses: ParsedReference[]): string {
        if (clauses.length === 0) return text;

        const positions: Array<{ start: number; end: number; displayText: string; bcv: string }> = [];

        for (const [clauseText, startPos, endPos, ranges, prefix] of clauses) {
            if (ranges.length === 0) continue;
            const bcv = ranges[0][0] === ranges[0][1] ? ranges[0][0] : `${ranges[0][0]}-${ranges[0][1]}`;
            positions.push({ start: startPos, end: endPos, displayText: prefix + clauseText, bcv });
        }

        if (positions.length === 0) return text;
        positions.sort((a, b) => a.start - b.start);

        let result = '';
        let pos = 0;

        for (const p of positions) {
            if (p.start < pos) continue;
            result += text.substring(pos, p.start);
            const link = `<a class="traverture-ref-link" data-bcv="${escapeHtml(p.bcv)}" data-ref="${escapeHtml(p.displayText)}">${text.substring(p.start, p.end)}</a>`;
            result += link;
            pos = p.end;
        }
        result += text.substring(pos);
        return result;
    }

    // ──────────────────────────────────────────────
    // Reformat / insert
    // ──────────────────────────────────────────────

    private applyReformat(text: string, format: NameFormat, sourceLang: string): string | null {
        const items = reformatScriptures(text, sourceLang, format);
        if (!items || items.length === 0) return null;
        const parsed = this.safeParseWith(text, sourceLang);
        if (!parsed) return null;
        const clauses = JSON.parse(parsed) as ParsedReference[];
        if (clauses.length === 0) return null;

        let result = text;
        for (let i = items.length - 1; i >= 0; i--) {
            const [, start, end, rewritten] = items[i];
            if (!clauses.some(c => c[1] >= start && c[2] <= end)) continue;
            result = result.substring(0, start) + rewritten + result.substring(end);
        }
        return result;
    }

    reformatReferences(editor: Editor, text: string, format: NameFormat, sourceLang: string) {
        const reformatted = this.applyReformat(text, format, sourceLang);
        if (reformatted === null || reformatted === text) return;
        editor.replaceSelection(reformatted);
    }

    private reformatDocument(editor: Editor, format: NameFormat, sourceLang: string): void {
        const full = editor.getValue();
        const { frontmatter, body } = this.splitFrontmatter(full);
        const reformatted = this.applyReformat(body, format, sourceLang);
        if (reformatted === null || reformatted === body) return;
        editor.setValue(frontmatter + reformatted);
    }

    private async prefetchCitationVerseText(
        bcvs: string[],
        withRef: boolean,
        fetchedCache: Map<string, string>,
    ): Promise<void> {
        const CONCURRENCY = 4;
        const lang = this.settings.outputLanguage;

        const tasks: string[] = [];
        const seen = new Set<string>();
        for (const bcv of bcvs) {
            if (seen.has(bcv)) continue;
            seen.add(bcv);
            tasks.push(bcv);
        }

        const toText = (div: HTMLElement): string => (div.textContent || '')
            .replace(/\u00A0/g, ' ').replace(/\u202F/g, ' ')
            .replace(/\+/g, '').replace(/\*/g, '')
            .replace(/\s+/g, ' ').trim();

        const worker = async (): Promise<void> => {
            for (;;) {
                const bcv = tasks.shift();
                if (bcv === undefined) return;
                const cacheKey = `${lang}:${bcv}`;

                const verseData = await fetchVerseWithExtras(bcv, lang);
                if (!verseData) {
                    fetchedCache.set(cacheKey, '');
                    if (!withRef) fetchedCache.set(`${cacheKey}:plain`, '');
                    continue;
                }
                const html = verseData.html
                    .replace(/<span class="parabreak"><\/span>/g, ' ')
                    .replace(/<span class="newblock"><\/span>/g, ' ');
                const tempDiv = createDiv();
                const parsedHtml = new DOMParser().parseFromString(html, 'text/html');
                for (const child of Array.from(parsedHtml.body.childNodes)) {
                    tempDiv.appendChild(child.cloneNode(true));
                }

                const needsPlain = withRef || !bcv.includes('-');
                let plainText = '';
                if (needsPlain) {
                    const plainDiv = tempDiv.cloneNode(true) as HTMLElement;
                    plainDiv.querySelectorAll('sup.verseNum, .chapterNum').forEach(el => el.remove());
                    plainText = toText(plainDiv);
                }

                if (withRef) {
                    fetchedCache.set(cacheKey, plainText);
                    continue;
                }

                tempDiv.querySelectorAll('.chapterNum').forEach(el => {
                    const textNode = el.querySelector('a') || el;
                    if (textNode) textNode.textContent = '1 ';
                });
                fetchedCache.set(cacheKey, toText(tempDiv));
                if (needsPlain) fetchedCache.set(`${cacheKey}:plain`, plainText);
            }
        };

        const workers: Promise<void>[] = [];
        const n = Math.min(CONCURRENCY, tasks.length);
        for (let i = 0; i < n; i++) workers.push(worker());
        await Promise.all(workers);
    }

    private buildCitationGroups(text: string, sourceLang: string): { groups: CitationGroup[]; failed: number } | null {
        const { text: engineText, origIndex } = toEngineText(text);
        const parsed = this.safeParseWith(engineText, sourceLang);
        if (!parsed) return null;
        const clauses = JSON.parse(parsed) as ParsedReference[];
        if (clauses.length === 0) return null;

        const spans = locateInText(engineText, clauses);
        const groups: CitationGroup[] = [];
        let failed = 0;
        let previousGrouped = false;

        for (let i = 0; i < clauses.length; i++) {
            const [, , , ranges, prefix, continues] = clauses[i];
            if (ranges.length === 0) { previousGrouped = false; continue; }

            const span = spans[i];
            const start = span ? origIndex[span.start] : undefined;
            const end = span ? origIndex[span.end - 1] + 1 : undefined;
            if (start === undefined || end === undefined) {
                failed++;
                previousGrouped = false;
                continue;
            }

            const [firstBcv, lastBcv] = ranges[0];
            const bcv = firstBcv === lastBcv ? firstBcv : `${firstBcv}-${lastBcv}`;
            const prev = groups[groups.length - 1];
            if (prev && previousGrouped && continues && /^\s*,\s*$/.test(text.substring(prev.end, start))) {
                prev.end = end;
                prev.bcvs.push(bcv);
            } else {
                groups.push({ start, end, bcvs: [bcv], prefix });
            }
            previousGrouped = true;
        }
        return { groups, failed };
    }

    private async buildCitationEdits(
        text: string,
        groups: CitationGroup[],
        failedBefore: number,
        withRef: boolean,
    ): Promise<CitationEdit[] | null> {
        let failed = failedBefore;
        const total = groups.length + failed;
        const allBcvs: string[] = [];
        for (const group of groups) {
            group.bcvs = normalizeCitationBcvs(group.bcvs, !withRef);
            allBcvs.push(...group.bcvs);
        }
        const fetchedCache = new Map<string, string>();
        await this.prefetchCitationVerseText(allBcvs, withRef, fetchedCache);

        const lang = this.settings.outputLanguage;
        const edits: CitationEdit[] = [];
        for (const group of groups) {
            const usePlain = !withRef && group.bcvs.length === 1 && !group.bcvs[0].includes('-');
            const verseTexts = group.bcvs.map(b => fetchedCache.get(`${lang}:${b}${usePlain ? ':plain' : ''}`));
            if (verseTexts.some(v => !v)) { failed++; continue; }

            let quote = verseTexts[0] as string;
            for (let k = 1; k < verseTexts.length; k++) {
                const consecutive = parseBcvSpan(group.bcvs[k]).s === parseBcvSpan(group.bcvs[k - 1]).e + 1;
                quote += (consecutive ? ' ' : ' [...] ') + (verseTexts[k] as string);
            }

            let start = group.start;
            let end = group.end;
            let prefix = group.prefix;
            if (text.substring(start - 2, start) === '{{' && text.substring(end, end + 2) === '}}') {
                start -= 2;
                end += 2;
                prefix = '';
            }
            const originalRef = prefix + text.substring(start, end);

            edits.push({
                start,
                end,
                replacement: withRef ? `"${quote}" (${originalRef})` : `${originalRef}: "${quote}"`,
            });
        }
        if (failed > 0) {
            new Notice(
                failed === total
                    ? 'Could not fetch verse text.'
                    : `Could not fetch verse text for ${failed} of ${total} references.`
            );
        }
        if (failed === total) return null;
        return edits;
    }

    async insertCitation(editor: Editor, text: string, withRef: boolean, sourceLang: string) {
        const built = this.buildCitationGroups(text, sourceLang);
        if (!built) { new Notice('No scripture references found.'); return; }

        const edits = await this.buildCitationEdits(text, built.groups, built.failed, withRef);
        if (!edits) return;

        let result = text;
        for (let i = edits.length - 1; i >= 0; i--) {
            result = result.substring(0, edits[i].start) + edits[i].replacement + result.substring(edits[i].end);
        }
        editor.replaceSelection(result);
    }

    async insertCitationAt(editor: Editor, pos: EditorPosition, withRef: boolean, sourceLang: string) {
        const lineText = editor.getLine(pos.line);
        const built = this.buildCitationGroups(lineText, sourceLang);
        if (!built) { new Notice('No scripture references found.'); return; }

        const group = built.groups.find(g => g.start <= pos.ch && pos.ch < g.end)
            ?? built.groups.find(g => pos.ch === g.end);
        if (!group) { new Notice('No scripture reference found here.'); return; }

        const edits = await this.buildCitationEdits(lineText, [group], 0, withRef);
        if (!edits || edits.length === 0) return;

        const edit = edits[0];
        editor.replaceRange(
            edit.replacement,
            { line: pos.line, ch: edit.start },
            { line: pos.line, ch: edit.end },
        );
    }

    // ──────────────────────────────────────────────
    // Menu
    // ──────────────────────────────────────────────

    private buildLanguageSubmenu(menu: Menu, kind: 'source' | 'output'): void {
        const languages = kind === 'source'
            ? getAvailableLanguages().filter(l => l.code !== 'ase')
            : getAvailableLanguages();
        const current = kind === 'source' ? this.settings.sourceLanguage : this.settings.outputLanguage;

        for (const lang of languages) {
            menu.addItem((langItem: MenuItem) => langItem
                .setTitle(`${lang.vernacularName} (${lang.code})`)
                .setChecked(lang.code === current)
                .onClick(async () => {
                    if (kind === 'source') {
                        this.settings.sourceLanguage = lang.code;
                        await this.saveSettings();
                        this.createEngine();
                        this.onSourceLanguageChanged();
                        new Notice(`Source language: ${lang.vernacularName}`);
                    } else {
                        this.settings.outputLanguage = lang.code;
                        await this.saveSettings();
                        this.createEngine();
                        this.notifySidebarOutputLanguageChanged(lang.code);
                        activeDocument.dispatchEvent(new CustomEvent('traverture-output-language-changed'));
                        new Notice(`Output language: ${lang.vernacularName}`);
                    }
                }));
        }
    }

    private addCitationItem(menu: Menu, insert: (withRef: boolean) => Promise<void>): void {
        menu.addItem((item: MenuItem) => {
            item.setTitle('Insert citation').setIcon('quote-glyph');
            const citeMenu = getSubmenu(item);
            citeMenu.addItem((citeItem: MenuItem) => citeItem.setTitle('Reference: "verse"').onClick(async () => {
                await insert(false);
            }));
            citeMenu.addItem((citeItem: MenuItem) => citeItem.setTitle('"verse" (Reference)').onClick(async () => {
                await insert(true);
            }));
        });
    }

    private addTravertureMenuItems(
        menu: Menu,
        editor: Editor | null,
        selection: string | undefined,
        sourceLang: string,
        liveDocumentText?: string,
        clickedPos?: EditorPosition,
    ): void {
        if (selection) {
            menu.addItem((item: MenuItem) => item.setTitle('Parse selection').setIcon('sidebar-right').onClick(async () => {
                await this.showSidebarWithResults(await this.parseReferences(selection, sourceLang));
            }));
            this.addCitationItem(menu, async (withRef: boolean) => {
                if (editor && selection) await this.insertCitation(editor, selection, withRef, sourceLang);
            });
            menu.addItem((item: MenuItem) => {
                item.setTitle('Reformat selection').setIcon('pencil');
                const submenu = getSubmenu(item);
                submenu.addItem((fmtItem: MenuItem) => fmtItem.setTitle('Full (1 Corinthians)').onClick(() => {
                    if (editor && selection) this.reformatReferences(editor, selection, 'full', sourceLang);
                }));
                submenu.addItem((fmtItem: MenuItem) => fmtItem.setTitle('Standard (1 Cor.)').onClick(() => {
                    if (editor && selection) this.reformatReferences(editor, selection, 'standard', sourceLang);
                }));
                submenu.addItem((fmtItem: MenuItem) => fmtItem.setTitle('Official (1Co)').onClick(() => {
                    if (editor && selection) this.reformatReferences(editor, selection, 'official', sourceLang);
                }));
            });
            menu.addSeparator();
        } else if (editor && clickedPos) {
            this.addCitationItem(menu, async (withRef: boolean) => {
                await this.insertCitationAt(editor, clickedPos, withRef, sourceLang);
            });
            menu.addSeparator();
        }

        menu.addItem((item: MenuItem) => item.setTitle('Parse document').setIcon('sidebar-right').onClick(async () => {
            let content: string;
            if (liveDocumentText !== undefined) {
                content = this.stripFrontmatter(liveDocumentText);
            } else {
                const file = this.app.workspace.getActiveFile();
                if (!file) { new Notice('No file open.'); return; }
                content = this.stripFrontmatter(await this.app.vault.read(file));
            }
            await this.showSidebarWithResults(await this.parseReferences(content, sourceLang));
        }));
        menu.addItem((item: MenuItem) => {
            item.setTitle('Reformat document').setIcon('pencil');
            const submenu = getSubmenu(item);
            submenu.addItem((fmtItem: MenuItem) => fmtItem.setTitle('Full (1 Corinthians)').onClick(() => {
                if (editor) this.reformatDocument(editor, 'full', sourceLang);
            }));
            submenu.addItem((fmtItem: MenuItem) => fmtItem.setTitle('Standard (1 Cor.)').onClick(() => {
                if (editor) this.reformatDocument(editor, 'standard', sourceLang);
            }));
            submenu.addItem((fmtItem: MenuItem) => fmtItem.setTitle('Official (1Co)').onClick(() => {
                if (editor) this.reformatDocument(editor, 'official', sourceLang);
            }));
        });
        menu.addSeparator();

        menu.addItem((item: MenuItem) => {
            item.setTitle('Source language').setIcon('book-open');
            const langMenu = getSubmenu(item);
            this.buildLanguageSubmenu(langMenu, 'source');
        });

        menu.addItem((item: MenuItem) => {
            item.setTitle('Output language').setIcon('languages');
            const langMenu = getSubmenu(item);
            this.buildLanguageSubmenu(langMenu, 'output');
        });
    }

    private addReadingModeMenuItems(menu: Menu, domSelection: Selection | null, sourceLang: string): void {
        const items: Array<{ bcv: string; text: string }> = [];
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
                    if (bcv) items.push({ bcv, text: link.textContent || '' });
                }
            });
        }

        if (hasSelection) {
            menu.addItem((subItem: MenuItem) => subItem.setTitle('Parse selection').setIcon('sidebar-right').onClick(async () => {
                if (items.length > 0) {
                    await this.showSidebarWithResults(await this.parseBcvs(items));
                } else {
                    const textSelection = domSelection?.toString() || '';
                    await this.showSidebarWithResults(await this.parseReferences(textSelection, sourceLang));
                }
            }));
        }

        menu.addItem((subItem: MenuItem) => subItem.setTitle('Parse document').setIcon('sidebar-right').onClick(async () => {
            const file = this.app.workspace.getActiveFile();
            if (!file) return;
            const content = this.stripFrontmatter(await this.app.vault.read(file));
            await this.showSidebarWithResults(await this.parseReferences(content, sourceLang));
        }));

        menu.addSeparator();

        menu.addItem((subItem: MenuItem) => {
            subItem.setTitle('Source language').setIcon('book-open');
            const langMenu = getSubmenu(subItem);
            this.buildLanguageSubmenu(langMenu, 'source');
        });

        menu.addItem((subItem: MenuItem) => {
            subItem.setTitle('Output language').setIcon('languages');
            const langMenu = getSubmenu(subItem);
            this.buildLanguageSubmenu(langMenu, 'output');
        });
    }

    showTravertureMenu(sourceLang: string): Menu {
        const menu = new Menu();

        const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);

        if (!activeMarkdownView) {
            menu.addItem((item: MenuItem) => {
                item.setTitle('Source language').setIcon('book-open');
                const langMenu = getSubmenu(item);
                this.buildLanguageSubmenu(langMenu, 'source');
            });
            menu.addItem((item: MenuItem) => {
                item.setTitle('Output language').setIcon('languages');
                const langMenu = getSubmenu(item);
                this.buildLanguageSubmenu(langMenu, 'output');
            });
            return menu;
        }

        if (activeMarkdownView.getMode() === 'preview') {
            this.addReadingModeMenuItems(menu, activeDocument.getSelection(), sourceLang);
        } else {
            const editor = this.app.workspace.activeEditor?.editor;
            const sel = editor?.getSelection();
            this.addTravertureMenuItems(menu, editor ?? null, sel, sourceLang, editor?.getValue());
        }

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

    applyPaneFontScale(): void {
        const scale = this.settings.paneFontScale;
        const clamped = Math.min(1.6, Math.max(0.7, scale));
        activeDocument.documentElement.style.setProperty(
            '--traverture-pane-font-scale',
            String(clamped)
        );
    }

    private registerEditorMenu(): void {
        this.registerDomEvent(activeDocument, 'contextmenu', (evt: MouseEvent) => {
            this.contextRefPos = null;
            const refEl = (evt.target as HTMLElement | null)?.closest?.('.cm-traverture-ref');
            if (!refEl) return;
            const view = EditorView.findFromDOM(refEl as HTMLElement);
            if (!view) return;
            const pos = view.posAtCoords({ x: evt.clientX, y: evt.clientY });
            if (pos === null) return;
            const line = view.state.doc.lineAt(pos);
            this.contextRefPos = { line: line.number - 1, ch: pos - line.from };
        }, true);

        this.registerEvent(this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, _view) => {
            if (!this.engine) return;
            const selection = editor.getSelection();
            const clickedPos = selection ? undefined : (this.contextRefPos ?? undefined);
            this.contextRefPos = null;
            const activeFile = this.app.workspace.getActiveFile();
            const sourceLang = this.getEffectiveSourceLanguage(activeFile, editor.getValue());
            menu.addItem((item: MenuItem) => {
                item.setTitle('tra.VER:ture').setIcon('book-open');
                const submenu = getSubmenu(item);
                this.addTravertureMenuItems(submenu, editor, selection, sourceLang, editor.getValue(), clickedPos);
            });
        }));
    }

    storeSidebarRefs(key: string, refs: SidebarRef[]): void {
        this.sidebarRefsStore.delete(key);
        this.sidebarRefsStore.set(key, refs);
        while (this.sidebarRefsStore.size > 4) {
            const oldest = this.sidebarRefsStore.keys().next().value;
            if (oldest === undefined) break;
            this.sidebarRefsStore.delete(oldest);
        }
    }

    loadSidebarRefs(key: string): SidebarRef[] | undefined {
        return this.sidebarRefsStore.get(key);
    }

    async onload() {
        await this.loadSettings();
        this.applyLinkColor();
        this.applyPaneFontScale();

        this.settingTab = new TravertureSettingTab(this.app, this);
        this.addSettingTab(this.settingTab);
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

        this.app.workspace.onLayoutReady(() => {
            this.app.workspace.detachLeavesOfType(VIEW_TYPE_TRAVERTURE_SIDEBAR);
            this.sessionRestored = true;

            this.engineTimer = window.setTimeout(() => {
                this.engineTimer = null;
                void this.startEngine();
            }, 100);
        });

        this.registerEditorMenu();

        this.registerDomEvent(activeDocument, 'contextmenu', (evt: MouseEvent) => {
            if (!this.engine) return;
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!view || view.getMode() !== 'preview') return;

            const target = evt.target as HTMLElement | null;
            if (!target?.closest?.('.markdown-preview-view') || !view.containerEl.contains(target)) return;

            const sourceLang = view.file ? this.getEffectiveSourceLanguage(view.file) : this.settings.sourceLanguage;
            const domSelection = activeDocument.getSelection();

            evt.preventDefault();
            evt.stopPropagation();

            const menu = new Menu();
            menu.addItem((item: MenuItem) => {
                item.setTitle('tra.VER:ture').setIcon('book-open');
                const submenu = getSubmenu(item);
                this.addReadingModeMenuItems(submenu, domSelection, sourceLang);
            });
            menu.showAtMouseEvent(evt);
        });

        this.addRibbonIcon('scroll', 'tra.VER:ture', (evt: MouseEvent) => {
            if (!this.engine) { new Notice('tra.VER:ture is still loading.'); return; }
            const activeFile = this.app.workspace.getActiveFile();
            const editor = this.app.workspace.activeEditor?.editor;
            const sourceLang = this.getEffectiveSourceLanguage(
                activeFile,
                editor ? editor.getValue() : undefined,
            );
            this.showTravertureMenu(sourceLang).showAtMouseEvent(evt);
        });

        this.addCommand({
            id: 'open-menu',
            name: 'Open menu',
            icon: 'scroll',
            callback: () => {
                if (!this.engine) { new Notice('tra.VER:ture is still loading.'); return; }
                const activeFile = this.app.workspace.getActiveFile();
                const editor = this.app.workspace.activeEditor?.editor;
                const sourceLang = this.getEffectiveSourceLanguage(
                    activeFile,
                    editor ? editor.getValue() : undefined,
                );
                this.showTravertureMenu(sourceLang).showAtMouseEvent({ clientX: 100, clientY: 100 } as MouseEvent);
            },
        });
    }

    onunload() {
        if (this.engineTimer !== null) {
            window.clearTimeout(this.engineTimer);
            this.engineTimer = null;
        }
        const root = activeDocument.documentElement;
        root.style.removeProperty('--traverture-link-color');
        root.style.removeProperty('--traverture-pane-font-scale');
        activeDocument.querySelectorAll('.traverture-marker-popover').forEach(el => el.remove());
        clearEnginePool();
    }
}