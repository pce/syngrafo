/**
 * @file hooks/useDocumentStats.ts
 * Derives word count, char count, block count, heading count and estimated
 * reading time from an SDocument.  Memoised on doc identity.
 */
import { useMemo } from "react";
import { type SDocument } from "../models/sdm";
import { isTextBlock } from "../models/sdm";
import { flattenBlocks } from "../models/sdm-factory";

export interface DocumentStats {
  blockCount:      number;
  wordCount:       number;
  charCount:       number;
  headingCount:    number;
  readingTimeMins: number;
}

export function useDocumentStats(doc: SDocument | null): DocumentStats | null {
  return useMemo(() => {
    if (!doc) return null;
    const flat  = flattenBlocks(doc.blocks);
    const text  = flat
      .filter(isTextBlock)
      .flatMap((b) => b.spans)
      .map((s) => s.text)
      .join(" ");
    const words = text.trim().split(/\s+/).filter(Boolean);
    const headingCount = flat.filter(
      (b) => b.type === "h1" || b.type === "h2" || b.type === "h3" || b.type === "h4",
    ).length;
    return {
      blockCount:      flat.length,
      wordCount:       words.length,
      charCount:       text.length,
      headingCount,
      readingTimeMins: Math.max(1, Math.round(words.length / 200)),
    };
  }, [doc]);
}
