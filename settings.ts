import { PluginSettingTab, Setting } from 'obsidian';
import { getAvailableLanguages } from './languages';
import TraverturePlugin from './main';
// @ts-ignore
import * as wasmModule from './engine.js';

export class TravertureSettingTab extends PluginSettingTab {
    plugin: TraverturePlugin;

    constructor(app: any, plugin: TraverturePlugin) {
        super(app, plugin);
        this.plugin = plugin;
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
                for (const lang of languages) dropdown.addOption(lang.code, `${lang.vernacularName} (${lang.code})`);
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
            .setName('Auto-detect references')
            .setDesc('Automatically detect scripture references in View mode without {{ }} markers.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoDetect)
                .onChange(async (value) => {
                    this.plugin.settings.autoDetect = value;
                    await this.plugin.saveSettings();
                }));
    }
}