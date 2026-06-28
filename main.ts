import { Plugin, WorkspaceLeaf, Notice, Menu, MarkdownView } from 'obsidian';
// @ts-ignore
import wasmBinary from './engine_bg.wasm';
// @ts-ignore
import * as wasmModule from './engine.js';
import { fetchVerseWithExtras } from './cache';
import { createTravertureEditorPlugin } from './editor';
import { VerseModal } from './modal';
import { TravertureSettingTab } from './settings';
import { TravertureSidebarView } from './sidebar';
import { DEFAULT_SETTINGS, VIEW_TYPE_TRAVERTURE_SIDEBAR, SidebarRef } from './types';

export default class TraverturePlugin extends Plugin {
    settings = DEFAULT_SETTINGS;
    engine: any = null;

    async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
    async saveSettings() { await this.saveData(this.settings); }

    createEngine() {
        try {
            this.engine = new wasmModule.ObsidianEngine(this.settings.sourceLanguage, this.settings.outputLanguage, 'full', false);
        } catch (e) { console.error('tra.VER:ture: Failed to create engine:', e); }
    }

    async parseReferences(text: string): Promise<SidebarRef[]> {
        const results: SidebarRef[] = [];
        if (!this.engine) return results;

        const engineText = text.replace(/\{\{(.+?)\}\}/g, '⟪$1⟫');
        const marked = this.engine.parse_with_markers(engineText);
        const markerRegex = /⟪(.+?)⟫/g;
        let match;

        const engFull = new wasmModule.ObsidianEngine('en', 'en', 'full', false);
        const engStd = new wasmModule.ObsidianEngine('en', 'en', 'standard', false);
        const engOff = new wasmModule.ObsidianEngine('en', 'en', 'official', false);

        while ((match = markerRegex.exec(marked)) !== null) {
            const originalRef = match[1];
            const parsed = this.engine.parse(
                this.settings.sourceLanguage,
                this.settings.outputLanguage,
                'full',
                false,
                `⟪${originalRef}⟫`
            );
            if (!parsed) continue;

            const clauses: Array<[string, string[][]]> = JSON.parse(parsed);
            if (clauses.length === 0) continue;

            for (const [_clauseText, ranges] of clauses) {
                for (const range of ranges) {
                    const singleRange = [[range[0], range[1]]];
                    const rangeJson = JSON.stringify(singleRange);
                    const fullDecoded = JSON.parse(engFull.decode_scriptures(rangeJson));
                    const stdDecoded = JSON.parse(engStd.decode_scriptures(rangeJson));
                    const offDecoded = JSON.parse(engOff.decode_scriptures(rangeJson));
                    const startBcv = range[0], endBcv = range[1];

                    results.push({
                        scripture: originalRef,
                        fullRef: fullDecoded[0] || originalRef,
                        standardRef: stdDecoded[0] || '',
                        officialRef: offDecoded[0] || '',
                        startBcv, endBcv,
                        startCh: parseInt(startBcv.substring(2, 5)),
                        endCh: parseInt(endBcv.substring(2, 5)),
                        startVerse: parseInt(startBcv.substring(5, 8)),
                        endVerse: parseInt(endBcv.substring(5, 8)),
                        bookNum: parseInt(startBcv.substring(0, 2)),
                    });
                }
            }
        }
        return results;
    }

    processElement(el: HTMLElement) {
        let html = el.innerHTML;
        if (/\{\{(.+?)\}\}/g.test(html)) {
            html = html.replace(/\{\{(.+?)\}\}/g, (_fullMatch: string, inner: string) => {
                if (!this.engine) return _fullMatch;
                
                const cleanMatch = _fullMatch.replace(/\*\*/g, '').replace(/\*/g, '');
                const engineInput = cleanMatch.replace('{{', '⟪').replace('}}', '⟫');
                const parsed = this.engine.parse(
                    this.settings.sourceLanguage,
                    this.settings.outputLanguage,
                    'full',
                    false,
                    engineInput
                );
                const clauses: Array<[string, string[][]]> = JSON.parse(parsed);
                if (clauses.length === 0) return inner;
                return this.insertLinks(inner, clauses);
            });
        }

        if (this.settings.autoDetect && this.engine) {
            const tempDiv = activeDocument.createElement('div');
            tempDiv.innerHTML = html;

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
                const parsed = this.engine.parse(
                    this.settings.sourceLanguage,
                    this.settings.outputLanguage,
                    'full',
                    false,
                    text
                );
                const clauses: Array<[string, string[][]]> = JSON.parse(parsed);
                if (clauses.length === 0) continue;

                const linked = this.insertLinks(text, clauses);
                if (linked !== text) {
                    const fragment = activeDocument.createDocumentFragment();
                    const span = activeDocument.createElement('span');
                    span.innerHTML = linked;
                    while (span.firstChild) fragment.appendChild(span.firstChild);
                    textNode.parentNode?.replaceChild(fragment, textNode);
                }
            }
            html = tempDiv.innerHTML;
        }

        const parsed = new DOMParser().parseFromString(html, 'text/html');
        while (el.firstChild) el.removeChild(el.firstChild);
        for (const child of Array.from(parsed.body.childNodes)) {
            el.appendChild(child.cloneNode(true));
        }

        el.querySelectorAll('.traverture-ref-link').forEach(link => {
            link.addEventListener('click', (e) => { void (async () => {
                e.preventDefault(); e.stopPropagation();
                const bcv = link.getAttribute('data-bcv')!;
                const refText = link.getAttribute('data-ref') || link.textContent || '';
                const modal = new VerseModal();
                modal.show({ html: `<p><em>Loading...</em></p>`, citation: refText }, bcv, this.settings.outputLanguage, refText);
                const verseData = await fetchVerseWithExtras(bcv, this.settings.outputLanguage);
                modal.show(verseData || { html: `<p><em>Verse lookup unavailable</em></p>`, citation: refText }, bcv, this.settings.outputLanguage, refText);
            })(); });
        });
    }

    private insertLinks(text: string, clauses: Array<[string, string[][]]>): string {
        if (clauses.length === 0) return text;

        const positions: Array<{ start: number; end: number; clause: [string, string[][]]; displayText: string; bcv: string }> = [];
        let bookName = '';

        const sorted = [...clauses].sort((a, b) => b[0].length - a[0].length);

        for (let i = 0; i < sorted.length; i++) {
            const [clauseText, ranges] = sorted[i];
            const origIndex = clauses.indexOf(sorted[i]);

            if (origIndex === 0) {
                const match = clauseText.match(/^(.+?)\s+\d/);
                if (match) bookName = match[1];
            }

            let displayText = clauseText;
            if (/^\d/.test(clauseText) && bookName && !clauseText.startsWith(bookName)) {
                displayText = `${bookName} ${clauseText}`;
            }

            if (ranges.length === 0) continue;
            const bcv = ranges[0][0] === ranges[0][1] ? ranges[0][0] : `${ranges[0][0]}-${ranges[0][1]}`;

            let searchFrom = 0;
            let found = false;
            while (!found) {
                const idx = text.indexOf(clauseText, searchFrom);
                if (idx === -1) break;

                const overlaps = positions.some(p => idx < p.end && idx + clauseText.length > p.start);
                if (!overlaps) {
                    positions.push({ start: idx, end: idx + clauseText.length, clause: sorted[i], displayText, bcv });
                    found = true;
                }
                searchFrom = idx + 1;
            }
        }

        if (positions.length === 0) return text;
        positions.sort((a, b) => a.start - b.start);
        let result = '';
        let pos = 0;

        for (const p of positions) {
            result += text.substring(pos, p.start);
            const link = `<a class="traverture-ref-link" data-bcv="${p.bcv}" data-ref="${p.displayText}">${text.substring(p.start, p.end)}</a>`;
            result += link;
            pos = p.end;
        }
        result += text.substring(pos);
        return result;
    }

    tagReferences(editor: any, text: string, isWholeDoc: boolean = false) {
        if (!text.trim()) { new Notice('No text to tag.'); return; }

        const parsed = this.engine?.parse(
            this.settings.sourceLanguage,
            this.settings.sourceLanguage,
            'full',
            false,
            text
        );
        if (!parsed) { new Notice('No scripture references found.'); return; }

        const data = JSON.parse(parsed);
        if (Object.keys(data).length === 0) { new Notice('No scripture references found.'); return; }

        const refs = Object.keys(data).sort((a, b) => b.length - a.length);
        let result = text;

        for (const ref of refs) {
            const escapedRef = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(?<!\\{\\{)${escapedRef}(?!\\}\\})`, 'g');
            result = result.replace(regex, `{{${ref}}}`);
        }

        if (isWholeDoc) {
            editor.setValue(result);
        } else {
            editor.replaceSelection(result);
        }
    }

    async onload() {
        await this.loadSettings();

        try { await wasmModule.default({ module_or_path: wasmBinary }); this.createEngine(); }
        catch (e) { console.error('tra.VER:ture: WASM error:', e); }

        this.addSettingTab(new TravertureSettingTab(this.app, this));
        this.registerView(VIEW_TYPE_TRAVERTURE_SIDEBAR, (leaf) => new TravertureSidebarView(leaf, this));

        this.addCommand({ id: 'parse-document-references', name: 'tra.VER:ture: Parse document', callback: async () => {
            const file = this.app.workspace.getActiveFile(); if (!file) return;
            await this.showSidebarWithResults(await this.parseReferences(await this.app.vault.read(file)));
        }});

        this.addCommand({ id: 'parse-selection-references', name: 'tra.VER:ture: Parse selection', editorCallback: async (editor: any) => {
            const selection = editor.getSelection(); if (!selection) return;
            await this.showSidebarWithResults(await this.parseReferences(selection));
        }});

        this.registerEditorExtension(createTravertureEditorPlugin(this));

        this.registerMarkdownPostProcessor((element, _context) => {
            this.processElement(element);
        });

        this.registerDomEvent(activeDocument, 'click', (evt: MouseEvent) => {
            const target = evt.target as HTMLElement;
            if (target.classList.contains('traverture-ref-link') && target.getAttribute('data-bcv')) {
                evt.preventDefault(); evt.stopPropagation();
                const bcv = target.getAttribute('data-bcv')!;
                const refText = target.getAttribute('data-ref') || target.textContent || '';
                const modal = new VerseModal();
                // @ts-ignore
                modal.show({ html: `<p><em>Loading...</em></p>`, citation: refText }, bcv, this.settings.outputLanguage, refText);
                void fetchVerseWithExtras(bcv, this.settings.outputLanguage).then(verseData => {
                    // @ts-ignore
                    modal.show(verseData || { html: `<p><em>Verse lookup unavailable</em></p>`, citation: refText }, bcv, this.settings.outputLanguage, refText);
                });
            }
        });

        this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, _view) => {
            const selection = editor.getSelection();
            menu.addItem((item: any) => {
                item.setTitle('tra.VER:ture').setIcon('book-open');
                const submenu = item.setSubmenu();

                if (selection) {
                    submenu.addItem((subItem: any) => subItem.setTitle('Parse selection').setIcon('sidebar-right').onClick(async () => { await this.showSidebarWithResults(await this.parseReferences(selection)); }));
                        submenu.addItem((subItem: any) => {
                            subItem.setTitle('Insert citation').setIcon('quote-glyph');
                            const citeMenu = subItem.setSubmenu();
                            citeMenu.addItem((citeItem: any) => citeItem.setTitle('Reference: "verse"').onClick(async () => {
                                await this.insertCitation(editor, selection, false);
                            }));
                            citeMenu.addItem((citeItem: any) => citeItem.setTitle('"verse" (Reference)').onClick(async () => {
                                await this.insertCitation(editor, selection, true);
                            }));
                        });
                    submenu.addItem((subItem: any) => subItem.setTitle('Tag selection').setIcon('hash').onClick(() => { this.tagReferences(editor, selection); }));
                    submenu.addItem((subItem: any) => {
                        subItem.setTitle('Reformat selection').setIcon('pencil');
                        const reformatMenu = subItem.setSubmenu();
                        reformatMenu.addItem((fmtItem: any) => fmtItem.setTitle('Full (1 Corinthians)').onClick(() => this.reformatReferences(editor, selection, 'full')));
                        reformatMenu.addItem((fmtItem: any) => fmtItem.setTitle('Standard (1 Cor.)').onClick(() => this.reformatReferences(editor, selection, 'standard')));
                        reformatMenu.addItem((fmtItem: any) => fmtItem.setTitle('Official (1Co)').onClick(() => this.reformatReferences(editor, selection, 'official')));
                    });
                    submenu.addSeparator();
                }

                submenu.addItem((subItem: any) => subItem.setTitle('Parse document').setIcon('sidebar-right').onClick(async () => { await this.showSidebarWithResults(await this.parseReferences(editor.getValue())); }));
                submenu.addItem((subItem: any) => subItem.setTitle('Tag document').setIcon('hash').onClick(() => { this.tagReferences(editor, editor.getValue(), true); }));
                submenu.addItem((subItem: any) => {
                    subItem.setTitle('Reformat document').setIcon('pencil');
                    const reformatMenu = subItem.setSubmenu();
                    reformatMenu.addItem((fmtItem: any) => fmtItem.setTitle('Full (1 Corinthians)').onClick(() => this.reformatReferences(editor, editor.getValue(), 'full', true)));
                    reformatMenu.addItem((fmtItem: any) => fmtItem.setTitle('Standard (1 Cor.)').onClick(() => this.reformatReferences(editor, editor.getValue(), 'standard', true)));
                    reformatMenu.addItem((fmtItem: any) => fmtItem.setTitle('Official (1Co)').onClick(() => this.reformatReferences(editor, editor.getValue(), 'official', true)));
                });
            });
        }));

        this.registerDomEvent(activeDocument, 'contextmenu', (evt: MouseEvent) => {
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!view || view.getMode() !== 'preview') return;

            const selection = activeDocument.getSelection()?.toString() || '';

            evt.preventDefault();
            evt.stopPropagation();

            const menu = new Menu();
            menu.addItem((item: any) => {
                item.setTitle('tra.VER:ture').setIcon('book-open');
                const submenu = item.setSubmenu();

                if (selection) {
                    submenu.addItem((subItem: any) => subItem.setTitle('Parse selection').setIcon('sidebar-right').onClick(async () => {
                        await this.showSidebarWithResults(await this.parseReferences(selection));
                    }));
                }

                submenu.addItem((subItem: any) => subItem.setTitle('Parse document').setIcon('sidebar-right').onClick(async () => {
                    const file = view.file;
                    if (!file) return;
                    const content = await this.app.vault.read(file);
                    await this.showSidebarWithResults(await this.parseReferences(content));
                }));
            });
            menu.showAtMouseEvent(evt);
        });

        // Mobile traverture menu
        this.addRibbonIcon('scroll', 'tra.VER:ture', () => {
            const file = this.app.workspace.getActiveFile();
            const editor = this.app.workspace.activeEditor?.editor;
            const sel = editor?.getSelection();
            const menu = new Menu();

            if (sel) {
                menu.addItem((item: any) => item.setTitle('Parse selection').setIcon('sidebar-right').onClick(async () => {
                    await this.showSidebarWithResults(await this.parseReferences(sel));
                }));
                menu.addItem((item: any) => {
                    item.setTitle('Insert citation').setIcon('quote-glyph');
                    const citeMenu = item.setSubmenu();
                    citeMenu.addItem((citeItem: any) => citeItem.setTitle('Reference: "verse"').onClick(async () => {
                        if (editor && sel) await this.insertCitation(editor, sel, false);
                    }));
                    citeMenu.addItem((citeItem: any) => citeItem.setTitle('"verse" (Reference)').onClick(async () => {
                        if (editor && sel) await this.insertCitation(editor, sel, true);
                    }));
                });
                menu.addItem((item: any) => item.setTitle('Tag selection').setIcon('hash').onClick(() => {
                    this.tagReferences(editor!, sel);
                }));
                menu.addItem((item: any) => {
                    item.setTitle('Reformat selection').setIcon('pencil');
                    const submenu = item.setSubmenu();
                    submenu.addItem((fmtItem: any) => fmtItem.setTitle('Full (1 Corinthians)').onClick(() => this.reformatReferences(editor!, sel, 'full')));
                    submenu.addItem((fmtItem: any) => fmtItem.setTitle('Standard (1 Cor.)').onClick(() => this.reformatReferences(editor!, sel, 'standard')));
                    submenu.addItem((fmtItem: any) => fmtItem.setTitle('Official (1Co)').onClick(() => this.reformatReferences(editor!, sel, 'official')));
                });
                menu.addSeparator();
            }

            menu.addItem((item: any) => item.setTitle('Parse document').setIcon('sidebar-right').onClick(async () => {
                if (!file) { new Notice('No file open.'); return; }
                await this.showSidebarWithResults(await this.parseReferences(await this.app.vault.read(file)));
            }));

            menu.addItem((item: any) => item.setTitle('Tag document').setIcon('hash').onClick(() => {
                if (editor) this.tagReferences(editor, editor.getValue(), true);
            }));

            menu.addItem((item: any) => {
                item.setTitle('Reformat document').setIcon('pencil');
                const submenu = item.setSubmenu();
                submenu.addItem((fmtItem: any) => fmtItem.setTitle('Full (1 Corinthians)').onClick(() => {
                    if (editor) this.reformatReferences(editor, editor.getValue(), 'full', true);
                }));
                submenu.addItem((fmtItem: any) => fmtItem.setTitle('Standard (1 Cor.)').onClick(() => {
                    if (editor) this.reformatReferences(editor, editor.getValue(), 'standard', true);
                }));
                submenu.addItem((fmtItem: any) => fmtItem.setTitle('Official (1Co)').onClick(() => {
                    if (editor) this.reformatReferences(editor, editor.getValue(), 'official', true);
                }));
            });

            menu.showAtMouseEvent({ clientX: 100, clientY: 100 } as MouseEvent);
        });
    }

    async showSidebarWithResults(refs: SidebarRef[]) {
        const { workspace } = this.app;
        let leaves = workspace.getLeavesOfType(VIEW_TYPE_TRAVERTURE_SIDEBAR);
        let leaf: WorkspaceLeaf;
        if (leaves.length > 0) { leaf = leaves[0]; }
        else { const rightLeaf = workspace.getRightLeaf(false); if (!rightLeaf) return; await rightLeaf.setViewState({ type: VIEW_TYPE_TRAVERTURE_SIDEBAR, active: true }); leaf = rightLeaf; }
        await leaf.loadIfDeferred();
        workspace.revealLeaf(leaf);
        (leaf.view as TravertureSidebarView).displayResults(refs);
    }

    reformatReferences(editor: any, text: string, format: string, wholeDoc: boolean = false) {
        const parsed = this.engine?.parse(this.settings.sourceLanguage, this.settings.outputLanguage, format, false, text);
        if (!parsed) return;
        const data = JSON.parse(parsed); let processed = text;
        for (const [ref, bcvRanges] of Object.entries(data)) {
            const fmtEngine = new wasmModule.ObsidianEngine('en', 'en', format, false);
            processed = processed.replace(ref, JSON.parse(fmtEngine.decode_scriptures(JSON.stringify(bcvRanges))).join('; '));
        }
        if (wholeDoc) { editor.setValue(processed); }
        else { editor.replaceSelection(processed); }
    }

    async insertCitation(editor: any, text: string, withRef: boolean) {
        const parsed = this.engine?.parse(this.settings.sourceLanguage, this.settings.sourceLanguage, 'full', false, text);
        if (!parsed || Object.keys(JSON.parse(parsed)).length === 0) { new Notice('No scripture references found.'); return; }
        const data = JSON.parse(parsed); let result = text; const fetchedSet = new Set<string>();
        for (const [originalRef, bcvRanges] of Object.entries(data)) {
            const ranges = bcvRanges as string[][]; if (ranges.length === 0) continue;
            const bcv = ranges[0][0] === ranges[0][1] ? ranges[0][0] : `${ranges[0][0]}-${ranges[0][1]}`;
            const cacheKey = `${this.settings.sourceLanguage}:${bcv}`;
            let verseText = '';
            if (!fetchedSet.has(cacheKey)) {
                const verseData = await fetchVerseWithExtras(bcv, this.settings.sourceLanguage);
                if (verseData) {
                    let html = verseData.html.replace(/<span class="parabreak"><\/span>/g, ' ').replace(/<span class="newblock"><\/span>/g, ' ');
                    const tempDiv = activeDocument.createElement('div');
                    const parsed = new DOMParser().parseFromString(html, 'text/html');
                    for (const child of Array.from(parsed.body.childNodes)) {
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
                }
                fetchedSet.add(cacheKey);
            }
            result = result.replace(originalRef, withRef ? `"${verseText}" (${originalRef})` : `${originalRef}: "${verseText}"`);
        }
        editor.replaceSelection(result);
    }

    onunload() { }
}