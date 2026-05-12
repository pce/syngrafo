import React from "react";
import { useLingui } from "@lingui/react";
import { useDms } from "../../store/dms-store";
import type { SearchResult } from "@/services/dms-service.ts";
import { Icon } from "../Icon";
import { pathKind, resultScoreLabel, splitAtMatch } from "./search-utils";

function SnippetText({ text, query }: { text: string; query: string }) {
  if (!text) return null;
  const parts = splitAtMatch(text, query);
  if (!parts) return <>{text}</>;
  return (
    <>
      {parts.before}
      <mark className="bg-[var(--theme-primary)]/25 text-[var(--theme-primary)] font-semibold not-italic rounded-sm px-0.5">
        {parts.hit}
      </mark>
      {parts.after}
    </>
  );
}

const SearchResults: React.FC = () => {
  const { state, dispatch } = useDms();
  const { _ } = useLingui();

  if (!state.searching && state.searchResults.length === 0 && !state.searchQuery) {
    return null;
  }

  const handleClose = () => {
    dispatch({ type: "SET_SEARCH_QUERY",   query:    ""    });
    dispatch({ type: "SET_SEARCH_RESULTS", results:  []    });
    dispatch({ type: "SET_SEARCHING",      searching: false });
  };

  const handleSelect = (result: SearchResult) => {
    const kind = pathKind(result.path, state.zone ?? null);

    if (kind === "notes" && state.zone) {
      // Navigate left panel to NotesView; SELECT_FILE carries the target note
      // so NotesView can auto-select it after loading.
      dispatch({ type: "SET_PATH",    path: state.zone.out_path + "/.notes" });
      dispatch({ type: "SELECT_FILE", path: result.path });
      handleClose();
      return;
    }
    if (kind === "kanban" && state.zone) {
      dispatch({ type: "SET_PATH",    path: state.zone.out_path + "/.kanban" });
      dispatch({ type: "SELECT_FILE", path: result.path });
      handleClose();
      return;
    }

    // Regular file: navigate file browser to parent dir and select the file
    const parentDir = result.path.substring(0, result.path.lastIndexOf("/"));
    if (parentDir) dispatch({ type: "SET_PATH", path: parentDir });
    dispatch({ type: "SELECT_FILE", path: result.path });
    handleClose();
  };

  const scopeLabel = state.zone ? `Zone · ${state.zone.name}` : "Global Index";

  return (
    <div className="absolute top-20 left-1/2 -translate-x-1/2 w-full max-w-2xl bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-2xl shadow-2xl z-50 flex flex-col max-h-[70vh] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--theme-border)] bg-[var(--theme-bg)]/50">
        <div className="flex items-center gap-2">
          <Icon name="search" size="xs" className="text-[var(--theme-text-muted)]" />
          <span className="text-xs font-bold uppercase tracking-widest text-[var(--theme-text-muted)]">
            Results for "{state.searchQuery}"
          </span>
          <span className="px-1.5 py-0.5 rounded-full bg-[var(--theme-primary)]/10 text-[var(--theme-primary)] text-[10px] font-bold">
            {state.searching ? "…" : state.searchResults.length}
          </span>
          <span
            className={`hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${
              state.zone
                ? "bg-[var(--theme-primary)]/10 border-[var(--theme-primary)]/30 text-[var(--theme-primary)]"
                : "bg-[var(--theme-border)]/50 border-[var(--theme-border)] text-[var(--theme-text-muted)]"
            }`}
            title={state.zone ? `Searched in zone: ${state.zone.name}` : "Searched global user index"}
          >
            {scopeLabel}
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
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)]">{_("Searching Index…")}</span>
          </div>
        ) : state.searchResults.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-[var(--theme-text-muted)]">
            <Icon name="block" size="lg" className="opacity-20" />
            <p className="text-sm font-medium">{_("No matches found")}</p>
            <p className="text-xs">{_("Try a simpler keyword or check your index status.")}</p>
          </div>
        ) : (
          <div className="space-y-1">
            {state.searchResults.map((result, i) => {
              const kind     = pathKind(result.path, state.zone ?? null);
              const isActive = state.selectedPath === result.path;
              const kindIcon = kind === "notes" ? "edit" : kind === "kanban" ? "columns" : (
                result.path.toLowerCase().endsWith(".pdf") ? "document"
                  : result.mimeType.startsWith("image/") ? "image" : "file"
              );
              // "exact" only for verified keyword filename matches; everything else shows %.
              const scoreLabel = resultScoreLabel(result.match, result.score);

              return (
                <button
                  key={i}
                  onClick={() => handleSelect(result)}
                  className={`
                    w-full flex flex-col gap-1 p-3 rounded-xl text-left transition-all group
                    ${isActive
                      ? "bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] shadow-md"
                      : "hover:bg-[var(--theme-bg)] text-[var(--theme-text)] border border-transparent hover:border-[var(--theme-border)]"}
                  `}
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2">
                      <Icon
                        name={kindIcon}
                        size="xs"
                        className={isActive ? "text-current" : "text-[var(--theme-primary)]"}
                      />
                      <span className="text-sm font-bold truncate max-w-xs">{result.filename}</span>
                      {kind !== "file" && (
                        <span className={`text-[9px] font-black uppercase tracking-widest px-1 rounded ${
                          isActive ? "bg-white/15" : "bg-[var(--theme-primary)]/10 text-[var(--theme-primary)]"
                        }`}>
                          {kind}
                        </span>
                      )}
                    </div>
                    <span className={`text-[9px] font-mono tabular-nums px-1.5 py-0.5 rounded ${
                      isActive
                        ? "text-white/40"
                        : "text-[var(--theme-text-muted)]/50"
                    }`}>
                      {scoreLabel}
                    </span>
                  </div>

                  {result.snippet && (
                    <p className={`text-xs line-clamp-2 italic opacity-80 ${
                      isActive ? "text-current" : "text-[var(--theme-text-muted)]"
                    }`}>
                      &ldquo;
                      <SnippetText text={result.snippet} query={state.searchQuery} />
                      &rdquo;
                    </p>
                  )}

                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {result.keywords.slice(0, 3).map((kw, ki) => (
                      <span
                        key={ki}
                        className={`text-[9px] uppercase tracking-tighter font-bold px-1 rounded ${
                          isActive ? "bg-white/10" : "bg-[var(--theme-bg)]/50 text-[var(--theme-text-muted)]"
                        }`}
                      >
                        #{kw.term}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchResults;
