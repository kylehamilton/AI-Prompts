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

## Prompt schema

```json
{
  "id": "iss-goal-drafting",
  "title": "Draft ISS goals from an intake summary",
  "summary": "One line for the index.",
  "functions": ["case-management"],
  "category": "draft",
  "complexity": "medium",
  "sensitivity": "deidentify",
  "source": "frwdb",
  "tags": ["WIOA Title I", "ISS"],
  "blocks": {
    "role": "You are a WIOA Title I career planner at {{BOARD_NAME}}.",
    "context": "Standing facts the model needs about our setting.",
    "steps": ["One instruction per array element."],
    "output": "The shape of the deliverable.",
    "constraints": ["One rule per array element."],
    "data": "What the user pastes or attaches."
  },
  "placeholders": [
    { "key": "BOARD_NAME", "label": "Board name", "default": "Fresno Regional Workforce Development Board" }
  ],
  "notes": "Shown under the composed prompt."
}
```

`sensitivity` drives a banner notice above the prompt: `none`, `deidentify`, or `prohibited`.
