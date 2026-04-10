# MCP Plugin Manifests

This directory contains marketplace manifests for external Tengra MCP plugins.

## File Naming

- Use descriptive kebab-case filenames that match the plugin id.
- Use the `.mcp.json` suffix.
- Example: `web-search.mcp.json`

## Manifest Format

Each manifest must be valid UTF-8 JSON and include:

- `$schema` (string): Use `./mcp-manifest.schema.json` for local validation.
- `id` (string): Stable unique identifier in kebab-case.
- `name` (string): Human-friendly plugin name.
- `description` (string): Short discovery summary.
- `author` (string): Creator or publisher name.
- `version` (string): Semantic version.
- `downloadUrl` (string): Raw manifest URL.
- `itemType` (string): Must be `mcp`.
- `category` (string): Discovery category.
- `command` (string): Process command to start the MCP server.
- `args` (string[]): Process arguments passed without a shell.
- `permissionProfile` (string): One of `read-only`, `workspace-only`, `network-enabled`, `destructive`, or `full-access`.
- `tools` (array): Tool names and short descriptions exposed by the plugin.

Optional fields:

- `entrypointUrl` (string): Raw JavaScript server URL downloaded into Tengra runtime storage during install.
- `entrypointFile` (string): Local filename used for the downloaded entrypoint.
- `env` (object): Environment variables required by the plugin.
- `storage` (object): Plugin-local storage settings.
- `capabilities` (string[]): Discovery and security capability labels.

## Example

```json
{
  "$schema": "./mcp-manifest.schema.json",
  "id": "example-plugin",
  "name": "Example Plugin",
  "description": "Example external MCP plugin manifest.",
  "author": "Tengra Studio",
  "version": "1.0.0",
  "downloadUrl": "https://raw.githubusercontent.com/TengraStudio/tengra-market/main/mcp/example-plugin.mcp.json",
  "itemType": "mcp",
  "category": "utility",
  "command": "node",
  "args": [],
  "entrypointUrl": "https://raw.githubusercontent.com/TengraStudio/tengra-market/main/mcp/example-plugin/server.mjs",
  "entrypointFile": "server.mjs",
  "permissionProfile": "read-only",
  "tools": [
    {
      "name": "example",
      "description": "Runs the example tool."
    }
  ],
  "storage": {
    "dataPath": "example-plugin",
    "quotaMb": 64,
    "migrationVersion": 1
  },
  "capabilities": ["read"]
}
```

## Policy

Do not add registry entries for packages that cannot be installed and started by the manifest command. If a plugin needs an npm package, verify that the package exists and that the command runs without a shell.
