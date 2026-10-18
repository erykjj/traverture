// engine-wrapper.ts

// @ts-ignore
import * as wasmModuleUntyped from './engine.js';
import wasmBinary from './engine_bg.wasm';
import { App } from 'obsidian';
import { TravertureEngineInstance, TravertureEngineStatic, NameFormat, ParsedReference, LanguageInfo } from './types';

const WASM_START = '/*WASM-START*/';
const WASM_END = '/*WASM-END*/';
const H_START = 2166136261;
const H_END = 16777619;
const wasmModule = wasmModuleUntyped as unknown as {
    TravertureEngine: TravertureEngineStatic;
    default(options: { module_or_path: unknown }): Promise<void>;
};
const enginePool = new Map<string, TravertureEngineInstance>();

let engineInitialized = false;
let inrefensEnabled = false;
let engineId = 0;


function getEngineKey(language: string, format: NameFormat): string {
    return `${language}|${format}`;
}

export async function initEngine(app: App, inrefens: boolean): Promise<void> {
    if (engineInitialized) return;
    inrefensEnabled = inrefens;

    const configDir = app.vault.configDir;
    const mainJsText = await app.vault.adapter.read(`${configDir}/plugins/traverture/main.js`);

    const wsIdx = mainJsText.indexOf(WASM_START);
    if (wsIdx === -1) throw new Error('engine: WASM-START marker not found');
    const weIdx = mainJsText.indexOf(WASM_END, wsIdx);
    if (weIdx === -1) throw new Error('engine: WASM-END marker not found');
    const stripped = mainJsText.slice(0, wsIdx) + mainJsText.slice(weIdx + WASM_END.length);
    const bytes = new TextEncoder().encode(stripped);
    let h = H_START;
    for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = Math.imul(h, H_END) >>> 0;
    }
    engineId = h >>> 0;

    const payload = wasmBinary.slice(
        wasmBinary.indexOf(WASM_START) + WASM_START.length,
        wasmBinary.indexOf(WASM_END)
    );
    const wasmBin = Uint8Array.from(atob(payload), c => c.charCodeAt(0));
    await wasmModule.default({ module_or_path: wasmBin });
    engineInitialized = true;

    try {
        const probe = new wasmModule.TravertureEngine(
            'en', 'en', 'full', false, inrefensEnabled, engineId
        );
        enginePool.set(getEngineKey('en', 'full'), probe);
    } catch (e) {
        engineInitialized = false;
        throw e;
    }
}

export function createMainEngine(sourceLanguage: string, outputLanguage: string): TravertureEngineInstance | null {
    if (!engineInitialized) {
        console.error('tra.VER:ture: Engine not initialized');
        return null;
    }
    try {
        return new wasmModule.TravertureEngine(
            sourceLanguage, outputLanguage, 'full', false, inrefensEnabled, engineId
        );
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
    const key = `${getEngineKey(language, format)}|${capitalize ? 'CAPS' : 'lower'}|${inrefensEnabled ? 'INR' : 'noINR'}`;
    if (enginePool.has(key)) {
        return enginePool.get(key)!;
    }
    try {
        const engine = new wasmModule.TravertureEngine(
            language, language, format, capitalize, inrefensEnabled, engineId
        );
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

export function resolveLanguage(input: string): string | null {
    const languages = getAvailableLanguagesCached();
    if (languages.length === 0) return null;
    if (!input || typeof input !== 'string') return null;
    const cleanInput = input.trim().replace(/^["']|["']$/g, '').toLowerCase();
    for (const lang of languages) {
        if (lang.code && lang.code.toLowerCase() === cleanInput) {
            return lang.code;
        }
        if (lang.vernacularName && lang.vernacularName.toLowerCase() === cleanInput) {
            return lang.code;
        }
        if (lang.englishName && lang.englishName.toLowerCase() === cleanInput) {
            return lang.code;
        }
    }
    return null;
}

export function parseFrontmatterLanguage(text: string): string | null {
    if (!text || !text.startsWith('---')) return null;
    const end = text.indexOf('---', 3);
    if (end === -1) return null;
    const frontmatter = text.substring(3, end);
    for (const line of frontmatter.split('\n')) {
        const match = line.match(/^([^:]+):\s*(.+)$/);
        if (!match) continue;
        const key = match[1].trim().toLowerCase();
        if (key !== 'language') continue;
        let value = match[2].trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        return resolveLanguage(value);
    }
    return null;
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