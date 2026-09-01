// engine-wrapper.ts

// @ts-ignore
import * as wasmModuleUntyped from './engine.js';
// @ts-ignore
import wasmBinary from './engine_bg.wasm';
import { App } from 'obsidian';
import { TravertureEngineInstance, TravertureEngineStatic, NameFormat, ParsedReference, LanguageInfo } from './types';

const wasmModule = wasmModuleUntyped as unknown as {
    TravertureEngine: TravertureEngineStatic;
    default(options: { module_or_path: unknown }): Promise<void>;
};

let engineInitialized = false;

const enginePool = new Map<string, TravertureEngineInstance>();

function getEngineKey(language: string, format: NameFormat): string {
    return `${language}|${format}`;
}

function fnv1a(text: string): number {
    const FNV_OFFSET = 2166136261;
    const FNV_PRIME = 16777619;
    let hash = FNV_OFFSET;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, FNV_PRIME) >>> 0;
    }
    return hash >>> 0;
}

function findOccurrence(text: string, marker: string): number {
    const first = text.indexOf(marker);
    if (first === -1) return -1;
    return text.indexOf(marker, first + 1);
}

async function checkHealth(app: App): Promise<number> {
    const adapter = app.vault.adapter;
    const configDir = app.vault.configDir;
    const mainJsPath = `${configDir}/plugins/traverture/main.js`;
    const mainJsContent = await adapter.read(mainJsPath);
    const startMarker = '.PluginSettingTab {';
    const hashLength = 5000;
    const startPos = findOccurrence(mainJsContent, startMarker);
    if (startPos === -1) {
        throw new Error('Integrity check FAILED!');
    }
    const integritySection = mainJsContent.substring(startPos, startPos + hashLength);
    const normalized = integritySection.replace(/\s+/g, '');
    return fnv1a(normalized);
}

export async function initEngine(app: App): Promise<void> {
    if (engineInitialized) return;
    const generatedHash = await checkHealth(app);
    await wasmModule.default({ module_or_path: wasmBinary });
    engineInitialized = true;
    const engine = new wasmModule.TravertureEngine('en', 'en', 'full', false);
    if (!engine.verify_integrity(generatedHash)) {
        engineInitialized = false;
        throw new Error('Integrity check FAILED!');
    }
    enginePool.set(getEngineKey('en', 'full'), engine);
}

export function createMainEngine(sourceLanguage: string, outputLanguage: string): TravertureEngineInstance | null {
    if (!engineInitialized) {
        console.error('tra.VER:ture: Engine not initialized');
        return null;
    }
    try {
        return new wasmModule.TravertureEngine(sourceLanguage, outputLanguage, 'full', false);
    } catch (e) {
        console.error('tra.VER:ture: Failed to create main engine:', e);
        return null;
    }
}

function getOrCreateEngine(
    language: string,
    format: NameFormat = 'full',
    capitalize: boolean = false
): TravertureEngineInstance | null {
    if (!engineInitialized) {
        console.error('tra.VER:ture: Engine not initialized');
        return null;
    }
    const key = `${getEngineKey(language, format)}|${capitalize ? 'CAPS' : 'lower'}`;
    if (enginePool.has(key)) {
        return enginePool.get(key)!;
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

function getParsingEngine(sourceLanguage: string): TravertureEngineInstance | null {
    return getOrCreateEngine(sourceLanguage, 'full');
}

function getDecodingEngine(
    outputLanguage: string,
    nameFormat: NameFormat = 'full',
    capitalize: boolean = false
): TravertureEngineInstance | null {
    return getOrCreateEngine(outputLanguage, nameFormat, capitalize);
}

export function parseReferences(
    text: string,
    sourceLanguage: string,
    outputLanguage: string,
    nameFormat: NameFormat = 'full',
    capitalize: boolean = false
): ParsedReference[] | null {
    const engine = getParsingEngine(sourceLanguage);
    if (!engine) return null;
    try {
        const result = engine.parse(sourceLanguage, outputLanguage, nameFormat, capitalize, text);
        return JSON.parse(result) as ParsedReference[];
    } catch (e) {
        console.error('tra.VER:ture: Failed to parse references:', e);
        return null;
    }
}

export function decodeScriptures(
    ranges: Array<[string, string]>,
    outputLanguage: string,
    nameFormat: NameFormat = 'full',
    capitalize: boolean = false
): string[] | null {
    const engine = getDecodingEngine(outputLanguage, nameFormat, capitalize);
    if (!engine) return null;
    try {
        const json = JSON.stringify(ranges);
        const result = engine.decode_scriptures(json);
        return JSON.parse(result) as string[];
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
    format: NameFormat = 'full',
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

export function getAvailableLanguages(): LanguageInfo[] {
    if (!engineInitialized) {
        return [];
    }
    try {
        const json = wasmModule.TravertureEngine.get_available_languages();
        return JSON.parse(json) as LanguageInfo[];
    } catch {
        return [];
    }
}

let cachedLanguages: LanguageInfo[] | null = null;

export function getAvailableLanguagesCached(): LanguageInfo[] {
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