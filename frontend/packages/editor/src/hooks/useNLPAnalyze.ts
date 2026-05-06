/**
 * @file hooks/useNLPAnalyze.ts
 * Shared hook that runs NLP analysis on the current document and
 * dispatches the standard SET_ANALYZING / SET_NLP_SUMMARY / SET_DOCUMENT /
 * SET_STATUS sequence.  Both StatsPanel and NLPPanel use this.
 */
import { useState, useCallback } from "react";
import { useEditor } from "../store/editor-store";
import { runAnalysis } from "../services/nlp-analyzer";

export interface UseNLPAnalyzeResult {
  analyze:     () => Promise<void>;
  isAnalyzing: boolean;
  error:       string | null;
}

export function useNLPAnalyze(canRun: boolean = true): UseNLPAnalyzeResult {
  const { state, dispatch } = useEditor();
  const { doc, isAnalyzing, nlpFlags } = state;
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(async () => {
    if (!doc || !canRun) return;
    setError(null);
    dispatch({ type: "SET_ANALYZING", value: true });
    try {
      const result = await runAnalysis(doc, {
        pos:         nlpFlags.showPOS,
        ner:         nlpFlags.showNER,
        keywords:    nlpFlags.showKeywords,
        readability: nlpFlags.showReadability,
      });
      dispatch({ type: "SET_NLP_SUMMARY", summary: result.summary });
      dispatch({ type: "SET_DOCUMENT", doc: result.doc });
      if (result.count === 0) {
        dispatch({ type: "SET_STATUS", text: "No text blocks to analyze", kind: "warning" });
      } else {
        dispatch({
          type: "SET_STATUS",
          text: `Analyzed ${result.count} block${result.count === 1 ? "" : "s"}`,
          kind: "success",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      dispatch({ type: "SET_STATUS", text: msg, kind: "error" });
    } finally {
      dispatch({ type: "SET_ANALYZING", value: false });
    }
  }, [doc, canRun, nlpFlags, dispatch]);

  return { analyze, isAnalyzing, error };
}
