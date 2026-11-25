# Changelog

## 0.1.0 - 2026-11-25

- Initial release: adds `opencode-go/jev-1.14`, `opencode-go/gemini-decision-1`, and `opencode-go/gpt-6-luna-decision` decision models, billed to the OpenCode Go subscription.

## 0.2.0 - 2026-11-25

- Add `/decision-model [provider/id|search]`: picker with the same UX as `/model` (fuzzy search, Enter to select, ctrl+s to save as default). Selection persists in `~/.pi/agent/decision-model.json` and shows in the footer status bar.

## 0.2.1 - 2026-11-25

- The `dm: provider/id` footer status line is now **off by default**. Enable it with `"showStatus": true` in `~/.pi/agent/decision-model.json`.

## 0.2.2 - 2026-11-25

- `/decision-model` picker now renders inline in the bottom dock (same slot as `/model`) instead of a floating overlay popup.

## 0.2.3 - 2026-11-25

- `/decision-model` picker now only shows decision models from **enabled providers** (resolved from `enabledModels` / `--models` scoping). Falls back to all configured providers when no scoping is set. Exact `provider/id` arguments still address any available decision model.

## 0.2.4 - 2026-11-25

- Fix `/decision-model <partial>` prefill: the search cursor now starts at the end of the prefilled term, so typing appends (previously characters were inserted at position 0, garbling the query).

## 0.2.5 - 2026-11-25

- Fix `/decision-model <partial>`: the prefill now goes through the component's own input path (identical to typing), so dynamic filtering works and the cursor starts at the end of the term (v0.2.4's ctrl+e trick was defeated by the app's keybinding manager).

## 0.2.6 - 2026-11-25

- Fix: the v0.2.4/v0.2.5 prefill patches were dead code (constructor result was returned directly, so the prefill statements never ran). `/decision-model <partial>` now genuinely prefills the search box by typing through the component; dynamic filtering works as you type.

## 0.3.0 - 2026-11-25

- Add a `classify` tool that uses the decision model selected with `/decision-model` by default (override with the `model: "provider/id"` parameter). This gives the selection a real consumer: the agent no longer picks among every classifier in the registry — it calls `classify` and the selected model is used.
