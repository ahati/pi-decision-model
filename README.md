# pi-decision-model

A [Pi](https://github.com/earendil-works/pi) extension that adds **OpenCode Go decision models** to the `opencode-go` provider, alongside its existing chat models.

Decision (classifier) models answer typed questions — yes/no, multiple choice, or scored ratings — with probabilities, at a fraction of the cost and latency of a chat completion. They are ideal for routing, triage, filtering, and guardrails.

## Models added

| Model ID | Type | Input | Price (per 1M input tokens) |
|---|---|---|---|
| `opencode-go/jev-1.14` | TypeSafe Jev (System One) | text | $0.042 |
| `opencode-go/gemini-decision-1` | Google | text | $0.10 |
| `opencode-go/gpt-6-luna-decision` | OpenAI | text | $0.10 (≤272K), $0.20 (>272K) |

All output tokens are free. Requests are billed to your **OpenCode Go subscription** (`billing_source: "go"`), not OpenCode Models credits, and do not require the free-endpoint training opt-in.

## Install

```bash
pi install git:github.com/ahati/pi-decision-model
# or from npm, if published:
pi install npm:pi-decision-model
```

Restart pi or run `/reload`.

**Requirements:**
- Pi ≥ 1.6
- An [OpenCode Go](https://opencode.ai/docs/console/go) subscription
- API key available via the stored `opencode-go` credential (`pi /login` or `auth.json`) or the `OPENCODE_API_KEY` environment variable

## Usage

Decision models do not appear in `/model`. Call them from the `codemode` tool:

```js
const jev = await models.getModelOfType("classifier", "opencode-go", "jev-1.14");
const result = await models.classify(jev, {
  state: { message: "The build passed and all tests are green." },
  questions: {
    build_ok: {
      type: "bool",
      instructions: "Did the build succeed?",
      criteria: { true: "build succeeded", false: "build failed" },
    },
    health: {
      type: "choice",
      instructions: "Rate repository health",
      criteria: { broken: "CI failing", degraded: "some failures", healthy: "all passing" },
    },
  },
});
// result.answers.build_ok → { type: "bool", probability: 0.98 }
// result.answers.health   → { type: "choice", choice: "healthy", confidence: 1, probabilities: {...} }
```

List everything available with `models.getAvailableOfType("classifier")`.

List everything with `models.getAvailableOfType("classifier")`, or pick interactively:

## /decision-model

`/decision-model` mirrors `/model` for decision models:

- `/decision-model` — opens the same search picker (fuzzy filter, arrow keys, Enter) over every decision model pi knows, e.g. `opencode-go/jev-1.14` or `openrouter/typesafe/jev-1.14`.
- `/decision-model opencode-go/jev-1.14` — exact match selects immediately, like `/model provider/id`.
- **Enter** selects for the session; **ctrl+s** saves as default (restored on every session start); **Esc** cancels.
- The current choice persists in `~/.pi/agent/decision-model.json` and shows in the footer status bar as `dm: provider/id`.

The picker reuses pi's own model selector component, so the UX is identical to `/model`.

**Footer status line** — off by default. To show the current decision model in the status bar, set:

```json
// ~/.pi/agent/decision-model.json
{ "showStatus": true }
```

## How it works

pi's `models.json` loader silently drops model `type`, so decision models can only be declared by provider code — there is no configuration-only way to add them (see [pi discussion #10950](https://github.com/earendil-works/pi/discussions/10950) for the same limitation). This extension:

1. Re-registers the `opencode-go` provider with its generated chat models **plus** the three decision model entries pointing at the Go System One endpoint (`https://opencode.ai/inference/go/systemone/v1/systemone`).
2. Reuses the System One classify implementation from pi's built-in `opencode` (Zen) provider — it is model-driven, so it correctly targets the Go gateway for these entries.
3. Inherits authentication from the built-in provider (stored credential or `OPENCODE_API_KEY`).

If a future pi version removes either building block, the extension fails soft and leaves the built-in provider untouched.

Chat models are **not** hardcoded — they are read from pi-ai's generated catalog, so they stay in sync with pi updates.

## Uninstall

```bash
pi remove git:github.com/ahati/pi-decision-model
```

## License

[MIT](LICENSE)
