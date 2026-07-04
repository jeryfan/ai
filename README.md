# @jeryfan/ai

Unified LLM API for browser and frontend environments. Talk to OpenAI, Anthropic, Google, Mistral, OpenRouter, and other providers through one consistent interface.

```bash
npm install @jeryfan/ai
```

## Features

- **Browser-first**: no Node-only dependencies, no OAuth flows, no local HTTP servers.
- **API-key only**: every request is authenticated with an explicit API key.
- **Unified interface**: one `AssistantMessage` / `AssistantMessageEvent` model across providers.
- **Streaming**: text deltas, thinking deltas, tool-call deltas, and completion events.
- **Multi-provider**: register built-in providers or define your own OpenAI-compatible endpoints.

## Quick start

```ts
import { builtinModels } from "@jeryfan/ai";

const models = builtinModels();
const model = models.getModel("anthropic", "claude-haiku-4-5")!;

const stream = models.stream(
  model,
  {
    messages: [{ role: "user", content: "Hello!", timestamp: Date.now() }],
  },
  {
    apiKey: "your-api-key",
  },
);

for await (const event of stream) {
  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  }
}

const result = await stream.result();
```

## Custom OpenAI-compatible endpoint

```ts
import { createModels, createProvider } from "@jeryfan/ai";
import { stream, streamSimple } from "@jeryfan/ai/api/openai-completions";

const models = createModels();

models.setProvider(
  createProvider({
    id: "my-proxy",
    name: "My OpenAI Proxy",
    auth: { apiKey: { name: "API Key", resolve: async () => undefined } },
    models: [
      {
        id: "gpt-4",
        name: "GPT-4",
        api: "openai-completions",
        provider: "my-proxy",
        baseUrl: "https://my-proxy.example.com/v1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ],
    api: { stream, streamSimple },
  }),
);
```

## Configure multiple endpoints from the UI

For frontend apps where users configure providers through a settings UI, use `createModelsWithEndpoints` to clone the built-in model catalog and apply custom `baseUrl` / `apiKey`:

`baseUrl` is optional. When omitted, built-in models keep their default endpoint URLs.

```ts
import { createModelsWithEndpoints } from "@jeryfan/ai";

const models = createModelsWithEndpoints([
  {
    id: "openai-prod",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-...",
  },
  {
    id: "anthropic-prod",
    provider: "anthropic",
    apiKey: "sk-ant-...",
    modelIds: ["claude-haiku-4-5", "claude-sonnet-4-5"],
  },
]);

// Populate model selector
const allModels = models.getModels();

// Chat with selected model
const selected = models.getModel("anthropic-prod", "claude-sonnet-4-5")!;
const stream = models.stream(selected, context);
```

You can also add custom models that are not in the built-in catalog by providing `customModels` and a `baseUrl`:

```ts
import { createModelsWithEndpoints } from "@jeryfan/ai";

const models = createModelsWithEndpoints([
  {
    id: "my-openai-proxy",
    provider: "openai",
    baseUrl: "https://my-proxy.example.com/v1",
    apiKey: "sk-...",
    modelIds: ["gpt-4o"],
    customModels: [
      {
        id: "my-custom-model",
        name: "My Custom Model",
        api: "openai-completions",
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ],
  },
]);

// Both built-in clones and custom models appear in the list
const allModels = models.getModels();
```

## Entry points

- `@jeryfan/ai` – core types and helpers.
- `@jeryfan/ai/compat` – deprecated global `stream()` / `complete()` API.
- `@jeryfan/ai/providers/*` – individual provider factories.
- `@jeryfan/ai/api/*` – individual protocol implementations.

## License

MIT
