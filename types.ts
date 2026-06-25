export interface TravertureSettings {
    sourceLanguage: string;
    outputLanguage: string;
}

export const DEFAULT_SETTINGS: TravertureSettings = {
    sourceLanguage: 'en',
    outputLanguage: 'en',
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