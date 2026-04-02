# Skills Directory

This directory contains marketplace skill manifests used by Tengra.

## File Naming

- Use: `<skill-id>.skill.json`
- Example: `ai-skill-01.skill.json`

## Skill Manifest Format

Each skill manifest must be valid UTF-8 JSON and include the following fields:

- `id` (string): Stable unique identifier in kebab-case.
- `name` (string): Human-friendly skill name.
- `description` (string): Short discovery summary.
- `publisher` (string): Creator or publisher name.
- `version` (string): Semantic version, e.g. `1.0.0`.
- `language` (string): Content language code (use `en` for English).
- `category` (string): Discovery category.
- `tags` (string[]): Search tags.
- `systemPrompt` (string): Instructional system prompt text.
- `userPromptTemplate` (string): Prompt template with placeholders.
- `outputFormat` (string): Expected output format (for example `markdown`).
- `itemType` (string): Must be `skill`.

## Marketplace Registration

Skills are discoverable through `registry.json` under the top-level `skills` array.
Each registry entry should include at least:

- `id`
- `name`
- `description`
- `author` and/or `publisher`
- `version`
- `downloadUrl`
- `itemType`
- discovery fields such as `language`, `category`, and `tags`

## Content Language Policy

Skill prompts and descriptions must be English-only unless a future localization policy is introduced.
