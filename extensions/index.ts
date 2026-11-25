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
import { Type } from "typebox";
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
	/** Set true to render `dm: provider/id` in the footer status bar. Default: off. */
	showStatus?: boolean;
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

	const setStatusLine = (ctx: { ui: { setStatus(key: string, text: string | undefined): void } }, state: DecisionModelState) => {
		// Opt-in via "showStatus": true in ~/.pi/agent/decision-model.json.
		if (state.showStatus !== true) return;
		ctx.ui.setStatus("decision-model", state.session ? `dm: ${state.session.provider}/${state.session.id}` : undefined);
	};

	pi.on("session_start", async (_event, ctx) => {
		const state = loadState();
		if (!state.session && state.default) state.session = state.default;
		setStatusLine(ctx, state);
	});

	pi.registerCommand("decision-model", {
		description: "Select a decision model (same UX as /model)",
		handler: async (args: string, ctx) => {
			const classifiers = await ctx.modelRegistry.getAvailableOfType("classifier");

			// Scope to enabled providers (resolved from `enabledModels` / --models via
			// ctx.scopedModels), mirroring how /scoped-models narrows chat models. When
			// no scoping is configured, all classifier-capable providers are shown.
			const enabledProviders = new Set(ctx.scopedModels.map((scoped) => scoped.model.provider));
			const visible = enabledProviders.size > 0 ? classifiers.filter((m) => enabledProviders.has(m.provider)) : classifiers;

			if (visible.length === 0) {
				ctx.ui.notify(
					`No decision models from enabled providers (${classifiers.length} available from: ${[...new Set(classifiers.map((m) => m.provider))].join(", ")}). Add patterns like "opencode-go/*" to enabledModels to include them.`,
					"warning",
				);
				return;
			}

			const state = loadState();
			if (!state.session && state.default) state.session = state.default;

			const select = (model: (typeof classifiers)[number], asDefault: boolean) => {
				const ref: ModelRef = { provider: model.provider, id: model.id, name: model.name };
				state.session = ref;
				if (asDefault) state.default = ref;
				saveState(state);
				setStatusLine(ctx, state);
				ctx.ui.notify(asDefault ? `Default decision model: ${ref.provider}/${ref.id}` : `Decision model: ${ref.id}`, "info");
			};

			const searchTerm = args.trim();

			// Mirror /model: an exact provider/id (or unique id) match selects
			// immediately without opening the picker. Explicit references may
			// address any available decision model, enabled or not.
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

			// Inline mount (bottom dock, same slot /model uses) - not an overlay popup.
			const picked = await ctx.ui.custom<{ model: (typeof classifiers)[number]; asDefault: boolean } | undefined>(
				(tui, _theme, _keybindings, done) => {
					const adapter = {
						getAvailableSnapshot: () => visible,
						getModel: () => undefined,
						getError: () => undefined,
						refresh: async ({ signal }: { signal?: AbortSignal }) => ({ aborted: signal?.aborted ?? false, errors: new Map() }),
					};
					const selector = new ModelSelectorComponent(
					tui,
					current,
					adapter as never,
					[] as never,
					(model) => done({ model, asDefault: false }),
					() => done(undefined),
					undefined,
					(model) => done({ model, asDefault: true }),
					defaultRef,
				);
				// Prefill by typing through the component itself - identical to real
				// typing: input starts empty (cursor at 0, no mis-insertion), the term
				// is forwarded to the search input, and the list re-filters live.
				if (searchTerm) selector.handleInput(searchTerm);
				return selector;
			},
		);

			if (picked) select(picked.model, picked.asDefault);
		},
	});

	// Give the selection a consumer: a `classify` tool that defaults to the
	// decision model chosen with /decision-model (override via `model`).
	// codemode's models.getAvailableOfType intentionally lists the whole
	// registry; this tool is the opinionated entry point.
	const textResult = (text: string, isError = false) => ({ content: [{ type: "text" as const, text }], isError });

	pi.registerTool({
		name: "classify",
		label: "Classify (decision model)",
		description:
			"Classify JSON state with typed questions (bool / choice / score) using the decision model selected via /decision-model. " +
			"Each question: { type, instructions, criteria } where criteria maps labels to meanings (bool: {true,false}; choice: label map; score: ordered levels lowest-first). " +
			"Returns per-question answers with probabilities and confidence. Pass `model` as 'provider/id' to override the selection.",
		promptSnippet: "classify: typed decisions (bool/choice/score with probabilities) using the selected decision model",
		parameters: Type.Object({
			state: Type.Unknown({ description: "JSON-serializable state to classify" }),
			questions: Type.Record(Type.String(), Type.Any(), {
				description: 'Question id \u2192 { type: "bool" | "choice" | "score", instructions, criteria }',
			}),
			model: Type.Optional(Type.String({ description: "Override decision model as 'provider/id'" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const override = typeof params.model === "string" ? params.model.trim() : "";
			let provider: string | undefined;
			let id: string | undefined;

			if (override) {
				const slash = override.indexOf("/");
				if (slash <= 0) return textResult(`Invalid model '${override}'. Use 'provider/id'.`, true);
				provider = override.slice(0, slash);
				id = override.slice(slash + 1);
			} else {
				const state = loadState();
				const ref = state.session ?? state.default;
				if (!ref) {
					return textResult("No decision model selected. Run /decision-model, or pass `model` as 'provider/id'.", true);
				}
				provider = ref.provider;
				id = ref.id;
			}

			const model = ctx.modelRegistry.getModelOfType("classifier", provider, id);
			if (!model) return textResult(`Decision model ${provider}/${id} is not available.`, true);

			const result = await ctx.modelRegistry.classify(
				model,
				{ state: params.state as Record<string, unknown>, questions: params.questions as Record<string, never> },
				{ signal },
			);

			const payload = {
				model: `${provider}/${id}`,
				stopReason: result.stopReason,
				answers: result.answers,
				...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
			};
			return textResult(JSON.stringify(payload), result.stopReason === "error");
		},
	});
}
