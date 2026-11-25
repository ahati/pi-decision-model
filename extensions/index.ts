/**
 * pi-decision-model — adds OpenCode Go decision (classifier) models to the
 * `opencode-go` provider, alongside its existing chat models, plus a
 * `/decision-model` picker with the same UX as `/model`.
 *
 * Registers:
 *   opencode-go/jev-1.14, opencode-go/gemini-decision-1, opencode-go/gpt-6-luna-decision
 *
 * Chat models are read from pi-ai's generated catalog (the same source the
 * built-in provider uses), so they stay in sync with pi updates. Auth is
 * inherited from the built-in provider: the stored `opencode-go` credential
 * (auth.json) or the OPENCODE_API_KEY environment variable.
 *
 * Why an extension: pi's models.json loader drops model `type`, so decision
 * (classifier) models cannot be declared in configuration. The System One
 * classify implementation is reused from the built-in `opencode` (Zen)
 * provider — the wire URL is derived from each model's own baseUrl, so these
 * entries hit the Go gateway endpoint. Requests are billed to the Go
 * subscription (`billing_source: "go"`), not OpenCode Models credits.
 *
 * /decision-model mirrors /model: exact `provider/id` arguments select
 * immediately, anything else opens the same search picker (fuzzy filter,
 * arrow keys, Enter to select, ctrl+s to save as default, Esc to cancel).
 * The selection is persisted in ~/.pi/agent/decision-model.json and shown in
 * the footer status bar.
 */
import { ModelSelectorComponent } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { builtinProviders, getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The System One transport appends "/systemone" to a model's baseUrl.
const GO_SYSTEMONE_BASE = "https://opencode.ai/inference/go/systemone/v1";

const STATE_FILE = join(homedir(), ".pi", "agent", "decision-model.json");

// Prices per OpenCode Go docs — input per 1M tokens; decision output is free.
// gpt-6-luna-decision doubles above 272K input tokens.
const DECISION_MODELS = [
	{
		type: "classifier" as const,
		id: "jev-1.14",
		name: "Jev 1.14",
		api: "typesafe-system-one" as const,
		baseUrl: GO_SYSTEMONE_BASE,
		input: ["text"] as const,
		cost: { input: 0.042, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 262144,
	},
	{
		type: "classifier" as const,
		id: "gemini-decision-1",
		name: "Gemini Decision 1",
		api: "typesafe-system-one" as const,
		baseUrl: GO_SYSTEMONE_BASE,
		input: ["text"] as const,
		cost: { input: 0.1, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 262144,
	},
	{
		type: "classifier",
		id: "gpt-6-luna-decision",
		name: "GPT 6 Luna Decision",
		api: "typesafe-system-one" as const,
		baseUrl: GO_SYSTEMONE_BASE,
		input: ["text"] as const,
		cost: {
			input: 0.1,
			output: 0,
			cacheRead: 0.1,
			cacheWrite: 0,
			tiers: [{ inputTokensAbove: 272000, input: 0.2, output: 0, cacheRead: 0.2, cacheWrite: 0 }],
		},
		contextWindow: 872000,
	},
];

interface ModelRef {
	provider: string;
	id: string;
	name?: string;
}

interface DecisionModelState {
	default?: ModelRef;
	session?: ModelRef;
}

function loadState(): DecisionModelState {
	try {
		return JSON.parse(readFileSync(STATE_FILE, "utf8")) as DecisionModelState;
	} catch {
		return {};
	}
}

function saveState(state: DecisionModelState): void {
	try {
		writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
	} catch {
		// best effort; selection still applies for this session
	}
}

function refKey(ref: ModelRef | undefined): string | undefined {
	return ref ? `${ref.provider}/${ref.id}` : undefined;
}

export default function piDecisionModel(pi: ExtensionAPI): void {
	const chatModels = getBuiltinModels("opencode-go");

	// Borrow the System One classifier implementation from the built-in
	// `opencode` (Zen) provider — the same workaround documented in
	// earendil-works/pi discussion #10950. It is model-driven, so it serves
	// models with any baseUrl, including the Go gateway.
	const zen = builtinProviders().find((p) => p.id === "opencode");

	// Fail soft: if either building block is missing (future pi versions),
	// leave the built-in provider untouched rather than break it.
	if (!zen?.classify || chatModels.length === 0) return;

	pi.registerProvider("opencode-go", {
		name: "OpenCode Go",
		models: [...chatModels, ...DECISION_MODELS],
		classifiers: {
			"typesafe-system-one": {
				classify: (model, context, options) => zen.classify(model, context, options),
			},
		},
	});

	const setStatusLine = (ctx: { ui: { setStatus(key: string, text: string | undefined): void } }, ref: ModelRef | undefined) => {
		ctx.ui.setStatus("decision-model", ref ? `dm: ${ref.provider}/${ref.id}` : undefined);
	};

	pi.on("session_start", async (_event, ctx) => {
		const state = loadState();
		if (!state.session && state.default) state.session = state.default;
		setStatusLine(ctx, state.session);
	});

	pi.registerCommand("decision-model", {
		description: "Select a decision model (same UX as /model)",
		handler: async (args: string, ctx) => {
			const classifiers = await ctx.modelRegistry.getAvailableOfType("classifier");

			if (classifiers.length === 0) {
				ctx.ui.notify("No decision models available. Configure a provider that serves them (e.g. OpenCode Go with pi-decision-model).", "warning");
				return;
			}

			const state = loadState();
			if (!state.session && state.default) state.session = state.default;

			const select = (model: (typeof classifiers)[number], asDefault: boolean) => {
				const ref: ModelRef = { provider: model.provider, id: model.id, name: model.name };
				state.session = ref;
				if (asDefault) state.default = ref;
				saveState(state);
				setStatusLine(ctx, ref);
				ctx.ui.notify(asDefault ? `Default decision model: ${ref.provider}/${ref.id}` : `Decision model: ${ref.id}`, "info");
			};

			const searchTerm = args.trim();

			// Mirror /model: an exact provider/id (or unique id) match selects
			// immediately without opening the picker.
			if (searchTerm) {
				const needle = searchTerm.toLowerCase();
				const exact = classifiers.filter(
					(m) => `${m.provider}/${m.id}`.toLowerCase() === needle || m.id.toLowerCase() === needle,
				);
				if (exact.length === 1) {
					select(exact[0], false);
					return;
				}
			}

			if (!ctx.hasUI) {
				ctx.ui.notify(
					`Available decision models: ${classifiers.map((m) => `${m.provider}/${m.id}`).join(", ")}. Current: ${refKey(state.session) ?? "none"}`,
					"info",
				);
				return;
			}

			// Mount the real /model selector over the classifier catalog via a
			// minimal runtime adapter — same search, columns, keybindings.
			const current = classifiers.find((m) => refKey(m) === refKey(state.session));
			const defaultRef = state.default ? { provider: state.default.provider, id: state.default.id } : undefined;

			const picked = await ctx.ui.custom<{ model: (typeof classifiers)[number]; asDefault: boolean } | undefined>(
				(tui, _theme, _keybindings, done) => {
					const adapter = {
						getAvailableSnapshot: () => classifiers,
						getModel: () => undefined,
						getError: () => undefined,
						refresh: async ({ signal }: { signal?: AbortSignal }) => ({ aborted: signal?.aborted ?? false, errors: new Map() }),
					};
					return new ModelSelectorComponent(
						tui,
						current,
						adapter as never,
						[] as never,
						(model) => done({ model, asDefault: false }),
						() => done(undefined),
						searchTerm || undefined,
						(model) => done({ model, asDefault: true }),
						defaultRef,
					);
				},
				{ overlay: true, blocked: { kind: "question", message: "Select decision model" } },
			);

			if (picked) select(picked.model, picked.asDefault);
		},
	});
}
