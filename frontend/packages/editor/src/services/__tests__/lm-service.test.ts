/**
 * @file services/__tests__/lm-service.test.ts
 *
 * Unit tests for the LM service layer — provider configuration management
 * and the remote chat routing logic.
 *
 * Tests that require a live IPC connection (lmLoad, lmStatus, lmChat local)
 * are integration tests and live outside this suite.  Here we only test:
 *   - Provider config set/get (pure in-memory state)
 *   - isLMAvailable() without a host environment
 *   - fetchRemoteChat routing via mocked globalThis.fetch
 *
 * Run with:  bun test
 */

import { describe, test, expect, beforeEach, mock } from "bun:test";
import {
  isLMAvailable,
  getLMProviderConfig,
  setLMProviderConfig,
  lmChat,
  type LMProviderConfig,
  type LMRequest,
  type LMResponse,
} from "../lm-service";

// ─────────────────────────────────────────────────────────────────────────────
// Provider config management
// ─────────────────────────────────────────────────────────────────────────────

describe("Provider config", () => {
  // Always restore local provider after each test so state doesn't bleed.
  beforeEach(() => {
    setLMProviderConfig({ provider: "local" });
  });

  test("default provider is local", () => {
    // After beforeEach reset
    expect(getLMProviderConfig().provider).toBe("local");
  });

  test("setLMProviderConfig accepts openai config", () => {
    setLMProviderConfig({ provider: "openai", apiKey: "sk-test", model: "gpt-4o-mini" });
    const cfg = getLMProviderConfig();
    expect(cfg.provider).toBe("openai");
    expect(cfg.apiKey).toBe("sk-test");
    expect(cfg.model).toBe("gpt-4o-mini");
  });

  test("setLMProviderConfig accepts ollama config", () => {
    setLMProviderConfig({ provider: "ollama", baseUrl: "http://localhost:11434", model: "llama3.2" });
    const cfg = getLMProviderConfig();
    expect(cfg.provider).toBe("ollama");
    expect(cfg.baseUrl).toBe("http://localhost:11434");
    expect(cfg.model).toBe("llama3.2");
  });

  test("getLMProviderConfig returns a shallow copy — mutations do not affect state", () => {
    setLMProviderConfig({ provider: "openai", apiKey: "sk-original" });
    const copy = getLMProviderConfig() as LMProviderConfig;
    copy.apiKey = "sk-mutated";
    // Internal state should still have the original key
    expect(getLMProviderConfig().apiKey).toBe("sk-original");
  });

  test("resetting to local clears remote fields", () => {
    setLMProviderConfig({ provider: "openai", apiKey: "sk-x", model: "gpt-4" });
    setLMProviderConfig({ provider: "local" });
    const cfg = getLMProviderConfig();
    expect(cfg.provider).toBe("local");
    expect(cfg.apiKey).toBeUndefined();
    expect(cfg.model).toBeUndefined();
  });

  test("partial config — apiKey optional for ollama", () => {
    setLMProviderConfig({ provider: "ollama" });
    expect(getLMProviderConfig().apiKey).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isLMAvailable
// ─────────────────────────────────────────────────────────────────────────────

describe("isLMAvailable", () => {
  test("returns false when window.__lm is not injected (Bun test env)", () => {
    // In the Bun test environment there is no C++ host, so __lm is never set.
    expect(isLMAvailable()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Remote routing via mocked fetch
// ─────────────────────────────────────────────────────────────────────────────

/** Build a minimal valid OpenAI completions response. */
function makeOpenAIResponse(text: string, model = "gpt-4o-mini") {
  return {
    ok:   true,
    json: async () => ({
      id:      "chatcmpl-test",
      model,
      choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage:   { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    text: async () => "",
  };
}

describe("lmChat remote routing", () => {
  beforeEach(() => {
    setLMProviderConfig({ provider: "local" });
  });

  test("routes to OpenAI and maps response to LMResponse shape", async () => {
    const fetchMock = mock(async (_url: string, _opts?: RequestInit) =>
      makeOpenAIResponse("Hello from OpenAI!"),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    setLMProviderConfig({ provider: "openai", apiKey: "sk-test", model: "gpt-4o-mini" });

    const result: LMResponse = await lmChat({
      messages: [{ role: "user", content: "Say hello" }],
    });

    expect(result.text).toBe("Hello from OpenAI!");
    expect(result.usage.total_tokens).toBe(15);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Verify the URL includes the OpenAI base and the completions path.
    const calledUrl = (fetchMock.mock.calls[0] as unknown[])[0] as string;
    expect(calledUrl).toContain("api.openai.com");
    expect(calledUrl).toContain("/v1/chat/completions");
  });

  test("adds Authorization header for openai provider", async () => {
    const fetchMock = mock(async (_url: string, opts?: RequestInit) =>
      makeOpenAIResponse("ok"),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    setLMProviderConfig({ provider: "openai", apiKey: "sk-secret", model: "gpt-4o-mini" });
    await lmChat({ messages: [{ role: "user", content: "hi" }] });

    const opts = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    const headers = opts.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-secret");
  });

  test("routes to custom Ollama base URL", async () => {
    const fetchMock = mock(async (_url: string) => makeOpenAIResponse("Ollama reply"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    setLMProviderConfig({
      provider: "ollama",
      baseUrl:  "http://localhost:11434",
      model:    "llama3.2",
    });

    const result = await lmChat({ messages: [{ role: "user", content: "hi" }] });
    expect(result.text).toBe("Ollama reply");

    const calledUrl = (fetchMock.mock.calls[0] as unknown[])[0] as string;
    expect(calledUrl).toContain("localhost:11434");
    expect(calledUrl).toContain("/v1/chat/completions");
  });

  test("per-request model overrides config model", async () => {
    const fetchMock = mock(async (_url: string, opts?: RequestInit) =>
      makeOpenAIResponse("ok"),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    setLMProviderConfig({ provider: "openai", apiKey: "sk-x", model: "gpt-4o-mini" });
    await lmChat({ messages: [{ role: "user", content: "hi" }], model: "gpt-4o" });

    const opts  = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    const body  = JSON.parse(opts.body as string) as { model: string };
    expect(body.model).toBe("gpt-4o");
  });

  test("strips trailing slash from baseUrl before appending path", async () => {
    const fetchMock = mock(async (_url: string) => makeOpenAIResponse("ok"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    setLMProviderConfig({ provider: "ollama", baseUrl: "http://my-server:8080/", model: "phi3" });
    await lmChat({ messages: [{ role: "user", content: "hi" }] });

    const calledUrl = (fetchMock.mock.calls[0] as unknown[])[0] as string;
    expect(calledUrl).toBe("http://my-server:8080/v1/chat/completions");
  });

  test("throws when no model is configured for remote provider", async () => {
    setLMProviderConfig({ provider: "openai", apiKey: "sk-x" }); // no model
    await expect(
      lmChat({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/no model specified/i);
  });

  test("throws when remote server returns non-2xx status", async () => {
    const fetchMock = mock(async () => ({
      ok:     false,
      status: 429,
      statusText: "Too Many Requests",
      text:   async () => "Rate limit exceeded",
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    setLMProviderConfig({ provider: "openai", apiKey: "sk-x", model: "gpt-4o-mini" });
    await expect(
      lmChat({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/429/);
  });
});
