# Changelog

## 0.1.0 - 2026-11-25

- Initial release: adds `opencode-go/jev-1.14`, `opencode-go/gemini-decision-1`, and `opencode-go/gpt-6-luna-decision` decision models, billed to the OpenCode Go subscription.

## 0.2.0 - 2026-11-25

- Add `/decision-model [provider/id|search]`: picker with the same UX as `/model` (fuzzy search, Enter to select, ctrl+s to save as default). Selection persists in `~/.pi/agent/decision-model.json` and shows in the footer status bar.
