import { envApiKeyAuth } from "./auth/helpers.ts";
import type { ApiKeyAuth } from "./auth/types.ts";
import { createModels, createProvider } from "./models.ts";
import type { Models } from "./models.ts";
import { builtinModels } from "./providers/all.ts";
import type { Api, Model } from "./types.ts";

/**
 * Configuration for a single custom endpoint. The model metadata (context
 * window, token costs, reasoning levels, etc.) is cloned from the corresponding
 * built-in provider, while `baseUrl` and `apiKey` are supplied by the caller.
 */
export interface EndpointConfig {
	/** Unique provider id for this endpoint. */
	id: string;
	/** Built-in provider to copy model metadata from, e.g. "openai" or "anthropic". */
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

		const customModels: Model<Api>[] = allowedModels.map((m) => ({
			...m,
			baseUrl: cfg.baseUrl,
			provider: cfg.id,
		}));

		models.setProvider(
			createProvider({
				id: cfg.id,
				name: source.name,
				auth: {
					apiKey: staticApiKeyAuth(`${source.name} API Key`, cfg.apiKey),
				},
				models: customModels,
				api: source,
			}),
		);
	}

	return models;
}

export { envApiKeyAuth };
export type { ApiKeyAuth };
