import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon } from "./Icon.tsx";
import { LazyImage } from "./LazyImage.tsx";
import type { KeyboardScheme } from "@syngrafo/shared";

export type { KeyboardScheme } from "@syngrafo/shared";

export interface FileBrowserEntry {
  name: string;
  path: string;
  kind: "dir" | "file";
  size?: number;
  modified?: number;
  /** Highlight with a dot indicator (e.g. "indexed" in DMS). */
  indexed?: boolean;
}

export type FileBrowserViewMode = "list" | "details" | "grid";
export type FileBrowserSortBy = "name" | "size" | "modified" | "kind";

type SortDir = "asc" | "desc";

/** Props for the FileBrowser component. */
export interface FileBrowserProps {
  entries: FileBrowserEntry[];
  currentPath: string;
  loading?: boolean;
  error?: string | null;

  /** Navigate to a different directory (dirs clicked, up-button, breadcrumb). */
  onNavigate: (path: string) => void;
  /** A file was double-clicked or activated via Enter. */
  onFileOpen?: (path: string) => void;
  /** Multi-selection changed (file paths only). */
  onSelectionChange?: (paths: string[]) => void;
  /** Component received focus. */
  onFocus?: () => void;
  /**
   * Optional: list immediate subdirectories of `path`.
   * Used by the breadcrumb chevron menus. When omitted, chevrons are hidden.
   */
  onListSubdirs?: (path: string) => Promise<string[]>;

  /** Injected above the path bar (e.g. DMS Source/Workspace/Notes/Kanban tabs). */
  toolbarTop?: React.ReactNode;
  /** Injected to the right of the breadcrumb (e.g. a Browse… or Index button). */
  toolbarRight?: React.ReactNode;
  /** Injected below the file list (e.g. an indexing status bar). */
  statusBar?: React.ReactNode;

  defaultViewMode?: FileBrowserViewMode;

  /**
   * Override the thumbnail shown in grid view for a single entry.
   * Return `null` to fall back to the default icon-based tile.
   */
  renderThumbnail?: (entry: FileBrowserEntry) => React.ReactNode | null;
  /**
   * Override the leading icon shown in list and details views.
   * Return `null` to use the default `<Icon>` based on entry kind.
   */
  renderIcon?: (entry: FileBrowserEntry) => React.ReactNode | null;

  /**
   * Keyboard navigation scheme. Defaults to `'macos'`.
   * - `'macos'`   Click selects; double-click or Enter opens. ⌘-click multi-selects.
   * - `'windows'` Click selects; double-click or Enter opens. Ctrl-click multi-selects.
   * - `'vi'`      Mouse like macOS. Keyboard: j/k move, h goes up, l/Enter opens,
   *               gg first, G last, / opens inline search.
   */
  keyboardScheme?: KeyboardScheme;

  /**
   * Called when the user starts dragging a file entry.
   * Set `e.dataTransfer` inside the handler to attach drag data.
   */
  onFileDragStart?: (entry: FileBrowserEntry, e: React.DragEvent) => void;

  className?: string;
}

function extToIconName(
  entry: FileBrowserEntry,
): "folder" | "image" | "document" | "music" | "archive" | "file" {
  if (entry.kind === "dir") return "folder";
  const ext = entry.path.toLowerCase().split(".").pop() ?? "";
  if (ext === "svg") return "image";
  if (["jpg", "jpeg", "png", "webp", "gif", "bmp"].includes(ext)) return "image";
  if (["pdf", "doc", "docx", "odt"].includes(ext)) return "document";
  if (["mp3", "wav", "aac", "ogg", "flac"].includes(ext)) return "music";
  if (["zip", "tar", "gz", "7z"].includes(ext)) return "archive";
  return "file";
}

function isImageEntry(entry: FileBrowserEntry): boolean {
  const ext = entry.path.toLowerCase().split(".").pop() ?? "";
  return ["jpg", "jpeg", "png", "webp", "gif", "bmp", "svg"].includes(ext);
}

function kindOrder(entry: FileBrowserEntry): number {
  if (entry.kind === "dir") return 0;
  const ext = entry.path.toLowerCase().split(".").pop() ?? "";
  if (["svg", "jpg", "jpeg", "png", "webp", "gif", "bmp"].includes(ext)) return 1;
  if (["pdf", "doc", "docx", "odt"].includes(ext)) return 2;
  if (["mp3", "wav", "aac", "ogg", "flac"].includes(ext)) return 3;
  if (["css", "scss", "txt", "md", "rst"].includes(ext)) return 4;
  if (["zip", "tar", "gz", "7z"].includes(ext)) return 5;
  return 6;
}

function fmtSize(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(ms?: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

function DefaultFileIcon({ entry }: { entry: FileBrowserEntry }) {
  const name = extToIconName(entry);
  const colorClass =
    entry.kind === "dir"
      ? "text-amber-500/70"
      : name === "image"
        ? "text-indigo-400/70"
        : name === "document"
          ? "text-rose-400/70"
          : name === "music"
            ? "text-emerald-400/70"
            : name === "archive"
              ? "text-amber-400/70"
              : "text-[var(--theme-text-muted)] opacity-70";
  return <Icon name={name} size="xs" className={colorClass} />;
}

interface ChevronMenuProps {
  atPath: string;
  onSelect: (path: string) => void;
  onClose: () => void;
  anchor: { x: number; y: number };
  onListSubdirs: (path: string) => Promise<string[]>;
}

const ChevronMenu: React.FC<ChevronMenuProps> = ({
  atPath,
  onSelect,
  onClose,
  anchor,
  onListSubdirs,
}) => {
  const [dirs, setDirs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await onListSubdirs(atPath);
      if (!cancelled) {
        setDirs(result);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [atPath, onListSubdirs]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const getName = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

  return (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        top: anchor.y,
        left: anchor.x,
        zIndex: 9999,
      }}
      className="min-w-[180px] max-w-[280px] max-h-[260px] overflow-y-auto rounded-xl shadow-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] py-1 text-sm"
    >
      {loading && (
        <div className="px-3 py-2 text-[var(--theme-text-muted)] text-xs italic">
          Loading…
        </div>
      )}
      {!loading && dirs.length === 0 && (
        <div className="px-3 py-2 text-[var(--theme-text-muted)] text-xs italic">
          No sub-folders
        </div>
      )}
      {dirs.map((d) => (
        <button
          key={d}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(d);
            onClose();
          }}
          className="w-full text-left flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--theme-bg)] transition-colors text-[var(--theme-text)] truncate"
        >
          <Icon name="folder" size="xs" className="text-amber-500/70 shrink-0" />
          <span className="truncate text-xs font-medium">{getName(d)}</span>
        </button>
      ))}
    </div>
  );
};

interface BreadcrumbSegment {
  label: string;
  path: string;
}

interface PathBreadcrumbProps {
  path: string;
  onNavigate: (path: string) => void;
  onListSubdirs?: (path: string) => Promise<string[]>;
}

const PathBreadcrumb: React.FC<PathBreadcrumbProps> = ({
  path,
  onNavigate,
  onListSubdirs,
}) => {
  const [openChevron, setOpenChevron] = useState<{
    segPath: string;
    anchor: { x: number; y: number };
  } | null>(null);

  const segments = useMemo<BreadcrumbSegment[]>(() => {
    if (!path) return [];
    const parts = path.split("/").filter(Boolean);
    return parts.map((label, i) => ({
      label,
      path: "/" + parts.slice(0, i + 1).join("/"),
    }));
  }, [path]);

  const openMenu = (
    e: React.MouseEvent<HTMLButtonElement>,
    segPath: string,
  ) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setOpenChevron({ segPath, anchor: { x: rect.left, y: rect.bottom + 4 } });
  };

  if (!path) {
    return (
      <span className="text-[10px] text-[var(--theme-text-muted)] font-mono italic flex-1 ml-0.5">
        No folder selected
      </span>
    );
  }

  return (
    <div className="flex items-center min-w-0 flex-1 overflow-hidden">
      <button
        onClick={() => onNavigate("/")}
        className="shrink-0 text-[10px] font-mono text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)] px-0.5 transition-colors"
        title="/"
      >
        /
      </button>

      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        const visible = segments.length <= 3 || i >= segments.length - 3;
        const showEllipsis =
          i === segments.length - 4 && segments.length > 3;
        if (!visible && !showEllipsis) return null;
        if (showEllipsis) {
          return (
            <span
              key="ellipsis"
              className="text-[10px] font-mono text-[var(--theme-text-muted)] px-0.5 shrink-0"
            >
              …/
            </span>
          );
        }
        return (
          <React.Fragment key={seg.path}>
            <button
              onClick={() => onNavigate(seg.path)}
              title={seg.path}
              className={`shrink-0 text-[10px] font-mono transition-colors truncate max-w-[90px] ${
                isLast
                  ? "text-[var(--theme-text)] font-semibold hover:text-[var(--theme-primary)]"
                  : "text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)]"
              }`}
            >
              {seg.label}
            </button>
            {onListSubdirs ? (
              <button
                onClick={(e) => openMenu(e, seg.path)}
                title={`Browse inside ${seg.label}`}
                className="shrink-0 p-0.5 rounded hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)] transition-colors"
              >
                <Icon name="chevron-right" size="xs" />
              </button>
            ) : (
              !isLast && (
                <span className="shrink-0 text-[10px] font-mono text-[var(--theme-text-muted)] px-0.5 select-none">/</span>
              )
            )}
          </React.Fragment>
        );
      })}

      {openChevron && onListSubdirs && (
        <ChevronMenu
          atPath={openChevron.segPath}
          onSelect={onNavigate}
          onClose={() => setOpenChevron(null)}
          anchor={openChevron.anchor}
          onListSubdirs={onListSubdirs}
        />
      )}
    </div>
  );
};

/** Fully data-driven file browser. All data arrives as props; all user actions are reported via callbacks. */
export const FileBrowser: React.FC<FileBrowserProps> = ({
  entries,
  currentPath,
  loading = false,
  error = null,
  onNavigate,
  onFileOpen,
  onSelectionChange,
  onFocus,
  onListSubdirs,
  toolbarTop,
  toolbarRight,
  statusBar,
  defaultViewMode = "list",
  renderThumbnail,
  renderIcon,
  onFileDragStart,
  keyboardScheme = "macos",
  className = "",
}) => {
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const lastClickRef = useRef<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // VI mode: track the last key for double-key sequences (e.g. `gg`).
  const lastViKeyRef   = useRef<string | null>(null);
  const lastViTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Typeahead jump.
  const [typeaheadStr, setTypeaheadStr] = useState("");
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inline search filter.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [sortBy, setSortBy] = useState<FileBrowserSortBy>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [viewMode, setViewMode] = useState<FileBrowserViewMode>(defaultViewMode);

  const onNavigateRef = useRef(onNavigate);
  const onFileOpenRef = useRef(onFileOpen);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onFocusRef = useRef(onFocus);
  useEffect(() => { onNavigateRef.current = onNavigate; }, [onNavigate]);
  useEffect(() => { onFileOpenRef.current = onFileOpen; }, [onFileOpen]);
  useEffect(() => { onSelectionChangeRef.current = onSelectionChange; }, [onSelectionChange]);
  useEffect(() => { onFocusRef.current = onFocus; }, [onFocus]);

  const handleNavigate = useCallback((path: string) => {
    setSelection(new Set());
    setFocusedPath(null);
    lastClickRef.current = null;
    onSelectionChangeRef.current?.([]);
    onNavigateRef.current(path);
    setSearchOpen(false);
    setSearchQuery("");
  }, []);

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      if (a.kind === "dir" && b.kind !== "dir") return -1;
      if (b.kind === "dir" && a.kind !== "dir") return 1;

      let cmp = 0;
      switch (sortBy) {
        case "name":
          cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
          break;
        case "size":
          cmp = (a.size ?? 0) - (b.size ?? 0);
          break;
        case "modified":
          cmp = (a.modified ?? 0) - (b.modified ?? 0);
          break;
        case "kind":
          cmp = kindOrder(a) - kindOrder(b);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [entries, sortBy, sortDir]);

  // displayEntries — applies inline search filter on top of the sorted list.
  // Defined before selectFile so selectFile can use it for range-select.
  const displayEntries = useMemo(() => {
    if (!searchOpen || !searchQuery.trim()) return sortedEntries;
    const q = searchQuery.toLowerCase();
    return sortedEntries.filter(e => e.kind === "dir" || e.name.toLowerCase().includes(q));
  }, [sortedEntries, searchOpen, searchQuery]);

  const toggleSort = (key: FileBrowserSortBy) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(key);
      setSortDir("asc");
    }
  };

  const sortIcon = (key: FileBrowserSortBy) =>
    sortBy !== key ? null : sortDir === "asc" ? " ↑" : " ↓";

  const selectFile = useCallback(
    (path: string, e?: React.MouseEvent) => {
      setSelection((prev) => {
        let next: Set<string>;
        if (e && (e.metaKey || e.ctrlKey)) {
          next = new Set(prev);
          if (next.has(path)) next.delete(path);
          else next.add(path);
        } else if (e && e.shiftKey && lastClickRef.current) {
          const files = displayEntries
            .filter((en) => en.kind !== "dir")
            .map((en) => en.path);
          const from = files.indexOf(lastClickRef.current!);
          const to = files.indexOf(path);
          if (from >= 0 && to >= 0) {
            const [lo, hi] = from < to ? [from, to] : [to, from];
            next = new Set(prev);
            for (let i = lo; i <= hi; i++) {
              const p = files[i];
              if (p) next.add(p);
            }
          } else {
            next = new Set([path]);
          }
        } else {
          next = new Set([path]);
        }
        onSelectionChangeRef.current?.(Array.from(next));
        return next;
      });
      setFocusedPath(path);
      lastClickRef.current = path;
    },
    [displayEntries],
  );

  const goUp = useCallback(() => {
    const clean = currentPath.replace(/\/$/, "");
    if (!clean || clean === "/") return;
    const parts = clean.split("/");
    parts.pop();
    handleNavigate(parts.join("/") || "/");
  }, [currentPath, handleNavigate]);

  const isAtRoot =
    !currentPath ||
    currentPath === "/" ||
    currentPath.replace(/\/$/, "") === "";

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const all = displayEntries;
      const idx = all.findIndex((en) => en.path === focusedPath);

      // Helper — move focus by delta and clamp.
      const moveFocus = (delta: number) => {
        const next = Math.max(0, Math.min(all.length - 1, idx + delta));
        const en = all[next];
        if (en) setFocusedPath(en.path);
      };

      // Helper — activate the focused entry (open file or navigate into dir).
      const activateFocused = () => {
        const entry = all[idx];
        if (!entry) return;
        if (entry.kind === "dir") handleNavigate(entry.path);
        else onFileOpenRef.current?.(entry.path);
      };

      // VI-specific key sequences run before the generic switch so that
      // `j`/`k` etc. are not misinterpreted as typeahead characters.
      if (keyboardScheme === "vi" && !searchOpen) {
        switch (e.key) {
          case "j": e.preventDefault(); moveFocus(+1); lastViKeyRef.current = null; return;
          case "k": e.preventDefault(); moveFocus(-1); lastViKeyRef.current = null; return;
          case "h": e.preventDefault(); goUp();        lastViKeyRef.current = null; return;
          case "l": e.preventDefault(); activateFocused(); lastViKeyRef.current = null; return;
          case "G": {
            e.preventDefault();
            const last = displayEntries[displayEntries.length - 1];
            if (last) setFocusedPath(last.path);
            lastViKeyRef.current = null;
            return;
          }
          case "g": {
            e.preventDefault();
            if (lastViKeyRef.current === "g") {
              const first = displayEntries[0];
              if (first) setFocusedPath(first.path);
              lastViKeyRef.current = null;
              if (lastViTimerRef.current) clearTimeout(lastViTimerRef.current);
            } else {
              lastViKeyRef.current = "g";
              if (lastViTimerRef.current) clearTimeout(lastViTimerRef.current);
              lastViTimerRef.current = setTimeout(() => { lastViKeyRef.current = null; }, 600);
            }
            return;
          }
          default: break;
        }
      }

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          moveFocus(+1);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          moveFocus(-1);
          break;
        }
        case "Enter": {
          activateFocused();
          break;
        }
        case "Backspace":
          e.preventDefault();
          goUp();
          break;
        case " ": {
          e.preventDefault();
          const entry = all[idx];
          if (!entry || entry.kind === "dir") break;
          setSelection((prev) => {
            const next = new Set(prev);
            if (next.has(entry.path)) next.delete(entry.path);
            else next.add(entry.path);
            onSelectionChangeRef.current?.(Array.from(next));
            return next;
          });
          break;
        }
        case "a": {
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            const allFiles = all
              .filter((en) => en.kind !== "dir")
              .map((en) => en.path);
            setSelection(new Set(allFiles));
            onSelectionChangeRef.current?.(allFiles);
          }
          break;
        }
        case "Escape":
          setSelection(new Set());
          onSelectionChangeRef.current?.([]);
          break;
        case "/": {
          e.preventDefault();
          setSearchOpen(true);
          setSearchQuery("");
          setTimeout(() => searchInputRef.current?.focus(), 0);
          return;
        }
        default: {
          // Typeahead: printable single char, no modifiers.
          if (
            e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey &&
            // In VI mode, skip navigation keys for typeahead.
            !(keyboardScheme === "vi" && ["j", "k", "h", "l", "g", "G", "/"].includes(e.key))
          ) {
            const next = typeaheadStr + e.key;
            setTypeaheadStr(next);
            if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current);
            typeaheadTimerRef.current = setTimeout(() => setTypeaheadStr(""), 800);
            const match = displayEntries.find(
              en => en.name.toLowerCase().startsWith(next.toLowerCase())
            );
            if (match) setFocusedPath(match.path);
          }
          break;
        }
      }
    },
    [displayEntries, focusedPath, keyboardScheme, searchOpen, typeaheadStr, handleNavigate, goUp],
  );

  useEffect(() => {
    if (!focusedPath || !listRef.current) return;
    const escaped = focusedPath.replace(/[.$*+?^{}()|[\]\\]/g, "\\$&");
    const el = listRef.current.querySelector(
      `[data-path="${escaped}"]`,
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [focusedPath]);

  const listAreaContent = () => {
    if (error) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 p-8 text-[var(--theme-text-muted)]">
          <Icon name="warning" size="md" />
          <p className="text-sm text-center">{error}</p>
        </div>
      );
    }

    if (viewMode === "grid") {
      return (
        <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
          {displayEntries.length === 0 && (
            <p className="px-4 py-8 text-center text-[var(--theme-text-muted)] text-sm italic">
              {searchOpen && searchQuery.trim() ? "No matches" : "Empty folder"}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            {displayEntries.map((entry) => {
              const isSelected = selection.has(entry.path);
              const customThumb = renderThumbnail ? renderThumbnail(entry) : null;
              return (
                <div
                  key={entry.path}
                  data-path={entry.path}
                  draggable={entry.kind === "file" && !!onFileDragStart}
                  onDragStart={(e) => { if (entry.kind === "file") onFileDragStart?.(entry, e); }}
                  onClick={(e) => {
                    if (entry.kind === "dir") {
                      handleNavigate(entry.path);
                    } else {
                      selectFile(entry.path, e);
                    }
                  }}
                  onDoubleClick={() => {
                    if (entry.kind === "file") onFileOpenRef.current?.(entry.path);
                  }}
                  className={`relative flex flex-col rounded-lg overflow-hidden border cursor-pointer select-none transition-all ${
                    isSelected
                      ? "border-[var(--theme-primary)] ring-2 ring-[var(--theme-primary)]/30"
                      : "border-[var(--theme-border)] hover:border-[var(--theme-primary)]/40"
                  }`}
                >
                  <div className="aspect-square bg-[var(--theme-bg)] flex items-center justify-center overflow-hidden">
                    {customThumb != null ? (
                      customThumb
                    ) : isImageEntry(entry) ? (
                      <LazyImage src={entry.path} alt={entry.name} />
                    ) : (
                      <DefaultFileIcon entry={entry} />
                    )}
                  </div>
                  <div
                    className={`px-1.5 py-1 ${isSelected ? "bg-[var(--theme-primary)]" : "bg-[var(--theme-surface)]"}`}
                  >
                    <p
                      className={`text-[10px] font-medium truncate ${isSelected ? "text-white dark:text-[var(--theme-bg)]" : "text-[var(--theme-text)]"}`}
                    >
                      {entry.name}
                    </p>
                  </div>
                  {entry.indexed && (
                    <span
                      className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-500 ring-1 ring-white/50"
                      title="Indexed"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    if (viewMode === "details") {
      return (
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="flex items-center gap-2 px-3 py-1 border-b border-[var(--theme-border)] bg-[var(--theme-bg)]/50 sticky top-0">
            <span className="w-4 shrink-0" />
            <button
              onClick={() => toggleSort("name")}
              className="flex-1 text-left text-[9px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
            >
              Name{sortIcon("name")}
            </button>
            <button
              onClick={() => toggleSort("kind")}
              className="w-10 shrink-0 text-[9px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] text-right"
            >
              Type{sortIcon("kind")}
            </button>
            <button
              onClick={() => toggleSort("size")}
              className="w-14 shrink-0 text-[9px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] text-right"
            >
              Size{sortIcon("size")}
            </button>
            <button
              onClick={() => toggleSort("modified")}
              className="w-16 shrink-0 text-[9px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] text-right"
            >
              Date{sortIcon("modified")}
            </button>
          </div>
          <ul
            ref={listRef}
            className="py-0.5 outline-none"
            tabIndex={0}
            onKeyDown={handleKeyDown}
            onFocus={() => onFocusRef.current?.()}
            onClick={() => onFocusRef.current?.()}
          >
            {displayEntries.length === 0 && (
              <li className="px-4 py-8 text-center text-[var(--theme-text-muted)] text-sm italic">
                {searchOpen && searchQuery.trim() ? "No matches" : "Empty folder"}
              </li>
            )}
            {displayEntries.map((entry) => {
              const isSelected = selection.has(entry.path);
              const isFocused = entry.path === focusedPath;
              const ext =
                entry.name.split(".").pop()?.toUpperCase().slice(0, 4) ?? "";
              const iconNode = renderIcon ? renderIcon(entry) : null;
              return (
                <li
                  key={entry.path}
                  data-path={entry.path}
                  draggable={entry.kind === "file" && !!onFileDragStart}
                  onDragStart={(e) => { if (entry.kind === "file") onFileDragStart?.(entry, e); }}
                  onClick={(e) => {
                    if (entry.kind === "dir") {
                      handleNavigate(entry.path);
                    } else {
                      selectFile(entry.path, e);
                    }
                  }}
                  onDoubleClick={() => {
                    if (entry.kind === "file") onFileOpenRef.current?.(entry.path);
                  }}
                  className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none text-sm ${
                    isSelected
                      ? "bg-[var(--theme-primary)] text-[var(--theme-primary-fg)]"
                      : isFocused
                        ? "bg-[var(--theme-bg)] text-[var(--theme-text)]"
                        : "hover:bg-[var(--theme-bg)] text-[var(--theme-text)]"
                  }`}
                >
                  <span className="shrink-0 flex items-center">
                    {iconNode !== null ? iconNode : <DefaultFileIcon entry={entry} />}
                  </span>
                  <span className="flex-1 truncate font-medium text-[11px]">
                    {entry.name}
                  </span>
                  <span
                    className={`w-10 shrink-0 text-right font-mono text-[9px] ${isSelected ? "opacity-70" : "text-[var(--theme-text-muted)]"}`}
                  >
                    {entry.kind === "dir" ? "\u2014" : ext}
                  </span>
                  <span
                    className={`w-14 shrink-0 text-right font-mono text-[9px] tabular-nums ${isSelected ? "opacity-70" : "text-[var(--theme-text-muted)]"}`}
                  >
                    {entry.kind === "file" ? fmtSize(entry.size) : ""}
                  </span>
                  <span
                    className={`w-16 shrink-0 text-right font-mono text-[9px] tabular-nums ${isSelected ? "opacity-70" : "text-[var(--theme-text-muted)]"}`}
                  >
                    {fmtDate(entry.modified)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      );
    }

    // Default: list view.
    return (
      <ul
        ref={listRef}
        className="flex-1 overflow-y-auto py-1 scrollbar-thin outline-none"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onFocus={() => onFocusRef.current?.()}
        onClick={() => onFocusRef.current?.()}
      >
        {displayEntries.length === 0 && (
          <li className="px-4 py-8 text-center text-[var(--theme-text-muted)] text-sm italic">
            {searchOpen && searchQuery.trim() ? "No matches" : "Empty folder"}
          </li>
        )}
        {displayEntries.map((entry) => {
          const isSelected = selection.has(entry.path);
          const isFocused = entry.path === focusedPath;
          const iconNode = renderIcon ? renderIcon(entry) : null;
          return (
            <li
              key={entry.path}
              data-path={entry.path}
              draggable={entry.kind === "file" && !!onFileDragStart}
              onDragStart={(e) => { if (entry.kind === "file") onFileDragStart?.(entry, e); }}
              onClick={(e) => {
                if (entry.kind === "dir") {
                  handleNavigate(entry.path);
                } else {
                  selectFile(entry.path, e);
                }
              }}
              onDoubleClick={() => {
                if (entry.kind === "file") onFileOpenRef.current?.(entry.path);
              }}
              className={`flex items-center gap-3 px-3 py-2 cursor-pointer select-none text-sm
                ${
                  isSelected
                    ? "bg-[var(--theme-primary)] text-[var(--theme-primary-fg)]"
                    : isFocused
                      ? "bg-[var(--theme-bg)] text-[var(--theme-text)]"
                      : "hover:bg-[var(--theme-bg)] text-[var(--theme-text)]"
                }
                ${isFocused && !isSelected ? "ring-1 ring-inset ring-[var(--theme-primary)]/25" : ""}
              `}
            >
              <span className="shrink-0 flex items-center justify-center">
                {iconNode !== null ? iconNode : <DefaultFileIcon entry={entry} />}
              </span>
              <span className="flex-1 truncate font-medium">{entry.name}</span>
              {entry.kind === "file" && (
                <span
                  className={`text-[10px] tabular-nums shrink-0 ${isSelected ? "opacity-70" : "text-[var(--theme-text-muted)]"}`}
                >
                  {fmtSize(entry.size)}
                </span>
              )}
              {entry.indexed && (
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSelected ? "bg-white" : "bg-emerald-500"}`}
                  title="Indexed"
                />
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div
      className={`flex flex-col h-full bg-[var(--theme-surface)] ${className}`}
    >
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-0 border-b border-[var(--theme-border)] bg-[var(--theme-surface)] shrink-0">
        {toolbarTop}

        <div className="flex items-center gap-1 px-2 py-1.5">
          <button
            onClick={goUp}
            title="Up one level"
            disabled={isAtRoot}
            className="p-1.5 rounded hover:bg-[var(--theme-bg)] disabled:opacity-30 transition-colors text-[var(--theme-text-muted)]"
          >
            <Icon name="chevron-up" size="xs" />
          </button>
          <PathBreadcrumb
            path={currentPath}
            onNavigate={handleNavigate}
            onListSubdirs={onListSubdirs}
          />
          {toolbarRight}
        </div>

        <div className="flex items-center gap-1 px-2 pb-1.5">
          <div className="flex items-center gap-0.5 flex-1 overflow-x-auto">
            {(["name", "kind", "size", "modified"] as FileBrowserSortBy[]).map(
              (k) => (
                <button
                  key={k}
                  onClick={() => toggleSort(k)}
                  className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded transition-colors whitespace-nowrap ${
                    sortBy === k
                      ? "bg-[var(--theme-primary)]/10 text-[var(--theme-primary)]"
                      : "text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-bg)]"
                  }`}
                >
                  {k}
                  {sortIcon(k)}
                </button>
              ),
            )}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {(["list", "details", "grid"] as FileBrowserViewMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                title={`${m.charAt(0).toUpperCase()}${m.slice(1)} view`}
                className={`p-1 rounded transition-colors ${
                  viewMode === m
                    ? "text-[var(--theme-primary)] bg-[var(--theme-primary)]/10"
                    : "text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-bg)]"
                }`}
              >
                <Icon
                  name={
                    m === "list" ? "list" : m === "details" ? "columns" : "grid"
                  }
                  size="xs"
                />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── List area ────────────────────────────────────────────────── */}
      <div className="relative flex flex-col flex-1 overflow-hidden">
        {/* The scrollable list itself is inside listAreaContent */}
        {listAreaContent()}

        {/* Inline search — below the scroll area, above loading */}
        {searchOpen && (
          <div className="shrink-0 flex items-center gap-1.5 px-3 py-1 border-t border-[var(--theme-border)] bg-[var(--theme-bg)]">
            <span className="font-mono text-[var(--theme-text-muted)] text-xs select-none">/</span>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setSearchOpen(false);
                  setSearchQuery("");
                  listRef.current?.focus();
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const all = displayEntries;
                  const idx = all.findIndex(en => en.path === focusedPath);
                  const entry = all[idx];
                  if (entry) {
                    if (entry.kind === "dir") handleNavigate(entry.path);
                    else onFileOpenRef.current?.(entry.path);
                  }
                  setSearchOpen(false);
                  setSearchQuery("");
                  listRef.current?.focus();
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  const all = displayEntries;
                  const idx = all.findIndex(en => en.path === focusedPath);
                  const next = all[Math.min(idx + 1, all.length - 1)];
                  if (next) setFocusedPath(next.path);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  const all = displayEntries;
                  const idx = all.findIndex(en => en.path === focusedPath);
                  const prev = all[Math.max(idx - 1, 0)];
                  if (prev) setFocusedPath(prev.path);
                }
              }}
              placeholder="filter…"
              className="flex-1 bg-transparent text-xs text-[var(--theme-text)] placeholder-[var(--theme-text-muted)] focus:outline-none"
            />
            {searchQuery && (
              <span className="text-[9px] text-[var(--theme-text-muted)] shrink-0">
                {displayEntries.filter(e => e.kind !== "dir").length} match{displayEntries.filter(e => e.kind !== "dir").length !== 1 ? "es" : ""}
              </span>
            )}
            <button
              onClick={() => { setSearchOpen(false); setSearchQuery(""); listRef.current?.focus(); }}
              className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] text-xs px-1"
            >
              ✕
            </button>
          </div>
        )}

        {/* Typeahead indicator */}
        {typeaheadStr && (
          <div className="absolute bottom-2 right-2 pointer-events-none z-20 bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded px-2 py-0.5 text-xs font-mono text-[var(--theme-text)] shadow-sm opacity-90">
            {typeaheadStr}
          </div>
        )}

        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--theme-surface)]/60 backdrop-blur-sm z-10">
            <div className="animate-spin w-5 h-5 border-2 border-[var(--theme-primary)] border-t-transparent rounded-full" />
          </div>
        )}
      </div>

      {statusBar}
    </div>
  );
};
