// sidebar.ts

import { ItemView, WorkspaceLeaf, ViewStateResult } from 'obsidian';
import { getAvailableLanguagesCached as getAvailableLanguages, getBookName, getLangSymbol } from './engine-wrapper';
import { fetchVerseWithExtras, getAslTimecodes } from './cache';
import { VerseModal } from './modal';
import { SidebarRef, VIEW_TYPE_TRAVERTURE_SIDEBAR, NameFormat } from './types';
import type TraverturePlugin from './main';

export const SIDEBAR_COLUMNS = [
    { key: 'scripture', label: 'Original', width: '140px', align: 'left' as const, mono: undefined as true | undefined },
    { key: 'fullRef', label: 'Full', width: '180px', align: 'left' as const, mono: undefined as true | undefined },
    { key: 'standardRef', label: 'Standard', width: '140px', align: 'left' as const, mono: undefined as true | undefined },
    { key: 'officialRef', label: 'Official', width: '120px', align: 'left' as const, mono: undefined as true | undefined },
    { key: 'startBcv', label: 'Start BCV', width: '120px', align: 'center' as const, mono: true as true },
    { key: 'endBcv', label: 'End BCV', width: '120px', align: 'center' as const, mono: true as true },
    { key: 'startCh', label: 'Start Ch', width: '80px', align: 'center' as const, mono: true as true },
    { key: 'endCh', label: 'End Ch', width: '80px', align: 'center' as const, mono: true as true },
    { key: 'startVerse', label: 'Start Vs', width: '80px', align: 'center' as const, mono: true as true },
    { key: 'endVerse', label: 'End Vs', width: '80px', align: 'center' as const, mono: true as true },
] as const;

type SidebarColumnKey = typeof SIDEBAR_COLUMNS[number]['key'];

export class TravertureSidebarView extends ItemView {
    plugin: TraverturePlugin;
    private allRefs: SidebarRef[] = [];
    private searchQuery: string = '';
    private sortColumn: string | null = null;
    private sortDir: number = 0;
    private visibleColumns: Set<string> = new Set(SIDEBAR_COLUMNS.map(c => c.key));
    private searchInputEl: HTMLInputElement | null = null;
    private outputLang: string;
    private capitalize: boolean = false;
    private uniqueOnly: boolean = false;

    constructor(leaf: WorkspaceLeaf, plugin: TraverturePlugin) {
        super(leaf);
        this.plugin = plugin;
        this.outputLang = plugin.settings.outputLanguage;
    }

    getViewType(): string { return VIEW_TYPE_TRAVERTURE_SIDEBAR; }
    getDisplayText(): string { return 'tra.VER:ture References'; }
    getIcon(): string { return 'book-open'; }

    async onOpen() { this.contentEl.empty(); this.contentEl.addClass('traverture-sidebar'); }
    async onClose() { this.contentEl.empty(); }

    async setState(state: Record<string, unknown>, _result: ViewStateResult): Promise<void> {
        if (state) {
            if (typeof state.outputLang === 'string') this.outputLang = state.outputLang;
            if (typeof state.capitalize === 'boolean') this.capitalize = state.capitalize;
            if (typeof state.uniqueOnly === 'boolean') this.uniqueOnly = state.uniqueOnly;
            if (Array.isArray(state.visibleColumns)) {
                this.visibleColumns = new Set(state.visibleColumns as string[]);
            }
        }
        await super.setState(state, _result);
    }

    getState(): Record<string, unknown> {
        const state = super.getState();
        return { ...state, outputLang: this.outputLang, capitalize: this.capitalize, uniqueOnly: this.uniqueOnly, visibleColumns: [...this.visibleColumns] };
    }

    private renderEmpty(message: string) {
        this.contentEl.empty();
        this.contentEl.addClass('traverture-sidebar');
        this.contentEl.createEl('p', { text: message, cls: 'traverture-sidebar-empty' });
    }

    async displayResults(refs: SidebarRef[]) {
        this.allRefs = refs;
        this.sortColumn = null;
        this.sortDir = 0;
        this.render();
    }

    private normalizeForSearch(text: string): string {
        return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '').toLowerCase();
    }

    private getDisplayRef(ref: SidebarRef, format: NameFormat): string {
        const bookName = getBookName(ref.bookNum, this.outputLang, format, this.capitalize);
        if (!bookName) return ref.fullRef;
        const engBookName = getBookName(ref.bookNum, 'en', 'full', false);
        if (engBookName && ref.fullRef.startsWith(engBookName)) {
            const rest = ref.fullRef.substring(engBookName.length); // " 3" or " 1:3"
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

    render() {
        const wasFocused = this.searchInputEl && activeDocument.activeElement === this.searchInputEl;
        this.contentEl.empty();
        this.contentEl.addClass('traverture-sidebar');
        if (this.allRefs.length === 0) { this.renderEmpty('No references found.'); return; }

        const refs = this.getFilteredSortedRefs();
        const visibleCols = SIDEBAR_COLUMNS.filter(c => this.visibleColumns.has(c.key));
        this.app.workspace.requestSaveLayout();
        const languages = getAvailableLanguages();

        const toolbar = this.contentEl.createDiv({ cls: 'traverture-sidebar-toolbar' });
        const topRow = toolbar.createDiv({ cls: 'traverture-sidebar-top-row' });

        const searchWrap = topRow.createDiv({ cls: 'traverture-sidebar-search-wrap' });
        this.searchInputEl = searchWrap.createEl('input', { type: 'text', placeholder: 'Search...', cls: 'traverture-sidebar-search' });
        this.searchInputEl.value = this.searchQuery;
        this.searchInputEl.addEventListener('input', () => { this.searchQuery = this.searchInputEl!.value; this.render(); });
        if (this.searchQuery) {
            const clearX = searchWrap.createEl('button', { cls: 'traverture-sidebar-search-clear' });
            clearX.setText('\u2715');
            clearX.addEventListener('click', () => { this.searchQuery = ''; this.render(); });
        }

        topRow.createEl('span', { text: `${refs.length} results`, cls: 'traverture-sidebar-count' });
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
            this.render();
        });

        const capsLabel = topRow.createEl('label', { cls: 'traverture-sidebar-caps-label' });
        const capsCb = capsLabel.createEl('input', { type: 'checkbox' });
        capsCb.checked = this.capitalize;
        capsCb.addEventListener('change', () => { this.capitalize = capsCb.checked; this.render(); });
        capsLabel.createEl('span', { text: 'CAPS' });

        const uniqueLabel = topRow.createEl('label', { cls: 'traverture-sidebar-caps-label' });
        const uniqueCb = uniqueLabel.createEl('input', { type: 'checkbox' });
        uniqueCb.checked = this.uniqueOnly;
        uniqueCb.addEventListener('change', () => { this.uniqueOnly = uniqueCb.checked; this.render(); });
        uniqueLabel.createEl('span', { text: 'UNIQUE' });

        const copyBtn = topRow.createEl('button', { text: 'COPY', cls: 'traverture-sidebar-copy-btn' });
        copyBtn.addEventListener('click', () => {
            const headers = visibleCols.map(c => c.label).join('\t');
            const body = refs.map(r => visibleCols.map(c => this.getRefValue(r, c.key)).join('\t')).join('\n');
            void navigator.clipboard.writeText(`${headers}\n${body}`);
            copyBtn.textContent = 'COPIED';
            window.setTimeout(() => { copyBtn.textContent = 'COPY'; }, 1500);
        });

        const colRow = toolbar.createDiv({ cls: 'traverture-sidebar-col-row' });
        colRow.createEl('span', { text: 'Columns:', cls: 'traverture-sidebar-col-label' });

        const allBtn = colRow.createEl('button', { text: 'ALL', cls: 'traverture-sidebar-col-btn' });
        allBtn.addEventListener('click', () => { this.visibleColumns = new Set(SIDEBAR_COLUMNS.map(c => c.key)); this.render(); });

        const listBtn = colRow.createEl('button', { text: 'REFS', cls: 'traverture-sidebar-col-btn' });
        listBtn.addEventListener('click', () => { this.visibleColumns = new Set(['scripture', 'fullRef', 'standardRef', 'officialRef']); this.render(); });

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
                this.render();
            });
            label.createEl('span', { text: col.label });
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
            th.textContent = col.key === 'scripture' ? `${col.label} (${this.plugin.settings.sourceLanguage})${arrow}` : col.label + arrow;
            th.addEventListener('click', () => {
                if (this.sortColumn === col.key) {
                    if (this.sortDir === 1) this.sortDir = -1;
                    else if (this.sortDir === -1) { this.sortDir = 0; this.sortColumn = null; }
                    else this.sortDir = 1;
                } else { this.sortColumn = col.key; this.sortDir = 1; }
                this.render();
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
                        if (e.ctrlKey || e.metaKey) {
                            const langSymbol = getLangSymbol(this.outputLang);
                            window.open(`jwlibrary:///finder?wtlocale=${langSymbol}&bible=${bcv}`, '_blank');
                            return;
                        }
                        e.preventDefault(); e.stopPropagation();
                        const timecodes = this.outputLang === 'ase' 
                            ? await getAslTimecodes(bcv) 
                            : undefined;
                        const modal = new VerseModal();
                        modal.show({ html: `<p><em>Loading...</em></p>`, citation: displayVal }, bcv, this.outputLang, displayVal, timecodes);
                        const verseData = await fetchVerseWithExtras(bcv, this.outputLang, modal.getSignal());
                        if (!modal.isVisible()) return;
                        modal.show(verseData || { html: `<p><em>Verse lookup unavailable</em></p>`, citation: displayVal }, bcv, this.outputLang, displayVal, timecodes);
                    })(); });
                } else { td.setText(displayVal); }
            }
        }
        if (wasFocused && this.searchInputEl) { this.searchInputEl.focus(); const len = this.searchInputEl.value.length; this.searchInputEl.setSelectionRange(len, len); }
    }
}