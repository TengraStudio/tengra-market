# Tengra Marketplace

This repository hosts the official and community-contributed themes, MCP modules, and language packs for [Tengra](https://github.com/TengraStudio/tengra).

## Repository Structure

- `registry.json`: The central index of all marketplace items.
- `themes/`: Theme manifest files.
- `mcp/`: MCP module metadata.
- `languages/`: Runtime language pack files.
- `models/ollama-models.json`: Scraped public Ollama model index.
- `scripts/scrape-ollama-models.mjs`: Ollama scraper script.

## Ollama model scraper automation

- Manual trigger: GitHub Actions → **Scrape Ollama Models** → Run workflow
- Automatic trigger: every Sunday (UTC) via schedule
- Behavior:
  - Scrapes public models from `https://ollama.com/library`
  - Compares the generated model list with `models/ollama-models.json`
  - If there is no model-level change, workflow exits without commit
  - If there are changes (new/removed/updated models), JSON is updated and committed

## Contributing

If you would like to contribute a theme, an MCP module, or a language pack, please open a Pull Request with your manifest file and update the `registry.json` accordingly.

### Theme Format

Themes must follow the `ThemeManifest` structure with colors defined in HSL format.

### Language Pack Format

Language packs must be JSON files with locale metadata plus a `translations` object that mirrors Tengra's English translation tree.

---
© 2026 Tengra Studio
