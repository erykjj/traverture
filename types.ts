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