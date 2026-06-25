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

        const marked = this.engine.parse_with_markers(text);
        const markerRegex = /\{\{(.+?)\}\}/g;
        let match;
        const orderedRefs: string[] = [];
        while ((match = markerRegex.exec(marked)) !== null) orderedRefs.push(match[1].trim());
        if (orderedRefs.length === 0) return results;

        const parsed = this.engine.parse(this.settings.sourceLanguage, this.settings.outputLanguage, 'full', false, text);
        if (!parsed) return results;
        const data = JSON.parse(parsed);

        const engFull = new wasmModule.ObsidianEngine('en', 'en', 'full', false);
        const engStd = new wasmModule.ObsidianEngine('en', 'en', 'standard', false);
        const engOff = new wasmModule.ObsidianEngine('en', 'en', 'official', false);

        for (const scripture of orderedRefs) {
            const bcvRanges = data[scripture];
            if (!bcvRanges) continue;
            const ranges = bcvRanges as string[][];
            for (let i = 0; i < ranges.length; i++) {
                const singleRange = [ranges[i]], rangeJson = JSON.stringify(singleRange);
                const fullDecoded = JSON.parse(engFull.decode_scriptures(rangeJson));
                const stdDecoded = JSON.parse(engStd.decode_scriptures(rangeJson));
                const offDecoded = JSON.parse(engOff.decode_scriptures(rangeJson));
                const startBcv = ranges[i][0], endBcv = ranges[i][1];
                results.push({
                    scripture, fullRef: fullDecoded[0] || scripture, standardRef: stdDecoded[0] || '', officialRef: offDecoded[0] || '',
                    startBcv, endBcv,
                    startCh: parseInt(startBcv.substring(2, 5)), endCh: parseInt(endBcv.substring(2, 5)),
                    startVerse: parseInt(startBcv.substring(5, 8)), endVerse: parseInt(endBcv.substring(5, 8)),
                    bookNum: parseInt(startBcv.substring(0, 2)),
                });
            }
        }
        return results;
    }

    processElement(el: HTMLElement) {
        let html = el.innerHTML;
        if (!/\{\{(.+?)\}\}/g.test(html)) return;

        html = html.replace(/\{\{(.+?)\}\}/g, (_fullMatch: string, inner: string) => {
            if (!this.engine) return _fullMatch;
            const refText = inner.replace(/\*\*/g, '').replace(/\*/g, '');
            const marked = this.engine.parse_with_markers(refText);

            let result = marked.replace(/\{\{(.+?)\}\}/g, (_m: string, ref: string) => {
                const parsed = this.engine.parse(
                    this.settings.sourceLanguage,
                    this.settings.outputLanguage,
                    'full',
                    false,
                    ref
                );
                const data = JSON.parse(parsed);
                const keys = Object.keys(data);
                if (keys.length > 0) {
                    const firstRange = (data[keys[0]] as string[][])[0];
                    const bcv = firstRange[0] === firstRange[1] ? firstRange[0] : `${firstRange[0]}-${firstRange[1]}`;
                    return `<a class="traverture-ref-link" data-bcv="${bcv}" data-ref="${ref}">${ref}</a>`;
                }
                return ref;
            });
            return result;
        });

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