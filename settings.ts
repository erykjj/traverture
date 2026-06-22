import { PluginSettingTab, Setting, Notice } from 'obsidian';
import { getAvailableLanguages } from './languages';
import { clearVerseCache } from './cache';
import TraverturePlugin from './main';

export class TravertureSettingTab extends PluginSettingTab {
    plugin: TraverturePlugin;

    constructor(app: any, plugin: TraverturePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'tra.VER:ture Settings' });
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
            .setName('Verse cache')
            .setDesc('Fetched verses are cached in memory for 60 minutes')
            .addButton(button => button.setButtonText('Clear cache').onClick(() => { clearVerseCache(); new Notice('Verse cache cleared.'); }));
    }
}