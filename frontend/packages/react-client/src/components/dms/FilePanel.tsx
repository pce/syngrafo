/**
 * FilePanel.tsx — reusable, self-contained file-tree panel.
 *
 * Features
 * ─────────
 * • Independent path / entries state (not tied to the global dms-store)
 * • Multi-select:  click=single, Ctrl/Cmd+click=toggle, Shift+click=range
 * • Keyboard navigation: ↑↓ move focus, Enter=open, Backspace=go up,
 *   Space=toggle selected, Ctrl+A=select all, Escape=clear
 * • Inline selection count badge + "Clear" button
 * • Browse-folder button to open native OS picker
 * • Refresh button
 *
 * Props
 * ─────
 * panelId           "left" | "right"  — used in callbacks
 * initialPath       starting directory (updated live when changed from outside)
 * title             optional label above the toolbar
 * onPathChange      called whenever the panel navigates to a new directory
 * onSelectionChange called whenever selection changes
 * onFileOpen        called on single-click+Enter on a file
 * onFocus           called when the panel gains focus (for CommandBar awareness)
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import {
  dms,
  isSupportedFile,
  isImageFile,
  isTextFile,
  isDocFile,
  isSvgFile,
  isAudioFile,
  isVideoFile,
} from "../../services/dms-service";
import type { FsEntry } from "../../services/dms-service";
import Icon from "../Icon";

// ── helpers ───────────────────────────────────────────────────────────────────

function FileRowIcon({ entry }: { entry: FsEntry }) {
  if (entry.kind === "dir")
    return <Icon name="folder" size="xs" className="text-amber-500/70" />;
  if (isSvgFile(entry.path))
    return <Icon name="image" size="xs" className="text-violet-400/70" />;
  if (isImageFile(entry.path))
    return <Icon name="image" size="xs" className="text-indigo-400/70" />;
  if (isDocFile(entry.path))
    return <Icon name="document" size="xs" className="text-rose-400/70" />;
  if (isAudioFile(entry.path))
    return <Icon name="music" size="xs" className="text-emerald-400/70" />;
  if (isVideoFile(entry.path))
    return <Icon name="play" size="xs" className="text-sky-400/70" />;
  if (isTextFile(entry.path))
    return <Icon name="file" size="xs" className="text-[var(--theme-text-muted)] opacity-70" />;
  return <Icon name="file" size="xs" className="text-[var(--theme-text-muted)] opacity-50" />;
}

function fmtSize(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

// ── types ─────────────────────────────────────────────────────────────────────

export interface FilePanelProps {
  panelId: "left" | "right";
  initialPath?: string;
  /** Label shown above the toolbar */
  title?: string;
  className?: string;
  /** Called whenever this panel navigates to a new dir */
  onPathChange?: (path: string, panelId: "left" | "right") => void;
  /** Called whenever selection changes; passes absolute paths of selected FILES */
  onSelectionChange?: (paths: string[], panelId: "left" | "right") => void;
  /** Called on single-click + Enter on a viewable file */
  onFileOpen?: (path: string) => void;
  /** Called when this panel receives focus (keyboard / click) */
  onFocus?: (panelId: "left" | "right") => void;
}

// ── component ─────────────────────────────────────────────────────────────────

const FilePanel: React.FC<FilePanelProps> = ({
  panelId,
  initialPath = "",
  title,
  className = "",
  onPathChange,
  onSelectionChange,
  onFileOpen,
  onFocus,
}) => {
  const [path, setPath]             = useState(initialPath);
  const [entries, setEntries]       = useState<FsEntry[]>([]);
  const [selection, setSelection]   = useState<Set<string>>(new Set());
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [isLoading, setIsLoading]   = useState(false);

  const listRef         = useRef<HTMLUListElement>(null);
  const lastClickRef    = useRef<string | null>(null);   // last clicked path for shift-range

  // ── navigation ──────────────────────────────────────────────────────────────

  const navigate = useCallback(
    async (newPath: string) => {
      setPath(newPath);
      setSelection(new Set());
      lastClickRef.current = null;
      onPathChange?.(newPath, panelId);
      onSelectionChange?.([], panelId);

      if (!newPath) { setEntries([]); return; }

      setIsLoading(true);
      const res = await dms.scanDir(newPath);
      setIsLoading(false);

      if (res.ok && res.data) {
        setEntries(res.data.entries);
        setFocusedPath(res.data.entries[0]?.path ?? null);
      } else {
        setEntries([]);
        setFocusedPath(null);
      }
    },
    [panelId, onPathChange, onSelectionChange],
  );

  // Navigate on mount / when initialPath changes from parent
  useEffect(() => {
    if (initialPath) navigate(initialPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPath]);

  const goUp = useCallback(() => {
    const clean = path.replace(/\/$/, "");
    if (!clean || clean === "/") return;
    const parts = clean.split("/");
    parts.pop();
    navigate(parts.join("/") || "/");
  }, [path, navigate]);

  const refresh = useCallback(() => {
    if (path) navigate(path);
  }, [path, navigate]);

  const browse = useCallback(async () => {
    const res = await dms.selectDirectory();
    if (res.ok && res.data) navigate(res.data);
  }, [navigate]);

  // ── selection helpers ────────────────────────────────────────────────────────

  const fileEntries = useCallback(
    () => entries.filter((e) => e.kind !== "dir"),
    [entries],
  );

  const emitSelection = useCallback(
    (next: Set<string>) => {
      setSelection(next);
      onSelectionChange?.(Array.from(next), panelId);
    },
    [panelId, onSelectionChange],
  );

  // ── click handler ────────────────────────────────────────────────────────────

  const handleClick = useCallback(
    (entry: FsEntry, e: React.MouseEvent) => {
      onFocus?.(panelId);

      if (entry.kind === "dir") {
        navigate(entry.path);
        return;
      }

      if (!isSupportedFile(entry.path)) return;

      const isMeta  = e.metaKey || e.ctrlKey;
      const isShift = e.shiftKey;

      if (isMeta) {
        // Toggle this path
        const next = new Set(selection);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        emitSelection(next);
        setFocusedPath(entry.path);
      } else if (isShift && lastClickRef.current) {
        // Range select
        const files   = fileEntries().map((e) => e.path);
        const fromIdx = files.indexOf(lastClickRef.current);
        const toIdx   = files.indexOf(entry.path);
        if (fromIdx >= 0 && toIdx >= 0) {
          const [lo, hi] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
        const next = new Set(selection);
        for (let i = lo; i <= hi; i++) {
          const p = files[i];
          if (p) next.add(p);
        }
          emitSelection(next);
        }
        setFocusedPath(entry.path);
      } else {
        // Single select + open
        emitSelection(new Set([entry.path]));
        setFocusedPath(entry.path);
        onFileOpen?.(entry.path);
      }

      lastClickRef.current = entry.path;
    },
    [selection, fileEntries, emitSelection, onFocus, onFileOpen, navigate, panelId],
  );

  // ── keyboard navigation ───────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const idx = entries.findIndex((en) => en.path === focusedPath);

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const next = Math.min(idx + 1, entries.length - 1);
          if (entries[next]) setFocusedPath(entries[next].path);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prev = Math.max(idx - 1, 0);
          if (entries[prev]) setFocusedPath(entries[prev].path);
          break;
        }
        case "Enter": {
          e.preventDefault();
          const entry = entries[idx];
          if (!entry) break;
          if (entry.kind === "dir") {
            navigate(entry.path);
          } else if (isSupportedFile(entry.path)) {
            emitSelection(new Set([entry.path]));
            onFileOpen?.(entry.path);
          }
          break;
        }
        case "Backspace":
        case "ArrowLeft":
          e.preventDefault();
          goUp();
          break;
        case " ": {
          e.preventDefault();
          const entry = entries[idx];
          if (!entry || entry.kind === "dir") break;
          const next = new Set(selection);
          if (next.has(entry.path)) next.delete(entry.path);
          else next.add(entry.path);
          emitSelection(next);
          break;
        }
        case "a":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            emitSelection(new Set(fileEntries().map((e) => e.path)));
          }
          break;
        case "Escape":
          emitSelection(new Set());
          break;
        default:
          break;
      }
    },
    [entries, focusedPath, selection, fileEntries, emitSelection, onFileOpen, navigate, goUp],
  );

  // ── scroll focused item into view ────────────────────────────────────────────

  useEffect(() => {
    if (!focusedPath || !listRef.current) return;
    const escaped = focusedPath.replace(/[.$*+?^{}()|[\]\\]/g, "\\$&");
    const el = listRef.current.querySelector(
      `[data-path="${escaped}"]`,
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [focusedPath]);

  // ── render ───────────────────────────────────────────────────────────────────

  const isAtRoot = !path || path === "/";
  const selCount = selection.size;

  return (
    <div
      className={`flex flex-col h-full bg-[var(--theme-surface)] ${className}`}
      onClick={() => onFocus?.(panelId)}
    >
      {/* Optional title strip */}
      {title && (
        <div className="px-2 py-0.5 border-b border-[var(--theme-border)] bg-[var(--theme-bg)]/40 shrink-0">
          <span className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60">
            {title}
          </span>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-[var(--theme-border)] shrink-0">
        <button
          onClick={goUp}
          disabled={isAtRoot}
          title="Up one level (Backspace)"
          className="p-1 rounded hover:bg-[var(--theme-bg)] disabled:opacity-30 transition-colors text-[var(--theme-text-muted)]"
        >
          <Icon name="chevron-up" size="xs" />
        </button>

        <span
          className="text-[10px] text-[var(--theme-text-muted)] flex-1 truncate font-mono mx-0.5"
          title={path}
        >
          {path
            ? path.split("/").slice(-2).join("/") || "/"
            : "No folder selected"}
        </span>

        <button
          onClick={browse}
          title="Choose folder"
          className="p-1 rounded hover:bg-[var(--theme-bg)] transition-colors text-[var(--theme-text-muted)]"
        >
          <Icon name="folder-open" size="xs" />
        </button>
        <button
          onClick={refresh}
          title="Refresh"
          className="p-1 rounded hover:bg-[var(--theme-bg)] transition-colors text-[var(--theme-text-muted)]"
        >
          <Icon name="refresh" size="xs" />
        </button>
      </div>

      {/* Selection badge */}
      {selCount > 0 && (
        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-[var(--theme-primary)]/10 border-b border-[var(--theme-primary)]/20 shrink-0">
          <span className="text-[9px] font-bold text-[var(--theme-primary)]">
            {selCount} selected
          </span>
          <button
            onClick={() => emitSelection(new Set())}
            className="ml-auto text-[9px] font-bold text-[var(--theme-text-muted)] hover:text-[var(--theme-danger)] transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {/* Spinner */}
      {isLoading && (
        <div className="flex items-center justify-center py-3 shrink-0">
          <div className="w-4 h-4 border-2 border-[var(--theme-primary)] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Entry list */}
      <ul
        ref={listRef}
        className="flex-1 overflow-y-auto py-0.5 scrollbar-thin outline-none"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onFocus={() => onFocus?.(panelId)}
        aria-label={`File panel ${panelId}`}
      >
        {!isLoading && entries.length === 0 && (
          <li className="px-4 py-8 text-center text-[var(--theme-text-muted)] text-xs italic">
            {path ? "Empty folder" : "No folder selected"}
          </li>
        )}

        {entries.map((entry) => {
          const isSel      = selection.has(entry.path);
          const isFocused  = entry.path === focusedPath;
          const clickable  = entry.kind === "dir" || isSupportedFile(entry.path);

          return (
            <li
              key={entry.path}
              data-path={entry.path}
              onClick={(e) => clickable && handleClick(entry, e)}
              className={[
                "flex items-center gap-2 px-1.5 py-1 text-xs select-none group transition-colors",
                isSel
                  ? "bg-[var(--theme-primary)]/15"
                  : isFocused
                    ? "bg-[var(--theme-bg)]"
                    : "hover:bg-[var(--theme-bg)]",
                isFocused && !isSel
                  ? "ring-1 ring-inset ring-[var(--theme-primary)]/25"
                  : "",
                !clickable ? "opacity-30 cursor-default" : "cursor-pointer",
              ]
                .join(" ")
                .trim()}
            >
              {/* Checkbox tick */}
              <span
                className={[
                  "w-3 h-3 shrink-0 flex items-center justify-center rounded border transition-colors",
                  isSel
                    ? "bg-[var(--theme-primary)] border-[var(--theme-primary)]"
                    : "border-transparent group-hover:border-[var(--theme-border)]",
                ].join(" ")}
              >
                {isSel && (
                  <Icon
                    name="check"
                    size="xs"
                    className="text-white dark:text-[var(--theme-bg)] scale-75"
                  />
                )}
              </span>

              <span className="shrink-0">
                <FileRowIcon entry={entry} />
              </span>

              <span className="flex-1 truncate font-medium text-[var(--theme-text)]">
                {entry.name}
              </span>

              {entry.kind === "file" && (
                <span className="text-[9px] tabular-nums shrink-0 text-[var(--theme-text-muted)]">
                  {fmtSize(entry.size)}
                </span>
              )}

              {entry.indexed && (
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0 bg-emerald-500"
                  title="Indexed"
                />
              )}

              {entry.kind === "dir" && (
                <Icon
                  name="chevron-right"
                  size="xs"
                  className="text-[var(--theme-text-muted)] opacity-30 shrink-0"
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default FilePanel;
