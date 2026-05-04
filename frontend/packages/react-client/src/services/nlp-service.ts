/**
 * Saucer IPC bridge shape as it exists on `window.saucer` at runtime.
 * The `@saucer-dev/types` package exports standalone functions, not this
 * namespace object — so we define the runtime shape locally.
 */
interface SaucerBridge {
  call<T = string>(name: string, params?: unknown[]): Promise<T>;
  exposed?: Record<string, (...args: unknown[]) => Promise<string>>;
}

declare global {
  interface Window {
    saucer?: SaucerBridge;
    __nlp?: {
      hasOnnx:      boolean;
      hasSentiment: boolean;
      hasToxicity:  boolean;
      hasNer:       boolean;
      version:      string;
    };
    __dms?: {
      hasSemanticSearch: boolean;
    };
  }
}

export interface NlpEnvelope<T = unknown> {
  ok:     boolean;
  data?:  T;
  error?: string;
}

/** Returns the saucer-exposed C++ function for `name`, or undefined outside the webview. */
export function binding(name: string): ((...args: unknown[]) => Promise<string>) | undefined {
  return window.saucer?.exposed?.[name];
}

/** Calls a saucer-exposed C++ function and parses the JSON envelope. Never throws. */
export async function call<T>(
  fn: ((...args: unknown[]) => Promise<string>) | undefined,
  ...args: unknown[]
): Promise<NlpEnvelope<T>> {
  if (typeof fn !== "function") {
    return { ok: false, error: "Native binding not available (running outside saucer?)" };
  }
  try {
    const raw = await fn(...args);
    return JSON.parse(raw) as NlpEnvelope<T>;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export interface HealthData        { onnx: boolean; sentiment: boolean; toxicity: boolean; ner: boolean; version: string; }
export interface SummaryData       { summary: string; selected_sentences: number[]; ratio: number; original_length: number; summary_length: number; }
export interface Keyword           { term: string; frequency: number; tfidf_score: number; pos: string; }
export interface Entity            { text: string; type: string; position: number; confidence: number; }
export interface SentimentData     { score: number; label: string; confidence: number; }
export interface ReadabilityData   { flesch_kincaid_grade: number; readability_score: number; complexity: string; word_count: number; sentence_count: number; avg_sentence_length: number; suggestions: string[]; }
export interface ToxicityData      { is_toxic: boolean; score: number; triggers: string[]; category: string; }
export interface LanguageData      { language: string; confidence: number; script_distribution: Record<string, number>; }
export interface EmbedData         { success: boolean; dimensions: number; vector: number[]; }
export interface SearchMatch       { text: string; score: number; index: number; }
export interface SpellCorrection   { original: string; suggested: string; confidence: number; reason: string; }

/** Legacy-compat shape used by Sidebar / DocumentPanel health display. */
export interface HealthStatus { status: string; engine_ready: boolean; }

/** One incremental step delivered by `streamNLP`. */
export interface StreamChunk  { chunk?: string; is_final?: boolean; error?: string; }

export interface NLPStreamRequest { text: string; plugin: string; options?: Record<string, string>; }

export const nlp = {
  health:         ()                                           => call<HealthData>(binding("nlp_health")),
  summarize:      (text: string, ratio = 0.3, query = "")     => call<SummaryData>(binding("nlp_summarize"), text, ratio, query),
  keywords:       (text: string, max = 15, lang = "en")       => call<Keyword[]>(binding("nlp_keywords"), text, max, lang),
  sentiment:      (text: string, lang = "en")                 => call<SentimentData>(binding("nlp_sentiment"), text, lang),
  entities:       (text: string, lang = "en")                 => call<Entity[]>(binding("nlp_entities"), text, lang),
  readability:    (text: string)                              => call<ReadabilityData>(binding("nlp_readability"), text),
  toxicity:       (text: string, lang = "en")                 => call<ToxicityData>(binding("nlp_toxicity"), text, lang),
  detectLanguage: (text: string)                              => call<LanguageData>(binding("nlp_detect_language"), text),
  tokenize:       (text: string)                              => call<string[]>(binding("nlp_tokenize"), text),
  spellCheck:     (text: string, lang = "en")                 => call<SpellCorrection[]>(binding("nlp_spell_check"), text, lang),
  semanticSearch: (query: string, docs: string[], topK = 5)   => call<SearchMatch[]>(binding("nlp_semantic_search"), query, JSON.stringify(docs), topK),
  extractSchema:  (text: string, schema: Record<string, string>) => call<Record<string, string>>(binding("nlp_extract_schema"), text, JSON.stringify(schema)),
  embed:          (text: string)                              => call<EmbedData>(binding("nlp_embed"), text),
  isConnected:    ()                                          => typeof window.saucer?.call === "function",
  caps:           ()                                          => window.__nlp ?? { hasOnnx: false, hasSentiment: false, hasToxicity: false, hasNer: false, version: "dev" },

  /** Maps `nlp_health` result to the `{ status, engine_ready }` shape used by UI components. */
  checkHealth: async (): Promise<HealthStatus> => {
    const res = await call<HealthData>(binding("nlp_health"));
    return {
      status:       res.ok ? "ok" : (res.error ?? "error"),
      engine_ready: res.ok && (res.data?.onnx ?? false),
    };
  },

  /**
   * Runs NLP analysis steps sequentially and delivers each result as a
   * `StreamChunk`, matching the text patterns that `Sidebar.parseLogLine()`
   * already parses.  Saucer IPC is one-shot Promise — this is the correct
   * pattern; a true push-streaming bus would require a separate event layer.
   *
   * Returns a cancellation function; calling it stops pending steps cleanly.
   */
  streamNLP: async (
    req:     NLPStreamRequest,
    onChunk: (data: StreamChunk) => void,
    onError: (err: unknown) => void,
  ): Promise<() => void> => {
    let cancelled = false;

    (async () => {
      try {
        const lang = await call<LanguageData>(binding("nlp_detect_language"), req.text);
        if (cancelled) return;
        if (lang.ok && lang.data)
          onChunk({ chunk: `Language: ${lang.data.language} • confidence: ${Math.round(lang.data.confidence * 100)}%\n` });

        const sent = await call<SentimentData>(binding("nlp_sentiment"), req.text, "en");
        if (cancelled) return;
        if (sent.ok && sent.data)
          onChunk({ chunk: `Sentiment: ${sent.data.label} • score: ${sent.data.score.toFixed(2)}\n` });

        const read = await call<ReadabilityData>(binding("nlp_readability"), req.text);
        if (cancelled) return;
        if (read.ok && read.data)
          onChunk({ chunk: `Complexity: ${read.data.complexity} • Grade: ${read.data.flesch_kincaid_grade}\n` });

        if (req.options?.["pos_tagging"] === "true") {
          const tokens = await call<string[]>(binding("nlp_tokenize"), req.text);
          if (cancelled) return;
          if (tokens.ok && tokens.data && tokens.data.length > 0)
            onChunk({ chunk: `Tags: ${tokens.data.slice(0, 12).join(" ")} … (${tokens.data.length})\n` });
        }

        if (req.options?.["terminology"] === "true") {
          const kw = await call<Keyword[]>(binding("nlp_keywords"), req.text, 15, "en");
          if (cancelled) return;
          if (kw.ok && kw.data && kw.data.length > 0)
            onChunk({ chunk: `Keywords: ${kw.data.map(k => k.term).join(", ")}\n` });
        }

        if (req.options?.["safety"] === "true") {
          const tox = await call<ToxicityData>(binding("nlp_toxicity"), req.text, "en");
          if (cancelled) return;
          if (tox.ok && tox.data)
            onChunk({ chunk: tox.data.is_toxic ? `Warning: Content flagged as ${tox.data.category}\n` : "Content Safety: Clean\n" });
        }

        onChunk({ is_final: true });
      } catch (e) {
        if (!cancelled) onError(e);
      }
    })();

    return () => { cancelled = true; };
  },
};
