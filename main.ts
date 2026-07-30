import { Plugin, WorkspaceLeaf, Notice, Menu, MarkdownView } from 'obsidian';
// @ts-ignore
import wasmBinary from './engine_bg.wasm';
// @ts-ignore
import * as wasmModule from './engine.js';
import { fetchVerseWithExtras, getAslTimecodes } from './cache';
import { createTravertureEditorPlugin } from './editor';
import { getAvailableLanguages } from './languages';
import { VerseModal } from './modal';
import { TravertureSettingTab } from './settings';
import { TravertureSidebarView } from './sidebar';
import { DEFAULT_SETTINGS, VIEW_TYPE_TRAVERTURE_SIDEBAR, SidebarRef } from './types';
import { buildJwLibraryFinderUrlForReference, buildJwOrgFinderUrlForReference } from './linkScheme';
import { VaultOfflineEpubRepository } from './VaultOfflineEpubRepository';
import { EpubImportService } from './EpubImportService';

export default class TraverturePlugin extends Plugin {
    settings = DEFAULT_SETTINGS;
    engine: any = null;
    private processingElements = new Set<HTMLElement>();

    // offline importer & repo
    offlineRepo: VaultOfflineEpubRepository | null = null;
    epubImportService: EpubImportService | null = null;

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    createEngine() {
        try {
            this.engine = new wasmModule.TravertureEngine(
                this.settings.sourceLanguage,
                this.settings.outputLanguage,
                'full',
                false
            );
        } catch (e) {
            console.error('tra.VER:ture: Failed to create engine:', e);
        }
    }

    private parseGuard = false;

    safeParse(text: string): string | null {
        return this.engine.parse(
            this.settings.sourceLanguage,
            this.settings.outputLanguage,
            'full',
            false,
            text
        );
    }

    private stripFrontmatter(content: string): string {
        if (content.startsWith('---')) {
            const endIndex = content.indexOf('---', 3);
            if (endIndex !== -1) {
                return content.substring(endIndex + 3);
            }
        }
        return content;
    }

    async parseReferences(text: string): Promise<SidebarRef[]> {
        const results: SidebarRef[] = [];
        if (!this.engine) return results;

        text = this.stripFrontmatter(text);
        const engineText = text.replace(/\{\{(.+?)\}\}/g, '⟪⟪$1⟫⟫');
        const parsed = this.safeParse(engineText);
        if (!parsed) return results;

        const clauses: Array<[string, number, number, string[][]]> = JSON.parse(parsed);
        if (clauses.length === 0) return results;

        let lastBookNum = -1;
        let groupStart = 0;
        let groupEnd = 0;
        let groupCount = 0;

        const clauseData: Array<{ ranges: string[][]; bookNum: number; original: string }> = [];

        for (const [, startPos, endPos, ranges] of clauses) {
            if (ranges.length === 0) continue;
            const bookNum = parseInt(ranges[0][0].substring(0, 2));

            if (bookNum !== lastBookNum) {
                if (lastBookNum !== -1 && groupCount > 0) {
                    
