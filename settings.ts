import { PluginSettingTab, Setting, Notice } from 'obsidian';
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

    private async chooseAndImportEpub(overwriteExisting = false): Promise<void> {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.epub,application/epub+zip';
        input.style.display = 'none';

        const done = new Promise<void>((resolve) => {
            input.onchange = async () => {
                try {
                    const file = input.files?.[0];
                    if (!file) return;
                    if (!this.plugin.epubImportService) {
                        new Notice('EPUB importer not initialized.');
                        return;
                    }
                    const data = new Uint8Array(await file.arrayBuffer());
                    const res = await this.plugin.epubImportService.importEpub(data, file.name, overwriteExisting);
                    if (!res.success) new Notice(`EPUB import failed: ${res.error ?? 'unknown'}`);
                    else new Notice(`Imported offline corpus: ${res.metadata?.language}`);
                } finally {
                    input.remove();
                    resolve();
                }
            };
        });

        document.body.appendChild(input);
        input.click();
        await done;
    }

    getSettingDefinitions(): any[] {
        return [
            { key: 'sourceLanguage', name: 'Source language', description: 'Language of the scripture references in your notes', type: 'dropdown', defaultValue: 'en' },
            { key: 'outputLanguage', name: 'Output language', description: 'Language for displaying book names and fetching verse text', type: 'dropdown', defaultValue: 'en' },
            { key: 'autoDetect', name: 'Auto-detect references', description: 'Automatically detect scripture references without {{ }} markers', type: 'toggle', defaultValue: true },
            { key: 'titleFormat', name: 'Modal title format', description: 'How scripture references are displayed in the verse modal title', type: 'dropdown', defaultValue: 'full' },
        ];
    }

    async display(): Promise<void> {
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

        // Link scheme selection
        new Setting(containerEl)
            .setName('JW link scheme')
            .setDesc('Choose how JW links are opened: plugin popup (default), JW Library app scheme, or web finder.')
            .addDropdown(dropdown => {
                dropdown.addOption('popup', 'Plugin popup (existing behavior)');
                dropdown.addOption('jwlibrary', 'Open via jwlibrary:// (native JW Library app)');
                dropdown.addOption('jworg', 'Open via https://www.jw.org/finder (web)');
                dropdown.setValue(this.plugin.settings.linkScheme ?? 'popup')
                    .onChange(async (value) => {
                        this.plugin.settings.linkScheme = value as any;
                        await this.plugin.saveSettings();
                    });
            });

        // Import EPUB button
        new Setting(containerEl)
            .setName('Import EPUB for offline lookup')
            .setDesc('Upload an EPUB file to enable offline citation lookup stored in the vault.')
            .addButton((btn) =>
                btn.setButtonText('Import EPUB').onClick(async () => {
                    await this.chooseAndImportEpub(false);
                    this.display();
                }),
            );

        const activeLanguage = this.plugin.settings.outputLanguage;
        const metadata = await this.plugin.offlineRepo?.getMetadata(activeLanguage);

        new Setting(containerEl)
            .setName('Offline EPUB corpus')
            .setDesc(
                metadata
                    ? `Current offline corpus for ${activeLanguage}: ${metadata.fileName} (${metadata.chapterCount ?? 0} chapters)`
                    : `No offline corpus imported for ${activeLanguage}.`
            )
            .addButton((btn) =>
                btn
                    .setButtonText('Replace EPUB')
                    .setDisabled(!metadata)
                    .onClick(async () => {
                        await this.chooseAndImportEpub(true);
                        this.display();
                    }),
            )
            .addButton((btn) =>
                btn
                    .setButtonText('Delete EPUB')
                    .setWarning()
                    .setDisabled(!metadata)
                    .onClick(async () => {
                        if (!this.plugin.offlineRepo) {
                            new Notice('Offline EPUB repository not initialized.');
                            return;
                        }
                        await this.plugin.offlineRepo.removeLanguage(activeLanguage);
                        new Notice(`Deleted offline corpus for ${activeLanguage}.`);
                        this.display();
                    }),
            );
    }
}
