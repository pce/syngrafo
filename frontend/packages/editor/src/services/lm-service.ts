/**
 * @file services/lm-service.ts
 *
 * OpenAI-compatible TypeScript wrapper around the local llama.cpp inference
 * engine exposed via saucer IPC.
 *
 * Architecture (push-based to avoid blocking the IPC bridge):
 *
 *   lmChatStart() → IPC "lm_chat_start" → { request_id }   (immediate)
 *        ↓
 *   C++ worker thread runs inference
 *        ↓
 *   window.__lm_result(requestId, text, promptTokens, completionTokens)
 *        ↓
 *   pendingRequests.get(requestId).resolve(result)          (resolves lmChat())
 *
 * Public API mirrors OpenAI's chat-completions shape so the same call-sites
 * work with both local models and an external OpenAI/Ollama proxy (future).
 *
 *   const reply = await lmChat({
 *     messages: [
 *       { role: "system", content: systemPrompt },
 *       { role: "user",   content: userMessage  },
 *     ],
 *     max_tokens:  512,
 *     temperature: 0.7,
 *   });
 *   console.log(reply.text);
 *
 * Checking availability before use:
 *   if (!isLMAvailable()) return;  // graceful no-LM path
 */

import { ipcRawCall, parseIpcResult } from "./ipc";

// ─────────────────────────────────────────────────────────────────────────────
// Window augmentation — capabilities injected by main.cc before page load
// ─────────────────────────────────────────────────────────────────────────────
declare global {
  interface Window {
    __lm?: {
      hasLM:       boolean;
      loadedModel: string | null;
      isBusy:      boolean;
    };
    /** Resolved by lm_bindings.hh when inference completes. */
    __lm_result?: (
      requestId:        string,
      text:             string,
      promptTokens:     number,
      completionTokens: number,
    ) => void;
    /** Resolved by lm_bindings.hh when inference fails. */
    __lm_error?: (requestId: string, error: string) => void;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain types (OpenAI-compatible shape)
// ─────────────────────────────────────────────────────────────────────────────

export type LMRole = "system" | "user" | "assistant";

export interface LMMessage {
  role:    LMRole;
  content: string;
}

export interface LMRequest {
  messages:     LMMessage[];
  max_tokens?:  number;   // default: 512
  temperature?: number;   // default: 0.7
  /**
   * Model identifier forwarded to the remote provider (OpenAI/Ollama).
   * Ignored when using the local GGUF backend.
   * Overrides LMProviderConfig.model for a single request.
   */
  model?:       string;
  /** Caller-supplied ID; auto-generated when omitted. */
  request_id?:  string;
}

export interface LMUsage {
  prompt_tokens:     number;
  completion_tokens: number;
  total_tokens:      number;
}

export interface LMResponse {
  request_id: string;
  text:       string;
  usage:      LMUsage;
}

export interface LMStatus {
  has_lm:       boolean;
  loaded_model: string | null;
  is_busy:      boolean;
  queue_depth:  number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pending-request registry
//
// Maps request_id → { resolve, reject } for in-flight lm_chat_start calls.
// The global __lm_result / __lm_error callbacks drain this map.
// ─────────────────────────────────────────────────────────────────────────────

interface PendingEntry {
  resolve: (r: LMResponse) => void;
  reject:  (e: Error)      => void;
}

const pendingRequests = new Map<string, PendingEntry>();

/** Install push callbacks once at module load time. */
function installPushCallbacks(): void {
  window.__lm_result = (
    requestId:        string,
    text:             string,
    promptTokens:     number,
    completionTokens: number,
  ) => {
    const entry = pendingRequests.get(requestId);
    if (!entry) return;
    pendingRequests.delete(requestId);
    entry.resolve({
      request_id: requestId,
      text,
      usage: {
        prompt_tokens:     promptTokens,
        completion_tokens: completionTokens,
        total_tokens:      promptTokens + completionTokens,
      },
    });
  };

  window.__lm_error = (requestId: string, error: string) => {
    const entry = pendingRequests.get(requestId);
    if (!entry) return;
    pendingRequests.delete(requestId);
    entry.reject(new Error(error));
  };
}

// Install immediately when running in a browser context.
// Guarded so the module can be safely imported in Bun / Node test environments
// where `window` is not defined.
if (typeof window !== "undefined") {
  installPushCallbacks();
}

// ─────────────────────────────────────────────────────────────────────────────
// Remote provider configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which inference backend `lmChat()` should use.
 *
 * - `"local"`  — on-device GGUF model via the `lm_chat_start` IPC binding.
 * - `"openai"` — OpenAI Chat Completions API (needs `apiKey`).
 * - `"ollama"` — Ollama OpenAI-compatible endpoint (default: localhost:11434).
 *
 * Any OpenAI-compatible server (LM Studio, vLLM, llama-server --api) can be
 * used by setting `provider: "ollama"` with the correct `baseUrl`.
 */
export type LMProvider = "local" | "openai" | "ollama";

export interface LMProviderConfig {
  /** Which backend to route inference requests to. */
  provider:  LMProvider;
  /**
   * API key sent as `Authorization: Bearer {apiKey}`.
   * Required for `provider="openai"`; ignored for `"local"` and `"ollama"`.
   */
  apiKey?:   string;
  /**
   * Base URL for the remote provider's API server.
   * Defaults: `"openai"` → `https://api.openai.com`,
   *           `"ollama"` → `http://localhost:11434`.
   * Override to point at LM Studio, vLLM, or any OpenAI-compatible endpoint.
   */
  baseUrl?:  string;
  /**
   * Default model identifier sent in the remote request body.
   * Per-request `LMRequest.model` takes precedence.
   * Ignored when `provider="local"`.
   */
  model?:    string;
}

/** Default base URLs keyed by provider. */
const PROVIDER_DEFAULT_BASE: Partial<Record<LMProvider, string>> = {
  openai: "https://api.openai.com",
  ollama: "http://localhost:11434",
};

/** Module-level provider config.  Default: local GGUF. */
let _providerConfig: LMProviderConfig = { provider: "local" };

/**
 * Update the active LM provider configuration.
 * Changes take effect on the next `lmChat()` call.
 *
 * @example
 *   // Switch to OpenAI
 *   setLMProviderConfig({ provider: "openai", apiKey: "sk-…", model: "gpt-4o-mini" });
 *
 *   // Switch to local Ollama
 *   setLMProviderConfig({ provider: "ollama", model: "llama3.2" });
 *
 *   // Back to on-device
 *   setLMProviderConfig({ provider: "local" });
 */
export function setLMProviderConfig(config: LMProviderConfig): void {
  _providerConfig = { ...config };
}

/**
 * Return a snapshot of the current provider configuration.
 * The returned object is a shallow copy — mutating it has no effect.
 */
export function getLMProviderConfig(): Readonly<LMProviderConfig> {
  return { ..._providerConfig };
}

// ─────────────────────────────────────────────────────────────────────────────
// Remote chat (OpenAI-compatible)
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal subset of the OpenAI `/v1/chat/completions` response we use. */
interface OpenAICompletionsResponse {
  id:      string;
  model:   string;
  choices: Array<{
    message:       { role: string; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens:     number;
    completion_tokens: number;
    total_tokens:      number;
  };
}

/**
 * Send a request to any OpenAI-compatible `/v1/chat/completions` endpoint.
 * Used when `_providerConfig.provider` is `"openai"` or `"ollama"`.
 */
async function fetchRemoteChat(request: LMRequest, config: LMProviderConfig): Promise<LMResponse> {
  const base = (config.baseUrl ?? PROVIDER_DEFAULT_BASE[config.provider] ?? "").replace(/\/$/, "");
  if (!base) throw new Error(`lmChat: no base URL configured for provider "${config.provider}"`);

  const model = request.model ?? config.model;
  if (!model) {
    throw new Error(
      `lmChat: no model specified for remote provider "${config.provider}". ` +
      `Set LMProviderConfig.model or pass LMRequest.model.`,
    );
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.provider === "openai" && config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  const body: Record<string, unknown> = {
    model,
    messages:    request.messages,
    max_tokens:  request.max_tokens  ?? 512,
    temperature: request.temperature ?? 0.7,
    stream:      false,
  };

  const resp = await globalThis.fetch(`${base}/v1/chat/completions`, {
    method:  "POST",
    headers,
    body:    JSON.stringify(body),
  });

  if (!resp.ok) {
    let detail = "";
    try { detail = await resp.text(); } catch { /* ignore */ }
    throw new Error(
      `lmChat [${config.provider}] ${resp.status} ${resp.statusText}` +
      (detail ? `: ${detail.slice(0, 200)}` : ""),
    );
  }

  const data   = await resp.json() as OpenAICompletionsResponse;
  const choice = data.choices[0];
  if (!choice) throw new Error(`lmChat [${config.provider}]: no choices in response`);

  return {
    request_id: request.request_id ?? crypto.randomUUID(),
    text:       choice.message.content,
    usage: {
      prompt_tokens:     data.usage.prompt_tokens,
      completion_tokens: data.usage.completion_tokens,
      total_tokens:      data.usage.total_tokens,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when the LM engine is available (SGF_WITH_LM=ON and at least
 * one model has been loaded via lmLoad()).
 * Check this before calling lmChat() for graceful degradation.
 */
export function isLMAvailable(): boolean {
  return typeof window !== "undefined" && window.__lm?.hasLM === true;
}

/**
 * Fetch the current engine status without changing anything.
 */
export async function lmStatus(): Promise<LMStatus> {
  const raw = await ipcRawCall("lm_status");
  const res = parseIpcResult<LMStatus>(raw);
  if (!res.data) throw new Error(res.error ?? "lm_status failed");
  return res.data;
}

/**
 * Load a GGUF model by catalog ID (e.g. "phi-3.5-mini-q4").
 * The model must have been downloaded first via model_start().
 * Resolves when the model is mmap'd and ready.  May take 2-10 s.
 */
export async function lmLoad(modelId: string): Promise<string> {
  const raw = await ipcRawCall("lm_load", modelId);
  const res = parseIpcResult<{ loaded_model: string }>(raw);
  if (!res.data?.loaded_model) throw new Error(res.error ?? "lm_load failed");
  // Update the injected capability flag so isLMAvailable() returns true.
  if (window.__lm) window.__lm.loadedModel = res.data.loaded_model;
  return res.data.loaded_model;
}

/**
 * Unload the current model and drain the inference queue.
 * After this call isLMAvailable() returns false until lmLoad() is called again.
 */
export async function lmUnload(): Promise<void> {
  const raw = await ipcRawCall("lm_unload");
  parseIpcResult(raw);   // throws on error
  if (window.__lm) { window.__lm.loadedModel = null; }
}

/**
 * Send a chat request to the local LM.
 *
 * Returns a Promise that resolves with the full generated text once inference
 * completes.  The call does NOT block the JS event loop — it registers the
 * request and returns immediately; the result is pushed from C++ when done.
 *
 * @throws if the LM is not loaded, the IPC call fails, or the request is
 *         cancelled (broken_promise → Error("request cancelled")).
 *
 * @example
 *   const { text, usage } = await lmChat({
 *     messages: [
 *       { role: "system", content: "You are a helpful assistant." },
 *       { role: "user",   content: "Write a short greeting." },
 *     ],
 *     max_tokens:  128,
 *     temperature: 0.8,
 *   });
 */
export async function lmChat(request: LMRequest): Promise<LMResponse> {
  // ── Remote path: OpenAI / Ollama / any OpenAI-compatible endpoint ───────────
  if (_providerConfig.provider !== "local") {
    return fetchRemoteChat(request, _providerConfig);
  }

  // ── Local path: on-device GGUF inference via saucer IPC ────────────────────
  // Register promise BEFORE IPC call to avoid race where result arrives first.
  const rid = request.request_id ?? crypto.randomUUID();

  const promise = new Promise<LMResponse>((resolve, reject) => {
    pendingRequests.set(rid, { resolve, reject });
  });

  try {
    const raw = await ipcRawCall(
      "lm_chat_start",
      JSON.stringify(request.messages),
      request.max_tokens  ?? 512,
      request.temperature ?? 0.7,
    );
    const res = parseIpcResult<{ request_id: string }>(raw);
    if (!res.data?.request_id) {
      pendingRequests.delete(rid);
      throw new Error(res.error ?? "lm_chat_start failed");
    }
    // The C++ side generates its own request_id; remap if different.
    const serverRid = res.data.request_id;
    if (serverRid !== rid) {
      const entry = pendingRequests.get(rid)!;
      pendingRequests.delete(rid);
      pendingRequests.set(serverRid, entry);
    }
  } catch (e) {
    pendingRequests.delete(rid);
    throw e;
  }

  return promise;
}

/**
 * Cancel a pending (not-yet-running) request by its request_id.
 * Already-running requests are not interrupted; their Promises will still
 * resolve normally (cancelled flag is checked only before execution starts).
 */
export async function lmCancel(requestId: string): Promise<boolean> {
  const raw = await ipcRawCall("lm_cancel", requestId);
  const res = parseIpcResult<{ cancelled: boolean }>(raw);
  return res.data?.cancelled ?? false;
}

/**
 * Cancel all pending requests that are currently waiting in the queue.
 * Useful for cleanup in useEffect teardown.
 */
export function lmCancelAll(): void {
  for (const [rid, entry] of pendingRequests) {
    entry.reject(new Error("request cancelled (lmCancelAll)"));
    pendingRequests.delete(rid);
    void lmCancel(rid);
  }
}
