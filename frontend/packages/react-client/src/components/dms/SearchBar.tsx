import React, { useState, useRef, useMemo } from "react";
import { useDms } from "../../store/dms-store";
import { dms } from "../../services/dms-service";
import Icon from "../Icon";

const SearchBar: React.FC = () => {
  const { state, dispatch } = useDms();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Derive contextual tags from top keywords of selected doc, or general trends
  const topKeywords = useMemo(() => {
    return state.metadata?.keywords?.slice(0, 5) || [];
  }, [state.metadata]);

  const search = async (q: string) => {
    if (!q.trim()) return;
    dispatch({ type: "SET_SEARCHING", searching: true });
    dispatch({ type: "SET_SEARCH_QUERY", q }); // Fixed: using q from param

    const res = await dms.search(q.trim(), 10);
    dispatch({ type: "SET_SEARCH_RESULTS", results: res.ok && res.data ? res.data.results : [] });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") search(query);
    if (e.key === "Escape") { setQuery(""); }
  };

  return (
    <div className="flex flex-col items-center w-full max-w-xl mx-auto py-4">
      <div className="relative w-full group">
        <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
          <Icon name="search" size="sm" className="text-[var(--theme-text-muted)] group-focus-within:text-[var(--theme-primary)] transition-colors" />
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder="Search documents, entities, or labels..."
          className="w-full pl-12 pr-12 py-3 rounded-2xl bg-[var(--theme-surface)] border border-[var(--theme-border)] text-sm text-[var(--theme-text)] placeholder-[var(--theme-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]/30 focus:border-[var(--theme-primary)]/30 transition-all shadow-xl"
        />
        <div className="absolute inset-y-0 right-4 flex items-center">
          <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[10px] font-medium text-[var(--theme-text-muted)] shadow-sm">
            <span className="text-xs">⌘</span>K
          </kbd>
        </div>
      </div>

      {/* Context-aware tags line */}
      <div className="mt-3 flex items-center justify-center gap-4 h-5">
        {topKeywords.length > 0 ? (
          topKeywords.map((kw, i) => (
            <button
              key={i}
              onClick={() => {
                setQuery(kw.term);
                search(kw.term);
              }}
              className="text-[10px] uppercase tracking-widest font-bold text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)] transition-colors"
            >
              #{kw.term}
            </button>
          ))
        ) : (
          <span className="text-[10px] uppercase tracking-widest font-bold text-[var(--theme-text-muted)]/50 select-none">
            {state.selectedPath ? "Analyzing Context..." : "Global Index Ready"}
          </span>
        )}
      </div>
    </div>
  );
};

export default SearchBar;
