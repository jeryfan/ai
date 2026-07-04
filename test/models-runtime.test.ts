import { describe, expect, it } from "vitest";
import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import type { ApiKeyAuth, CredentialStore, ProviderAuth } from "../src/auth/types.ts";
import { createModels, hasApi, type Provider } from "../src/models.ts";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions, StreamOptions } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";

function testModel(provider: string, id: string): Model<Api> {
	return {
		id,
		name: id,
		api: "test-api",
		provider,
		baseUrl: "https://example.test/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 10000,
		maxTokens: 1000,
	};
}

function doneMessage(model: Model<Api>, text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

interface ProviderCall {
	model: Model<Api>;
	options: StreamOptions | undefined;
}

/** Ambient auth for keyless test providers; reports "configured" with no auth values. */
const ambientAuth: ApiKeyAuth = {
	name: "Ambient",
	resolve: async () => ({ auth: {} }),
};

function testProvider(input: {
	id: string;
	models?: Model<Api>[];
	auth?: ProviderAuth;
	getModels?: () => readonly Model<Api>[];
	refreshModels?: () => Promise<void>;
	calls?: ProviderCall[];
}): Provider {
	const models = input.models ?? [testModel(input.id, "model-a")];
	const respond = (model: Model<Api>, options: StreamOptions | undefined) => {
		input.calls?.push({ model, options });
		const stream = new AssistantMessageEventStream();
		const message = doneMessage(model, "ok");
		stream.push({ type: "start", partial: message });
		stream.push({ type: "done", reason: "stop", message });
		stream.end(message);
		return stream;
	};
	return {
		id: input.id,
		name: input.id,
		auth: input.auth ?? { apiKey: ambientAuth },
		getModels: input.getModels ?? (() => models),
		refreshModels: input.refreshModels,
		stream: (model, _context, options) => respond(model, options as StreamOptions | undefined),
		streamSimple: (model, _context, options) => respond(model, options as SimpleStreamOptions | undefined),
	};
}

const context: Context = { messages: [{ role: "user", content: "hi", timestamp: Date.now() }] };

function envKeyAuth(key: string | undefined): ApiKeyAuth {
	return {
		name: "Test API key",
		resolve: async ({ credential }) => {
			const resolved = credential?.key ?? key;
			if (!resolved) return undefined;
			return { auth: { apiKey: resolved }, source: credential ? "stored" : "env" };
		},
	};
}

describe("Models runtime", () => {
	it("registers, replaces, and deletes providers", () => {
		const models = createModels();
		models.setProvider(testProvider({ id: "p1" }));
		models.setProvider(testProvider({ id: "p2" }));
		expect(models.getProviders().map((p) => p.id)).toEqual(["p1", "p2"]);

		const replacement = testProvider({ id: "p1" });
		models.setProvider(replacement);
		expect(models.getProvider("p1")).toBe(replacement);
		expect(models.getProviders()).toHaveLength(2);

		models.deleteProvider("p1");
		expect(models.getProvider("p1")).toBeUndefined();

		models.clearProviders();
		expect(models.getProviders()).toHaveLength(0);
	});

	it("lists and finds models per provider", async () => {
		const models = createModels();
		models.setProvider(testProvider({ id: "p1", models: [testModel("p1", "m1"), testModel("p1", "m2")] }));
		models.setProvider(testProvider({ id: "p2", models: [testModel("p2", "m3")] }));

		expect(models.getModels().map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
		expect(models.getModels("p1").map((m) => m.id)).toEqual(["m1", "m2"]);
		expect(models.getModels("nope").length).toBe(0);
		expect(models.getModel("p2", "m3")?.id).toBe("m3");
		expect(models.getModel("p2", "missing")).toBeUndefined();

		// hasApi() narrows dynamically looked-up models with a runtime check
		const found = models.getModel("p2", "m3");
		expect(found && hasApi(found, "openai-completions")).toBe(false);
		expect(found && hasApi(found, "test-api")).toBe(true);
		if (found && hasApi(found, "test-api")) {
			const _typed: Model<"test-api"> = found;
			expect(_typed.id).toBe("m3");
		}
	});

	it("swallows provider source failures for both all-provider and single-provider listing", () => {
		const models = createModels();
		models.setProvider(
			testProvider({
				id: "broken",
				getModels: () => {
					throw new Error("boom");
				},
			}),
		);
		models.setProvider(testProvider({ id: "ok", models: [testModel("ok", "m1")] }));

		expect(models.getModels().map((m) => m.id)).toEqual(["m1"]);
		expect(models.getModels("broken")).toEqual([]);
		// precise failures come from the provider directly
		expect(() => models.getProvider("broken")?.getModels()).toThrow("boom");
	});

	it("refresh() updates dynamic providers; single-provider refresh failures reject", async () => {
		let list = [testModel("dyn", "before")];
		let refreshes = 0;
		const models = createModels();
		models.setProvider(
			testProvider({
				id: "dyn",
				getModels: () => list,
				refreshModels: async () => {
					refreshes++;
					list = [testModel("dyn", "after")];
				},
			}),
		);
		models.setProvider(testProvider({ id: "static", models: [testModel("static", "s1")] }));

		expect(models.getModel("dyn", "before")).toBeDefined();
		await models.refresh("dyn");
		expect(refreshes).toBe(1);
		expect(models.getModel("dyn", "after")).toBeDefined();
		expect(models.getModel("dyn", "before")).toBeUndefined();

		// static providers are no-ops; refresh-all is best-effort
		await models.refresh("static");
		await models.refresh();
		expect(refreshes).toBe(2);

		// single-provider refresh failures reject with ModelsError
		models.setProvider(
			testProvider({
				id: "flaky",
				refreshModels: async () => {
					throw new Error("fetch failed");
				},
			}),
		);
		await expect(models.refresh("flaky")).rejects.toMatchObject({ code: "model_source" });
		// refresh-all swallows the same failure
		await expect(models.refresh()).resolves.toBeUndefined();
	});

	it("resolves auth: stored credential owns the provider, ambient only when nothing stored", async () => {
		const credentials = new InMemoryCredentialStore();
		const models = createModels({ credentials });
		models.setProvider(testProvider({ id: "p1", auth: { apiKey: envKeyAuth("env-key") } }));
		const model = testModel("p1", "model-a");

		// nothing stored: ambient env resolves
		expect((await models.getAuth(model))?.auth.apiKey).toBe("env-key");

		// stored api-key credential resolves through apiKey auth, beats env
		await credentials.modify("p1", async () => ({ type: "api_key", key: "stored-key" }));
		const apiKeyResolution = await models.getAuth(model);
		expect(apiKeyResolution?.auth.apiKey).toBe("stored-key");
		expect(apiKeyResolution?.source).toBe("stored");
	});

	it("a stored api-key credential with no key falls back to ambient", async () => {
		const credentials = new InMemoryCredentialStore();
		const models = createModels({ credentials });
		models.setProvider(testProvider({ id: "p1", auth: { apiKey: envKeyAuth("env-key") } }));
		await credentials.modify("p1", async () => ({ type: "api_key", key: undefined }));

		expect((await models.getAuth(testModel("p1", "model-a")))?.auth.apiKey).toBe("env-key");
	});

	it("wraps credential store failures in ModelsError", async () => {
		// read failure
		const readFailing: CredentialStore = {
			read: async () => {
				throw new Error("disk on fire");
			},
			modify: async () => undefined,
			delete: async () => {},
		};
		const models = createModels({ credentials: readFailing });
		models.setProvider(testProvider({ id: "p1", auth: { apiKey: envKeyAuth("env-key") } }));
		await expect(models.getAuth(testModel("p1", "model-a"))).rejects.toMatchObject({ code: "auth" });
	});

	it("wraps api-key auth failures in ModelsError", async () => {
		const failing: ApiKeyAuth = {
			name: "Failing",
			resolve: async () => {
				throw new Error("nope");
			},
		};
		const models = createModels();
		models.setProvider(testProvider({ id: "p1", auth: { apiKey: failing } }));
		await expect(models.getAuth(testModel("p1", "model-a"))).rejects.toMatchObject({ code: "auth" });
	});

	it("uses explicit request api key and env during provider auth resolution", async () => {
		const calls: ProviderCall[] = [];
		const apiKey: ApiKeyAuth = {
			name: "Scoped",
			resolve: async ({ credential, ctx }) => {
				const account = credential?.env?.ACCOUNT_ID ?? (await ctx.env("ACCOUNT_ID"));
				if (!credential?.key || !account) return undefined;
				return {
					auth: { apiKey: credential.key, baseUrl: `https://example.test/${account}` },
					env: { ACCOUNT_ID: account },
				};
			},
		};
		const models = createModels();
		models.setProvider(testProvider({ id: "p1", auth: { apiKey }, calls }));
		const model = testModel("p1", "model-a");

		await models.completeSimple(model, context, { apiKey: "explicit-key", env: { ACCOUNT_ID: "acct" } });

		expect(calls[0].model.baseUrl).toBe("https://example.test/acct");
		expect(calls[0].options?.apiKey).toBe("explicit-key");
		expect(calls[0].options?.env).toEqual({ ACCOUNT_ID: "acct" });
	});

	it("merges resolved auth into stream options; explicit options win per field", async () => {
		const calls: ProviderCall[] = [];
		const apiKey: ApiKeyAuth = {
			name: "Test",
			resolve: async () => ({
				auth: {
					apiKey: "resolved-key",
					headers: { "x-a": "auth", "x-b": "auth" },
					baseUrl: "https://auth.test/v1",
				},
			}),
		};
		const models = createModels();
		models.setProvider(testProvider({ id: "p1", auth: { apiKey }, calls }));
		const model = testModel("p1", "model-a");

		const result = await models.completeSimple(model, context, {
			apiKey: "explicit-key",
			headers: { "x-b": "explicit" },
		});
		expect(result.stopReason).toBe("stop");
		expect(calls).toHaveLength(1);
		expect(calls[0].options?.apiKey).toBe("explicit-key");
		expect(calls[0].options?.headers).toEqual({ "x-a": "auth", "x-b": "explicit" });
		expect(calls[0].model.baseUrl).toBe("https://auth.test/v1");

		// without explicit options, resolved auth applies
		const result2 = await models.completeSimple(model, context);
		expect(result2.stopReason).toBe("stop");
		expect(calls[1].options?.apiKey).toBe("resolved-key");
	});

	it("produces an error stream for unknown providers instead of throwing", async () => {
		const models = createModels();
		const result = await models.completeSimple(testModel("ghost", "model-a"), context);
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("Unknown provider: ghost");
	});

	it("streams through the provider", async () => {
		const models = createModels();
		models.setProvider(testProvider({ id: "p1" }));
		const model = testModel("p1", "model-a");

		const events: string[] = [];
		const stream = models.streamSimple(model, context);
		for await (const event of stream) {
			events.push(event.type);
		}
		expect(events).toEqual(["start", "done"]);
		const message = await stream.result();
		expect(message.stopReason).toBe("stop");
	});
});
