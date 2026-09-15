// settings.ts

import { App, PluginSettingTab, Setting } from 'obsidian';
import { getEngineVersion, getAvailableLanguagesCached as getAvailableLanguages } from './engine-wrapper';
import { NameFormat } from './types';
import TraverturePlugin from './main';

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
        footerText.appendChild(activeDocument.createTextNode('My other Obsidian plugin: '));

        const conversumStrong = footerText.createEl('strong');
        const conversumLink = conversumStrong.createEl('a', {
            text: 'con[VER]sum',
            href: 'https://github.com/erykjj/conversum',
        });
        conversumLink.setAttribute('target', '_blank');
        conversumLink.setAttribute('rel', 'noopener noreferrer');

        footerText.appendChild(activeDocument.createTextNode(', '));

        const travertureStrong = footerText.createEl('strong');
        const travertureLink = travertureStrong.createEl('a', {
            text: 'in(REF)ens',
            href: 'https://github.com/erykjj/inrefens',
        });
        travertureLink.setAttribute('target', '_blank');
        travertureLink.setAttribute('rel', 'noopener noreferrer');
    }
}