// settings.ts

import { App, PluginSettingTab, Setting } from 'obsidian';
import { getEngineVersion, getAvailableLanguagesCached as getAvailableLanguages } from './engine-wrapper';
import { NameFormat } from './types';
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

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        const headerEl = containerEl.createDiv({ cls: 'traverture-settings-header' });
        headerEl.createSpan({ text: 'tra.VER:ture', cls: 'traverture-settings-title' });
        const engineVersion = getEngineVersion();
        headerEl.createSpan({ 
            text: `v${this.plugin.manifest.version} – ${engineVersion}`,
            cls: 'traverture-version-info'
        });

        const languages = getAvailableLanguages();

        new Setting(containerEl)
            .setName('Source language')
            .setDesc('Language of the scripture references in your notes')
            .addDropdown(dropdown => {
                for (const lang of languages.filter(l => l.code !== 'ase')) {
                    dropdown.addOption(lang.code, `${lang.vernacularName} (${lang.code})`);
                }
                dropdown.setValue(this.plugin.settings.sourceLanguage)
                    .onChange(async (value) => {
                        this.plugin.settings.sourceLanguage = value;
                        await this.plugin.saveSettings();
                        this.plugin.createEngine();
                    });
            });

        new Setting(containerEl)
            .setName('Output language')
            .setDesc('Language for displaying and fetching scripture text')
            .addDropdown(dropdown => {
                for (const lang of languages) {
                    dropdown.addOption(lang.code, `${lang.vernacularName} (${lang.code})`);
                }
                dropdown.setValue(this.plugin.settings.outputLanguage)
                    .onChange(async (value) => {
                        this.plugin.settings.outputLanguage = value;
                        await this.plugin.saveSettings();
                        this.plugin.createEngine();
                    });
            });

        new Setting(containerEl)
            .setName('Modal title format')
            .setDesc('How scripture references are displayed in the modal title')
            .addDropdown(dropdown => {
                dropdown.addOption('full', 'Full (1 Corinthians)');
                dropdown.addOption('standard', 'Standard (1 Cor.)');
                dropdown.addOption('official', 'Official (1Co)');
                dropdown
                    .setValue(this.plugin.settings.titleFormat)
                    .onChange(async (value: string) => {
                        this.plugin.settings.titleFormat = value as NameFormat;
                        await this.plugin.saveSettings();
                    });
            });

        // ──────────────────────────────────────────
        // Link color
        // ──────────────────────────────────────────
        const savedColor = this.plugin.settings.linkColor ?? '';
        const isPreset = LINK_COLOR_OPTIONS.some(o => o.value === savedColor);
        const dropdownValue = isPreset ? savedColor : 'custom';

        let customTextEl: HTMLInputElement | null = null;

        new Setting(containerEl)
            .setName('Link color')
            .setDesc('Color for citation links. "Theme default" uses the vault\u2019s external-link color. Changing this requires restarting Obsidian.')
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

        new Setting(containerEl)
            .setName('Auto-detect references')
            .setDesc('Automatically detect scripture references in View mode without {{ }} markers.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoDetect)
                .onChange(async (value) => {
                    this.plugin.settings.autoDetect = value;
                    await this.plugin.saveSettings();
                }));

        const footerEl = containerEl.createDiv({ cls: 'traverture-settings-footer' });
        const footerText = footerEl.createSpan();
        footerText.appendChild(activeDocument.createTextNode('My other Obsidian plugins: '));

        const conversumStrong = footerText.createEl('strong');
        const conversumLink = conversumStrong.createEl('a', {
            text: 'con[VER]sum',
            href: 'https://github.com/erykjj/conversum',
        });
        conversumLink.setAttribute('target', '_blank');
        conversumLink.setAttribute('rel', 'noopener noreferrer');

        footerText.appendChild(activeDocument.createTextNode(', '));

        const inrefensStrong = footerText.createEl('strong');
        const inrefensLink = inrefensStrong.createEl('a', {
            text: 'in(REF)ens',
            href: 'https://github.com/erykjj/inrefens',
        });
        inrefensLink.setAttribute('target', '_blank');
        inrefensLink.setAttribute('rel', 'noopener noreferrer');
    }
}