// types.ts

export interface TravertureSettings {
    sourceLanguage: string;
    outputLanguage: string;
    autoDetect: boolean;
    titleFormat: 'full' | 'standard' | 'official';
}

export const DEFAULT_SETTINGS: TravertureSettings = {
    sourceLanguage: 'en',
    outputLanguage: 'en',
    autoDetect: true,
    titleFormat: 'full',
};

export interface LanguageInfo {
    code: string;
    vernacularName: string;
    englishName: string;
    suffix: string;
}

export interface VerseData {
    html: string;
    citation: string;
    footnotes?: Array<{ id: number; content: string; source: string }>;
    crossReferences?: Array<{ id: number; source: string; targets: Array<{ vs: string; standardCitation: string; abbreviatedCitation: string }> }>;
    commentaries?: Array<{ id: number; content: string; source: string }>;
}

export const VIEW_TYPE_TRAVERTURE_SIDEBAR = 'traverture-sidebar-view';

export interface SidebarRef {
    scripture: string;
    fullRef: string;
    standardRef: string;
    officialRef: string;
    startBcv: string;
    endBcv: string;
    startCh: number;
    endCh: number;
    startVerse: number;
    endVerse: number;
    bookNum: number;
}

// ──────────────────────────────────────────────
// Engine (WASM) Types
// ──────────────────────────────────────────────

export type NameFormat = 'full' | 'standard' | 'official';

export type ParsedReference = [
    string,          // matched scripture text
    number,          // start position (char index)
    number,          // end position (char index)
    string[][]       // array of [startBcv, endBcv] pairs
];

export interface TravertureEngineInstance {
    parse(sourceLang: string, outputLang: string, nameFormat: NameFormat, capitalize: boolean, text: string): string;
    parse_with_markers(text: string): string;
    decode_scriptures(encodedJson: string): string;
    verify_integrity(hash: number): boolean;
    debug_integrity_hash(): number;
}

export interface TravertureEngineStatic {
    new(sourceLang: string, outputLang: string, nameFormat: NameFormat, capitalize: boolean): TravertureEngineInstance;
    get_chapter_count(bookId: number): number;
    get_verse_count(bookId: number, chapter: number): number;
    get_available_languages(): string;
    get_lang_suffix(langCode: string): string;
    get_book_name(bookNumber: number, langCode: string, format: NameFormat, capitalize: boolean): string;
    get_lang_symbol(langCode: string): string;
    get_version(): string;
    get_asl_metadata_url(bookNumber: number, chapter: number): string;
    default(options: { module_or_path: unknown }): Promise<void>;
}

export interface TravertureEngineModule {
    TravertureEngine: TravertureEngineStatic;
    default(options: { module_or_path: unknown }): Promise<void>;
}