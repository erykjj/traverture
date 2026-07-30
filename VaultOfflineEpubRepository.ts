import type { App } from 'obsidian';

export interface CorpusMetadata {
  language: string;
  fileName: string;
  checksum: string;
  importedAt: string;
  chapterCount?: number;
}

export interface OfflineChapter {
  language: string;
  book: number | string;
  chapter: number | string;
  title?: string;
  verses: Record<string, string>;
  source?: {
    sourceFileChecksum?: string;
    importedAt?: string;
  };
}

export class VaultOfflineEpubRepository {
  private basePath: string;

  constructor(private app: App, private pluginId: string) {
    this.basePath = `.${pluginId}/offline-epub`;
  }

  private async ensureFolder() {
    try {
      await this.app.vault.createFolder(this.basePath);
    } catch (_) {
      // ignore if exists
    }
  }

  private getMetadataPath(language: string): string {
    return `${this.basePath}/${language}.metadata.json`;
  }

  private getCorpusPath(language: string): string {
    return `${this.basePath}/${language}.corpus.json`;
  }

  private getChapterPath(language: string, book: number | string, chapter: number | string): string {
    const bookKey = String(book).padStart(3, '0');
    const chapterKey = String(chapter).padStart(3, '0');
    return `${this.basePath}/${language}/${bookKey}/${chapterKey}.json`;
  }

  private async ensureLanguageFolder(language: string): Promise<void> {
    await this.ensureFolder();
    try {
      await this.app.vault.createFolder(`${this.basePath}/${language}`);
    } catch (_) {
      // ignore if exists
    }
  }

  private async ensureBookFolder(language: string, book: number | string): Promise<void> {
    await this.ensureLanguageFolder(language);
    const bookKey = String(book).padStart(3, '0');
    try {
      await this.app.vault.createFolder(`${this.basePath}/${language}/${bookKey}`);
    } catch (_) {
      // ignore if exists
    }
  }

  async saveCorpus(metadata: CorpusMetadata, chapters: OfflineChapter[]): Promise<void> {
    await this.ensureFolder();

    const metaPath = this.getMetadataPath(metadata.language);
    const dataPath = this.getCorpusPath(metadata.language);

    const normalizedMetadata: CorpusMetadata = {
      ...metadata,
      importedAt: metadata.importedAt || new Date().toISOString(),
      chapterCount: metadata.chapterCount ?? chapters.length,
    };

    await this.app.vault.adapter.write(metaPath, JSON.stringify(normalizedMetadata, null, 2));
    await this.app.vault.adapter.write(dataPath, JSON.stringify(chapters, null, 2));

    for (const chapter of chapters) {
      const book = chapter.book;
      const chapterNum = chapter.chapter;
      await this.ensureBookFolder(metadata.language, book);
      const chapterPath = this.getChapterPath(metadata.language, book, chapterNum);
      await this.app.vault.adapter.write(chapterPath, JSON.stringify(chapter, null, 2));
    }
  }

  async getMetadata(language: string): Promise<CorpusMetadata | null> {
    const metaPath = this.getMetadataPath(language);
    try {
      const text = await this.app.vault.adapter.read(metaPath);
      return JSON.parse(text) as CorpusMetadata;
    } catch (_) {
      return null;
    }
  }

  async hasLanguage(language: string): Promise<boolean> {
    return (await this.getMetadata(language)) !== null;
  }

  async getCorpus(language: string): Promise<OfflineChapter[] | null> {
    const dataPath = this.getCorpusPath(language);
    try {
      const text = await this.app.vault.adapter.read(dataPath);
      return JSON.parse(text) as OfflineChapter[];
    } catch (_) {
      return null;
    }
  }

  async getChapter(language: string, book: number | string, chapter: number | string): Promise<OfflineChapter | null> {
    const chapterPath = this.getChapterPath(language, book, chapter);
    try {
      const text = await this.app.vault.adapter.read(chapterPath);
      return JSON.parse(text) as OfflineChapter;
    } catch (_) {
      const corpus = await this.getCorpus(language);
      if (!corpus) return null;
      return (
        corpus.find(
          (entry) => String(entry.book) === String(book) && String(entry.chapter) === String(chapter)
        ) ?? null
      );
    }
  }

  async getVerseRange(
    language: string,
    book: number | string,
    chapter: number | string,
    verseStart: number,
    verseEnd?: number,
  ): Promise<string | null> {
    const chapterData = await this.getChapter(language, book, chapter);
    if (!chapterData?.verses) return null;

    const end = verseEnd ?? verseStart;
    const verses: string[] = [];

    for (let verse = verseStart; verse <= end; verse++) {
      const text = chapterData.verses[String(verse)];
      if (text) verses.push(text.trim());
    }

    return verses.length > 0 ? verses.join(' ') : null;
  }

  async listLanguages(): Promise<string[]> {
    try {
      const items = await this.app.vault.adapter.list(this.basePath);
      return items.files
        .map((file) => file.split('/').pop() || '')
        .filter((name) => name.endsWith('.metadata.json'))
        .map((name) => name.replace(/\.metadata\.json$/, ''));
    } catch (_) {
      return [];
    }
  }

  async removeLanguage(language: string): Promise<void> {
    const metaPath = this.getMetadataPath(language);
    const dataPath = this.getCorpusPath(language);
    const languageFolder = `${this.basePath}/${language}`;

    try {
      await this.app.vault.adapter.remove(metaPath);
    } catch (_) {}

    try {
      await this.app.vault.adapter.remove(dataPath);
    } catch (_) {}

    try {
      const listed = await this.app.vault.adapter.list(languageFolder);
      for (const file of listed.files) {
        try {
          await this.app.vault.adapter.remove(file);
        } catch (_) {}
      }
      const folders = [...listed.folders].sort((a, b) => b.length - a.length);
      for (const folder of folders) {
        try {
          await this.app.vault.adapter.rmdir(folder, true);
        } catch (_) {}
      }
      await this.app.vault.adapter.rmdir(languageFolder, true);
    } catch (_) {
      // ignore missing folder
    }
  }
}
