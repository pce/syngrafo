import React from "react";
import { useDms } from "../../store/dms-store";
import Icon from "../Icon";

const SearchResults: React.FC = () => {
  const { state, dispatch } = useDms();

  if (!state.searching && state.searchResults.length === 0 && !state.searchQuery) {
    return null;
  }

  const handleClose = () => {
    dispatch({ type: "SET_SEARCH_QUERY", query: "" });
    dispatch({ type: "SET_SEARCH_RESULTS", results: [] });
  };

  const handleSelect = (path: string) => {
    dispatch({ type: "SELECT_FILE", path });
    // Keep results open or close? User might want to click multiple.
    // Let's keep them for now but allow closing.
  };

  return (
    <div className="absolute top-20 left-1/2 -translate-x-1/2 w-full max-w-2xl bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-2xl shadow-2xl z-50 flex flex-col max-h-[70vh] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--theme-border)] bg-[var(--theme-bg)]/50">
        <div className="flex items-center gap-2">
          <Icon name="search" size="xs" className="text-[var(--theme-text-muted)]" />
          <span className="text-xs font-bold uppercase tracking-widest text-[var(--theme-text-muted)]">
            Search Results for "{state.searchQuery}"
          </span>
          <span className="px-1.5 py-0.5 rounded-full bg-[var(--theme-primary)]/10 text-[var(--theme-primary)] text-[10px] font-bold">
            {state.searchResults.length}
          </span>
        </div>
        <button
          onClick={handleClose}
          className="p-1 rounded-lg hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)] transition-colors"
        >
          <Icon name="close" size="xs" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
        {state.searching ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <span className="w-6 h-6 border-2 border-[var(--theme-primary)]/20 border-t-[var(--theme-primary)] rounded-full animate-spin" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)]">Searching Index…</span>
          </div>
        ) : state.searchResults.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-[var(--theme-text-muted)]">
            <Icon name="block" size="lg" className="opacity-20" />
            <p className="text-sm font-medium">No matches found</p>
            <p className="text-xs">Try a simpler keyword or check your index status.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {state.searchResults.map((result, i) => (
              <button
                key={i}
                onClick={() => handleSelect(result.path)}
                className={`
                  w-full flex flex-col gap-1 p-3 rounded-xl text-left transition-all group
                  ${state.selectedPath === result.path 
                    ? "bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] shadow-md" 
                    : "hover:bg-[var(--theme-bg)] text-[var(--theme-text)] border border-transparent hover:border-[var(--theme-border)]"}
                `}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <Icon
                      name={result.path.toLowerCase().endsWith(".pdf") ? "document" : result.mimeType.startsWith("image/") ? "image" : "file"}
                      size="xs"
                      className={state.selectedPath === result.path ? "text-current" : "text-[var(--theme-primary)]"}
                    />
                    <span className="text-sm font-bold truncate max-w-md">{result.filename}</span>
                  </div>
                  <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                    state.selectedPath === result.path ? "bg-white/20" : "bg-[var(--theme-bg)] text-[var(--theme-text-muted)]"
                  }`}>
                    {Math.round(result.score * 100)}%
                  </span>
                </div>

                {result.snippet && (
                  <p className={`text-xs line-clamp-2 italic opacity-80 ${
                    state.selectedPath === result.path ? "text-current" : "text-[var(--theme-text-muted)]"
                  }`}>
                    &ldquo;...{result.snippet}...&rdquo;
                  </p>
                )}

                <div className="flex flex-wrap gap-1 mt-1">
                  {result.keywords.slice(0, 3).map((kw, ki) => (
                    <span
                      key={ki}
                      className={`text-[9px] uppercase tracking-tighter font-bold px-1 rounded ${
                        state.selectedPath === result.path ? "bg-white/10" : "bg-[var(--theme-bg)]/50 text-[var(--theme-text-muted)]"
                      }`}
                    >
                      #{kw.term}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchResults;

