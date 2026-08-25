// editor.ts

import { ViewPlugin, EditorView, Decoration, DecorationSet, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { decodeScriptures, getLangSymbol } from './engine-wrapper';
import { fetchVerseWithExtras, getAslTimecodes } from './cache';
import { VerseModal } from './modal';
import { ParsedReference } from './types';
import type TraverturePlugin from './main';

interface BcvEntry {
    from: number;
    to: number;
    bcv: string;
}

interface DecoEntry {
    from: number;
    to: number;
    deco: Decoration;
}

const REF_PATTERN = /\{\{(.+?)\}\}/g;

function buildDecorations(view: EditorView, plugin: TraverturePlugin): DecorationSet {
    const allDecos: DecoEntry[] = [];
    const cursor = view.state.selection.main;
    const bcvs: BcvEntry[] = [];

    for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        const decorated: Array<{ from: number; to: number }> = [];

        let match: RegExpExecArray | null;
        while ((match = REF_PATTERN.exec(text)) !== null) {
            const blockStart = from + match.index;
            const blockEnd = blockStart + match[0].length;
            const innerStart = blockStart + 2;
            const innerEnd = blockEnd - 2;

            if (cursor.from <= blockEnd && cursor.to >= blockStart) continue;

            allDecos.push({ from: blockStart, to: innerStart, deco: Decoration.replace({}) });
            allDecos.push({ from: innerEnd, to: blockEnd, deco: Decoration.replace({}) });
            decorated.push({ from: blockStart, to: innerStart });
            decorated.push({ from: innerEnd, to: blockEnd });

            const innerText = match[1];
            const cleanMatch = match[0].replace(/\*\*/g, '').replace(/\*/g, '');
            const engineInput = cleanMatch.replace('{{', '⟪⟪').replace('}}', '⟫⟫');
            const parsed = plugin.safeParse(engineInput);
            if (!parsed) continue;

            const clauses = JSON.parse(parsed) as ParsedReference[];
            const sorted = [...clauses].sort((a, b) => b[0].length - a[0].length);
            
            for (const clause of sorted) {
                const [clauseText, , , ranges] = clause;
                if (ranges.length === 0) continue;
                const bcv = ranges[0][0] === ranges[0][1] ? ranges[0][0] : `${ranges[0][0]}-${ranges[0][1]}`;
                
                const escaped = clauseText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const refRegex = new RegExp(escaped, 'g');
                let refMatch: RegExpExecArray | null;
                while ((refMatch = refRegex.exec(innerText)) !== null) {
                    const refStart = innerStart + refMatch.index;
                    const refEnd = refStart + clauseText.length;
                    
                    const overlaps = decorated.some(p => refStart < p.to && refEnd > p.from);
                    if (!overlaps) {
                        allDecos.push({ from: refStart, to: refEnd, deco: Decoration.mark({ class: 'cm-traverture-ref' }) });
                        decorated.push({ from: refStart, to: refEnd });
                        bcvs.push({ from: refStart, to: refEnd, bcv });
                    }
                }
            }
        }

        if (plugin.settings.autoDetect) {
            const decoratedRanges = [...decorated].sort((a, b) => a.from - b.from);
            let pos = from;

            for (const d of decoratedRanges) {
                if (pos < d.from) {
                    const segment = view.state.doc.sliceString(pos, d.from);
                    processSegment(pos, segment, plugin, allDecos, decorated, bcvs);
                }
                pos = Math.max(pos, d.to);
            }
            if (pos < to) {
                const segment = view.state.doc.sliceString(pos, to);
                processSegment(pos, segment, plugin, allDecos, decorated, bcvs);
            }
        }
    }

    allDecos.sort((a, b) => a.from - b.from);
    const builder = new RangeSetBuilder<Decoration>();
    for (const d of allDecos) {
        builder.add(d.from, d.to, d.deco);
    }
    (plugin as unknown as { _editBcvs: BcvEntry[] })._editBcvs = bcvs;
    return builder.finish();
}

function processSegment(
    basePos: number,
    segment: string,
    plugin: TraverturePlugin,
    allDecos: DecoEntry[],
    decorated: Array<{ from: number; to: number }>,
    bcvs: BcvEntry[]
): void {
    const parsed = plugin.safeParse(segment);
    if (!parsed) return;

    const clauses = JSON.parse(parsed) as ParsedReference[];
    if (clauses.length === 0) return;

    for (const clause of clauses) {
        const [, startPos, endPos, ranges] = clause;
        if (ranges.length === 0) continue;
        const bcv = ranges[0][0] === ranges[0][1] ? ranges[0][0] : `${ranges[0][0]}-${ranges[0][1]}`;
        
        const refStart = basePos + startPos;
        const refEnd = basePos + endPos;

        const overlaps = decorated.some(p => refStart < p.to && refEnd > p.from);
        if (!overlaps) {
            allDecos.push({ from: refStart, to: refEnd, deco: Decoration.mark({ class: 'cm-traverture-ref' }) });
            decorated.push({ from: refStart, to: refEnd });
            bcvs.push({ from: refStart, to: refEnd, bcv });
        }
    }
}

export function createTravertureEditorPlugin(plugin: TraverturePlugin) {
    (plugin as unknown as { _editBcvs: BcvEntry[] })._editBcvs = [];

    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;

            constructor(view: EditorView) {
                this.decorations = buildDecorations(view, plugin);
            }

            update(update: ViewUpdate) {
                if (update.docChanged || update.selectionSet || update.viewportChanged) {
                    this.decorations = buildDecorations(update.view, plugin);
                }
            }
        },
        {
            decorations: (v: { decorations: DecorationSet }) => v.decorations,
            eventHandlers: {
                mousedown: (e: MouseEvent, view: EditorView) => {
                    if (e.button !== 0) return;
                    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
                    if (pos === null) return;
                    const bcvs = (plugin as unknown as { _editBcvs: BcvEntry[] })._editBcvs;
                    const entry = bcvs?.find((b: BcvEntry) => pos > b.from && pos < b.to);
                    if (entry) {
                        if (e.ctrlKey || e.metaKey) {
                            const langSymbol = getLangSymbol(plugin.settings.outputLanguage);
                            window.open(`jwlibrary:///finder?wtlocale=${langSymbol}&bible=${entry.bcv}`, '_blank');
                            return;
                        }
                        e.preventDefault();
                        e.stopPropagation();
                        void showModal(plugin, entry.bcv);
                    }
                }
            }
        }
    );
}

async function showModal(plugin: TraverturePlugin, bcv: string): Promise<void> {
    const parts = bcv.split('-');
    const startBcv = parts[0];
    const endBcv = parts.length > 1 ? parts[1] : parts[0];
    
    const decoded = decodeScriptures([[startBcv, endBcv]], plugin.settings.outputLanguage, plugin.settings.titleFormat);
    const displayText = decoded?.[0] || bcv;

    const timecodes = plugin.settings.outputLanguage === 'ase' 
        ? await getAslTimecodes(bcv) 
        : undefined;

    const modal = new VerseModal();
    modal.show({ html: `<p><em>Loading...</em></p>`, citation: displayText }, bcv, plugin.settings.outputLanguage, displayText, timecodes);
    void fetchVerseWithExtras(bcv, plugin.settings.outputLanguage, modal.getSignal()).then(verseData => {
        if (!modal.isVisible()) return;
        modal.show(verseData || { html: `<p><em>Verse lookup unavailable</em></p>`, citation: displayText }, bcv, plugin.settings.outputLanguage, displayText, timecodes);
    });
}