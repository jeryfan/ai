import { describe, expect, it } from "vitest";
import { createModelsWithEndpoints } from "../src/endpoints.ts";

describe("createModelsWithEndpoints", () => {
	it("clones built-in models and applies custom baseUrl/apiKey", () => {
		const models = createModelsWithEndpoints([
			{
				id: "my-openai",
				provider: "openai",
				baseUrl: "https://my-proxy.example.com/v1",
				apiKey: "test-key",
				modelIds: ["gpt-4o"],
			},
		]);

		const providers = models.getProviders();
		expect(providers.map((p) => p.id)).toContain("my-openai");

		const model = models.getModel("my-openai", "gpt-4o")!;
		expect(model).toBeDefined();
		expect(model.baseUrl).toBe("https://my-proxy.example.com/v1");
		expect(model.provider).toBe("my-openai");
		expect(model.api).toBe("openai-responses");
	});

	it("resolves auth from the configured apiKey", async () => {
		const models = createModelsWithEndpoints([
			{
				id: "my-anthropic",
				provider: "anthropic",
				baseUrl: "https://api.anthropic.com",
				apiKey: "anthropic-key",
				modelIds: ["claude-haiku-4-5"],
			},
		]);

		const model = models.getModel("my-anthropic", "claude-haiku-4-5")!;
		const auth = await models.getAuth(model);
		expect(auth?.auth.apiKey).toBe("anthropic-key");
		expect(auth?.source).toBe("Anthropic API Key");
	});

	it("throws for unknown providers", () => {
		expect(() =>
			createModelsWithEndpoints([
				{
					id: "bad",
					provider: "not-a-real-provider",
					baseUrl: "https://example.com",
					apiKey: "key",
				},
			]),
		).toThrow("Unknown provider: not-a-real-provider");
	});

	it("exposes all models when modelIds is omitted", () => {
		const models = createModelsWithEndpoints([
			{
				id: "my-openai",
				provider: "openai",
				baseUrl: "https://api.openai.com/v1",
				apiKey: "key",
			},
		]);

		const list = models.getModels("my-openai");
		expect(list.length).toBeGreaterThan(0);
		expect(list.every((m) => m.provider === "my-openai")).toBe(true);
		expect(list.every((m) => m.baseUrl === "https://api.openai.com/v1")).toBe(true);
	});
});
