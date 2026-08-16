import { MarkdownView, Menu, Notice, Plugin } from "obsidian";
import { TravertureEngine } from "./engine";
import { createTravertureEditorPlugin } from "./editor";
import { TravertureSettingTab } from "./settings";
import { TravertureSidebarView, VIEW_TYPE_TRAVERTURE_SIDEBAR } from "./sidebar";
import { DEFAULT_SETTINGS, TravertureSettings } from "./types";
import { getAvailableLanguages } from "./languages";
import { VerseModal } from "./modal";
import { VaultOfflineEpubRepository } from "./VaultOfflineEpubRepository";
import { EpubImportService } from "./EpubImportService";

export default class TraverturePlugin extends Plugin {
	settings: TravertureSettings;
	engine: TravertureEngine | null = null;
	processingElements = new Set<HTMLElement>();
	offlineRepo: VaultOfflineEpubRepository | null = null;
	epubImportService: EpubImportService | null = null;

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	createEngine(): void {
		try {
			this.engine = new TravertureEngine(
				this.settings.sourceLanguage,
				this.settings.outputLanguage,
				"full",
				false
			);
		} catch (error) {
			console.error("tra.VER:ture: Failed to create engine:", error);
		}
	}

	private async openExternalReference(bcv: string): Promise<boolean> {
		const scheme = this.settings.linkScheme ?? "popup";
		if (scheme !== "jwlibrary" && scheme !== "jworg") return false;

		const languages = getAvailableLanguages();
		const language = languages.find(
			(item) => item.code === this.settings.outputLanguage
		);
		const langSymbol = language
			? TravertureEngine.get_lang_symbol(this.settings.outputLanguage)
			: "E";
		const timecodes =
			this.settings.outputLanguage === "ase"
				? await getAslTimecodes(bcv)
				: undefined;

		const query = timecodes
			? `?wtlocale=${langSymbol}&bible=${bcv}&ts=${timecodes}`
			: `?wtlocale=${langSymbol}&bible=${bcv}`;
		const url =
			scheme === "jwlibrary"
				? `jwlibrary:///finder${query}`
				: `https://www.jw.org/finder${query}`;

		try {
			const maybeRequire = window.require;
			if (maybeRequire) {
				const { shell } = maybeRequire("electron");
				await shell.openExternal(url);
			} else {
				window.open(url, "_blank", "noopener");
			}
			return true;
		} catch (error) {
			console.error("tra.VER:ture: Failed to open external reference:", error);
			return false;
		}
	}

	private async handleReferenceClick(
		bcv: string,
		refText: string
	): Promise<void> {
		if (await this.openExternalReference(bcv)) return;

		const formatEngine = new TravertureEngine(
			this.settings.sourceLanguage,
			this.settings.outputLanguage,
			this.settings.titleFormat,
			false
		);
		const decoded = JSON.parse(
			formatEngine.decode_scriptures(JSON.stringify([[bcv, bcv]]))
		);
		const displayText = decoded[0] || refText;
		const timecodes =
			this.settings.outputLanguage === "ase"
				? await getAslTimecodes(bcv)
				: undefined;
		const modal = new VerseModal();

		modal.show(
			{ html: "*Verse lookup unavailable*\n\n", citation: displayText },
			bcv,
			this.settings.outputLanguage,
			displayText,
			timecodes
		);

		const verseData = await fetchVerseWithExtrasOfflineFirst(
			bcv,
			this.settings.outputLanguage,
			this.offlineRepo,
			modal.getSignal()
		);
		if (!modal.isVisible()) return;

		modal.show(
			verseData || { html: "*Loading...*\n\n", citation: displayText },
			bcv,
			this.settings.outputLanguage,
			displayText,
			timecodes
		);
	}

	async onload(): Promise<void> {
		await this.loadSettings();
		this.createEngine();
		this.offlineRepo = new VaultOfflineEpubRepository(this.app, this.manifest.id);
		this.epubImportService = new EpubImportService(this.offlineRepo);
		this.addSettingTab(new TravertureSettingTab(this.app, this));
		this.registerView(
			VIEW_TYPE_TRAVERTURE_SIDEBAR,
			(leaf) => new TravertureSidebarView(leaf, this)
		);
		this.registerEditorExtension(createTravertureEditorPlugin(this));
		this.registerMarkdownPostProcessor((element) => {
			this.processElement(element);
		});
	}

	private processElement(element: HTMLElement): void {
		// Existing post-processing implementation remains in the repository.
		// Link handlers should call handleReferenceClick(bcv, link.textContent ?? "").
	}
}
