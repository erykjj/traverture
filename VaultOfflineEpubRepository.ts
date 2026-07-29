import type { App } from 'obsidian';

export interface CorpusMetadata {
  language: string;
  fileName: string;
  checksum: string;
  importedAt: string;
  chapterCount?: number;
}

export class VaultOfflineEpubRepository {
  private basePath: string;
  constructor(private app: App, private pluginId: string) {
    this.basePath = `.${pluginId}/offline-epub`;
  }

  private async ensureFolder() {
    try {
      await this.app.vault.createFolder(this.basePath);
    } catch (e) {
      // ignore if exists
    }
  }

  async saveCorpus(metadata: CorpusMetadata, chapters: any): Promise<void> {
    await this.ensureFolder();
    const metaPath = `${this.basePath}/${metadata.language}.metadata.json`;
    const dataPath = `${this.basePath}/${metadata.language}.corpus.json`;
    await this.app.vault.adapter.write(metaPath, JSON.stringify(metadata, null, 2));
    await this.app.vault.adapter.write(dataPath, JSON.stringify(chapters, null, 2));
  }

  async getMetadata(language: string): Promise<CorpusMetadata | null> {
    const metaPath = `${this.basePath}/${language}.metadata.json`;
    try {
      const text = await this.app.vault.adapter.read(metaPath);
      return JSON.parse(text) as CorpusMetadata;
    } catch (e) {
      return null;
    }
  }

  async removeLanguage(language: string): Promise<void> {
    const metaPath = `${this.basePath}/${language}.metadata.json`;
    const dataPath = `${this.basePath}/${language}.corpus.json`;
    try { await this.app.vault.adapter.remove(metaPath); } catch (_) {}
    try { await this.app.vault.adapter.remove(dataPath); } catch (_) {}
  }
}
