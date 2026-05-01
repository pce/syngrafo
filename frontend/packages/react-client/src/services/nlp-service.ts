// services/nlp-service.ts ──────────────────────────────────────────────────
// Direct saucer expose() bindings for NLPEngine.
// No HTTP, no FastAPI — every call is an in-process C++ invocation.
//
// C++ side: app/main.cc → register_bindings() → view.expose("nlp_*", ...)
//
// Saucer IPC mechanism:
//   Exposed C++ functions are NOT placed directly on window.name.
//   They live behind:  window.saucer.call("name", [...args]) → Promise<string>
//   and as a Proxy:    window.saucer.exposed.name(...args)   → Promise<string>
//
// The C++ lambda returns a std::string (JSON).  Saucer JSON-encodes that
// string before resolving the JS Promise, so the Promise resolves with a
// plain JS string which we JSON.parse() to get the envelope object.
//
// Every exposed function returns Promise<string> where the string is a JSON
// envelope:  { "ok": true, "data": <T> }  |  { "ok": false, "error": string }
// ──────────────────────────────────────────────────────────────────────────

import type { Saucer } from "@saucer-dev/types";

export interface NlpEnvelope<T = unknown> {
  ok:     boolean;
  data?:  T;
  error?: string;
}

// ── Window / saucer type declarations ────────────────────────────────────────

declare global {
  interface Window {
    /** Saucer IPC bridge — present when running inside the saucer webview. */
    saucer?: Saucer;

    /** Capability flags injected by C++ before page load. */
    __nlp?: {
      hasOnnx:      boolean;
      hasSentiment: boolean;
      hasToxicity:  boolean;
      hasNer:       boolean;
      version:      string;
    };

    /** DMS capability flags injected by C++ before page load. */
    __dms?: {
      hasSemanticSearch: boolean;
    };
  }
}

// ── Core call helper ──────────────────────────────────────────────────────────
//
// Looks up the function via window.saucer.exposed (a Proxy that always returns
// a callable regardless of whether the name is registered on the C++ side).
// The "not connected" guard fires only when saucer itself is absent — i.e.
// when the page is opened in a normal browser rather than the saucer webview.

/** Returns the saucer-exposed proxy function for `name`, or undefined. */
function binding(name: string): ((...args: unknown[]) => Promise<string>) | undefined {
  return window.saucer?.exposed?.[name];
}

async function call<T>(
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

// ── Payload types ─────────────────────────────────────────────────────────────

export interface HealthData {
  onnx:      boolean;
  sentiment: boolean;
  toxicity:  boolean;
  ner:       boolean;
  version:   string;
}

export interface SummaryData {
  summary:            string;
  selected_sentences: number[];
  ratio:              number;
  original_length:    number;
  summary_length:     number;
}

export interface Keyword {
  term:        string;
  frequency:   number;
  tfidf_score: number;
  pos:         string;
}

export interface Entity {
  text:       string;
  type:       string;
  position:   number;
  confidence: number;
}

export interface SentimentData {
  score:      number;
  label:      string;
  confidence: number;
}

export interface ReadabilityData {
  flesch_kincaid_grade: number;
  readability_score:    number;
  complexity:           string;
  word_count:           number;
  sentence_count:       number;
  avg_sentence_length:  number;
  suggestions:          string[];
}

export interface ToxicityData {
  is_toxic:  boolean;
  score:     number;
  triggers:  string[];
  category:  string;
}

export interface LanguageData {
  language:            string;
  confidence:          number;
  script_distribution: Record<string, number>;
}

export interface EmbedData {
  success:    boolean;
  dimensions: number;
  vector:     number[];
}

export interface SearchMatch {
  text:  string;
  score: number;
  index: number;
}

export interface SpellCorrection {
  original:   string;
  suggested:  string;
  confidence: number;
  reason:     string;
}

// ── NLP API ───────────────────────────────────────────────────────────────────

export const nlp = {
  health: () =>
    call<HealthData>(binding("nlp_health")),

  summarize: (text: string, ratio = 0.3, query = "") =>
    call<SummaryData>(binding("nlp_summarize"), text, ratio, query),

  keywords: (text: string, max = 15, lang = "en") =>
    call<Keyword[]>(binding("nlp_keywords"), text, max, lang),

  sentiment: (text: string, lang = "en") =>
    call<SentimentData>(binding("nlp_sentiment"), text, lang),

  entities: (text: string, lang = "en") =>
    call<Entity[]>(binding("nlp_entities"), text, lang),

  readability: (text: string) =>
    call<ReadabilityData>(binding("nlp_readability"), text),

  toxicity: (text: string, lang = "en") =>
    call<ToxicityData>(binding("nlp_toxicity"), text, lang),

  detectLanguage: (text: string) =>
    call<LanguageData>(binding("nlp_detect_language"), text),

  tokenize: (text: string) =>
    call<string[]>(binding("nlp_tokenize"), text),

  spellCheck: (text: string, lang = "en") =>
    call<SpellCorrection[]>(binding("nlp_spell_check"), text, lang),

  semanticSearch: (query: string, docs: string[], topK = 5) =>
    call<SearchMatch[]>(
      binding("nlp_semantic_search"),
      query, JSON.stringify(docs), topK,
    ),

  extractSchema: (text: string, schema: Record<string, string>) =>
    call<Record<string, string>>(
      binding("nlp_extract_schema"),
      text, JSON.stringify(schema),
    ),

  embed: (text: string) =>
    call<EmbedData>(binding("nlp_embed"), text),

  /** True when running inside the saucer webview (C++ bindings present). */
  isConnected: () => typeof window.saucer?.call === "function",

  /** Cached capability flags injected before page load. */
  caps: () =>
    window.__nlp ?? {
      hasOnnx: false, hasSentiment: false,
      hasToxicity: false, hasNer: false, version: "dev",
    },
};
