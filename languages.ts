// @ts-ignore
import * as wasmModule from './traverture_obsidian.js';
import { LanguageInfo } from './types';

let cachedLanguages: LanguageInfo[] | null = null;

export function getAvailableLanguages(): LanguageInfo[] {
    if (!cachedLanguages) {
        try {
            const json = wasmModule.ObsidianEngine.get_available_languages();
            cachedLanguages = JSON.parse(json);
        } catch (e) {
            console.error('Failed to get languages from WASM:', e);
            cachedLanguages = [];
        }
    }
    return cachedLanguages ?? [];
}

export function getLangSuffix(langCode: string): string {
    try {
        return wasmModule.ObsidianEngine.get_lang_suffix(langCode);
    } catch {
        return 'en/library/bible/study-bible/books/';
    }
}