// sidebar.ts

import { ItemView, WorkspaceLeaf, ViewStateResult, setIcon } from 'obsidian';
import { fetchVerseWithExtras, getAslTimecodes } from './cache';
import { buildJwLibraryUrl, buildJwOrgUrl, buildVerseBody, buildCopyText, buildCommentaryPane, attachMarkerTooltips } from './common';
import { getAvailableLanguagesCached as getAvailableLanguages, getBookName, decodeScriptures } from './engine-wrapper';
import type TraverturePlugin from './main';
import { SidebarRef, VIEW_TYPE_TRAVERTURE_SIDEBAR, NameFormat, VerseData } from './types';

export const SIDEBAR_COLUMNS = [
    { key: 'scripture', label: 'Original', width: '140px', align: 'left', mono: false },
    { key: 'fullRef', label: 'Full', width: '180px', align: 'left', mono: false },
    { key: 'standardRef', label: 'Standard', width: '140px', align: 'left', mono: false },
    { key: 'officialRef', label: 'Official', width: '120px', align: 'left', mono: false },
    { key: 'startBcv', label: 'Start BCV', width: '120px', align: 'center', mono: true },
    { key: 'endBcv', label: 'End BCV', width: '120px', align: 'center', mono: true },
    { key: 'startCh', label: 'Start Ch', width: '80px', align: 'center', mono: true },
    { key: 'endCh', label: 'End Ch', width: '80px', align: 'center', mono: true },
    { key: 'startVerse', label: 'Start Vs', width: '80px', align: 'center', mono: true },
    { key: 'endVerse', label: 'End Vs', width: '80px', align: 'center', mono: true },
] as const;

type SidebarColumn = typeof SIDEBAR_COLUMNS[number];
type SidebarColumnKey = SidebarColumn['key'];

type SidebarMode = 'table' | 'scripture';

interface ScriptureView {
    kind: 'scripture';
    bcv: string;
    displayText: string;
    timecodes?: string;
}

interface TableView {
    kind: 'table';
}

type NavView = ScriptureView | TableView;

export class TravertureSidebarView extends ItemView {
    plugin: TraverturePlugin;
    private mode: SidebarMode = 'table';
    private allRefs: SidebarRef[] = [];
    private searchQuery: string = '';
    private sortColumn: string | null = null;
    private sortDir: number = 0;
    private visibleColumns: Set<string> = new Set(SIDEBAR_COLUMNS.map(c => c.key));
    private searchInputEl: HTMLInputElement | null = null;
    private outputLang: string;
    private capitalize: boolean = false;
    private uniqueOnly: boolean = false;
    private history: NavView[] = [];
    private historyIndex: number = -1;
    private scriptureAbort: AbortController | null = null;
    private scriptureVerseData: VerseData | null = null;
    private scriptureBcv: string = '';
    private scriptureDisplayText: string = '';

    constructor(leaf: WorkspaceLeaf, plugin: TraverturePlugin) {
        super(leaf);
        this.plugin = plugin;
        this.outputLang = plugin.settings.outputLanguage;
        this.visibleColumns = new Set(plugin.settings.sidebarColumns);
        this.capitalize = plugin.settings.sidebarCapitalize;
        this.uniqueOnly = plugin.settings.sidebarUniqueOnly;
    }

    getViewType(): string { return VIEW_TYPE_TRAVERTURE_SIDEBAR; }
    getDisplayText(): string { return 'tra.VER:ture References'; }
    getIcon(): string { return 'book-open'; }

    async onOpen() {
        this.contentEl.empty();
        this.contentEl.addClass('traverture-sidebar');
        this.renderCurrentView();
    }

    async onClose() {
        this.abortScriptureFetch();
        this.contentEl.empty();
        this.mode = 'table';
        this.allRefs = [];
        this.history = [];
        this.historyIndex = -1;
    }

    async setState(state: Record<string, unknown>, _result: ViewStateResult): Promise<void> {
        const restoringAtStartup = !this.plugin.sessionRestored;

        if (state && !restoringAtStartup) {
            if (state.mode === 'table' || state.mode === 'scripture') this.mode = state.mode;
            if (Array.isArray(state.allRefs)) this.allRefs = state.allRefs as SidebarRef[];
            if (typeof state.searchQuery === 'string') this.searchQuery = state.searchQuery;
            if (typeof state.sortColumn === 'string' || state.sortColumn === null) this.sortColumn = state.sortColumn;
            if (typeof state.sortDir === 'number') this.sortDir = state.sortDir;
            if (Array.isArray(state.history)) this.history = state.history as NavView[];
            if (typeof state.historyIndex === 'number') this.historyIndex = state.historyIndex;
        }

        await super.setState(state, _result);

        if (this.contentEl.isConnected) {
            this.renderCurrentView();
        }
    }

    getState(): Record<string, unknown> {
        const state = super.getState();
        return {
            ...state,
            mode: this.mode,
            allRefs: this.allRefs,
            searchQuery: this.searchQuery,
            sortColumn: this.sortColumn,
            sortDir: this.sortDir,
            history: this.history,
            historyIndex: this.historyIndex,
        };
    }

    isEmpty(): boolean {
        return this.history.length === 0 && this.allRefs.length === 0;
    }

    async displayResults(refs: SidebarRef[]) {
        this.allRefs = refs;
        this.sortColumn = null;
        this.sortDir = 0;
        this.abortScriptureFetch();
        this.history = [{ kind: 'table' }];
        this.historyIndex = 0;
        this.mode = 'table';
        this.renderCurrentView();
    }

    async displayScripture(
        bcv: string,
        displayText: string,
        timecodes?: string,
        titleOverride?: string,
    ): Promise<void> {
        let resolvedTimecodes = timecodes;
        if (this.outputLang === 'ase' && !resolvedTimecodes) {
            resolvedTimecodes = await getAslTimecodes(bcv);
        }
        let title = titleOverride;
        if (!title) {
            const parts = bcv.split('-');
            const startBcv = parts[0];
            const endBcv = parts.length > 1 ? parts[1] : parts[0];
            const decoded = decodeScriptures([[startBcv, endBcv]], this.outputLang, this.plugin.settings.titleFormat);
            title = decoded?.[0] || displayText;
        }
        this.pushView({ kind: 'scripture', bcv, displayText: title, timecodes: resolvedTimecodes });
    }

    private pushView(view: NavView): void {
        this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push(view);
        this.historyIndex = this.history.length - 1;
        this.renderCurrentView();
    }

    private canGoBack(): boolean { return this.historyIndex > 0; }
    private canGoForward(): boolean { return this.historyIndex < this.history.length - 1; }

    private goBack(): void {
        if (!this.canGoBack()) return;
        this.historyIndex--;
        this.renderCurrentView();
    }

    private goForward(): void {
        if (!this.canGoForward()) return;
        this.historyIndex++;
        this.renderCurrentView();
    }

    private currentView(): NavView | null {
        if (this.historyIndex < 0 || this.historyIndex >= this.history.length) return null;
        return this.history[this.historyIndex];
    }

    private handleNavigate = (bcv: string, displayText: string): void => {
        void this.displayScripture(bcv, displayText);
    };

    private renderCurrentView(): void {
        const view = this.currentView();
        if (!view) {
            this.abortScriptureFetch();
            this.contentEl.empty();
            this.contentEl.addClass('traverture-sidebar');
            return;
        }
        if (view.kind === 'table') {
            this.abortScriptureFetch();
            this.renderTable();
        } else {
            this.renderScripture(view);
        }
    }

    private renderScripture(view: ScriptureView): void {
        this.abortScriptureFetch();
        this.contentEl.empty();
        this.contentEl.addClass('traverture-sidebar');

        const header = this.contentEl.createDiv({ cls: 'traverture-scripture-header' });

        const left = header.createDiv({ cls: 'traverture-scripture-header-left' });

        left.createSpan({ cls: 'traverture-pane-title', text: view.displayText });

        const nav = left.createDiv({ cls: 'traverture-scripture-nav' });
        if (this.canGoBack()) {
            const backBtn = nav.createEl('button', { cls: 'traverture-scripture-nav-btn' });
            setIcon(backBtn, 'arrow-left');
            backBtn.setAttribute('aria-label', 'Back');
            backBtn.addEventListener('click', () => this.goBack());
        }
        if (this.canGoForward()) {
            const fwdBtn = nav.createEl('button', { cls: 'traverture-scripture-nav-btn' });
            setIcon(fwdBtn, 'arrow-right');
            fwdBtn.setAttribute('aria-label', 'Forward');
            fwdBtn.addEventListener('click', () => this.goForward());
        }

        const buttonGroup = header.createDiv({ cls: 'traverture-scripture-header-buttons' });
        this.buildScriptureButtons(buttonGroup, view);

        const bodyContainer = this.contentEl.createDiv({ cls: 'traverture-scripture-pane' });
        this.renderScriptureContent(bodyContainer, view);
    }

    private renderScriptureContent(container: HTMLElement, view: ScriptureView): void {
        this.abortScriptureFetch();
        this.scriptureAbort = new AbortController();

        this.scriptureBcv = view.bcv;
        this.scriptureDisplayText = view.displayText;
        this.scriptureVerseData = null;

        container.empty();
        container.addClass('traverture-scripture-pane');

        const loading = container.createDiv({ cls: 'traverture-pane-body' });
        const p = loading.createEl('p');
        p.createEl('em', { text: 'Loading...' });

        const signal = this.scriptureAbort.signal;

        void fetchVerseWithExtras(view.bcv, this.outputLang, signal).then(verseData => {
            if (signal.aborted) return;
            this.scriptureVerseData = verseData;
            this.renderScriptureBody(container, verseData, view);
        });
    }

    private renderScriptureBody(container: HTMLElement, verseData: VerseData | null, view: ScriptureView): void {
        container.empty();
        container.addClass('traverture-scripture-pane');

        const body = buildVerseBody(verseData);
        if (verseData) {
            attachMarkerTooltips(body, verseData, this.outputLang, this.handleNavigate);
        }
        container.appendChild(body);

        if (verseData?.commentaries && verseData.commentaries.length > 0) {
            const pane = buildCommentaryPane(verseData.commentaries, this.outputLang, this.handleNavigate);
            container.appendChild(pane);
        }

        this.scriptureBcv = view.bcv;
        this.scriptureDisplayText = view.displayText;
        this.scriptureVerseData = verseData;
    }

    private buildScriptureButtons(parent: HTMLElement, view: ScriptureView): void {
        const jwlibUrl = buildJwLibraryUrl(view.bcv, this.outputLang, view.timecodes);
        const jworgUrl = buildJwOrgUrl(view.bcv, this.outputLang, view.timecodes);

        const jwlibBtn = this.createScriptureButton('JW Library');
        jwlibBtn.addEventListener('click', () => {
            window.open(jwlibUrl, '_blank');
            void navigator.clipboard.writeText(jwlibUrl);
        });
        parent.appendChild(jwlibBtn);

        const jworgBtn = this.createScriptureButton('JW.ORG');
        jworgBtn.addEventListener('click', () => {
            window.open(jworgUrl, '_blank');
            void navigator.clipboard.writeText(jworgUrl);
        });
        parent.appendChild(jworgBtn);

        const copyBtn = this.createScriptureButton('COPY');
        copyBtn.addEventListener('click', () => {
            void navigator.clipboard.writeText(
                buildCopyText(this.scriptureVerseData, this.scriptureDisplayText),
            );
            copyBtn.textContent = 'COPIED';
            window.setTimeout(() => { copyBtn.textContent = 'COPY'; }, 1500);
        });
        parent.appendChild(copyBtn);
    }

    private createScriptureButton(text: string): HTMLButtonElement {
        const btn = createEl('button');
        btn.className = 'traverture-pane-btn';
        btn.textContent = text;
        return btn;
    }

    private abortScriptureFetch(): void {
        if (this.scriptureAbort) {
            this.scriptureAbort.abort();
            this.scriptureAbort = null;
        }
        this.scriptureVerseData = null;
        this.scriptureBcv = '';
        this.scriptureDisplayText = '';
    }

    private renderEmpty(message: string) {
        this.contentEl.empty();
        this.contentEl.addClass('traverture-sidebar');
        this.contentEl.createEl('p', { text: message, cls: 'traverture-sidebar-empty' });
    }

    private normalizeForSearch(text: string): string {
        return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '').toLowerCase();
    }

    private getDisplayRef(ref: SidebarRef, format: NameFormat): string {
        const bookName = getBookName(ref.bookNum, this.outputLang, format, this.capitalize);
        if (!bookName) return ref.fullRef;
        const engBookName = getBookName(ref.bookNum, 'en', 'full', false);
        if (engBookName && ref.fullRef.startsWith(engBookName)) {
            const rest = ref.fullRef.substring(engBookName.length);
            return `${bookName}${rest}`;
        }
        return `${bookName}`;
    }

    private getRefValue(ref: SidebarRef, key: SidebarColumnKey): string {
        if (key === 'fullRef') return this.getDisplayRef(ref, 'full');
        if (key === 'standardRef') return this.getDisplayRef(ref, 'standard');
        if (key === 'officialRef') return this.getDisplayRef(ref, 'official');
        const raw = ref[key];
        return String(raw ?? '');
    }

    private getFilteredSortedRefs(): SidebarRef[] {
        let refs = [...this.allRefs];
        if (this.uniqueOnly) {
            const seen = new Set<string>();
            refs = refs.filter(r => { const key = this.getDisplayRef(r, 'full'); if (seen.has(key)) return false; seen.add(key); return true; });
        }
        if (this.searchQuery) {
            const q = this.normalizeForSearch(this.searchQuery);
            refs = refs.filter(r => SIDEBAR_COLUMNS.some(col => {
                if (!this.visibleColumns.has(col.key)) return false;
                const val = this.getRefValue(r, col.key);
                return this.normalizeForSearch(val).includes(q);
            }));
        }
        if (this.sortColumn && this.sortDir !== 0) {
            const sortKey = this.sortColumn as SidebarColumnKey;
            refs.sort((a, b) => {
                const aVal = this.getRefValue(a, sortKey);
                const bVal = this.getRefValue(b, sortKey);
                const cmp = aVal.localeCompare(bVal);
                return this.sortDir === 1 ? cmp : -cmp;
            });
        }
        return refs;
    }

    private renderTable() {
        const wasFocused = this.searchInputEl && activeDocument.activeElement === this.searchInputEl;
        this.contentEl.empty();
        this.contentEl.addClass('traverture-sidebar');
        if (this.allRefs.length === 0) { this.renderEmpty('No references found.'); return; }

        const refs = this.getFilteredSortedRefs();
        const visibleCols = SIDEBAR_COLUMNS.filter(c => this.visibleColumns.has(c.key));
        const languages = getAvailableLanguages();

        const toolbar = this.contentEl.createDiv({ cls: 'traverture-sidebar-toolbar' });
        const topRow = toolbar.createDiv({ cls: 'traverture-sidebar-top-row' });

        const searchWrap = topRow.createDiv({ cls: 'traverture-sidebar-search-wrap' });
        this.searchInputEl = searchWrap.createEl('input', { type: 'text', placeholder: 'Search...', cls: 'traverture-sidebar-search' });
        this.searchInputEl.value = this.searchQuery;
        this.searchInputEl.addEventListener('input', () => { this.searchQuery = this.searchInputEl!.value; this.renderTable(); });
        if (this.searchQuery) {
            const clearX = searchWrap.createEl('button', { cls: 'traverture-sidebar-search-clear' });
            clearX.setText('\u2715');
            clearX.addEventListener('click', () => { this.searchQuery = ''; this.renderTable(); });
        }

        topRow.createSpan({ text: `${refs.length} results`, cls: 'traverture-sidebar-count' });
        topRow.createDiv({ cls: 'traverture-sidebar-spacer' });

        const langSelect = topRow.createEl('select', { cls: 'traverture-sidebar-lang-select' });
        for (const lang of languages) {
            const opt = langSelect.createEl('option', { text: `${lang.vernacularName} (${lang.code})` });
            opt.value = lang.code;
            if (lang.code === this.outputLang) opt.selected = true;
        }
        langSelect.addEventListener('change', () => {
            this.outputLang = langSelect.value;
            this.plugin.settings.outputLanguage = langSelect.value;
            void this.plugin.saveSettings();
            this.plugin.createEngine();
            this.renderTable();
        });

        const capsLabel = topRow.createEl('label', { cls: 'traverture-sidebar-caps-label' });
        const capsCb = capsLabel.createEl('input', { type: 'checkbox' });
        capsCb.checked = this.capitalize;
        capsCb.addEventListener('change', () => {
            this.capitalize = capsCb.checked;
            this.plugin.settings.sidebarCapitalize = this.capitalize;
            void this.plugin.saveSettings();
            this.renderTable();
        });
        capsLabel.createSpan({ text: 'CAPS' });

        const uniqueLabel = topRow.createEl('label', { cls: 'traverture-sidebar-caps-label' });
        const uniqueCb = uniqueLabel.createEl('input', { type: 'checkbox' });
        uniqueCb.checked = this.uniqueOnly;
        uniqueCb.addEventListener('change', () => {
            this.uniqueOnly = uniqueCb.checked;
            this.plugin.settings.sidebarUniqueOnly = this.uniqueOnly;
            void this.plugin.saveSettings();
            this.renderTable();
        });
        uniqueLabel.createSpan({ text: 'UNIQUE' });

        const copyBtn = topRow.createEl('button', { text: 'COPY', cls: 'traverture-sidebar-copy-btn' });
        copyBtn.addEventListener('click', () => {
            const headers = visibleCols.map(c => c.label).join('\t');
            const body = refs.map(r => visibleCols.map(c => this.getRefValue(r, c.key)).join('\t')).join('\n');
            void navigator.clipboard.writeText(`${headers}\n${body}`);
            copyBtn.textContent = 'COPIED';
            window.setTimeout(() => { copyBtn.textContent = 'COPY'; }, 1500);
        });

        const colRow = toolbar.createDiv({ cls: 'traverture-sidebar-col-row' });
        colRow.createSpan({ text: 'Columns:', cls: 'traverture-sidebar-col-label' });

        const allBtn = colRow.createEl('button', { text: 'ALL', cls: 'traverture-sidebar-col-btn' });
        allBtn.addEventListener('click', () => {
            this.visibleColumns = new Set(SIDEBAR_COLUMNS.map(c => c.key));
            this.plugin.settings.sidebarColumns = [...this.visibleColumns];
            void this.plugin.saveSettings();
            this.renderTable();
        });

        const listBtn = colRow.createEl('button', { text: 'REFS', cls: 'traverture-sidebar-col-btn' });
        listBtn.addEventListener('click', () => {
            this.visibleColumns = new Set(['scripture', 'fullRef', 'standardRef', 'officialRef']);
            this.plugin.settings.sidebarColumns = [...this.visibleColumns];
            void this.plugin.saveSettings();
            this.renderTable();
        });

        for (const col of SIDEBAR_COLUMNS) {
            const label = colRow.createEl('label', { cls: 'traverture-sidebar-col-toggle' });
            const cb = label.createEl('input', { type: 'checkbox' });
            cb.checked = this.visibleColumns.has(col.key);
            cb.addEventListener('change', () => {
                if (cb.checked) {
                    this.visibleColumns.add(col.key);
                } else {
                    const remaining = [...this.visibleColumns].filter(k => k !== col.key);
                    if (remaining.length === 0) {
                        cb.checked = true;
                        return;
                    }
                    this.visibleColumns.delete(col.key);
                }
                this.plugin.settings.sidebarColumns = [...this.visibleColumns];
                void this.plugin.saveSettings();
                this.renderTable();
            });
            label.createSpan({ text: col.label });
        }

        const tableWrapper = this.contentEl.createDiv({ cls: 'traverture-sidebar-table-wrapper' });
        const table = tableWrapper.createEl('table', { cls: 'traverture-sidebar-table' });
        const thead = table.createEl('thead');
        const headerRow = thead.createEl('tr');
        for (const col of visibleCols) {
            const th = headerRow.createEl('th', { cls: 'traverture-sidebar-th' });
            th.style.width = col.width; th.style.minWidth = col.width; th.style.textAlign = col.align;
            let arrow = '';
            if (this.sortColumn === col.key) arrow = this.sortDir === 1 ? ' ▲' : (this.sortDir === -1 ? ' ▼' : '');
            const headerLang = this.allRefs[0]?.sourceLanguage || this.plugin.settings.sourceLanguage;
            th.textContent = col.key === 'scripture' ? `${col.label} (${headerLang})${arrow}` : col.label + arrow;
            th.addEventListener('click', () => {
                if (this.sortColumn === col.key) {
                    if (this.sortDir === 1) this.sortDir = -1;
                    else if (this.sortDir === -1) { this.sortDir = 0; this.sortColumn = null; }
                    else this.sortDir = 1;
                } else { this.sortColumn = col.key; this.sortDir = 1; }
                this.renderTable();
            });
        }
        const tbody = table.createEl('tbody');
        for (const ref of refs) {
            const row = tbody.createEl('tr');
            for (const col of visibleCols) {
                const td = row.createEl('td', { cls: 'traverture-sidebar-td' });
                td.style.textAlign = col.align;
                if (col.mono) td.addClass('traverture-mono');
                const displayVal = this.getRefValue(ref, col.key);
                if (col.key === 'fullRef' || col.key === 'standardRef' || col.key === 'officialRef') {
                    const link = td.createEl('a', { text: displayVal, cls: 'traverture-ref-link' });
                    const bcv = ref.startBcv === ref.endBcv ? ref.startBcv : `${ref.startBcv}-${ref.endBcv}`;
                    link.setAttribute('data-bcv', bcv);
                    link.setAttribute('data-ref', displayVal);
                    link.addEventListener('click', (e) => { void (async () => {
                        if (e.button !== 0) return;
                        e.preventDefault(); e.stopPropagation();
                        if (e.ctrlKey || e.metaKey) {
                            window.open(buildJwLibraryUrl(bcv, this.outputLang), '_blank');
                            return;
                        }
                        const timecodes = this.outputLang === 'ase' ? await getAslTimecodes(bcv) : undefined;
                        await this.displayScripture(bcv, displayVal, timecodes, displayVal);
                    })(); });
                } else { td.setText(displayVal); }
            }
        }
        if (wasFocused && this.searchInputEl) { this.searchInputEl.focus(); const len = this.searchInputEl.value.length; this.searchInputEl.setSelectionRange(len, len); }
    }
}