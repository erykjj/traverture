import { fetchVerseWithExtras } from './cache';
import { VerseModal } from './modal';
import { ViewPlugin, Decoration } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

const REF_PATTERN = /\{\{(.+?)\}\}/g;

function buildDecorations(view: any, plugin: any) {
    const builder: any = new RangeSetBuilder();
    const cursor = view.state.selection.main;

    for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        let match;
        while ((match = REF_PATTERN.exec(text)) !== null) {
            const blockStart = from + match.index;
            const blockEnd = blockStart + match[0].length;
            const innerStart = blockStart + 2;
            const innerEnd = blockEnd - 2;

            if (cursor.from <= blockEnd && cursor.to >= blockStart) continue;

            const decos: Array<{ from: number; to: number; deco: any }> = [];

            decos.push({ from: blockStart, to: innerStart, deco: Decoration.replace({}) });
            decos.push({ from: innerEnd, to: blockEnd, deco: Decoration.replace({}) });

            const innerText = match[1];
            const parsed = plugin.engine?.parse(
                plugin.settings.sourceLanguage,
                plugin.settings.outputLanguage,
                'full',
                false,
                innerText
            );

            let hasRefs = false;
            if (parsed) {
                const data = JSON.parse(parsed);
                const refKeys = Object.keys(data);

                if (refKeys.length > 0) {
                    const sorted = refKeys.sort((a: string, b: string) => b.length - a.length);
                    const placed: Array<{ from: number; to: number }> = [];

                    for (const refKey of sorted) {
                        const escaped = refKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const refRegex = new RegExp(escaped, 'g');
                        let refMatch;

                        while ((refMatch = refRegex.exec(innerText)) !== null) {
                            const refStart = innerStart + refMatch.index;
                            const refEnd = refStart + refKey.length;
                            
                            const overlaps = placed.some(p => refStart < p.to && refEnd > p.from);
                            if (!overlaps) {
                                decos.push({ from: refStart, to: refEnd, deco: Decoration.mark({ class: 'cm-traverture-ref' }) });
                                placed.push({ from: refStart, to: refEnd });
                                hasRefs = true;
                            }
                        }
                    }
                }
            }

            if (!hasRefs) {
                decos.push({ from: innerStart, to: innerEnd, deco: Decoration.mark({ class: 'cm-traverture-ref' }) });
            }

            decos.sort((a, b) => a.from - b.from);
            for (const d of decos) {
                builder.add(d.from, d.to, d.deco);
            }
        }
    }

    return builder.finish();
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
                    let match;
                    while ((match = REF_PATTERN.exec(line.text)) !== null) {
                        const blockStart = line.from + match.index;
                        const blockEnd = blockStart + match[0].length;
                        const innerStart = blockStart + 2;

                        if (pos >= blockStart && pos <= blockEnd) {
                            const innerText = match[1];
                            const clickOffset = pos - innerStart;

                            const parsed = plugin.engine?.parse(
                                plugin.settings.sourceLanguage,
                                plugin.settings.outputLanguage,
                                'full',
                                false,
                                innerText
                            );

                            if (!parsed) return;
                            const data = JSON.parse(parsed);
                            const refKeys = Object.keys(data);
                            if (refKeys.length === 0) return;

                            const sorted = refKeys.sort((a: string, b: string) => b.length - a.length);
                            let clickedRef = refKeys[0];

                            for (const refKey of sorted) {
                                const escaped = refKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                const refRegex = new RegExp(escaped, 'g');
                                let refMatch;
                                while ((refMatch = refRegex.exec(innerText)) !== null) {
                                    const refStart = refMatch.index;
                                    const refEnd = refStart + refKey.length;
                                    if (clickOffset >= refStart && clickOffset <= refEnd) {
                                        clickedRef = refKey;
                                        break;
                                    }
                                }
                            }

                            e.preventDefault();
                            e.stopPropagation();

                            const firstRange = (data[clickedRef] as string[][])[0];
                            const bcv = firstRange[0] === firstRange[1] ? firstRange[0] : `${firstRange[0]}-${firstRange[1]}`;

                            const modal = new VerseModal();
                            modal.show({ html: `<p><em>Loading...</em></p>`, citation: clickedRef }, bcv, plugin.settings.outputLanguage, clickedRef);
                            void fetchVerseWithExtras(bcv, plugin.settings.outputLanguage).then(verseData => {
                                modal.show(verseData || { html: `<p><em>Verse lookup unavailable</em></p>`, citation: clickedRef }, bcv, plugin.settings.outputLanguage, clickedRef);
                            });
                            return;
                        }
                    }
                }
            }
        }
    );
}