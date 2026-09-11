# Prompt Cookbook

A collection of prompts for popular AI models.

## Files

| File | What it is |
|---|---|
| `index.html` | Contains the app and a copy of the collection. |
| `prompts.json` | The collection. The only file you need to edit to publish new prompts. |
| `app.js` | Application logic. Input to the build. |

## Running it

**Off a shared drive.** Double-click `index.html`. `fetch()` fails under `file://`,
so the app falls back to the copy of the collection embedded at build time. Everything
works; the collection is whatever was current when the file was built.

**Served (GitHub Pages).** `index.html` fetches
`prompts.json` on load and uses it instead of the embedded copy. Publish a new prompt
by replacing `prompts.json`.
