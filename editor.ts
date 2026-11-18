// editor.ts

import { ViewPlugin, EditorView, Decoration, DecorationSet, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { buildJwLibraryUrl, resolveClickContext, stripMarkup } from './common';
import type TraverturePlugin from './main';
import { ParsedReference } from './types';

interface DecoEntry {
    from: number;
    to: number;
    deco: Decoration;
}

interface LocatedClause {
    start: number;
    end: number;
    bcv: string;
}

const REF_CLASS = 'cm-traverture-ref';
const BCV_ATTR = 'data-bcv';
const MAX_KEY_LINES = 500;

function refMark(bcv: string): Decoration {
    return Decoration.mark({ class: REF_CLASS, attributes: { [BCV_ATTR]: bcv } });
}

function clauseBcv(ranges: string[][]): string {
    return ranges[0][0] === ranges[0][1] ? ranges[0][0] : `${ranges[0][0]}-${ranges[0][1]}`;
}

function parseClauses(text: string, plugin: TraverturePlugin, sourceLang: string): ParsedReference[] {
    try {
        const parsed = plugin.safeParseWith(text, sourceLang);
        if (!parsed) return [];
        return JSON.parse(parsed) as ParsedReference[];
    } catch (e) {
        console.error('tra.VER:ture: Failed to parse editor text:', e);
        return [];
    }
}

function locateClauses(clean: string, origIndex: number[], clauses: ParsedReference[]): LocatedClause[] {
    const located: LocatedClause[] = [];
    let searchFrom = 0;

    for (const [clauseText, startPos, endPos, ranges] of clauses) {
        if (ranges.length === 0) continue;

        let cStart = startPos;
        let cEnd = endPos;
        if (cStart < 0 || cEnd > clean.length || cEnd <= cStart || clean.substring(cStart, cEnd) !== clauseText) {
            let found = clean.indexOf(clauseText, searchFrom);
            if (found === -1) found = clean.indexOf(clauseText);
            if (found === -1) continue;
            cStart = found;
            cEnd = found + clauseText.length;
        }
        if (cStart >= origIndex.length || cEnd <= cStart) continue;
        searchFrom = cEnd;

        located.push({
            start: origIndex[cStart],
            end: origIndex[cEnd - 1] + 1,
            bcv: clauseBcv(ranges),
        });
    }
    return located;
}

function selectionTouchKey(view: EditorView): string | null {
    const { from, to } = view.state.selection.main;
    const doc = view.state.doc;
    const firstLine = doc.lineAt(from);
    const lastLine = doc.lineAt(to);
    if (lastLine.number - firstLine.number > MAX_KEY_LINES) return null;

    const starts: number[] = [];
    for (let n = firstLine.number; n <= lastLine.number; n++) {
        const line = doc.line(n);
        if (!line.text.includes('{{')) continue;
        const pattern = /\{\{(.+?)\}\}/g;
        let m: RegExpExecArray | null;
        while ((m = pattern.exec(line.text)) !== null) {
            const blockStart = line.from + m.index;
            const blockEnd = blockStart + m[0].length;
            if (from <= blockEnd && to >= blockStart) starts.push(blockStart);
        }
    }
    return starts.join(',');
}

function decorateBlock(
    inner: string,
    innerStart: number,
    plugin: TraverturePlugin,
    sourceLang: string,
    allDecos: DecoEntry[],
    decorated: Array<{ from: number; to: number }>,
): void {
    const { clean, origIndex } = stripMarkup(inner);
    const clauses = parseClauses('\u27EA\u27EA' + clean + '\u27EB\u27EB', plugin, sourceLang);
    if (clauses.length === 0) return;

    for (const clause of locateClauses(clean, origIndex, clauses)) {
        const refStart = innerStart + clause.start;
        const refEnd = innerStart + clause.end;

        const overlaps = decorated.some(p => refStart < p.to && refEnd > p.from);
        if (overlaps) continue;
        allDecos.push({ from: refStart, to: refEnd, deco: refMark(clause.bcv) });
        decorated.push({ from: refStart, to: refEnd });
    }
}

function buildDecorations(view: EditorView, plugin: TraverturePlugin): DecorationSet {
    if (!plugin.engine) return Decoration.none;

    const allDecos: DecoEntry[] = [];
    const cursor = view.state.selection.main;
    const sourceLang = plugin.getSourceLanguageForEditor(view);

    for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        const decorated: Array<{ from: number; to: number }> = [];

        const blockPattern = /\{\{(.+?)\}\}/g;
        let match: RegExpExecArray | null;
        while ((match = blockPattern.exec(text)) !== null) {
            const blockStart = from + match.index;
            const blockEnd = blockStart + match[0].length;
            const innerStart = blockStart + 2;
            const innerEnd = blockEnd - 2;

            if (cursor.from <= blockEnd && cursor.to >= blockStart) continue;

            allDecos.push({ from: blockStart, to: innerStart, deco: Decoration.replace({}) });
            allDecos.push({ from: innerEnd, to: blockEnd, deco: Decoration.replace({}) });
            decorated.push({ from: blockStart, to: innerStart });
            decorated.push({ from: innerEnd, to: blockEnd });

            decorateBlock(match[1], innerStart, plugin, sourceLang, allDecos, decorated);
        }

        // Auto-detect references in the text outside the decorated {{ }} parts
        const decoratedRanges = [...decorated].sort((a, b) => a.from - b.from);
        let pos = from;

        for (const d of decoratedRanges) {
            if (pos < d.from) {
                const segment = view.state.doc.sliceString(pos, d.from);
                processSegment(pos, segment, plugin, allDecos, decorated, sourceLang);
            }
            pos = Math.max(pos, d.to);
        }
        if (pos < to) {
            const segment = view.state.doc.sliceString(pos, to);
            processSegment(pos, segment, plugin, allDecos, decorated, sourceLang);
        }
    }

    allDecos.sort((a, b) => a.from - b.from);
    const builder = new RangeSetBuilder<Decoration>();
    for (const d of allDecos) {
        builder.add(d.from, d.to, d.deco);
    }
    return builder.finish();
}

function processSegment(
    basePos: number,
    segment: string,
    plugin: TraverturePlugin,
    allDecos: DecoEntry[],
    decorated: Array<{ from: number; to: number }>,
    sourceLang: string
): void {
    const clauses = parseClauses(segment, plugin, sourceLang);
    if (clauses.length === 0) return;

    for (const clause of clauses) {
        const [, startPos, endPos, ranges] = clause;
        if (ranges.length === 0) continue;
        const bcv = clauseBcv(ranges);
        const refStart = basePos + startPos;
        const refEnd = basePos + endPos;

        const overlaps = decorated.some(p => refStart < p.to && refEnd > p.from);
        if (!overlaps) {
            allDecos.push({ from: refStart, to: refEnd, deco: refMark(bcv) });
            decorated.push({ from: refStart, to: refEnd });
        }
    }
}

export function createTravertureEditorPlugin(plugin: TraverturePlugin) {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet = Decoration.none;
            private lastGeneration = 0;
            private touchKey: string | null = null;

            constructor(view: EditorView) {
                this.rebuild(view);
            }

            private rebuild(view: EditorView): void {
                this.lastGeneration = plugin.editorRefreshGeneration;
                this.touchKey = selectionTouchKey(view);
                this.decorations = buildDecorations(view, plugin);
            }

            update(update: ViewUpdate) {
                const forceRebuild = plugin.editorRefreshGeneration !== this.lastGeneration;
                if (forceRebuild || update.docChanged || update.viewportChanged) {
                    this.rebuild(update.view);
                } else if (update.selectionSet) {
                    const key = selectionTouchKey(update.view);
                    if (key === null || key !== this.touchKey) this.rebuild(update.view);
                }
            }
        },
        {
            decorations: (v: { decorations: DecorationSet }) => v.decorations,
            eventHandlers: {
                mousedown: (e: MouseEvent) => {
                    if (e.button !== 0) return;
                    const refEl = (e.target as HTMLElement | null)?.closest?.(`.${REF_CLASS}`);
                    const bcv = refEl?.getAttribute(BCV_ATTR);
                    if (!bcv) return;

                    if (e.ctrlKey || e.metaKey) {
                        window.open(buildJwLibraryUrl(bcv, plugin.settings.outputLanguage), '_blank');
                        return;
                    }

                    e.preventDefault();
                    e.stopPropagation();
                    void showScripture(plugin, bcv);
                }
            }
        }
    );
}

async function showScripture(plugin: TraverturePlugin, bcv: string): Promise<void> {
    const { refText, timecodes } = await resolveClickContext(
        bcv, plugin.settings.outputLanguage, plugin.settings.titleFormat,
    );
    await plugin.showScripture(bcv, refText, timecodes);
}