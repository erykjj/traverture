# tra.VER:ture Security and Privacy

## Network Use

This plugin fetches scripture text from the official *jw.org* API when displaying verse previews or inserting citations. No data is sent; only scripture BCV codes are used in the URL to retrieve verse content. Fetched content is cached locally in memory for 1 hour.

No other network requests are made. **No telemetry, tracking, or third-party services** are used. **No HTML web-scraping** is involved.

---

## File Access

The plugin reads the active note and it inserts or reformats text via the editor when you invoke those actions. All file operations go through Obsidian's API and are limited to your vault.

### What the plugin does:
- **Reads the active note** to detect references in Reading View and to fetch frontmatter language overrides
- **Writes to the active note** only when you invoke "Insert citation" or "Reformat" actions via the context menu or command palette

### What the plugin does not do:
- Modify files without your explicit action
- Access files outside your vault
- Transmit file content anywhere

---

## Privacy

This plugin writes to the system clipboard only when you click a COPY button (to copy scripture text or table data). **No clipboard data is ever read. No data is collected, stored, or transmitted**.

---

## WASM Module

This plugin includes a WebAssembly (WASM) parsing engine binary compiled from Rust. The WASM module is **embedded** in the plugin file and is not loaded from any external source. The parsing engine is based on my [linkture](https://github.com/erykjj/linkture) project.

The WASM module:
- Does not make any network requests
- Does not access the file system
- Does not read or modify DOM directly
