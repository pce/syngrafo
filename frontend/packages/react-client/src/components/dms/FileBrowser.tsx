import React, { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { useDms } from "../../store/dms-store";
import {
  dms, isImageFile, isTextFile, isSupportedFile, isDocFile,
  isSvgFile, isAudioFile, isArchiveFile, isCssFile, fileKind,
} from "../../services/dms-service";
import type { FsEntry } from "../../services/dms-service";
import Icon from "../Icon";
import { ImportModal } from "./ImportModal";

type SortBy  = "name" | "size" | "modified" | "kind";
type SortDir = "asc"  | "desc";
type ViewMode = "list" | "details" | "grid";

// ── PathBreadcrumb ─────────────────────────────────────────────────────────────
//
// Renders the current path as interactive breadcrumb segments.
// • Click a segment  → navigate to that path
// • Click a chevron  → open a popup listing sub-directories at that path level
//   so you can jump sideways without going all the way up first.

interface BreadcrumbSegment {
  label: string;  // display name
  path:  string;  // absolute path up to this segment
}

interface ChevronMenuProps {
  atPath:   string;                // directory whose children we list
  onSelect: (path: string) => void;
  onClose:  () => void;
  anchor:   { x: number; y: number };
}

const ChevronMenu: React.FC<ChevronMenuProps> = ({ atPath, onSelect, onClose, anchor }) => {
  const [dirs, setDirs]     = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await dms.scanDir(atPath);
      if (!cancelled) {
        setDirs(
          (res.ok && res.data
            ? res.data.entries.filter(e => e.kind === "dir").map(e => e.path)
            : [])
        );
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [atPath]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const getName = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

  return (
    <div
      ref={menuRef}
      style={{ position: "fixed", top: anchor.y, left: anchor.x, zIndex: 9999 }}
      className="min-w-[180px] max-w-[280px] max-h-[260px] overflow-y-auto rounded-xl shadow-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] py-1 text-sm"
    >
      {loading && (
        <div className="px-3 py-2 text-[var(--theme-text-muted)] text-xs italic">Loading…</div>
      )}
      {!loading && dirs.length === 0 && (
        <div className="px-3 py-2 text-[var(--theme-text-muted)] text-xs italic">No sub-folders</div>
      )}
      {dirs.map(d => (
        <button
          key={d}
          onMouseDown={(e) => { e.preventDefault(); onSelect(d); onClose(); }}
          className="w-full text-left flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--theme-bg)] transition-colors text-[var(--theme-text)] truncate"
        >
          <Icon name="folder" size="xs" className="text-amber-500/70 shrink-0" />
          <span className="truncate text-xs font-medium">{getName(d)}</span>
        </button>
      ))}
    </div>
  );
};

interface PathBreadcrumbProps {
  path:     string;
  navigate: (path: string) => void;
}

const PathBreadcrumb: React.FC<PathBreadcrumbProps> = ({ path, navigate }) => {
  const [openChevron, setOpenChevron] = useState<{ segPath: string; anchor: { x: number; y: number } } | null>(null);

  const segments = useMemo<BreadcrumbSegment[]>(() => {
    if (!path) return [];
    const parts = path.split("/").filter(Boolean);
    return parts.map((label, i) => ({
      label,
      path: "/" + parts.slice(0, i + 1).join("/"),
    }));
  }, [path]);

  const openMenu = (e: React.MouseEvent<HTMLButtonElement>, segPath: string) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setOpenChevron({ segPath, anchor: { x: rect.left, y: rect.bottom + 4 } });
  };

  if (!path) {
    return <span className="text-[10px] text-[var(--theme-text-muted)] font-mono italic flex-1 ml-0.5">No folder selected</span>;
  }

  return (
    <div className="flex items-center min-w-0 flex-1 overflow-hidden">
      {/* Root slash */}
      <button
        onClick={() => navigate("/")}
        className="shrink-0 text-[10px] font-mono text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)] px-0.5 transition-colors"
        title="/"
      >/</button>

      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        // Only show the last 3 segments to avoid overflow; show ellipsis for hidden ones
        const visible = segments.length <= 3 || i >= segments.length - 3;
        const showEllipsis = i === segments.length - 4 && segments.length > 3;
        if (!visible && !showEllipsis) return null;
        if (showEllipsis) {
          return (
            <span key="ellipsis" className="text-[10px] font-mono text-[var(--theme-text-muted)] px-0.5 shrink-0">…/</span>
          );
        }
        return (
          <React.Fragment key={seg.path}>
            <button
              onClick={() => navigate(seg.path)}
              title={seg.path}
              className={`shrink-0 text-[10px] font-mono transition-colors truncate max-w-[90px] ${
                isLast
                  ? "text-[var(--theme-text)] font-semibold hover:text-[var(--theme-primary)]"
                  : "text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)]"
              }`}
            >
              {seg.label}
            </button>
            {/* Chevron — opens sub-folder picker for this segment's directory */}
            <button
              onClick={(e) => openMenu(e, seg.path)}
              title={`Browse inside ${seg.label}`}
              className="shrink-0 p-0.5 rounded hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)] transition-colors"
            >
              <Icon name="chevron-right" size="xs" />
            </button>
          </React.Fragment>
        );
      })}

      {openChevron && (
        <ChevronMenu
          atPath={openChevron.segPath}
          onSelect={navigate}
          onClose={() => setOpenChevron(null)}
          anchor={openChevron.anchor}
        />
      )}
    </div>
  );
};

const ImportSelectBox: React.FC = () => {
    const { state, dispatch } = useDms();
    const [isImporting, setIsImporting]       = useState(false);
    const [isDragOver,  setIsDragOver]        = useState(false);
    const [queue,       setQueue]             = useState<string[]>([]);
    const [currentFile, setCurrentFile]       = useState<string | null>(null);
    const dragCounterRef = useRef(0);

    // When queue has items and no modal is open, pop the next one.
    useEffect(() => {
        if (!currentFile && queue.length > 0) {
            setCurrentFile(queue[0]);
            setQueue(q => q.slice(1));
        }
    }, [currentFile, queue]);

    const openPicker = async () => {
        if (isImporting || !state.zone) return;
        setIsImporting(true);

        // Refresh zones list before opening modal.
        const zres = await dms.getZones();
        if (zres.ok && zres.data) dispatch({ type: "SET_ZONES", zones: zres.data });

        const res = await dms.selectFiles();
        setIsImporting(false);

        if (!res.ok || !res.data || res.data.paths.length === 0) return;
        // Enqueue all selected files.
        setQueue(res.data.paths);
    };

    const handleSuccess = async () => {
        if (state.currentPath) {
            const res = await dms.scanDir(state.currentPath);
            if (res.ok && res.data)
                dispatch({ type: "SET_ENTRIES", entries: res.data.entries });
        }
    };

    if (!state.zone) return null;

    return (
        <>
            <div className="flex flex-col gap-2 p-3 bg-[var(--theme-bg)] border-t border-[var(--theme-border)]">
                <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)]">Import to Zone</span>
                </div>

                {/* Drop zone — click OR drag to import */}
                <div
                    role="button"
                    tabIndex={0}
                    onClick={openPicker}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") openPicker(); }}
                    onDragEnter={e => { e.preventDefault(); dragCounterRef.current++; setIsDragOver(true); }}
                    onDragOver={e => { e.preventDefault(); }}
                    onDragLeave={() => { dragCounterRef.current--; if (dragCounterRef.current === 0) setIsDragOver(false); }}
                    onDrop={e => {
                        e.preventDefault();
                        dragCounterRef.current = 0;
                        setIsDragOver(false);
                        // WKWebView File API doesn't expose full paths — open native picker instead.
                        void openPicker();
                    }}
                    className={`
                        flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed rounded-xl
                        transition-all cursor-pointer select-none outline-none
                        focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]
                        ${isImporting
                            ? "border-[var(--theme-primary)] bg-[var(--theme-primary)]/5 cursor-not-allowed"
                            : isDragOver
                                ? "border-[var(--theme-primary)] bg-[var(--theme-primary)]/10 scale-[1.01]"
                                : "border-[var(--theme-border)] hover:border-[var(--theme-primary)]/50 hover:bg-[var(--theme-surface)]"}
                    `}
                >
                    {isImporting ? (
                        <>
                            <div className="w-4 h-4 border-2 border-[var(--theme-primary)] border-t-transparent rounded-full animate-spin" />
                            <span className="text-xs font-bold text-[var(--theme-primary)] uppercase tracking-wide">Importing…</span>
                        </>
                    ) : isDragOver ? (
                        <>
                            <Icon name="download" size="xs" className="text-[var(--theme-primary)]" />
                            <span className="text-xs font-bold text-[var(--theme-primary)] uppercase tracking-wide">Drop to choose…</span>
                        </>
                    ) : (
                        <>
                            <Icon name="plus" size="xs" className="text-[var(--theme-text-muted)]" />
                            <span className="text-xs font-bold text-[var(--theme-text-muted)] uppercase tracking-wide">Click or Drop to Import</span>
                        </>
                    )}
                </div>
            </div>

            {currentFile && (
                <ImportModal
                    filePath={currentFile}
                    onClose={() => setCurrentFile(null)}
                    onSuccess={handleSuccess}
                />
            )}
        </>
    );
};

function FileIcon({ entry }: { entry: FsEntry }) {
  if (entry.kind === "dir")        return <Icon name="folder"   size="xs" className="text-amber-500/70" />;
  if (isSvgFile(entry.path))       return <Icon name="image"    size="xs" className="text-violet-400/70" />;
  if (isImageFile(entry.path))     return <Icon name="image"    size="xs" className="text-indigo-400/70" />;
  if (isDocFile(entry.path))       return <Icon name="document" size="xs" className="text-rose-400/70" />;
  if (isAudioFile(entry.path))     return <Icon name="music"    size="xs" className="text-emerald-400/70" />;
  if (isArchiveFile(entry.path))   return <Icon name="document" size="xs" className="text-amber-400/70" />;
  if (isCssFile(entry.path))       return <Icon name="file"     size="xs" className="text-sky-400/70" />;
  if (isTextFile(entry.path))      return <Icon name="file"     size="xs" className="text-[var(--theme-text-muted)] opacity-70" />;
  return <Icon name="file" size="xs" className="text-[var(--theme-text-muted)] opacity-50" />;
}

function fmtSize(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── LazyImage ────────────────────────────────────────────────────────────────
// Renders a placeholder until the element scrolls into the viewport, then
// swaps in the real <img> src.  Uses IntersectionObserver so images that are
// off-screen never trigger a network request.

interface LazyImageProps {
  src: string;
  alt: string;
  className?: string;
}

const LazyImage: React.FC<LazyImageProps> = ({ src, alt, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Once we've entered the viewport we never need to observe again.
    if (inView) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      // Start loading slightly before the tile actually enters view so the
      // image is ready by the time the user sees it.
      { rootMargin: "200px 0px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [inView]);

  return (
    <div ref={containerRef} className={`w-full h-full flex items-center justify-center ${className ?? ""}`}>
      {inView ? (
        <img
          src={src}
          alt={alt}
          className="w-full h-full object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        /* Skeleton shown while tile is off-screen */
        <div className="w-full h-full bg-[var(--theme-border)]/40 animate-pulse" />
      )}
    </div>
  );
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface FileBrowserProps {
  /** called whenever multi-selection changes (file paths only) */
  onSelectionChange?: (paths: string[]) => void;
  /** called when this panel is focused (click / keyboard) */
  onFocus?: () => void;
  /** called whenever the current path changes */
  onPathChange?: (path: string) => void;
}

// ── FileBrowser ───────────────────────────────────────────────────────────────

const FileBrowser: React.FC<FileBrowserProps> = ({
  onSelectionChange,
  onFocus,
  onPathChange,
}) => {
  const { state, dispatch } = useDms();

  // Multi-select state (independent from the store's single selectedPath)
  const [selection, setSelection]     = useState<Set<string>>(new Set());
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const lastClickRef                  = useRef<string | null>(null);
  const listRef                       = useRef<HTMLUListElement>(null);

  // Sorting + view mode
  const [sortBy,   setSortBy]   = useState<SortBy>("name");
  const [sortDir,  setSortDir]  = useState<SortDir>("asc");
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // ── Stable refs for prop callbacks ────────────────────────────────────────
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onPathChangeRef      = useRef(onPathChange);
  const onFocusRef           = useRef(onFocus);
  useEffect(() => { onSelectionChangeRef.current = onSelectionChange; }, [onSelectionChange]);
  useEffect(() => { onPathChangeRef.current      = onPathChange;      }, [onPathChange]);
  useEffect(() => { onFocusRef.current           = onFocus;           }, [onFocus]);

  // navigate depends only on dispatch (permanently stable)
  const navigate = useCallback(async (path: string) => {
    dispatch({ type: "SET_PATH", path });
    onPathChangeRef.current?.(path);
    setSelection(new Set());
    lastClickRef.current = null;
    onSelectionChangeRef.current?.([]);
    const res = await dms.scanDir(path);
    if (res.ok && res.data) {
      dispatch({ type: "SET_ENTRIES", entries: res.data.entries });
      setFocusedPath(res.data.entries[0]?.path ?? null);
    } else {
      dispatch({ type: "SET_ERROR", error: res.error ?? "Failed to list directory" });
    }
  }, [dispatch]);

  // ── Sort entries ──────────────────────────────────────────────────────────
  const sortedEntries = useMemo(() => {
    const kindOrder = (e: FsEntry) => {
      if (e.kind === "dir")      return 0;
      const k = fileKind(e.path);
      if (k === "image" || k === "vector") return 1;
      if (k === "document")      return 2;
      if (k === "audio")         return 3;
      if (k === "code" || k === "style" || k === "markup" || k === "data" || k === "text") return 4;
      if (k === "archive")       return 5;
      return 6;
    };

    return [...state.entries].sort((a, b) => {
      // Dirs always first regardless of sort key
      if (a.kind === "dir" && b.kind !== "dir") return -1;
      if (b.kind === "dir" && a.kind !== "dir") return 1;

      let cmp = 0;
      switch (sortBy) {
        case "name":     cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" }); break;
        case "size":     cmp = (a.size ?? 0) - (b.size ?? 0); break;
        case "modified": cmp = (a.modified ?? 0) - (b.modified ?? 0); break;
        case "kind":     cmp = kindOrder(a) - kindOrder(b); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [state.entries, sortBy, sortDir]);

  const toggleSort = (key: SortBy) => {
    if (sortBy === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(key); setSortDir("asc"); }
  };

  const sortIcon = (key: SortBy) =>
    sortBy !== key ? null : sortDir === "asc" ? " ↑" : " ↓";

  const selectFile = useCallback((path: string, e?: React.MouseEvent) => {
    if (e && (e.metaKey || e.ctrlKey)) {
      const next = new Set(selection);
      if (next.has(path)) next.delete(path); else next.add(path);
      setSelection(next);
      onSelectionChangeRef.current?.(Array.from(next));
      setFocusedPath(path);
    } else if (e && e.shiftKey && lastClickRef.current) {
      const files = state.entries.filter(en => en.kind !== "dir").map(en => en.path);
      const from = files.indexOf(lastClickRef.current!);
      const to = files.indexOf(path);
      if (from >= 0 && to >= 0) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        const next = new Set(selection);
        for (let i = lo; i <= hi; i++) { const p = files[i]; if (p) next.add(p); }
        setSelection(next);
        onSelectionChangeRef.current?.(Array.from(next));
      }
    } else {
      setSelection(new Set([path]));
      onSelectionChangeRef.current?.([path]);
      dispatch({ type: "SELECT_FILE", path });
    }
    setFocusedPath(path);
    lastClickRef.current = path;
  }, [dispatch, selection, state.entries]);

  const bulkIndex = useCallback(async () => {
    if (!state.currentPath) return;
    dispatch({ type: "SET_INDEXING", indexing: true });
    const res = await dms.bulkIndex(state.currentPath);
    if (!res.ok) dispatch({ type: "SET_ERROR", error: res.error ?? "Index failed" });
  }, [state.currentPath, dispatch]);

  const goUp = useCallback(() => {
    const clean = state.currentPath.replace(/\/$/, "");
    if (!clean || clean === "/") return;
    const parts = clean.split("/");
    parts.pop();
    navigate(parts.join("/") || "/");
  }, [state.currentPath, navigate]);

  const selectInboxFolder = useCallback(async () => {
    const res = await dms.selectDirectory();
    if (res.ok && res.data) navigate(res.data);
  }, [navigate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const entries = sortedEntries;
    const idx = entries.findIndex(en => en.path === focusedPath);
    switch (e.key) {
      case "ArrowDown": { e.preventDefault(); const n = Math.min(idx + 1, entries.length - 1); if (entries[n]) setFocusedPath(entries[n].path); break; }
      case "ArrowUp":   { e.preventDefault(); const n = Math.max(idx - 1, 0);                  if (entries[n]) setFocusedPath(entries[n].path); break; }
      case "Enter": {
        const entry = entries[idx];
        if (!entry) break;
        if (entry.kind === "dir") navigate(entry.path);
        else if (isSupportedFile(entry.path)) selectFile(entry.path);
        break;
      }
      case "Backspace": e.preventDefault(); goUp(); break;
      case " ": {
        e.preventDefault();
        const entry = entries[idx];
        if (!entry || entry.kind === "dir") break;
        const next = new Set(selection);
        if (next.has(entry.path)) next.delete(entry.path); else next.add(entry.path);
        setSelection(next); onSelectionChangeRef.current?.(Array.from(next));
        break;
      }
      case "a": if (e.metaKey || e.ctrlKey) { e.preventDefault(); const all = entries.filter(e => e.kind !== "dir").map(e => e.path); setSelection(new Set(all)); onSelectionChangeRef.current?.(all); } break;
      case "Escape": setSelection(new Set()); onSelectionChangeRef.current?.([]); break;
    }
  }, [sortedEntries, focusedPath, selection, navigate, goUp, selectFile]);

  useEffect(() => {
    if (!focusedPath || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-path="${focusedPath.replace(/[.$*+?^{}()|[\]\\]/g, "\\$&")}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [focusedPath]);

  useEffect(() => {
    if (state.currentPath) navigate(state.currentPath);
  }, [state.currentPath, navigate]);

  const isAtRoot = !state.currentPath || state.currentPath === "/";

  const browsingSource = state.zone
    ? (state.currentPath === state.zone.in_path  || state.currentPath.startsWith(state.zone.in_path + "/"))
    : true;
  const browsingWorkspace = state.zone
    ? (state.currentPath === state.zone.out_path || state.currentPath.startsWith(state.zone.out_path + "/"))
    : false;

  const goToSource    = () => { if (state.zone) navigate(state.zone.in_path); };
  const goToWorkspace = async () => { if (state.zone) navigate(state.zone.out_path); };

  const goToNotes = async () => {
    if (!state.zone) return;
    const notesDir = state.zone.out_path + "/.notes";
    await dms.createDir(notesDir);
    navigate(notesDir);
  };

  const goToKanban = async () => {
    if (!state.zone) return;
    const kanbanDir = state.zone.out_path + "/.kanban";
    await dms.createDir(kanbanDir);
    navigate(kanbanDir);
  };

  const browsingNotes = state.zone
    ? (state.currentPath === state.zone.out_path + "/.notes" || state.currentPath.startsWith(state.zone.out_path + "/.notes/"))
    : false;
  const browsingKanban = state.zone
    ? (state.currentPath === state.zone.out_path + "/.kanban" || state.currentPath.startsWith(state.zone.out_path + "/.kanban/"))
    : false;

  // ── Shared row renderer helpers ────────────────────────────────────────────
  const fmtDate = (ms?: number) => {
    if (!ms) return "";
    const d = new Date(ms);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
  };

  return (
    <div className="flex flex-col h-full bg-[var(--theme-surface)]">
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-0 border-b border-[var(--theme-border)] bg-[var(--theme-surface)] shrink-0">

        {/* Source / Workspace toggle */}
        {state.zone && (
          <div className="flex items-center gap-0.5 px-2 pt-1.5 pb-1">
            <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-black/5 dark:bg-white/5 border border-[var(--theme-border)] flex-1">
              <button onClick={goToSource} title={`Source: ${state.zone.in_path}`}
                className={`flex-1 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded transition-all ${browsingSource ? "bg-[var(--theme-surface)] shadow-sm text-emerald-500" : "text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"}`}>
                Source
              </button>
              <button onClick={goToWorkspace} title={`Workspace: ${state.zone.out_path}`}
                className={`flex-1 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded transition-all ${browsingWorkspace ? "bg-[var(--theme-surface)] shadow-sm text-blue-500" : "text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"}`}>
                Workspace
              </button>
            </div>
          </div>
        )}

        {/* Notes + Kanban quick-access */}
        {state.zone && (
          <div className="flex items-center gap-0.5 px-2 pb-1">
            <button
              onClick={goToNotes}
              title="Open zone notes (.notes/)"
              className={`flex items-center justify-center gap-1 flex-1 py-0.5 px-1.5 text-[10px] font-bold uppercase tracking-wider rounded transition-all border ${
                browsingNotes
                  ? "bg-violet-500/10 border-violet-500/30 text-violet-500"
                  : "border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-bg)]"
              }`}
            >
              <Icon name="edit" size="xs" />
              <span>Notes</span>
            </button>
            <button
              onClick={goToKanban}
              title="Open zone kanban (.kanban/)"
              className={`flex items-center justify-center gap-1 flex-1 py-0.5 px-1.5 text-[10px] font-bold uppercase tracking-wider rounded transition-all border ${
                browsingKanban
                  ? "bg-sky-500/10 border-sky-500/30 text-sky-500"
                  : "border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-bg)]"
              }`}
            >
              <Icon name="rows" size="xs" />
              <span>Kanban</span>
            </button>
          </div>
        )}

        {/* Path bar + actions */}
        <div className="flex items-center gap-1 px-2 py-1.5">
          <button onClick={goUp} title="Up one level" disabled={isAtRoot}
            className="p-1.5 rounded hover:bg-[var(--theme-bg)] disabled:opacity-30 transition-colors text-[var(--theme-text-muted)]">
            <Icon name="chevron-up" size="xs" />
          </button>
          <PathBreadcrumb path={state.currentPath} navigate={navigate} />
          {!state.zone ? (
            <button onClick={selectInboxFolder}
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-[var(--theme-primary)] hover:opacity-90 text-white dark:text-[var(--theme-bg)] transition-colors shrink-0">
              Browse…
            </button>
          ) : (
            <button onClick={bulkIndex} disabled={state.indexing} title="Index all files in this folder"
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-[var(--theme-primary)] hover:opacity-90 disabled:opacity-40 text-white dark:text-[var(--theme-bg)] transition-colors shrink-0">
              {state.indexing ? "…" : "Index"}
            </button>
          )}
        </div>

        {/* Sort + View mode bar */}
        <div className="flex items-center gap-1 px-2 pb-1.5">
          {/* Sort buttons */}
          <div className="flex items-center gap-0.5 flex-1 overflow-x-auto">
            {(["name", "kind", "size", "modified"] as SortBy[]).map(k => (
              <button key={k} onClick={() => toggleSort(k)}
                className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded transition-colors whitespace-nowrap ${
                  sortBy === k
                    ? "bg-[var(--theme-primary)]/10 text-[var(--theme-primary)]"
                    : "text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-bg)]"
                }`}>
                {k}{sortIcon(k)}
              </button>
            ))}
          </div>
          {/* View mode icons */}
          <div className="flex items-center gap-0.5 shrink-0">
            {(["list","details","grid"] as ViewMode[]).map(m => (
              <button key={m} onClick={() => setViewMode(m)}
                title={m.charAt(0).toUpperCase() + m.slice(1) + " view"}
                className={`p-1 rounded transition-colors ${viewMode === m ? "text-[var(--theme-primary)] bg-[var(--theme-primary)]/10" : "text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-bg)]"}`}>
                <Icon name={m === "list" ? "file" : m === "details" ? "document" : "image"} size="xs" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Entry list / grid ────────────────────────────────────────────────── */}
      {viewMode === "grid" ? (
        /* Grid view */
        <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
          {sortedEntries.length === 0 && (
            <p className="px-4 py-8 text-center text-[var(--theme-text-muted)] text-sm italic">Empty folder</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            {sortedEntries.map((entry) => {
              const isSelected = entry.path === state.selectedPath || selection.has(entry.path);
              const clickable  = entry.kind === "dir" || isSupportedFile(entry.path);
              const isImg = isImageFile(entry.path);
              return (
                <div key={entry.path} data-path={entry.path}
                  onClick={(e) => { if (!clickable) return; entry.kind === "dir" ? navigate(entry.path) : selectFile(entry.path, e); }}
                  className={`relative flex flex-col rounded-lg overflow-hidden border cursor-pointer select-none transition-all ${
                    isSelected
                      ? "border-[var(--theme-primary)] ring-2 ring-[var(--theme-primary)]/30"
                      : "border-[var(--theme-border)] hover:border-[var(--theme-primary)]/40"
                  } ${!clickable ? "opacity-30 cursor-default" : ""}`}>
                  {/* Thumbnail */}
                  <div className="aspect-square bg-[var(--theme-bg)] flex items-center justify-center overflow-hidden">
                    {isImg ? (
                      <LazyImage
                        src={`local://local${entry.path.split("/").map(encodeURIComponent).join("/")}`}
                        alt={entry.name}
                      />
                    ) : (
                      <FileIcon entry={entry} />
                    )}
                  </div>
                  {/* Label */}
                  <div className={`px-1.5 py-1 ${isSelected ? "bg-[var(--theme-primary)]" : "bg-[var(--theme-surface)]"}`}>
                    <p className={`text-[10px] font-medium truncate ${isSelected ? "text-white dark:text-[var(--theme-bg)]" : "text-[var(--theme-text)]"}`}>
                      {entry.name}
                    </p>
                  </div>
                  {entry.indexed && (
                    <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-500 ring-1 ring-white/50" title="Indexed" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : viewMode === "details" ? (
        /* Details table view */
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {/* Header row */}
          <div className="flex items-center gap-2 px-3 py-1 border-b border-[var(--theme-border)] bg-[var(--theme-bg)]/50 sticky top-0">
            <span className="w-4 shrink-0" />
            <button onClick={() => toggleSort("name")} className="flex-1 text-left text-[9px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]">
              Name{sortIcon("name")}
            </button>
            <button onClick={() => toggleSort("kind")} className="w-10 shrink-0 text-[9px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] text-right">
              Type{sortIcon("kind")}
            </button>
            <button onClick={() => toggleSort("size")} className="w-14 shrink-0 text-[9px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] text-right">
              Size{sortIcon("size")}
            </button>
            <button onClick={() => toggleSort("modified")} className="w-16 shrink-0 text-[9px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] text-right">
              Date{sortIcon("modified")}
            </button>
          </div>
          <ul ref={listRef} className="py-0.5 outline-none" tabIndex={0} onKeyDown={handleKeyDown} onFocus={() => onFocusRef.current?.()} onClick={() => onFocusRef.current?.()}>
            {sortedEntries.length === 0 && <li className="px-4 py-8 text-center text-[var(--theme-text-muted)] text-sm italic">Empty folder</li>}
            {sortedEntries.map((entry) => {
              const isSelected = entry.path === state.selectedPath || selection.has(entry.path);
              const isFocused  = entry.path === focusedPath;
              const clickable  = entry.kind === "dir" || isSupportedFile(entry.path);
              const ext = entry.name.split(".").pop()?.toUpperCase().slice(0,4) ?? "";
              return (
                <li key={entry.path} data-path={entry.path}
                  onClick={(e) => { if (!clickable) return; entry.kind === "dir" ? navigate(entry.path) : selectFile(entry.path, e); }}
                  className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none text-sm ${
                    isSelected ? "bg-[var(--theme-primary)] text-white dark:text-[var(--theme-bg)]"
                    : isFocused ? "bg-[var(--theme-bg)] text-[var(--theme-text)]"
                    : "hover:bg-[var(--theme-bg)] text-[var(--theme-text)]"
                  } ${!clickable ? "opacity-30 cursor-default" : ""}`}>
                  <span className="shrink-0 flex items-center"><FileIcon entry={entry} /></span>
                  <span className="flex-1 truncate font-medium text-[11px]">{entry.name}</span>
                  <span className={`w-10 shrink-0 text-right font-mono text-[9px] ${isSelected ? "opacity-70" : "text-[var(--theme-text-muted)]"}`}>
                    {entry.kind === "dir" ? "—" : ext}
                  </span>
                  <span className={`w-14 shrink-0 text-right font-mono text-[9px] tabular-nums ${isSelected ? "opacity-70" : "text-[var(--theme-text-muted)]"}`}>
                    {entry.kind === "file" ? fmtSize(entry.size) : ""}
                  </span>
                  <span className={`w-16 shrink-0 text-right font-mono text-[9px] tabular-nums ${isSelected ? "opacity-70" : "text-[var(--theme-text-muted)]"}`}>
                    {fmtDate(entry.modified)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        /* List view (default) */
        <ul ref={listRef} className="flex-1 overflow-y-auto py-1 scrollbar-thin outline-none" tabIndex={0}
          onKeyDown={handleKeyDown} onFocus={() => onFocusRef.current?.()} onClick={() => onFocusRef.current?.()}>
          {sortedEntries.length === 0 && <li className="px-4 py-8 text-center text-[var(--theme-text-muted)] text-sm italic">Empty folder</li>}
          {sortedEntries.map((entry) => {
            const isSelected = entry.path === state.selectedPath || selection.has(entry.path);
            const isFocused  = entry.path === focusedPath;
            const clickable  = entry.kind === "dir" || isSupportedFile(entry.path);
            return (
              <li key={entry.path} data-path={entry.path}
                onClick={(e) => { if (!clickable) return; entry.kind === "dir" ? navigate(entry.path) : selectFile(entry.path, e); }}
                className={`flex items-center gap-3 px-3 py-2 cursor-pointer select-none text-sm group
                  ${isSelected ? "bg-[var(--theme-primary)] text-white dark:text-[var(--theme-bg)]" : isFocused ? "bg-[var(--theme-bg)] text-[var(--theme-text)]" : "hover:bg-[var(--theme-bg)] text-[var(--theme-text)]"}
                  ${isFocused && !isSelected ? "ring-1 ring-inset ring-[var(--theme-primary)]/25" : ""}
                  ${!clickable ? "opacity-30 cursor-default" : ""}`}>
                <span className="shrink-0 flex items-center justify-center"><FileIcon entry={entry} /></span>
                <span className="flex-1 truncate font-medium">{entry.name}</span>
                {entry.kind === "file" && (
                  <span className={`text-[10px] tabular-nums shrink-0 ${isSelected ? "opacity-70" : "text-[var(--theme-text-muted)]"}`}>
                    {fmtSize(entry.size)}
                  </span>
                )}
                {entry.indexed && (
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSelected ? "bg-white" : "bg-emerald-500"}`} title="Indexed" />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ImportSelectBox />

      {/* Status bar */}
      {state.indexStatus.total > 0 && (
        <div className="px-3 py-2 border-t border-[var(--theme-border)] text-[10px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)] shrink-0 bg-[var(--theme-bg)]/50">
          <span className="text-[var(--theme-text)]">{state.indexStatus.indexed}</span>
          <span className="mx-1">/</span>
          <span>{state.indexStatus.total} indexed</span>
          {state.indexStatus.errors > 0 && (
            <span className="text-[var(--theme-danger)] ml-auto float-right">{state.indexStatus.errors} errors</span>
          )}
        </div>
      )}
    </div>
  );
};


export default FileBrowser;
