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
            this.engine = new wasmModule.TravertureEngine(this.settings.sourceLanguage, this.settings.outputLanguage, 'full', false);
        } catch (e) { console.error('tra.VER:ture: Failed to create engine:', e); }
    }

    private parseGuard = false;

    safeParse(text: string): string | null {
        return this.engine.parse(
            this.settings.sourceLanguage,
            this.settings.outputLanguage,
            'full',
            false,
            text
        );
    }

    async parseReferences(text: string): Promise<SidebarRef[]> {
        const results: SidebarRef[] = [];
        if (!this.engine) return results;

        const engineText = text.replace(/\{\{(.+?)\}\}/g, '⟪⟪$1⟫⟫');
        const parsed = this.safeParse(engineText);
        if (!parsed) return results;

        const clauses: Array<[string, number, number, string[][]]> = JSON.parse(parsed);
        if (clauses.length === 0) return results;

        let currentOriginal = '';
        let lastBookNum = -1;

        const engFull = new wasmModule.TravertureEngine('en', 'en', 'full', false);
        const engStd = new wasmModule.TravertureEngine('en', 'en', 'standard', false);
        const engOff = new wasmModule.TravertureEngine('en', 'en', 'official', false);

        for (const [_clauseText, _startPos, _endPos, ranges] of clauses) {
            if (ranges.length === 0) continue;
            const bookNum = parseInt(ranges[0][0].substring(0, 2));

            if (bookNum !== lastBookNum) {
                currentOriginal = _clauseText;
                lastBookNum = bookNum;
            } else if (currentOriginal && /^\d/.test(_clauseText)) {
                currentOriginal += `; ${_clauseText}`;
            } else {
                currentOriginal = _clauseText;
            }

            for (const range of ranges) {
                const singleRange = [[range[0], range[1]]];
                const rangeJson = JSON.stringify(singleRange);
                const fullDecoded = JSON.parse(engFull.decode_scriptures(rangeJson));
                const stdDecoded = JSON.parse(engStd.decode_scriptures(rangeJson));
                const offDecoded = JSON.parse(engOff.decode_scriptures(rangeJson));
                const startBcv = range[0], endBcv = range[1];

                results.push({
                    scripture: currentOriginal,
                    fullRef: fullDecoded[0] || currentOriginal,
                    standardRef: stdDecoded[0] || '',
                    officialRef: offDecoded[0] || '',
                    startBcv, endBcv,
                    startCh: parseInt(startBcv.substring(2, 5)),
                    endCh: parseInt(endBcv.substring(2, 5)),
                    startVerse: parseInt(startBcv.substring(5, 8)),
                    endVerse: parseInt(endBcv.substring(5, 8)),
                    bookNum,
                });
            }
        }
        return results;
    }

    processElement(el: HTMLElement) {
        let html = el.innerHTML;

        // Process {{ }} blocks (forced parsing)
        if (/\{\{(.+?)\}\}/g.test(html)) {
            html = html.replace(/\{\{(.+?)\}\}/g, (_fullMatch: string, inner: string) => {
                if (!this.engine) return _fullMatch;
                
                const refText = inner.replace(/\*\*/g, '').replace(/\*/g, '');
                const engineInput = '⟪⟪' + refText + '⟫⟫';
                const parsed = this.safeParse(engineInput);
                if (!parsed) return inner;
                const clauses: Array<[string, number, number, string[][]]> = JSON.parse(parsed);
                if (clauses.length === 0) return inner;

                let result = inner;
                let bookName = '';
                const sorted = [...clauses].sort((a, b) => b[0].length - a[0].length);
                
                for (let i = 0; i < sorted.length; i++) {
                    const [clauseText, _startPos, _endPos, ranges] = sorted[i];
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
                const parsed = this.safeParse(text);
                if (!parsed) continue;
                const clauses: Array<[string, number, number, string[][]]> = JSON.parse(parsed);
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
                e.preventDefault(); e.stopPropagation();
                const bcv = link.getAttribute('data-bcv')!;
                const fmtEngine = new wasmModule.TravertureEngine(this.settings.sourceLanguage, this.settings.outputLanguage, this.settings.titleFormat, false);
                const decoded = JSON.parse(fmtEngine.decode_scriptures(JSON.stringify([[bcv, bcv]])));
                const refText = decoded[0] || link.textContent || '';
                const modal = new VerseModal();
                modal.show({ html: `<p><em>Loading...</em></p>`, citation: refText }, bcv, this.settings.outputLanguage, refText);
                const verseData = await fetchVerseWithExtras(bcv, this.settings.outputLanguage);
                modal.show(verseData || { html: `<p><em>Verse lookup unavailable</em></p>`, citation: refText }, bcv, this.settings.outputLanguage, refText);
            })(); });
        });
    }

    private insertLinks(text: string, clauses: Array<[string, number, number, string[][]]>): string {
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

    // tagReferences(editor: any, text: string, isWholeDoc: boolean = false) {
    //     if (!text.trim()) { new Notice('No text to tag.'); return; }

    //     const parsed = this.engine?.parse(
    //         this.settings.sourceLanguage,
    //         this.settings.sourceLanguage,
    //         'full',
    //         false,
    //         text
    //     );
    //     if (!parsed) { new Notice('No scripture references found.'); return; }

    //     const data = JSON.parse(parsed);
    //     if (Object.keys(data).length === 0) { new Notice('No scripture references found.'); return; }

    //     const refs = Object.keys(data).sort((a, b) => b.length - a.length);
    //     let result = text;

    //     for (const ref of refs) {
    //         const escapedRef = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    //         const regex = new RegExp(`(?<!\\{\\{)${escapedRef}(?!\\}\\})`, 'g');
    //         result = result.replace(regex, `{{${ref}}}`);
    //     }

    //     if (isWholeDoc) {
    //         editor.setValue(result);
    //     } else {
    //         editor.replaceSelection(result);
    //     }
    // }

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
        const parsed = this.engine?.parse(this.settings.sourceLanguage, this.settings.outputLanguage, 'full', false, text);
        if (!parsed) return;

        const clauses: Array<[string, number, number, string[][]]> = JSON.parse(parsed);
        if (clauses.length === 0) return;

        let processed = text;
        const replaced = new Set<string>();

        for (const [clauseText, _startPos, _endPos, ranges] of clauses) {
            if (ranges.length === 0) continue;
            if (/^\d/.test(clauseText)) continue;

            const bookMatch = clauseText.match(/^(.+?)\s+\d/);
            if (!bookMatch) continue;
            const bookName = bookMatch[1];

            if (replaced.has(bookName)) continue;
            replaced.add(bookName);

            const bookNum = parseInt(ranges[0][0].substring(0, 2));
            const newBookName = wasmModule.TravertureEngine.get_book_name(bookNum, this.settings.sourceLanguage, format, false);

            if (newBookName && newBookName !== bookName) {
                const escaped = bookName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                processed = processed.replace(new RegExp(escaped, 'g'), newBookName);
            }
        }

        if (wholeDoc) { editor.setValue(processed); }
        else { editor.replaceSelection(processed); }
    }

    async insertCitation(editor: any, text: string, withRef: boolean) {
        const parsed = this.engine?.parse(this.settings.sourceLanguage, this.settings.sourceLanguage, 'full', false, text);
        if (!parsed) { new Notice('No scripture references found.'); return; }
        
        const clauses: Array<[string, number, number, string[][]]> = JSON.parse(parsed);
        if (clauses.length === 0) { new Notice('No scripture references found.'); return; }
        
        const groups: Array<{ original: string; bcvs: string[] }> = [];
        let lastBookNum = -1;
        let groupStart = 0;
        let groupEnd = 0;
        let currentBcvs: string[] = [];
        
        for (const [_clauseText, startPos, endPos, ranges] of clauses) {
            if (ranges.length === 0) continue;
            const bookNum = parseInt(ranges[0][0].substring(0, 2));
            
            if (bookNum !== lastBookNum) {
                if (currentBcvs.length > 0) groups.push({ original: text.substring(groupStart, groupEnd), bcvs: currentBcvs });
                groupStart = startPos;
                lastBookNum = bookNum;
                currentBcvs = [];
            }
            groupEnd = endPos;
            
            for (const range of ranges) {
                currentBcvs.push(range[0] === range[1] ? range[0] : `${range[0]}-${range[1]}`);
            }
        }
        if (currentBcvs.length > 0) groups.push({ original: text.substring(groupStart, groupEnd), bcvs: currentBcvs });
        
        let result = text;
        const fetchedCache = new Map<string, string>();
        
        for (const group of groups) {
            let allText = '';
            for (const bcv of group.bcvs) {
                const cacheKey = `${this.settings.outputLanguage}:${bcv}`;
                let verseText = fetchedCache.get(cacheKey);
                if (verseText === undefined) {
                    const verseData = await fetchVerseWithExtras(bcv, this.settings.outputLanguage);
                    if (verseData) {
                        let html = verseData.html.replace(/<span class="parabreak"><\/span>/g, ' ').replace(/<span class="newblock"><\/span>/g, ' ');
                        const tempDiv = activeDocument.createElement('div');
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
                if (verseText) allText += (allText ? ' ' : '') + verseText;
            }
            
            if (allText) {
                const escaped = group.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                result = result.replace(new RegExp(escaped), withRef ? `"${allText}" (${group.original})` : `${group.original}: "${allText}"`);
            }
        }
        editor.replaceSelection(result);
    }

    onunload() { }
}