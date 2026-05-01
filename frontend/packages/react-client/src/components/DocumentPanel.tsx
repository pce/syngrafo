import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  nlpService,
  type NLPRequest,
  type StreamChunk,
} from "../services/nlp-service";
import { DocumentModel, type DocumentState } from "../models/document";
import Icon from "./Icon";
import AnalysisDashboard from "./analysis/AnalysisDashboard";

/**
 * Extracted Highlighter component to ensure useMemo is called consistently
 * and not inside a conditional branch of the parent.
 */
const EditorHighlighter = ({
  content,
  highlights,
  searchQuery,
}: {
  content: string;
  highlights: any[];
  searchQuery?: string;
}) => {
  const renderedHighlights = useMemo(() => {
    const allHighlights = [...(highlights || [])];

    // Add Search Matches to the highlight list (Needle in Haystack)
    if (searchQuery && searchQuery.length > 1 && content) {
      const lowerContent = content.toLowerCase();
      const lowerQuery = searchQuery.toLowerCase();
      let pos = lowerContent.indexOf(lowerQuery);
      while (pos !== -1) {
        allHighlights.push({
          offset: pos,
          length: searchQuery.length,
          type: "search",
        });
        pos = lowerContent.indexOf(lowerQuery, pos + 1);
      }
    }

    if (allHighlights.length === 0 || !content) return null;

    const result = [];
    let lastIndex = 0;
    const sortedHighlights = allHighlights
      .filter(
        (h) =>
          h && typeof h.offset === "number" && typeof h.length === "number",
      )
      .sort((a, b) => a.offset - b.offset);

    for (const highlight of sortedHighlights) {
      const offset = Math.max(0, highlight.offset);
      const length = Math.max(0, highlight.length);

      if (offset >= content.length || offset < lastIndex) continue;

      if (offset > lastIndex) {
        result.push(content.substring(lastIndex, offset));
      }

      const end = Math.min(content.length, offset + length);
      const isSearch = highlight.type === "search";

      result.push(
        <span
          key={`hl-${offset}-${lastIndex}-${isSearch ? "s" : "d"}`}
          className="rounded-sm transition-all duration-200"
          style={{
            backgroundColor: isSearch
              ? "color-mix(in srgb, var(--theme-primary) 30%, transparent)"
              : "color-mix(in srgb, var(--theme-danger, #f43f5e) 25%, transparent)",
            borderBottom: isSearch
              ? "2px solid var(--theme-primary)"
              : "2px solid var(--theme-danger, #f43f5e)",
            padding: "1px 0",
            color: "transparent",
          }}
        >
          {content.substring(offset, end)}
        </span>,
      );
      lastIndex = end;
    }
    // Remaining text
    if (lastIndex < content.length) {
      result.push(content.substring(lastIndex));
    }
    return result;
  }, [content, highlights]);

  return (
    <div
      className="absolute inset-0 p-6 text-lg leading-relaxed font-serif pointer-events-none whitespace-pre-wrap break-words overflow-y-auto scrollbar-none z-0"
      style={{
        color: "transparent",
        WebkitTextFillColor: "transparent",
        backgroundColor: "transparent",
        userSelect: "none",
      }}
    >
      {renderedHighlights}
    </div>
  );
};

interface DocumentPanelProps {
  content: string;
  outputContent?: string;
  onContentChange?: (content: string) => void;
  onOutputChange?: (content: string) => void;
  onAnalysisResultsRef?: React.MutableRefObject<
    ((results: string) => void) | null
  >;
  isGenerating?: boolean;
}

const DocumentPanel = ({
  content,
  outputContent: externalOutputContent,
  onContentChange,
  onOutputChange,
  onAnalysisResultsRef,
  isGenerating,
}: DocumentPanelProps) => {
  // Initialize document state using the model helper
  const [doc, setDoc] = useState<DocumentState>(() =>
    DocumentModel.createInitialState("Analysis Workspace", content),
  );
  const [selectedText, setSelectedText] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isSearchVisible, setIsSearchVisible] = useState<boolean>(false);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [results, setResults] = useState<string>("");
  const [internalOutputContent, setInternalOutputContent] =
    useState<string>("");
  const [activeTab, setActiveTab] = useState<"editor" | "output" | "analysis">(
    "editor",
  );
  const [highlights, setHighlights] = useState<
    Array<{ offset: number; length: number }>
  >([]);
  const [outputHighlights, setOutputHighlights] = useState<
    Array<{ offset: number; length: number }>
  >([]);
  const [outputDuplicates, setOutputDuplicates] = useState<number>(0);

  const outputContent =
    externalOutputContent !== undefined
      ? externalOutputContent
      : internalOutputContent;

  // Sync tab on content changes
  useEffect(() => {
    if (externalOutputContent) {
      setActiveTab("output");
    }
  }, [externalOutputContent]);

  useEffect(() => {
    if (activeTab === "output") {
      const target = document.getElementById(
        "markov-output-area",
      ) as HTMLTextAreaElement;
      const highlighter = target?.previousSibling as HTMLElement;
      if (target && highlighter) {
        highlighter.scrollTop = target.scrollTop;
      }
    }
  }, [outputContent, activeTab, outputHighlights]);
  const setOutputContent = onOutputChange || setInternalOutputContent;
  const streamCleanupRef = useRef<(() => void) | null>(null);

  // Derived stats using the model logic
  const stats = DocumentModel.getStats(doc);

  const handleContentChange = (newContent: string) => {
    const updatedDoc = DocumentModel.updateContent(doc, newContent);
    setDoc(updatedDoc);
    onContentChange?.(newContent);
  };

  const handleSelection = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement;
    const selection = target.value.substring(
      target.selectionStart,
      target.selectionEnd,
    );
    setSelectedText(selection);
  };

  const handleProcessText = async () => {
    const textToProcess = selectedText || doc.content;
    if (!textToProcess.trim()) return;

    // Switch to results tab to show streaming analysis
    setActiveTab("results");
    setIsProcessing(true);
    setResults("");

    try {
      const request: NLPRequest = {
        text: textToProcess || " ",
        plugin: "default",
        streaming: true,
        options: {
          pos_tagging: "true",
          terminology: "true",
        },
      };

      const cleanup = await nlpService.streamNLP(
        request,
        (chunk: StreamChunk) => {
          setResults((prev) => prev + chunk.chunk);
          if (chunk.is_final) {
            setIsProcessing(false);
          }
        },
        (error) => {
          console.error("Linguistic streaming error:", error);
          setIsProcessing(false);
          setResults((prev) => prev + "\n\n[Error: Processing failed]");
        },
      );

      streamCleanupRef.current = cleanup;
    } catch (error) {
      console.error("Submission error:", error);
      setIsProcessing(false);
    }
  };

  const handleClear = () => {
    if (activeTab === "editor") {
      handleContentChange("");
    } else if (activeTab === "output") {
      setOutputContent("");
    } else {
      setResults("");
    }

    if (streamCleanupRef.current) {
      streamCleanupRef.current();
      streamCleanupRef.current = null;
    }
  };

  const handleSave = () => {
    const dataToSave = activeTab === "output" ? outputContent : doc.content;
    localStorage.setItem(
      "nlp-studio-doc",
      JSON.stringify({
        ...DocumentModel.toJSON(doc),
        content: dataToSave,
      }),
    );
  };

  const handleLoad = () => {
    const saved = localStorage.getItem("nlp-studio-doc");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        const loadedDoc = DocumentModel.fromJSON(data);
        setDoc(loadedDoc);
        onContentChange?.(loadedDoc.content);
      } catch (e) {
        console.error("Failed to hydrate document", e);
      }
    }
  };

  // Expose setResults to parent via ref
  useEffect(() => {
    if (onAnalysisResultsRef) {
      onAnalysisResultsRef.current = (newResults: string) => {
        setActiveTab("analysis");
        setResults(newResults);
        setIsProcessing(false);

        // Check for duplicates in results and set highlights
        try {
          const data = JSON.parse(newResults);
          // Backend now guarantees an array for duplicates
          const rawDuplicates = Array.isArray(data.duplicates)
            ? data.duplicates
            : [];
          const validated = rawDuplicates.map((d: any) => {
            const off = parseInt(String(d.offset), 10);
            const len = parseInt(String(d.length), 10);
            return {
              offset: isNaN(off) ? 0 : off,
              length: isNaN(len) ? 0 : len,
            };
          });
          setHighlights(validated);
        } catch (e) {
          setHighlights([]);
        }
      };
    }
    return () => {
      if (onAnalysisResultsRef) onAnalysisResultsRef.current = null;
    };
  }, [onAnalysisResultsRef]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamCleanupRef.current) {
        streamCleanupRef.current();
      }
    };
  }, []);

  // Listen for Markov generation updates from the Header
  useEffect(() => {
    if (isGenerating) {
      // Switch to Output tab when generation starts
      setActiveTab("output");
    }
  }, [isGenerating]);

  // Sync Input Source if content changed while on editor tab (initial load or manual sync)
  useEffect(() => {
    if (
      activeTab === "editor" &&
      content !== doc.content &&
      !isGenerating &&
      !content.startsWith("Initializing")
    ) {
      setDoc(DocumentModel.updateContent(doc, content));
    }
  }, [content, activeTab, isGenerating]);

  return (
    <div
      className="bg-white dark:bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl mb-6 overflow-hidden"
      style={{
        backgroundColor: "var(--theme-surface)",
        borderColor: "var(--theme-border)",
      }}
    >
      <div
        className="p-4 bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700"
        style={{
          backgroundColor: "var(--theme-bg)",
          borderBottomColor: "var(--theme-border)",
          opacity: 0.8,
        }}
      >
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSearchVisible(!isSearchVisible)}
              className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg hover:bg-indigo-200 transition-colors"
              style={{ backgroundColor: "var(--theme-bg)" }}
            >
              <Icon
                name="search"
                size="sm"
                className="text-indigo-600 dark:text-indigo-400"
                style={{ color: "var(--theme-primary)" }}
              />
            </button>
            <div className="relative">
              {isSearchVisible && (
                <div
                  className="absolute left-0 -top-1 border rounded-lg shadow-xl px-2 py-1 flex items-center gap-2 z-50 animate-in fade-in slide-in-from-left-2 w-48"
                  style={{
                    backgroundColor: "var(--theme-surface)",
                    borderColor: "var(--theme-primary)",
                  }}
                >
                  <input
                    autoFocus
                    type="text"
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-transparent border-none text-[10px] font-bold  tracking-widest focus:ring-0 p-0 w-full"
                    style={{ color: "var(--theme-text)" }}
                  />
                  <button
                    onClick={() => {
                      setIsSearchVisible(false);
                      setSearchQuery("");
                    }}
                  >
                    <Icon
                      name="close"
                      size="xs"
                      className="text-slate-400 hover:text-rose-500"
                    />
                  </button>
                </div>
              )}
              <h2
                className="text-sm font-black uppercase tracking-widest text-slate-800 dark:text-slate-200"
                style={{ color: "var(--theme-text)" }}
              >
                {doc.title}
              </h2>
              <div
                className="text-[9px] font-bold text-slate-400 uppercase tracking-tight"
                style={{ color: "var(--theme-text-muted)" }}
              >
                {activeTab === "editor"
                  ? "Source Editor"
                  : activeTab === "output"
                    ? "Native Markov Output"
                    : "Linguistic Analysis"}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleLoad}
              className="p-2 hover:bg-white dark:hover:bg-slate-700 rounded-lg transition-all border border-transparent hover:border-slate-200 dark:hover:border-slate-600"
              title="Load saved work"
            >
              <Icon name="import" size="sm" className="text-slate-500" />
            </button>
            <button
              onClick={handleSave}
              className="p-2 hover:bg-white dark:hover:bg-slate-700 rounded-lg transition-all border border-transparent hover:border-slate-200 dark:hover:border-slate-600"
              title="Save locally"
            >
              <Icon name="copy" size="sm" className="text-slate-500" />
            </button>
          </div>
        </div>
      </div>

      <div className="p-1">
        <div
          className="flex gap-1 bg-slate-100/50 dark:bg-slate-900/30 p-1 rounded-xl m-2"
          style={{ backgroundColor: "var(--theme-bg)" }}
        >
          <button
            className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${
              activeTab === "editor"
                ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
            style={
              activeTab === "editor"
                ? {
                    backgroundColor: "var(--theme-surface)",
                    color: "var(--theme-primary)",
                  }
                : { color: "var(--theme-text-muted)" }
            }
            onClick={() => setActiveTab("editor")}
          >
            Input Source
          </button>
          <button
            className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${
              activeTab === "output"
                ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
            style={
              activeTab === "output"
                ? {
                    backgroundColor: "var(--theme-surface)",
                    color: "var(--theme-primary)",
                  }
                : { color: "var(--theme-text-muted)" }
            }
            onClick={() => setActiveTab("output")}
          >
            Markov Output
          </button>
          <button
            className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${
              activeTab === "analysis"
                ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
            style={
              activeTab === "analysis"
                ? {
                    backgroundColor: "var(--theme-surface)",
                    color: "var(--theme-primary)",
                  }
                : { color: "var(--theme-text-muted)" }
            }
            onClick={() => setActiveTab("analysis")}
          >
            Analysis View
          </button>
        </div>

        <div className="p-4">
          {activeTab === "editor" && (
            <div className="animate-in fade-in duration-300 relative">
              <div className="relative w-full h-80">
                {/* Highlight Layer - Optimized rendering with pre-calculated ranges */}
                <EditorHighlighter
                  content={doc.content}
                  highlights={highlights}
                />
                <textarea
                  value={doc.content}
                  onChange={(e) => {
                    handleContentChange(e.target.value);
                    if (highlights.length > 0) setHighlights([]);
                  }}
                  onSelect={handleSelection}
                  className="w-full h-full p-6 bg-transparent border-none text-lg leading-relaxed focus:outline-none focus:ring-0 resize-none font-serif placeholder:text-slate-300 dark:placeholder:text-slate-700 overflow-y-auto scrollbar-thin relative z-10"
                  style={{ color: "var(--theme-text)" }}
                  placeholder="Start typing your document for C++ linguistic processing..."
                  spellCheck="false"
                />
              </div>
              <div
                className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center"
                style={{ borderTopColor: "var(--theme-border)" }}
              >
                <div
                  className="flex items-center gap-4 text-[10px] font-bold text-slate-400 uppercase tracking-tighter"
                  style={{ color: "var(--theme-text-muted)" }}
                >
                  <div className="flex gap-4 items-center">
                    <span>{stats.wordCount} WORDS</span>
                    <span>{stats.charCount} CHARS</span>
                    {selectedText && (
                      <span
                        className="lowercase opacity-80 italic"
                        style={{ color: "var(--theme-primary)" }}
                      >
                        (
                        {
                          selectedText.trim().split(/\s+/).filter(Boolean)
                            .length
                        }{" "}
                        selected)
                      </span>
                    )}
                  </div>
                  {highlights.length > 0 ? (
                    <span
                      className="flex items-center gap-1 animate-pulse"
                      style={{ color: "var(--theme-danger)" }}
                    >
                      <Icon name="search" size="xs" />
                      {highlights.length} DUPLICATES FOUND
                    </span>
                  ) : (
                    <span
                      style={{ color: "var(--theme-text-muted)", opacity: 0.5 }}
                    >
                      0 DUPLICATES
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleClear}
                    className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-red-500 transition-colors"
                  >
                    Clear
                  </button>
                  <button
                    onClick={handleProcessText}
                    disabled={
                      isProcessing ||
                      (!doc.content.trim() && !selectedText.trim())
                    }
                    className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all shadow-lg active:scale-95 ${
                      isProcessing ||
                      (!doc.content.trim() && !selectedText.trim())
                        ? "bg-slate-100 dark:bg-slate-800 text-slate-400"
                        : "bg-indigo-600 text-white hover:bg-indigo-700"
                    }`}
                    style={
                      !isProcessing &&
                      (doc.content.trim() || selectedText.trim())
                        ? { backgroundColor: "var(--theme-primary)" }
                        : {}
                    }
                  >
                    Analyze Source
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "output" && (
            <div className="animate-in fade-in duration-300 relative">
              {isGenerating && (
                <div className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-indigo-500 text-white px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest animate-pulse shadow-lg">
                  <div className="w-1.5 h-1.5 bg-white rounded-full animate-ping" />
                  Streaming from C++
                </div>
              )}
              <div className="relative group overflow-hidden rounded-xl border border-transparent focus-within:border-indigo-500/30 transition-colors bg-slate-50/30 dark:bg-slate-900/30 shadow-inner h-80">
                <EditorHighlighter
                  content={outputContent || ""}
                  highlights={outputHighlights}
                  searchQuery={searchQuery}
                />
                <textarea
                  readOnly
                  id="markov-output-area"
                  value={outputContent || ""}
                  className="w-full h-full p-6 bg-transparent border-none text-lg leading-relaxed focus:outline-none focus:ring-0 resize-none font-serif placeholder:text-slate-300 dark:placeholder:text-slate-700 overflow-y-auto scrollbar-thin relative z-10"
                  style={{
                    color: "var(--theme-text)",
                    opacity: 1,
                  }}
                  onScroll={(e) => {
                    const target = e.target as HTMLTextAreaElement;
                    const highlighter = target.previousSibling as HTMLElement;
                    if (highlighter) {
                      highlighter.scrollTop = target.scrollTop;
                    }
                  }}
                  placeholder="Markov generation output will appear here..."
                />
              </div>
              <div
                className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center"
                style={{ borderTopColor: "var(--theme-border)" }}
              >
                <div
                  className="flex items-center gap-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest"
                  style={{ color: "var(--theme-text-muted)" }}
                >
                  <span>
                    {(outputContent || "").split(/\s+/).filter(Boolean).length}{" "}
                    GEN. WORDS
                  </span>
                  <button
                    onClick={async () => {
                      const text = outputContent || "";
                      if (!text.trim()) return;

                      // Clear and start
                      setOutputHighlights([]);
                      setOutputDuplicates(0);
                      setIsProcessing(true);

                      try {
                        const res = await nlpService.analyze({
                          seed: text,
                          model: "deduplication",
                          options: {
                            mode: "detect",
                            min_length: "1",
                            skip_words: "",
                            ignore_quotes: "true",
                            ignore_punctuation: "true",
                          },
                        });

                        // Use the standardized ProcessingResponse contract
                        const data = res;
                        const hits = Array.isArray(data.duplicates)
                          ? data.duplicates
                          : [];

                        // Reactive state update - trigger re-render for counter
                        // Strict numeric conversion for counter and highlights
                        const safeHits = Array.isArray(hits) ? hits : [];
                        setOutputDuplicates(safeHits.length);

                        setOutputHighlights(
                          safeHits.map((h: any) => {
                            const off = parseInt(String(h.offset), 10);
                            const len = parseInt(String(h.length), 10);
                            return {
                              offset: isNaN(off) ? 0 : off,
                              length: isNaN(len) ? 0 : len,
                            };
                          }),
                        );

                        if (onAnalysisResultsRef?.current) {
                          onAnalysisResultsRef.current(
                            JSON.stringify(data, null, 2),
                          );
                        }

                        // Switch tab to show results if we found hits and weren't already there
                        if (hits.length > 0 && activeTab !== "analysis") {
                          setActiveTab("analysis");
                        }
                      } catch (e) {
                        console.error("[Dedupe] Error:", e);
                      } finally {
                        setIsProcessing(false);
                      }
                    }}
                    className="flex items-center gap-1 transition-all active:scale-95 group/dupbtn"
                    style={{
                      color:
                        outputDuplicates > 0
                          ? "var(--theme-danger)"
                          : "var(--theme-text-muted)",
                      fontWeight: outputDuplicates > 0 ? "900" : "bold",
                    }}
                  >
                    <Icon name="search" size="xs" />
                    <span>{outputDuplicates} DUPS</span>
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setOutputContent("")}
                    className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-red-500 transition-colors"
                  >
                    Reset
                  </button>
                  <button
                    onClick={() => handleContentChange(outputContent)}
                    className="px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] bg-emerald-600 text-white hover:bg-emerald-700 transition-all shadow-lg active:scale-95"
                  >
                    Use as Input
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "analysis" && (
            <div className="animate-in slide-in-from-bottom-2 duration-300 space-y-4">
              <div className="flex justify-between items-center px-2">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"
                    style={{ backgroundColor: "var(--theme-primary)" }}
                  />
                  <span
                    className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400"
                    style={{ color: "var(--theme-text-muted)" }}
                  >
                    Engine Insight
                  </span>
                </div>
                <button
                  onClick={() => setResults("")}
                  className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-indigo-600 transition-colors"
                  style={{ color: "var(--theme-text-muted)" }}
                >
                  Clear Results
                </button>
              </div>
              <div
                className="bg-slate-50/50 dark:bg-slate-900/50 rounded-3xl p-6 min-h-[400px] overflow-hidden border border-slate-100 dark:border-slate-800 shadow-inner"
                style={{
                  backgroundColor: "var(--theme-bg)",
                  borderColor: "var(--theme-border)",
                }}
              >
                <AnalysisDashboard
                  results={results}
                  isProcessing={isProcessing}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DocumentPanel;
