import { PluginSettingTab, Setting } from 'obsidian';
// @ts-ignore
import * as wasmModule from './engine.js';
import { getAvailableLanguages } from './languages';
import TraverturePlugin from './main';

export class TravertureSettingTab extends PluginSettingTab {
    plugin: TraverturePlugin;

    constructor(app: any, plugin: TraverturePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }


    getSettingDefinitions(): any[] {
        return [
            { key: 'sourceLanguage', name: 'Source language', description: 'Language of the scripture references in your notes', type: 'dropdown', defaultValue: 'en' },
            { key: 'outputLanguage', name: 'Output language', description: 'Language for displaying book names and fetching verse text', type: 'dropdown', defaultValue: 'en' },
            { key: 'autoDetect', name: 'Auto-detect references', description: 'Automatically detect scripture references without {{ }} markers', type: 'toggle', defaultValue: true },
            { key: 'titleFormat', name: 'Modal title format', description: 'How scripture references are displayed in the verse modal title', type: 'dropdown', defaultValue: 'full' },
        ];
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        const headerEl = containerEl.createDiv({ cls: 'traverture-settings-header' });
        headerEl.createSpan({ text: 'tra.VER:ture', cls: 'traverture-settings-title' });
        const engineVersion = wasmModule.TravertureEngine.get_version();
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
                    .onChange(async (value) => { this.plugin.settings.sourceLanguage = value; await this.plugin.saveSettings(); this.plugin.createEngine(); });
            });

        new Setting(containerEl)
            .setName('Output language')
            .setDesc('Language for displaying and fetching scripture text')
            .addDropdown(dropdown => {
                for (const lang of languages) dropdown.addOption(lang.code, `${lang.vernacularName} (${lang.code})`);
                dropdown.setValue(this.plugin.settings.outputLanguage)
                    .onChange(async (value) => { this.plugin.settings.outputLanguage = value; await this.plugin.saveSettings(); this.plugin.createEngine(); });
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
                    .onChange(async (value) => {
                        this.plugin.settings.titleFormat = value;
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
        footerText.appendChild(document.createTextNode('My other Obsidian plugin: '));
        footerText.createEl('strong', { text: 'con[VER]sum' });
        footerText.appendChild(document.createTextNode(': '));
        const githubLink = footerText.createEl('a', {
            text: 'GitHub repo',
            href: 'https://github.com/erykjj/conversum'
        });
        githubLink.setAttribute('target', '_blank');
        githubLink.setAttribute('rel', 'noopener noreferrer');
        footerText.appendChild(document.createTextNode(', '));
        const obsidianLink = footerText.createEl('a', {
            text: 'Obsidian Community',
            href: 'https://community.obsidian.md/plugins/conversum'
        });
        obsidianLink.setAttribute('target', '_blank');
        obsidianLink.setAttribute('rel', 'noopener noreferrer');
    }
}