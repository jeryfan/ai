# 项目说明

## 简介

本库是一个统一的 AI 请求库，用于在前端/浏览器环境中请求各种协议的大语言模型。

## 核心目标

- **屏蔽差异**：在底层封装 OpenAI、Anthropic、Google、Mistral、OpenRouter 等各家模型的协议与返回格式差异。
- **统一接口**：向上层提供统一的请求、流式输出、工具调用、Token/成本统计等抽象。
- **前端友好**：已移除 Node 环境依赖（OAuth 本地服务、Node HTTP 代理、Bedrock 相关 Node SDK 等），使其能在浏览器或类浏览器运行时中直接运行。

## 统一输出抽象

上层代码只与以下统一类型交互，无需关心底层厂商：

- `AssistantMessage`：助手回复消息
- `AssistantMessageEvent`：流式事件协议（`text_delta`、`thinking_delta`、`toolcall_delta`、`done`、`error` 等）
- `Message`：统一会话消息（`user` / `assistant` / `toolResult`）
- `ToolCall`：统一工具调用
- `Usage`：统一 Token / 缓存 / 成本统计
- `StopReason`：统一停止原因

## 代码组织

- `src/api/`：各厂商协议实现，负责把原始响应转换为统一输出格式。
- `src/providers/`：各厂商的模型列表与工厂函数。
- `src/types.ts`：统一类型定义。
- `src/models.ts`：`Provider` / `Models` 统一调用入口。
- `src/auth/`：认证相关（目前仅保留 api-key 路径）。
- `src/auth/context.ts`：默认认证上下文（`process.env` 读取，浏览器环境下 `fileExists` 恒返回 `false`）。
- `src/env-api-keys.ts`：环境变量 API key 读取（仅识别显式 API key 与 Google Vertex 项目/位置配置）。

包名：`@jeryfan/ai`，版本从 `0.1.0` 开始。

## 开发原则

- 保持统一接口稳定，新增厂商时在 `src/api/` 内实现转换逻辑，不破坏上层类型。
- 移除 Node 专属代码时，优先用浏览器原生 API 替换（如 `fetch`、`AbortSignal`、`crypto`）。
- 不保留向后兼容，按前端库的目标环境精简功能。
