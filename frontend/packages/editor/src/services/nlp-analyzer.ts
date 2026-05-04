import type { NLPToken, NLPBlockAnnotation, BlockReadability, SentenceBoundary, NERType, DocumentNLPSummary } from "../models/nlp";
import type { Block } from "../models/block";

// We don't import the react-client service directly (different package).
// Instead we replicate the tiny call() helper here.

declare global {
  interface Window {
    saucer?: {
      call<T = string>(name: string, params?: unknown[]): Promise<T>;
      exposed?: Record<string, (...args: unknown[]) => Promise<string>>;
    };
  }
}

function binding(name: string) {
  return window.saucer?.exposed?.[name];
}

async function nlpCall<T>(fn: ((...args: unknown[]) => Promise<string>) | undefined, ...args: unknown[]): Promise<{ ok: boolean; data?: T; error?: string }> {
  if (typeof fn !== "function") return { ok: false, error: "not connected" };
  try {
    const raw = await fn(...args);
    return JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export function isNLPConnected(): boolean {
  return typeof window.saucer?.exposed?.["nlp_health"] === "function";
}

export interface AnalyzeOptions {
  keywords?: boolean; // default true
  entities?: boolean; // default true
  readability?: boolean; // default true
  spellCheck?: boolean; // default false
  lang?: string; // default "en"
}

/**
 * Analyze a plain-text string and return a full NLPBlockAnnotation.
 * Calls the C++ NLP engine via saucer IPC.
 * Falls back to simple whitespace tokenization if not connected.
 */
export async function analyzeText(text: string, options: AnalyzeOptions = {}): Promise<NLPBlockAnnotation> {
  const lang = options.lang ?? "en";
  const now = Date.now();

  const tokRes = await nlpCall<string[]>(binding("nlp_tokenize"), text);
  const rawTokens: string[] = tokRes.ok && tokRes.data ? tokRes.data : text.split(/\s+/).filter(Boolean);

  const tokens: NLPToken[] = rawTokens.map((t) => ({ text: t }));

  if (options.keywords !== false) {
    const kwRes = await nlpCall<Array<{ term: string; tfidf_score: number; frequency: number; pos: string }>>(binding("nlp_keywords"), text, 20, lang);
    if (kwRes.ok && kwRes.data) {
      const kwSet = new Map(kwRes.data.map((k) => [k.term.toLowerCase(), k.tfidf_score]));
      tokens.forEach((t) => {
        const score = kwSet.get(t.text.toLowerCase());
        if (score !== undefined) {
          t.isKeyword = true;
          t.keywordScore = score;
        }
      });
    }
  }

  if (options.entities !== false) {
    const nerRes = await nlpCall<Array<{ text: string; type: string; position: number }>>(binding("nlp_entities"), text, lang);
    if (nerRes.ok && nerRes.data) {
      for (const ent of nerRes.data) {
        const entWords = ent.text.split(/\s+/);
        for (let i = 0; i <= tokens.length - entWords.length; i++) {
          const match = entWords.every((w, j) => tokens[i + j]?.text.toLowerCase() === w.toLowerCase());
          if (match) {
            for (let j = 0; j < entWords.length; j++) {
              const tok = tokens[i + j];
              if (tok) tok.ner = ent.type as NERType;
            }
            break;
          }
        }
      }
    }
  }

  if (options.spellCheck) {
    const scRes = await nlpCall<Array<{ original: string; suggested: string }>>(binding("nlp_spell_check"), text, lang);
    if (scRes.ok && scRes.data) {
      const errSet = new Map(scRes.data.map((e) => [e.original.toLowerCase(), e.suggested]));
      tokens.forEach((t) => {
        const suggestion = errSet.get(t.text.toLowerCase());
        if (suggestion) {
          t.spellError = true;
          t.suggestion = suggestion;
        }
      });
    }
  }

  let readability: BlockReadability | undefined;
  if (options.readability !== false) {
    const rdRes = await nlpCall<{
      flesch_kincaid_grade: number;
      readability_score: number;
      complexity: string;
      word_count: number;
      sentence_count: number;
      avg_sentence_length: number;
      suggestions: string[];
    }>(binding("nlp_readability"), text);
    if (rdRes.ok && rdRes.data) {
      readability = {
        fleschKincaidGrade: rdRes.data.flesch_kincaid_grade,
        readabilityScore: rdRes.data.readability_score,
        complexity: rdRes.data.complexity,
        wordCount: rdRes.data.word_count,
        sentenceCount: rdRes.data.sentence_count,
        avgSentenceLength: rdRes.data.avg_sentence_length,
        suggestions: rdRes.data.suggestions,
      };
    }
  }

  const sentences: SentenceBoundary[] = [];
  let sentStart = 0;
  tokens.forEach((t, i) => {
    if (/^[.!?]+$/.test(t.text)) {
      sentences.push({ start: sentStart, end: i + 1 });
      sentStart = i + 1;
    }
  });
  if (sentStart < tokens.length) {
    sentences.push({ start: sentStart, end: tokens.length });
  }

  return {
    tokens,
    ...(sentences.length > 0 ? { sentences } : {}),
    ...(readability !== undefined ? { readability } : {}),
    lang,
    analyzedAt: now,
  };
}

/**
 * Analyze all text blocks in a DocumentModel and annotate them in-place.
 * Returns the count of blocks annotated.
 */
export async function analyzeDocument(
  blocks: Array<{
    getContent: () => string;
    setNLPAnnotation: (a: NLPBlockAnnotation) => void;
    isTextBlock: () => boolean;
  }>,
  options: AnalyzeOptions = {},
): Promise<number> {
  let count = 0;
  for (const block of blocks) {
    if (!block.isTextBlock()) continue;
    const text = block
      .getContent()
      .replace(/<[^>]+>/g, "")
      .trim();
    if (!text) continue;
    const annotation = await analyzeText(text, options);
    block.setNLPAnnotation(annotation);
    count++;
  }
  return count;
}

function buildNLPSummary(blocks: Block[]): DocumentNLPSummary {
  const kwMap = new Map<string, { score: number; frequency: number }>();
  const entMap = new Map<string, { type: string; count: number }>();
  const posDistrib: Record<string, number> = {};
  let totalTokens = 0;
  let totalWords = 0;
  let totalSentences = 0;
  let gradeSum = 0;
  let readabilitySum = 0;
  let gradeCount = 0;

  for (const block of blocks) {
    const ann = block.getNLPAnnotation();
    if (!ann) continue;
    for (const tok of ann.tokens) {
      if (tok.isKeyword && tok.keywordScore !== undefined) {
        const existing = kwMap.get(tok.text.toLowerCase());
        if (existing) {
          existing.frequency++;
          existing.score = Math.max(existing.score, tok.keywordScore);
        } else kwMap.set(tok.text.toLowerCase(), { score: tok.keywordScore, frequency: 1 });
      }
      if (tok.ner) {
        const key = `${tok.text.toLowerCase()}|${tok.ner}`;
        const ex = entMap.get(key);
        if (ex) ex.count++;
        else entMap.set(key, { type: tok.ner, count: 1 });
      }
      if (tok.pos) {
        posDistrib[tok.pos] = (posDistrib[tok.pos] ?? 0) + 1;
        totalTokens++;
      }
    }
    if (ann.readability) {
      totalWords += ann.readability.wordCount;
      totalSentences += ann.readability.sentenceCount;
      gradeSum += ann.readability.fleschKincaidGrade;
      readabilitySum += ann.readability.readabilityScore;
      gradeCount++;
    }
  }

  if (totalTokens > 0) {
    for (const k in posDistrib) posDistrib[k] = (posDistrib[k] ?? 0) / totalTokens;
  }

  return {
    wordCount: totalWords,
    sentenceCount: totalSentences,
    keywordCount: kwMap.size,
    topKeywords: Array.from(kwMap.entries())
      .map(([term, { score, frequency }]) => ({ term, score, frequency }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20),
    entities: Array.from(entMap.entries())
      .map(([key, { type, count }]) => ({
        text: key.split("|")[0] ?? key,
        type: type as NERType,
        count,
      }))
      .sort((a, b) => b.count - a.count),
    avgGrade: gradeCount > 0 ? gradeSum / gradeCount : 0,
    readabilityScore: gradeCount > 0 ? readabilitySum / gradeCount : 0,
    ...(totalTokens > 0 ? { posDistribution: posDistrib } : {}),
    computedAt: Date.now(),
  };
}

export async function runAnalysis(doc: { getBlocks(): Block[] }, options: AnalyzeOptions = {}): Promise<{ count: number; summary: DocumentNLPSummary }> {
  const blocks = doc.getBlocks();
  const count = await analyzeDocument(blocks, options);
  const summary = buildNLPSummary(blocks);
  return { count, summary };
}
