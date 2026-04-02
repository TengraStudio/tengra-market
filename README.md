# Tengra Marketplace

This repository hosts the official and community-contributed themes, MCP modules, language packs, and skills for [Tengra](https://github.com/TengraStudio/tengra).

## Repository Structure

- `registry.json`: The central index of all marketplace items.
- `themes/`: Theme manifest files.
- `mcp/`: MCP module metadata.
- `languages/`: Runtime language pack files.
- `skills/`: Skill manifest files.
- `models/ollama-models.json`: Scraped public Ollama model index.
- `models/huggingface-models.json`: Scraped Hugging Face model index (filtered for Tengra-compatible categories).
- `scripts/scrape-ollama-models.mjs`: Ollama scraper script.
- `scripts/scrape-hf-models.mjs`: Hugging Face scraper script.

## Ollama model scraper automation

- Manual trigger: GitHub Actions → **Scrape Ollama Models** → Run workflow
- Automatic trigger: every Sunday (UTC) via schedule
- Behavior:
  - Scrapes public models from `https://ollama.com/library`
  - Compares the generated model list with `models/ollama-models.json`
  - If there is no model-level change, workflow exits without commit
  - If there are changes (new/removed/updated models), JSON is updated and committed

## Hugging Face model scraper automation

- Manual trigger: GitHub Actions → **Scrape Hugging Face Models** → Run workflow
- Automatic trigger: every Sunday (UTC) via schedule
- Source: Hugging Face Models API
- Filter: only Tengra-compatible categories derived from Tengra's own classifier:
  - `coding`
  - `chat`
  - `multimodal`
  - `embedding`
  - `reasoning`
  - `general`
- Behavior:
  - If model-level output is unchanged, workflow exits without commit
  - If changed, `models/huggingface-models.json` is updated and committed

## Contributing

If you would like to contribute a theme, an MCP module, a language pack, or a skill, please open a Pull Request with your manifest file and update the `registry.json` accordingly.

### Theme Format

Themes must follow the `ThemeManifest` structure with colors defined in HSL format.

### Language Pack Format

Language packs must be JSON files with locale metadata plus a `translations` object that mirrors Tengra's English translation tree.

### Skill Format

Skills are JSON manifests stored in `skills/` and indexed under the `skills` array in `registry.json`. See `skills/README.md` for the required schema and field definitions. Skill filenames now use descriptive kebab-case names (not numeric placeholders), and categories span software, education, research, marketing, operations, planning, and productivity use cases.

---
© 2026 Tengra Studio

