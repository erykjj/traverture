// settings.ts

import { App, PluginSettingTab, SettingDefinitionItem } from 'obsidian';
import { getEngineVersion, getAvailableLanguagesCached as getAvailableLanguages } from './engine-wrapper';
import TraverturePlugin from './main';

/// Preset color choices for the "Link color" dropdown.
/// The empty string means "use the theme's external link color".
const LINK_COLOR_OPTIONS: Array<{ value: string; label: string }> = [
    { value: '',            label: 'Theme default' },
    { value: '#eab308',     label: 'Yellow' },
    { value: '#4a6da7',     label: 'Blue' },
    { value: '#059669',     label: 'Green' },
    { value: '#7c3aed',     label: 'Purple' },
    { value: '#dc2626',     label: 'Red' },
    { value: 'custom',      label: 'Custom (hex)' },
];

export class TravertureSettingTab extends PluginSettingTab {
    plugin: TraverturePlugin;

    constructor(app: App, plugin: TraverturePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    async setControlValue(key: string, value: unknown): Promise<void> {
        const s = this.plugin.settings as unknown as Record<string, unknown>;

        switch (key) {
            case 'sourceLanguage': {
                s.sourceLanguage = value;
                await this.plugin.saveSettings();
                this.plugin.createEngine();
                this.plugin.onSourceLanguageChanged();
                break;
            }
            case 'outputLanguage': {
                s.outputLanguage = value;
                await this.plugin.saveSettings();
                this.plugin.createEngine();
                break;
            }
            case 'titleFormat': {
                s.titleFormat = value;
                await this.plugin.saveSettings();
                break;
            }
            case 'autoDetect': {
                s.autoDetect = value;
                await this.plugin.saveSettings();
                break;
            }
        }
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        const languages = getAvailableLanguages();

        const sourceLangOptions: Record<string, string> = {};
        for (const lang of languages.filter(l => l.code !== 'ase')) {
            sourceLangOptions[lang.code] = `${lang.vernacularName} (${lang.code})`;
        }

        const outputLangOptions: Record<string, string> = {};
        for (const lang of languages) {
            outputLangOptions[lang.code] = `${lang.vernacularName} (${lang.code})`;
        }

        return [
            // ─── Header section ───
            {
                type: 'group',
                heading: '',
                items: [
                    {
                        name: '',
                        render: (setting) => {
                            setting.settingEl.empty();
                            setting.settingEl.addClass('traverture-settings-header');
                            const headerEl = setting.settingEl.createDiv();
                            headerEl.createSpan({
                                text: 'tra.VER:ture  ',
                                cls: 'traverture-settings-title',
                            });
                            headerEl.createSpan({
                                text: `v${this.plugin.manifest.version} \u2013 ${getEngineVersion()}`,
                                cls: 'traverture-version-info',
                            });
                        },
                    },
                ],
            },

            // ─── Options section ───
            {
                type: 'group',
                heading: '',
                items: [
                    {
                        name: 'Source language',
                        desc: 'Language of the scripture references in your notes',
                        control: {
                            type: 'dropdown',
                            key: 'sourceLanguage',
                            options: sourceLangOptions,
                        },
                    },
                    {
                        name: 'Output language',
                        desc: 'Language for displaying and fetching scripture text',
                        control: {
                            type: 'dropdown',
                            key: 'outputLanguage',
                            options: outputLangOptions,
                        },
                    },
                    {
                        name: 'Modal title format',
                        desc: 'How scripture references are displayed in the modal title',
                        control: {
                            type: 'dropdown',
                            key: 'titleFormat',
                            options: {
                                full: 'Full (1 Corinthians)',
                                standard: 'Standard (1 Cor.)',
                                official: 'Official (1Co)',
                            },
                        },
                    },
                    {
                        name: 'Link color',
                        desc: 'Color for citation links. "Theme default" uses the vault\u2019s external-link color. Changing this requires restarting Obsidian.',
                        render: (setting) => {
                            const savedColor = this.plugin.settings.linkColor ?? '';
                            const isPreset = LINK_COLOR_OPTIONS.some(o => o.value === savedColor);
                            const dropdownValue = isPreset ? savedColor : 'custom';

                            let customTextEl: HTMLInputElement | null = null;

                            setting
                                .addDropdown(dropdown => {
                                    for (const opt of LINK_COLOR_OPTIONS) {
                                        dropdown.addOption(opt.value, opt.label);
                                    }
                                    dropdown
                                        .setValue(dropdownValue)
                                        .onChange(async (value) => {
                                            if (value === 'custom') {
                                                this.plugin.settings.linkColor = this.plugin.settings.linkColor || '';
                                            } else {
                                                this.plugin.settings.linkColor = value;
                                            }
                                            await this.plugin.saveSettings();
                                            this.plugin.applyLinkColor();
                                            if (customTextEl) {
                                                if (value === 'custom') {
                                                    customTextEl.removeClass('traverture-hidden');
                                                } else {
                                                    customTextEl.addClass('traverture-hidden');
                                                }
                                            }
                                        });
                                })
                                .addText(text => {
                                    customTextEl = text.inputEl;
                                    text.inputEl.placeholder = '#4a6da7';
                                    text.setValue(isPreset ? '' : savedColor);
                                    text.setDisabled(!isPreset && dropdownValue !== 'custom');
                                    if (dropdownValue !== 'custom') {
                                        text.inputEl.addClass('traverture-hidden');
                                    }
                                    text.onChange(async (value) => {
                                        this.plugin.settings.linkColor = value.trim();
                                        await this.plugin.saveSettings();
                                        this.plugin.applyLinkColor();
                                    });
                                });
                        },
                    },
                    {
                        name: 'Auto-detect references',
                        desc: 'Automatically detect scripture references in View mode without {{ }} markers.',
                        control: {
                            type: 'toggle',
                            key: 'autoDetect',
                            defaultValue: true,
                        },
                    },
                ],
            },

            // ─── Footer section ───
            {
                type: 'group',
                heading: '',
                items: [
                    {
                        name: '',
                        render: (setting) => {
                            setting.settingEl.empty();
                            setting.settingEl.addClass('traverture-settings-footer-row');
                            const footerEl = setting.settingEl.createDiv({ cls: 'traverture-settings-footer' });
                            footerEl.appendChild(
                                document.createTextNode('My other Obsidian plugins: ')
                            );

                            const entries: Array<[string, string]> = [
                                ['con[VER]sum', 'https://github.com/erykjj/conversum'],
                                ['in(REF)ens', 'https://github.com/erykjj/inrefens'],
                                ['mu/TEX/tum', 'https://github.com/erykjj/mutextum'],
                            ];

                            entries.forEach(([text, href], i) => {
                                const strong = footerEl.createEl('strong');
                                const link = strong.createEl('a', { text, href });
                                link.setAttribute('target', '_blank');
                                link.setAttribute('rel', 'noopener noreferrer');
                                if (i < entries.length - 1) {
                                    footerEl.appendChild(document.createTextNode(', '));
                                }
                            });
                        },
                    },
                ],
            },
        ];
    }
}