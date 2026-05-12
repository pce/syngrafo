import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLingui } from "@lingui/react";
import { i18n } from "@/i18n";
import { FileBrowser, LazyImage } from "@syngrafo/ui";
import type { FileBrowserEntry } from "@syngrafo/ui";
import {
  KEYBOARD_SCHEME_PREF_KEY,
  detectPreferredKeyboardScheme,
  normalizeKeyboardScheme,
  type KeyboardScheme,
} from "@syngrafo/shared";
import { useDms } from "../../store/dms-store.tsx";
import {
  dms, isImageFile, isTextFile, isDocFile,
  isSvgFile, isAudioFile, isArchiveFile, isCssFile,
  onDmsProgress,
  type DmsProgressEvent,
} from "@/services/dms-service.ts";
import type { FsEntry } from "@/services/dms-service.ts";
import { Icon } from "../Icon";
import { ImportModal } from "./ImportModal";

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

const ImportSelectBox: React.FC = () => {
  const { state, dispatch } = useDms();
  useLingui();
  const [isImporting, setIsImporting] = useState(false);
  const [isDragOver,  setIsDragOver]  = useState(false);
  const [queue,       setQueue]       = useState<string[]>([]);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const dragCounterRef                = useRef(0);

  useEffect(() => {
    if (!currentFile && queue.length > 0) {
      setCurrentFile(queue[0] ?? null);
      setQueue(q => q.slice(1));
    }
  }, [currentFile, queue]);

  const openPicker = async () => {
    if (isImporting || !state.zone) return;
    setIsImporting(true);
    const zres = await dms.getZones();
    if (zres.ok && zres.data) dispatch({ type: "SET_ZONES", zones: zres.data as never });
    const res = await dms.selectFiles();
    setIsImporting(false);
    if (!res.ok || !res.data || res.data.paths.length === 0) return;
    setQueue(res.data.paths);
  };

  const handleSuccess = async () => {
    if (state.currentPath) {
      const res = await dms.scanDir(state.currentPath);
      if (res.ok && res.data) dispatch({ type: "SET_ENTRIES", entries: res.data.entries });
    }
  };

  if (!state.zone) return null;

  return (
    <>
      <div className="flex flex-col gap-2 p-3 bg-[var(--theme-bg)] border-t border-[var(--theme-border)]">
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)]">{i18n._({ id: "Import to Zone", message: "Import to Zone" })}</span>
        </div>

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
              <span className="text-xs font-bold text-[var(--theme-primary)] uppercase tracking-wide">{i18n._({ id: "Importing…", message: "Importing…" })}</span>
            </>
          ) : isDragOver ? (
            <>
              <Icon name="download" size="xs" className="text-[var(--theme-primary)]" />
              <span className="text-xs font-bold text-[var(--theme-primary)] uppercase tracking-wide">{i18n._({ id: "Drop to choose…", message: "Drop to choose…" })}</span>
            </>
          ) : (
            <>
              <Icon name="plus" size="xs" className="text-[var(--theme-text-muted)]" />
              <span className="text-xs font-bold text-[var(--theme-text-muted)] uppercase tracking-wide">{i18n._({ id: "Click or Drop to Import", message: "Click or Drop to Import" })}</span>
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

interface FileBrowserWrapperProps {
  onSelectionChange?: (paths: string[]) => void;
  onFocus?: () => void;
  onPathChange?: (path: string) => void;
}

const FileBrowserWrapper: React.FC<FileBrowserWrapperProps> = ({
  onSelectionChange,
  onFocus,
  onPathChange,
}) => {
  const { state, dispatch } = useDms();
  useLingui();
  const [loading, setLoading] = useState(false);
  const [keyboardScheme, setKeyboardScheme] = useState<KeyboardScheme>(detectPreferredKeyboardScheme());
  const [transferEntries, setTransferEntries] = useState<Record<string, {
    taskId: string;
    name: string;
    path: string;
    kind: "dir" | "file";
    size?: number;
    modified?: number;
    transferLabel: string;
    transferProgress: number;
    transferOperation: "copy" | "move";
    destDir: string;
    sourceParentDirs: string[];
  }>>({});
  const onPathChangeRef = useRef(onPathChange);
  useEffect(() => { onPathChangeRef.current = onPathChange; }, [onPathChange]);

  useEffect(() => {
    dms.loadPreference(KEYBOARD_SCHEME_PREF_KEY).then(value => {
      setKeyboardScheme(normalizeKeyboardScheme(value));
    });
  }, []);

  useEffect(() => {
    const refreshCurrentPath = async () => {
      if (!state.currentPath) return;
      const res = await dms.scanDir(state.currentPath);
      if (res.ok && res.data) dispatch({ type: "SET_ENTRIES", entries: res.data.entries });
    };

    const unsubscribe = onDmsProgress((event: DmsProgressEvent) => {
      // ── indexing progress (bulk-index) ────────────────────────────────────
      if (event.kind === "indexing" || (!event.kind && !event.task_id && !event.operation)) {
        if (event.phase === "progress" || event.phase === "complete") {
          dispatch({
            type: "SET_INDEX_STATUS",
            status: {
              total:   event.total  ?? 0,
              indexed: event.done   ?? 0,
              errors:  event.errors ?? 0,
            },
          });
        }
        if (event.phase === "complete" || event.phase === "cancelled") {
          dispatch({ type: "SET_INDEXING", indexing: false });
        }
        return;
      }

      // ── transfer progress (copy / move) ───────────────────────────────────
      if (event.kind !== "transfer" || !event.task_id || !event.operation) return;

      if (event.phase === "start" && Array.isArray(event.entries)) {
        setTransferEntries((prev) => {
          const next = { ...prev };
          for (const entry of event.entries ?? []) {
            next[entry.target_path] = {
              taskId: event.task_id,
              name: entry.name,
              path: entry.target_path,
              kind: entry.is_dir ? "dir" : "file",
              size: entry.size_bytes,
              modified: Date.now(),
              transferLabel: event.operation === "move" ? "moving" : "copying",
              transferProgress: 0,
              transferOperation: event.operation,
              destDir: event.dest_dir ?? "",
              sourceParentDirs: event.source_parent_dirs ?? [],
            };
          }
          return next;
        });
        return;
      }

      const progress = event.total_bytes && event.total_bytes > 0
        ? Math.round(((event.done_bytes ?? 0) / event.total_bytes) * 100)
        : (event.phase === "complete" ? 100 : 0);

      if (event.target_path) {
        setTransferEntries((prev) => {
          const current = prev[event.target_path ?? ""];
          if (!current) return prev;
          return {
            ...prev,
            [event.target_path!]: {
              ...current,
              transferProgress: progress,
              transferLabel: event.phase === "cancelled"
                ? "cancelled"
                : event.phase === "complete"
                  ? "finalizing"
                  : current.transferLabel,
            },
          };
        });
      }

      if (event.phase === "complete" || event.phase === "cancelled") {
        const sourceParentDirs = event.source_parent_dirs ?? [];
        const affectsCurrentPath =
          !!state.currentPath &&
          ((event.dest_dir && state.currentPath === event.dest_dir) ||
           sourceParentDirs.includes(state.currentPath));
        if (affectsCurrentPath) void refreshCurrentPath();
        setTransferEntries((prev) => {
          const next = { ...prev };
          for (const [path, entry] of Object.entries(prev)) {
            if (entry.destDir === (event.dest_dir ?? "")) {
              if (entry.taskId !== event.task_id) continue;
              delete next[path];
            }
          }
          return next;
        });
      }
    });
    return unsubscribe;
  }, [dispatch, state.currentPath]);

  const navigate = useCallback(async (path: string) => {
    dispatch({ type: "SET_PATH", path });
    onPathChangeRef.current?.(path);
    setLoading(true);
    const res = await dms.scanDir(path);
    setLoading(false);
    if (res.ok && res.data) {
      dispatch({ type: "SET_ENTRIES", entries: res.data.entries });
    } else {
      dispatch({ type: "SET_ERROR", error: res.error ?? "Failed to list directory" });
    }
  }, [dispatch]);

  useEffect(() => {
    if (state.currentPath) navigate(state.currentPath);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentPath]);

  const listSubdirs = useCallback(async (path: string): Promise<string[]> => {
    const res = await dms.scanDir(path);
    return res.ok && res.data
      ? res.data.entries.filter(e => e.kind === "dir").map(e => e.path)
      : [];
  }, []);

  const selectInboxFolder = useCallback(async () => {
    const res = await dms.selectDirectory();
    if (res.ok && res.data) navigate(res.data);
  }, [navigate]);

  const bulkIndex = useCallback(async () => {
    if (!state.currentPath) return;
    dispatch({ type: "SET_INDEXING", indexing: true });
    const res = await dms.bulkIndex(state.currentPath);
    if (!res.ok) dispatch({ type: "SET_ERROR", error: res.error ?? "Index failed" });
  }, [state.currentPath, dispatch]);

  const goToSource = useCallback(() => {
    if (state.zone) navigate(state.zone.in_path);
  }, [state.zone, navigate]);

  const goToWorkspace = useCallback(() => {
    if (state.zone) navigate(state.zone.out_path);
  }, [state.zone, navigate]);

  const goToNotes = useCallback(async () => {
    if (!state.zone) return;
    const notesDir = state.zone.out_path + "/.notes";
    await dms.createDir(notesDir);
    navigate(notesDir);
  }, [state.zone, navigate]);

  const goToKanban = useCallback(async () => {
    if (!state.zone) return;
    const kanbanDir = state.zone.out_path + "/.kanban";
    await dms.createDir(kanbanDir);
    navigate(kanbanDir);
  }, [state.zone, navigate]);

  const browsingSource = state.zone
    ? (state.currentPath === state.zone.in_path  || state.currentPath.startsWith(state.zone.in_path  + "/"))
    : true;
  const browsingWorkspace = state.zone
    ? (state.currentPath === state.zone.out_path || state.currentPath.startsWith(state.zone.out_path + "/"))
    : false;
  const browsingNotes = state.zone
    ? (state.currentPath === state.zone.out_path + "/.notes" || state.currentPath.startsWith(state.zone.out_path + "/.notes/"))
    : false;
  const browsingKanban = state.zone
    ? (state.currentPath === state.zone.out_path + "/.kanban" || state.currentPath.startsWith(state.zone.out_path + "/.kanban/"))
    : false;

  const entries: FileBrowserEntry[] = useMemo(() => {
    const baseEntries = state.entries.map((entry) => {
      const overlay = transferEntries[entry.path];
      return {
        name: entry.name,
        path: entry.path,
        kind: entry.kind === "dir" ? "dir" : "file",
        size: entry.size,
        modified: entry.modified,
        indexed: entry.indexed,
        transferLabel: overlay?.transferLabel,
        transferProgress: overlay?.transferProgress,
        transferOperation: overlay?.transferOperation,
      } satisfies FileBrowserEntry;
    });

    const present = new Set(baseEntries.map((entry) => entry.path));
    const optimistic = Object.values(transferEntries)
      .filter((entry) => entry.destDir === state.currentPath && !present.has(entry.path))
      .map((entry) => ({
        name: entry.name,
        path: entry.path,
        kind: entry.kind,
        size: entry.size,
        modified: entry.modified,
        indexed: false,
        transferLabel: entry.transferLabel,
        transferProgress: entry.transferProgress,
        transferOperation: entry.transferOperation,
      } satisfies FileBrowserEntry));

    return [...baseEntries, ...optimistic];
  }, [state.currentPath, state.entries, transferEntries]);

  const toolbarTop = state.zone ? (
    <>
      <div className="flex items-center gap-0.5 px-2 pt-1.5 pb-1">
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-black/5 dark:bg-white/5 border border-[var(--theme-border)] flex-1">
          <button
            onClick={goToSource}
            title={`Source: ${state.zone.in_path}`}
            className={`flex-1 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded transition-all ${
              browsingSource
                ? "bg-[var(--theme-surface)] shadow-sm text-emerald-500"
                : "text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
            }`}
          >
            {i18n._({ id: "Source", message: "Source" })}
          </button>
          <button
            onClick={goToWorkspace}
            title={`Workspace: ${state.zone.out_path}`}
            className={`flex-1 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded transition-all ${
              browsingWorkspace
                ? "bg-[var(--theme-surface)] shadow-sm text-blue-500"
                : "text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
            }`}
          >
            {i18n._({ id: "Workspace", message: "Workspace" })}
          </button>
        </div>
      </div>

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
          <span>{i18n._({ id: "Notes", message: "Notes" })}</span>
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
          <span>{i18n._({ id: "Kanban", message: "Kanban" })}</span>
        </button>
      </div>
    </>
  ) : undefined;

  const toolbarRight = !state.zone ? (
    <button
      onClick={selectInboxFolder}
      className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-[var(--theme-primary)] hover:opacity-90 text-[var(--theme-primary-fg)] transition-colors shrink-0"
    >
      {i18n._({ id: "Browse…", message: "Browse…" })}
    </button>
  ) : (
    <button
      onClick={bulkIndex}
      disabled={state.indexing}
      title="Index all files in this folder"
      className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-[var(--theme-primary)] hover:opacity-90 disabled:opacity-40 text-[var(--theme-primary-fg)] transition-colors shrink-0"
    >
      {state.indexing ? "…" : i18n._({ id: "Index", message: "Index" })}
    </button>
  );

  const statusBar = state.indexStatus.total > 0 ? (
    <div className="px-3 py-2 border-t border-[var(--theme-border)] text-[10px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)] shrink-0 bg-[var(--theme-bg)]/50">
      <span className="text-[var(--theme-text)]">{state.indexStatus.indexed}</span>
      <span className="mx-1">/</span>
      <span>{state.indexStatus.total}{" "}{i18n._({ id: "indexed", message: "indexed" })}</span>
      {state.indexStatus.errors > 0 && (
        <span className="text-[var(--theme-danger)] ml-auto float-right">{state.indexStatus.errors}{" "}{i18n._({ id: "errors", message: "errors" })}</span>
      )}
    </div>
  ) : undefined;

  return (
    <>
      <FileBrowser
        entries={entries}
        currentPath={state.currentPath}
        loading={loading}
        error={state.error}
        onNavigate={navigate}
        onFileOpen={path => dispatch({ type: "SELECT_FILE", path })}
        onSelectionChange={onSelectionChange}
        onFocus={onFocus}
        onListSubdirs={listSubdirs}
        toolbarTop={toolbarTop}
        toolbarRight={toolbarRight}
        statusBar={statusBar}
        keyboardScheme={keyboardScheme}
        renderIcon={entry => (
          <FileIcon entry={{ ...entry, kind: entry.kind } as FsEntry} />
        )}
        renderThumbnail={entry => {
          if (!isImageFile(entry.path)) return null;
          const url = "local://local" + entry.path.split("/").map(encodeURIComponent).join("/");
          return <LazyImage src={url} alt={entry.name} className="w-full h-full object-cover" />;
        }}
      />
      <ImportSelectBox />
    </>
  );
};

export { FileBrowserWrapper as FileBrowser };
export default FileBrowserWrapper;
