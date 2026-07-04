import { envApiKeyAuth } from "./auth/helpers.ts";
import type { ApiKeyAuth } from "./auth/types.ts";
import { createModels, createProvider } from "./models.ts";
import type { Models } from "./models.ts";
import { builtinModels } from "./providers/all.ts";
import type { Api, Model, ThinkingLevelMap } from "./types.ts";

/**
 * Input for defining a custom model that is not in the built-in catalog.
 * Only the user-facing metadata is required; the endpoint's `baseUrl` and
 * `provider` id are filled in automatically by `createModelsWithEndpoints`.
 */
export interface CustomModelInput {
	id: string;
	name: string;
	/** Protocol API, e.g. "openai-completions" or "anthropic-messages". */
	api: Api;
	contextWindow: number;
	maxTokens: number;
	input?: ("text" | "image")[];
	reasoning?: boolean;
	cost?: Partial<Model<Api>["cost"]>;
	thinkingLevelMap?: ThinkingLevelMap;
}

/**
 * Build a `Model` object from a minimal custom model definition. The returned
 * model has empty `provider` / `baseUrl`; `createModelsWithEndpoints` fills
 * those in from the endpoint config.
 */
export function createCustomModel(input: CustomModelInput): Model<Api> {
	return {
		id: input.id,
		name: input.name,
		api: input.api,
		provider: "",
		baseUrl: "",
		reasoning: input.reasoning ?? false,
		input: input.input ?? ["text"],
		cost: {
			input: input.cost?.input ?? 0,
			output: input.cost?.output ?? 0,
			cacheRead: input.cost?.cacheRead ?? 0,
			cacheWrite: input.cost?.cacheWrite ?? 0,
		},
		contextWindow: input.contextWindow,
		maxTokens: input.maxTokens,
		thinkingLevelMap: input.thinkingLevelMap,
	};
}

/**
 * Configuration for a single custom endpoint. The model metadata (context
 * window, token costs, reasoning levels, etc.) is cloned from the corresponding
 * built-in provider, while `baseUrl` and `apiKey` are supplied by the caller.
 */
export interface EndpointConfig {
	/** Unique provider id for this endpoint. */
	id: string;
	/**
	 * Built-in provider to copy model metadata and API implementation from,
	 * e.g. "openai" or "anthropic". Required because the endpoint needs a
	 * concrete protocol implementation to dispatch requests.
	 */
	provider: string;
	/** Custom API endpoint URL. */
	baseUrl: string;
	/** API key for this endpoint. */
	apiKey: string;
	/**
	 * Optional model id filter. When omitted, all models from the built-in
	 * provider are exposed. When provided, only those ids are included.
	 */
	modelIds?: readonly string[];
	/**
	 * Additional custom models not present in the built-in catalog. They are
	 * merged with the cloned models and use the same endpoint `baseUrl`,
	 * `provider` id, and API implementation.
	 */
	customModels?: readonly CustomModelInput[];
}

function staticApiKeyAuth(name: string, apiKey: string): ApiKeyAuth {
	return {
		name,
		resolve: async () => ({ auth: { apiKey }, source: `${name}` }),
	};
}

/**
 * Build a `Models` collection from a list of user-defined endpoints.
 *
 * This is intended for browser / frontend apps where the user configures a
 * provider, base URL, and API key, and the app should expose the corresponding
 * model catalog without re-declaring context windows, costs, or protocol
 * details.
 *
 * Example:
 *
 * ```ts
 * const models = createModelsWithEndpoints([
 *   {
 *     id: "my-openai",
 *     provider: "openai",
 *     baseUrl: "https://api.openai.com/v1",
 *     apiKey: "sk-...",
 *   },
 *   {
 *     id: "my-anthropic",
 *     provider: "anthropic",
 *     baseUrl: "https://api.anthropic.com",
 *     apiKey: "sk-ant-...",
 *     modelIds: ["claude-haiku-4-5", "claude-sonnet-4-5"],
 *   },
 * ]);
 *
 * const all = models.getModels();
 * const selected = models.getModel("my-anthropic", "claude-sonnet-4-5")!;
 * const stream = models.stream(selected, context);
 * ```
 */
export function createModelsWithEndpoints(configs: readonly EndpointConfig[]): Models {
	const builtIn = builtinModels();
	const models = createModels();

	for (const cfg of configs) {
		const source = builtIn.getProvider(cfg.provider);
		if (!source) {
			throw new Error(`Unknown provider: ${cfg.provider}`);
		}

		const sourceModels = source.getModels();
		const allowedModels = cfg.modelIds?.length
			? sourceModels.filter((m) => cfg.modelIds!.includes(m.id))
			: sourceModels;

		const builtInClones: Model<Api>[] = allowedModels.map((m) => ({
			...m,
			baseUrl: cfg.baseUrl,
			provider: cfg.id,
		}));

		const customModels: Model<Api>[] = (cfg.customModels ?? []).map((m) => ({
			...createCustomModel(m),
			baseUrl: cfg.baseUrl,
			provider: cfg.id,
		}));

		const allModels = [...builtInClones, ...customModels];

		models.setProvider(
			createProvider({
				id: cfg.id,
				name: source.name,
				auth: {
					apiKey: staticApiKeyAuth(`${source.name} API Key`, cfg.apiKey),
				},
				models: allModels,
				api: source,
			}),
		);
	}

	return models;
}

export { envApiKeyAuth };
export type { ApiKeyAuth };
