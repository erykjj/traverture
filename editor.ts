import { fetchVerseWithExtras } from './cache';
import { VerseModal } from './modal';
import { ViewPlugin, Decoration } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

const REF_PATTERN = /\{\{(.+?)\}\}/g;

function buildDecorations(view: any) {
    const builder: any = new RangeSetBuilder();
    const cursor = view.state.selection.main;

    for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        let match;
        while ((match = REF_PATTERN.exec(text)) !== null) {
            const start = from + match.index;
            const end = start + match[0].length;

            if (cursor.from <= end && cursor.to >= start) continue;

            const innerStart = start + 2;
            const innerEnd = end - 2;

            builder.add(start, innerStart, Decoration.replace({}));
            builder.add(innerStart, innerEnd, Decoration.mark({ class: 'cm-traverture-ref' }));
            builder.add(innerEnd, end, Decoration.replace({}));
        }
    }

    return builder.finish();
}

export function createTravertureEditorPlugin(plugin: any) {
    return ViewPlugin.fromClass(
        class {
            decorations: any;

            constructor(view: any) {
                this.decorations = buildDecorations(view);
            }

            update(update: any) {
                if (update.docChanged || update.selectionSet || update.viewportChanged) {
                    this.decorations = buildDecorations(update.view);
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
                        const from = line.from + match.index;
                        const to = from + match[0].length;
                        if (pos >= from && pos <= to) {
                            e.preventDefault();
                            e.stopPropagation();

                            const refText = match[1].trim();
                            const parsed = plugin.engine?.parse(
                                plugin.settings.sourceLanguage,
                                plugin.settings.outputLanguage,
                                'full',
                                false,
                                refText
                            );
                            if (!parsed) return;

                            const data = JSON.parse(parsed);
                            const keys = Object.keys(data);
                            if (keys.length === 0) return;

                            const firstRange = (data[keys[0]] as string[][])[0];
                            const bcv = firstRange[0] === firstRange[1] ? firstRange[0] : `${firstRange[0]}-${firstRange[1]}`;

                            const modal = new VerseModal();
                            modal.show({ html: `<p><em>Loading...</em></p>`, citation: refText }, bcv, plugin.settings.outputLanguage, refText);
                            void fetchVerseWithExtras(bcv, plugin.settings.outputLanguage).then(verseData => {
                                modal.show(verseData || { html: `<p><em>Verse lookup unavailable</em></p>`, citation: refText }, bcv, plugin.settings.outputLanguage, refText);
                            });
                            return;
                        }
                    }
                }
            }
        }
    );
}