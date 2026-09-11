# Prompt Cookbook

A collection of prompts for popular AI models, written for workforce development boards. This is a self contained file so there are no accounts, or server setup.

[https://kylehamilton.github.io/AI-Prompts/](https://kylehamilton.github.io/AI-Prompts/)



## Files

| File | What it is |
|---|---|
| `index.html` | Contains the app and a copy of the collection. |
| `index.template.html` | Shell and styles, with `__SEED__` and the app placeholder. Input to the build. |
| `prompts.json` | The collection. The only file you need to edit to publish new prompts. |
| `app.js` | Application logic. Input to the build. |

There is an R file that I'll upload later.

## Running it

**Off a shared or local drive.** Double-click `index.html`. `fetch()` fails under `file://`,
so the app falls back to the copy of the collection embedded at build time. Everything
works; the collection is whatever was current when the file was built.

**Served (GitHub Pages).** `index.html` fetches
`prompts.json` on load and uses it instead of the embedded copy. Publish a new prompt
by replacing `prompts.json`.

## Using it

Pick a prompt from the index, fill in the variables, choose your model, copy, paste.

**Variables.** Anything written `{{LIKE_THIS}}` becomes a fill-in box. Values are stored by
key rather than by prompt, so typing your board name once fills it into every prompt that
asks for it.

**The model buttons.** Claude, ChatGPT, and Gemini do not change what the prompt asks for.
Prompts store role, context, steps, output format, rules, and source material.
Each button lays those same parts out the way that model handles best:

| | How it renders |
|---|---|
| Claude | XML tags around each part, source material before the instructions |
| ChatGPT | Markdown headings, numbered steps, data-analysis handoff when a file is involved |
| Gemini | Source material first, brief second, instruction restated at the end |

The Model tuning guide in the app explains why each one is shaped that way, so you can do
it by hand in a chat window.

## What lives in your browser

Favorites, prompts you write, edits to published prompts, saved variable values, and your
model choice are all in `localStorage`. They are per person, per browser, and clearing site
data wipes them.

- **Back up my prompts** exports that as a JSON file; **Restore from a backup** merges it back.
- **Export full prompts.json** writes the entire prompt collection.

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

`functions` are `case-management`, `business-services`, `fiscal`, `grants`, `research`,
`admin`. `category` is `draft`, `review`, `analyze`, `summarize`, or `plan`. `complexity` is
`low`, `medium`, or `high` and only affects filtering and how much reasoning scaffolding the
composed prompt carries. Both lists, along with their labels and colors, live in the
`taxonomy` block at the top of `prompts.json`.

## Building

`index.html` is `index.template.html` with `prompts.json` and `app.js` injected into it.

```r
source("build_vault.R")
write_vault(extract_cookbook("prompts"))
```

If you are only changing the app or the collection and have no legacy tree to migrate, the
injection is two string substitutions `__SEED__` and the app placeholder comment and any
language will do it.
