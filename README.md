# tra.VER:ture – Obsidian plugin

**traverture** (n.): The act of traversing text to find, convert, and reformat scripture references – a turning across formats, translations, and styles. From Latin *trans-* ("across") + *vertere* ("to turn") + *-ura* (action/result).

A scripture reference parser and formatter for Obsidian. Create interactive links with verse previews, or parse entire documents into a searchable, sortable sidebar table.

---

## Features

- **Inline reference parsing** – Wrap any text containing scripture references in `{{ }}` to create clickable links (in View mode). Surrounding text is preserved. Multiple references within a single block are all detected.

  ```text
  {{this is John 17:17 and Ps 1:1-3 end of test}}
  ```
  Produces two clickable links: `John 17:17` and `Ps 1:1-3`

- **Verse preview modal** – Click any reference to open a modal with the full scripture text[^1] and buttons to copy the text, or open in *JW Library*[^2] or [*JW.ORG*](https://jw.org).

- **Sidebar table** – Parse a selection or entire document into a searchable, sortable table with columns for Original, Full, Standard, and Official name formats, BCV codes, and chapter and verse numbers. Features include:
  - Accent-insensitive search/filter
  - Sort by any column (ascending/descending/original order)
  - Column visibility toggles
  - Translation language dropdown with live book name translation
  - Option to render book names in all-caps
  - Option to filter out duplicate entries
  - Copy table (with current filter/sort, etc.) to clipboard (TSV format)

- **Tag references** – Enclose all scripture references in a selection or document with `{{ }}` markers.

- **Insert citation** – Replace a scripture reference with the full verse text[^1]. Two formats available:
  - `Reference: "verse"` – preserves verse numbers
  - `"verse" (Reference)` – plain text without verse numbers

- **Reformat references** – Convert references between Full (1 Corinthians), Standard (1 Cor.), and Official (1Co) name formats. Works on selections or entire documents.

- **Multi-language support** – Parse references in any supported language, and display or fetch verse text in a different language.
  - Supported languages: Danish, Dutch, English, French, German, Italian, Japanese, Korean, Mandarin Chinese (simplified), Norwegian, Polish, Portuguese, Russian, Spanish, Swedish, Ukrainian

---

## Usage

### Desktop
Right-click text selection or anywhere in the editor to access:
- **Parse selection / Parse document** – Open the sidebar table
- **Insert citation** – Choose `Reference: "verse"` or `"verse" (Reference)`
- **Tag selection / Tag document** – Wrap references in `{{ }}`
- **Reformat selection / Reformat document** – Convert between name formats

### Mobile
Tap the three-line hamburger menu and look for **tra.VER:ture** (scroll icon) to access all commands.

---

## Settings

- **Source language** – Language of the scripture references in your notes
- **Output language** – Language for displaying book names in the sidebar and fetching verse text for previews

---

## Network Use

This plugin fetches scripture text from the official *jw.org* API when displaying verse previews or inserting citations. No data is sent; only scripture BCV codes are used in the URL to retrieve verse content. Fetched content is cached locally in memory for 1 hour.

No other network requests are made. **No telemetry, tracking, or third-party services** are used. **No HTML web-scraping** is involved.

---

## Performance

Depending on the length of the scripture passage and the device, initial verse lookup requires a network request and may take a moment. Parsing large documents on mobile may take a few seconds.

---

## Installation

1. Download the [latest release](https://github.com/erykjj/traverture/releases/latest/download/traverture.zip)
2. Unzip and copy the folder to your vault's `.obsidian/plugins/` directory
3. Enable the plugin in Obsidian Settings → Community plugins
4. Configure source and output languages in the plugin settings

______

[^1]: Bible citation text is taken from [*New World Translation of the Holy Scriptures*](https://www.jw.org/en/library/bible/study-bible/books/) (*NWT*) (© Watch Tower Bible and Tract Society of Pennsylvania). In the future, other translations may be included.

[^2]: [JW Library](https://www.jw.org/en/online-help/jw-library/) is a registered trademark of Watch Tower Bible and Tract Society of Pennsylvania.
