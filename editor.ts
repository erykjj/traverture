import { fetchVerseWithExtras } from './cache';
import { VerseModal } from './modal';
import { ViewPlugin, Decoration } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

const REF_PATTERN = /\{\{(.+?)\}\}/g;
const MARKER_PATTERN = /⟪(.+?)⟫/g;

function buildDecorations(view: any, plugin: any) {
    const allDecos: Array<{ from: number; to: number; deco: any }> = [];
    const cursor = view.state.selection.main;

    for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        const decorated: Array<{ from: number; to: number }> = [];

        let match;
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
            const parsed = plugin.engine?.parse(
                plugin.settings.sourceLanguage,
                plugin.settings.outputLanguage,
                'full',
                false,
                engineInput
            );

            if (parsed) {
                const clauses: Array<[string, number, number, string[][]]> = JSON.parse(parsed);
                const sorted = [...clauses].sort((a, b) => b[0].length - a[0].length);
                
                for (const [clauseText, _ranges] of sorted) {
                    const escaped = clauseText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const refRegex = new RegExp(escaped, 'g');
                    let refMatch;
                    while ((refMatch = refRegex.exec(innerText)) !== null) {
                        const refStart = innerStart + refMatch.index;
                        const refEnd = refStart + clauseText.length;
                        
                        const overlaps = decorated.some(p => refStart < p.to && refEnd > p.from);
                        if (!overlaps) {
                            allDecos.push({ from: refStart, to: refEnd, deco: Decoration.mark({ class: 'cm-traverture-ref' }) });
                            decorated.push({ from: refStart, to: refEnd });
                        }
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
                    processSegment(pos, segment, plugin, allDecos, decorated);
                }
                pos = Math.max(pos, d.to);
            }
            if (pos < to) {
                const segment = view.state.doc.sliceString(pos, to);
                processSegment(pos, segment, plugin, allDecos, decorated);
            }
        }
    }

    allDecos.sort((a, b) => a.from - b.from);
    const builder: any = new RangeSetBuilder();
    for (const d of allDecos) {
        builder.add(d.from, d.to, d.deco);
    }
    return builder.finish();
}

function processSegment(basePos: number, segment: string, plugin: any, allDecos: Array<{ from: number; to: number; deco: any }>, decorated: Array<{ from: number; to: number }>) {
    const parsed = plugin.engine?.parse(
        plugin.settings.sourceLanguage,
        plugin.settings.outputLanguage,
        'full',
        false,
        segment
    );
    if (!parsed) return;

    const clauses: Array<[string, number, number, string[][]]> = JSON.parse(parsed);
    if (clauses.length === 0) return;

    for (const [_clauseText, startPos, endPos, _ranges] of clauses) {
        const refStart = basePos + startPos;
        const refEnd = basePos + endPos;

        const overlaps = decorated.some(p => refStart < p.to && refEnd > p.from);
        if (!overlaps) {
            allDecos.push({ from: refStart, to: refEnd, deco: Decoration.mark({ class: 'cm-traverture-ref' }) });
            decorated.push({ from: refStart, to: refEnd });
        }
    }
}

export function createTravertureEditorPlugin(plugin: any) {
    return ViewPlugin.fromClass(
        class {
            decorations: any;

            constructor(view: any) {
                this.decorations = buildDecorations(view, plugin);
            }

            update(update: any) {
                if (update.docChanged || update.selectionSet || update.viewportChanged) {
                    this.decorations = buildDecorations(update.view, plugin);
                }
            }
        },
        {
            decorations: (v: any) => v.decorations,
            eventHandlers: {
                mousedown: (e: MouseEvent, view: any) => {
                    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
                    if (pos === null) return;

                    const line = view.state.doc.lineAt(pos);
                    const lineText = line.text;
                    const lineFrom = line.from;
                    const engineInput = lineText.replace(/\{\{(.+?)\}\}/g, '⟪$1⟫');
                    const parsed = plugin.engine?.parse(
                        plugin.settings.sourceLanguage,
                        plugin.settings.outputLanguage,
                        'full',
                        false,
                        engineInput
                    );
                    if (!parsed) return;

                    const clauses: Array<[string, number, number, string[][]]> = JSON.parse(parsed);
                    if (clauses.length === 0) return;

                    for (const clause of clauses) {
                        const [_clauseText, startPos, endPos, _ranges] = clause;

                        const refStart = lineFrom + startPos;
                        const refEnd = lineFrom + endPos;

                        if (pos >= refStart && pos <= refEnd) {
                            e.preventDefault();
                            e.stopPropagation();
                            showModal(plugin, clause, clauses);
                            return;
                        }
                    }
                }
            }
        }
    );
}

function showModal(plugin: any, clause: [string, number, number, string[][]], clauses: Array<[string, number, number, string[][]]>) {
    const [clauseText, _startPos, _endPos, ranges] = clause;
    const range = ranges[0];
    const bcv = range[0] === range[1] ? range[0] : `${range[0]}-${range[1]}`;

    let displayText = clauseText;
    if (/^\d/.test(clauseText) && !/^\d+\s*[a-zA-Z]/.test(clauseText)) {
        const idx = clauses.indexOf(clause);
        for (let i = idx - 1; i >= 0; i--) {
            if (!/^\d/.test(clauses[i][0])) {
                const bookMatch = clauses[i][0].match(/^(.+?)\s+\d/);
                if (bookMatch) {
                    displayText = `${bookMatch[1]} ${clauseText}`;
                    break;
                }
            }
        }
    }

    const modal = new VerseModal();
    modal.show({ html: `<p><em>Loading...</em></p>`, citation: displayText }, bcv, plugin.settings.outputLanguage, displayText);
    void fetchVerseWithExtras(bcv, plugin.settings.outputLanguage).then(verseData => {
        modal.show(verseData || { html: `<p><em>Verse lookup unavailable</em></p>`, citation: displayText }, bcv, plugin.settings.outputLanguage, displayText);
    });
}