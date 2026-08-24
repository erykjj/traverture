// engine-wrapper.ts

// @ts-ignore
import * as wasmModule from './engine.js';
// @ts-ignore
import wasmBinary from './engine_bg.wasm';

let engineInitialized = false;

const enginePool = new Map<string, any>();

function getEngineKey(language: string, format: 'full' | 'standard' | 'official'): string {
    return `${language}|${format}`;
}

export async function initEngine(): Promise<void> {
    if (engineInitialized) return;
    
    try {
        await wasmModule.default({ module_or_path: wasmBinary });
        engineInitialized = true;
    } catch (e) {
        console.error('tra.VER:ture: Failed to initialize WASM engine:', e);
        throw e;
    }
}

function getOrCreateEngine(
    language: string,
    format: 'full' | 'standard' | 'official' = 'full',
    capitalize: boolean = false
): any | null {
    if (!engineInitialized) {
        console.error('tra.VER:ture: Engine not initialized');
        return null;
    }
    const key = `${getEngineKey(language, format)}|${capitalize ? 'CAPS' : 'lower'}`;
    if (enginePool.has(key)) {
        return enginePool.get(key);
    }
    try {
        const engine = new wasmModule.TravertureEngine(language, language, format, capitalize);
        enginePool.set(key, engine);
        return engine;
    } catch (e) {
        console.error('tra.VER:ture: Failed to create engine:', e);
        return null;
    }
}

export function prewarmEngines(sourceLanguage: string, outputLanguage: string): void {
    if (!engineInitialized) return;
    getOrCreateEngine(sourceLanguage, 'full');
    getOrCreateEngine(outputLanguage, 'full');
    getOrCreateEngine(outputLanguage, 'standard');
    getOrCreateEngine(outputLanguage, 'official');
}

export function clearEnginePool(): void {
    enginePool.clear();
}

export function getEnginePoolSize(): number {
    return enginePool.size;
}

export function isEngineReady(): boolean {
    return engineInitialized;
}

function getParsingEngine(sourceLanguage: string): any | null {
    return getOrCreateEngine(sourceLanguage, 'full');
}

function getDecodingEngine(
    outputLanguage: string,
    nameFormat: 'full' | 'standard' | 'official' = 'full',
    capitalize: boolean = false
): any | null {
    return getOrCreateEngine(outputLanguage, nameFormat, capitalize);
}

export function parseReferences(
    text: string,
    sourceLanguage: string,
    outputLanguage: string,
    nameFormat: 'full' | 'standard' | 'official' = 'full',
    capitalize: boolean = false
): any[] | null {
    const engine = getParsingEngine(sourceLanguage);
    if (!engine) return null;
    try {
        const result = engine.parse(sourceLanguage, outputLanguage, nameFormat, capitalize, text);
        return JSON.parse(result);
    } catch (e) {
        console.error('tra.VER:ture: Failed to parse references:', e);
        return null;
    }
}

export function decodeScriptures(
    ranges: Array<[string, string]>,
    outputLanguage: string,
    nameFormat: 'full' | 'standard' | 'official' = 'full',
    capitalize: boolean = false
): string[] | null {
    const engine = getDecodingEngine(outputLanguage, nameFormat, capitalize);
    if (!engine) return null;
    try {
        const json = JSON.stringify(ranges);
        const result = engine.decode_scriptures(json);
        return JSON.parse(result);
    } catch (e) {
        console.error('tra.VER:ture: Failed to decode scriptures:', e);
        return null;
    }
}

export function getEngineVersion(): string {
    if (!engineInitialized) {
        return 'Engine not initialized';
    }
    try {
        return wasmModule.TravertureEngine.get_version();
    } catch {
        return 'Unknown';
    }
}

export function getBookName(
    bookNumber: number,
    langCode: string,
    format: 'full' | 'standard' | 'official' = 'full',
    capitalize: boolean = false
): string {
    if (!engineInitialized) {
        return '';
    }
    try {
        return wasmModule.TravertureEngine.get_book_name(bookNumber, langCode, format, capitalize);
    } catch {
        return '';
    }
}

export function getLangSymbol(langCode: string): string {
    if (!engineInitialized) {
        return 'E';
    }
    try {
        return wasmModule.TravertureEngine.get_lang_symbol(langCode);
    } catch {
        return 'E';
    }
}

export function getAvailableLanguages(): any[] {
    if (!engineInitialized) {
        return [];
    }
    try {
        const json = wasmModule.TravertureEngine.get_available_languages();
        return JSON.parse(json);
    } catch {
        return [];
    }
}

let cachedLanguages: any[] | null = null;

export function getAvailableLanguagesCached(): any[] {
    if (!cachedLanguages) {
        cachedLanguages = getAvailableLanguages();
    }
    return cachedLanguages ?? [];
}

export function getLangSuffix(langCode: string): string {
    if (!engineInitialized) {
        return 'en/library/bible/study-bible/books/';
    }
    try {
        return wasmModule.TravertureEngine.get_lang_suffix(langCode);
    } catch {
        return 'en/library/bible/study-bible/books/';
    }
}

export function getAslMetadataUrl(bookNumber: number, chapter: number): string {
    if (!engineInitialized) {
        return '';
    }
    try {
        return wasmModule.TravertureEngine.get_asl_metadata_url(bookNumber, chapter);
    } catch {
        return '';
    }
}

export function getChapterCount(bookId: number): number {
    if (!engineInitialized) {
        return 0;
    }
    try {
        return wasmModule.TravertureEngine.get_chapter_count(bookId);
    } catch {
        return 0;
    }
}

export function getVerseCount(bookId: number, chapter: number): number {
    if (!engineInitialized) {
        return 0;
    }
    try {
        return wasmModule.TravertureEngine.get_verse_count(bookId, chapter);
    } catch {
        return 0;
    }
}