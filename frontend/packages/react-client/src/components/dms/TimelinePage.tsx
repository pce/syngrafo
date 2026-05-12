import React, { useState, useEffect, useCallback } from "react";
import { useLingui } from "@lingui/react";
import { i18n } from "@/i18n";
import { useDms } from "../../store/dms-store";
import { dms, isImageFile, isDocFile, isAudioFile, isTextFile, isSvgFile } from "../../services/dms-service";
import type { FsEntry, ZoneWorkflow } from "../../services/dms-service";
import { Icon } from "../Icon";
import type { IconName } from "../Icon";


function relativeDay(ts: number): string {
  const now   = Date.now();
  const diff  = now - ts;
  const days  = Math.floor(diff / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7)  return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? "s" : ""} ago`;
  if (days < 365) return `${Math.floor(days / 30)} month${Math.floor(days / 30) > 1 ? "s" : ""} ago`;
  return `${Math.floor(days / 365)} year${Math.floor(days / 365) > 1 ? "s" : ""} ago`;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

function fmtSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1_048_576)   return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function fileIconName(entry: FsEntry): IconName {
  if (entry.kind === "dir")           return "folder";
  if (isSvgFile(entry.path))          return "image";
  if (isImageFile(entry.path))        return "image";
  if (isDocFile(entry.path))          return "document";
  if (isAudioFile(entry.path))        return "music";
  if (isTextFile(entry.path))         return "file";
  return "file";
}

function fileIconColor(entry: FsEntry): string {
  if (entry.kind === "dir")           return "text-amber-500/70";
  if (isSvgFile(entry.path))          return "text-violet-400/70";
  if (isImageFile(entry.path))        return "text-indigo-400/70";
  if (isDocFile(entry.path))          return "text-rose-400/70";
  if (isAudioFile(entry.path))        return "text-emerald-400/70";
  if (isTextFile(entry.path))         return "text-[var(--theme-text-muted)] opacity-70";
  return "text-[var(--theme-text-muted)] opacity-50";
}

// Group entries by calendar day (bucket key = YYYY-MM-DD)
function groupByDay(entries: FsEntry[]): Map<string, FsEntry[]> {
  const map = new Map<string, FsEntry[]>();
  for (const e of entries) {
    const ts  = e.modified ?? 0;
    const key = new Date(ts).toISOString().slice(0, 10);
    const arr = map.get(key) ?? [];
    arr.push(e);
    map.set(key, arr);
  }
  return map;
}

type FilterKind = "all" | "files" | "images" | "docs" | "audio";

interface TimelinePageProps {
  /** Called when the user clicks a workflow state link or the "Workflow Schema" button. */
  onNavigateToWorkflows?: (stateFilter?: string) => void;
}


const TimelinePage: React.FC<TimelinePageProps> = ({ onNavigateToWorkflows }) => {
  const { state, dispatch } = useDms();
  useLingui();

  const [entries,  setEntries]  = useState<FsEntry[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [filter,   setFilter]   = useState<FilterKind>("all");
  const [scanPath, setScanPath] = useState<string>("");
  const [workflow, setWorkflow] = useState<ZoneWorkflow | null>(null);
  const [wfCounts, setWfCounts] = useState<Map<string, number>>(new Map());

  const load = useCallback(async (path: string) => {
    if (!path) return;
    setLoading(true);
    const res = await dms.scanDir(path);
    setLoading(false);
    if (res.ok && res.data) {
      // flatten: only files (skip directories for timeline), sort newest-first
      const files = res.data.entries
        .filter((e) => e.kind === "file")
        .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0));
      setEntries(files);
    }
  }, []);

  useEffect(() => {
    const path = state.zone?.out_path ?? state.currentPath;
    if (path && path !== scanPath) {
      setScanPath(path);
      load(path);
    }
  }, [state.zone, state.currentPath, scanPath, load]);

  useEffect(() => {
    if (!state.zone?.name) { setWorkflow(null); setWfCounts(new Map()); return; }
    dms.lifecycle.workflow(state.zone.name).then((r) => {
      if (r.ok && r.data) setWorkflow(r.data);
    });
    const inPath = state.zone.in_path;
    if (inPath) {
      dms.lifecycle.folderDashboard(inPath, 50).then((r) => {
        if (r.ok && r.data) {
          const m = new Map<string, number>();
          for (const c of r.data.workflowCounts) m.set(c.stateKey, c.count);
          setWfCounts(m);
        }
      });
    }
  }, [state.zone?.name, state.zone?.in_path]);

  const filtered = entries.filter((e) => {
    if (filter === "all")    return true;
    if (filter === "images") return isImageFile(e.path);
    if (filter === "docs")   return isDocFile(e.path);
    if (filter === "audio")  return isAudioFile(e.path);
    return e.kind === "file"; // "files" = all files
  });

  const grouped = groupByDay(filtered);
  const dayKeys = Array.from(grouped.keys()).sort((a, b) => b.localeCompare(a)); // newest first

  const activePath = state.zone?.out_path ?? state.currentPath;

  return (
    <div className="h-full flex flex-col bg-[var(--theme-bg)] overflow-hidden">

      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--theme-border)] bg-[var(--theme-surface)] shrink-0">
        <span className="text-xs font-black uppercase tracking-widest text-[var(--theme-text)]">
          {i18n._({ id: "Timeline", message: "Timeline" })}
        </span>

        {activePath && (
          <span
            className="text-[10px] text-[var(--theme-text-muted)] truncate max-w-xs"
            title={activePath}
          >
            {activePath.split("/").slice(-2).join("/")}
          </span>
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-0.5">
          {(["all", "files", "images", "docs", "audio"] as FilterKind[]).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide transition-colors ${
                filter === k
                  ? "bg-[var(--theme-primary)] text-[var(--theme-primary-fg)]"
                  : "text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] hover:text-[var(--theme-text)]"
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        <button
          onClick={() => activePath && load(activePath)}
          disabled={loading}
          title={i18n._({ id: "Reload", message: "Reload" })}
          className="p-1 rounded hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors disabled:opacity-40"
        >
          <svg
            className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
          >
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">

        {state.zone && (
          <aside className="w-44 shrink-0 border-r border-[var(--theme-border)] bg-[var(--theme-surface)] flex flex-col overflow-y-auto">
            <div className="px-3 py-2.5 border-b border-[var(--theme-border)]">
              <p className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 mb-1">
                Zone
              </p>
              <span className="text-xs font-bold text-[var(--theme-text)] truncate block">
                {state.zone.name}
              </span>
            </div>

            {workflow && workflow.states.length > 0 && (
              <div className="px-3 py-2.5 flex flex-col gap-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 mb-1">
                  Workflows
                </p>
                {workflow.states
                  .slice()
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((s) => {
                    const count = wfCounts.get(s.key) ?? 0;
                    return (
                      <button
                        key={s.key}
                        onClick={() => onNavigateToWorkflows?.(s.key)}
                        className="flex items-center gap-1.5 px-2 py-1 rounded text-left w-full hover:bg-[var(--theme-bg)] transition-colors group"
                        title={`View ${s.label} documents`}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: s.color || "var(--theme-primary)" }}
                        />
                        <span className="flex-1 text-[10px] font-semibold text-[var(--theme-text)] truncate">
                          {s.label}
                        </span>
                        {count > 0 && (
                          <span className="text-[9px] font-bold text-[var(--theme-text-muted)] bg-[var(--theme-bg)] rounded-full px-1 shrink-0">
                            {count}
                          </span>
                        )}
                      </button>
                    );
                  })}
              </div>
            )}

            {onNavigateToWorkflows && (
              <div className="mt-auto px-3 py-2.5 border-t border-[var(--theme-border)]">
                <button
                  onClick={() => onNavigateToWorkflows(undefined)}
                  className="flex items-center gap-1 w-full text-[10px] font-bold text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)] transition-colors"
                >
                  <Icon name="layers" size="xs" />
                  <span>Workflow Schema</span>
                  <Icon name="chevron-right" size="xs" className="ml-auto opacity-50" />
                </button>
              </div>
            )}
          </aside>
        )}

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-3">

        {!activePath && !loading && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-16">
            <svg className="w-12 h-12 opacity-20 text-[var(--theme-text)]"
              viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            <p className="text-sm font-bold text-[var(--theme-text)]">{i18n._({ id: "No active zone", message: "No active zone" })}</p>
            <p className="text-xs text-[var(--theme-text-muted)] max-w-xs leading-relaxed">
              {i18n._({ id: "Open a zone from the header to see its file activity timeline here.", message: "Open a zone from the header to see its file activity timeline here." })}
            </p>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-16 gap-2 text-[var(--theme-text-muted)]">
            <span className="w-4 h-4 border-2 border-[var(--theme-primary)]/20 border-t-[var(--theme-primary)] rounded-full animate-spin" />
            <span className="text-xs font-bold uppercase tracking-widest">{i18n._({ id: "Scanning…", message: "Scanning…" })}</span>
          </div>
        )}

        {!loading && activePath && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
            <Icon name="folder" size="lg" className="opacity-20 text-[var(--theme-text)]" />
            <p className="text-sm text-[var(--theme-text-muted)]">{i18n._({ id: "No files found", message: "No files found" })}</p>
          </div>
        )}

        {!loading && dayKeys.map((dayKey) => {
          const dayEntries = grouped.get(dayKey) ?? [];
          const ts         = dayEntries[0]?.modified ?? new Date(dayKey).getTime();

          return (
            <div key={dayKey} className="mb-6">
              <div className="flex items-center gap-2 mb-2 sticky top-0 bg-[var(--theme-bg)] py-1 z-10">
                <span className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-primary)]">
                  {relativeDay(ts)}
                </span>
                <span className="text-[10px] text-[var(--theme-text-muted)] opacity-60">
                  {fmtDate(ts)}
                </span>
                <div className="flex-1 h-px bg-[var(--theme-border)]" />
                <span className="text-[9px] text-[var(--theme-text-muted)] opacity-50">
                  {dayEntries.length} file{dayEntries.length !== 1 ? "s" : ""}
                </span>
              </div>

              <ul className="space-y-1 relative">
                <div
                  className="absolute left-4 top-0 bottom-0 w-px bg-[var(--theme-border)] opacity-40"
                  style={{ transform: "translateX(-50%)" }}
                />

                {dayEntries.map((entry) => {
                  const isSelected = state.selectedPath === entry.path;
                  return (
                    <li
                      key={entry.path}
                      onClick={() => dispatch({ type: "SELECT_FILE", path: entry.path })}
                      className={`relative flex items-start gap-3 pl-8 pr-3 py-2 rounded-lg cursor-pointer transition-colors group ${
                        isSelected
                          ? "bg-[var(--theme-primary)]/10 border border-[var(--theme-primary)]/30"
                          : "hover:bg-[var(--theme-surface)]"
                      }`}
                    >
                      <div
                        className={`absolute left-4 top-3.5 w-2 h-2 rounded-full border-2 -translate-x-1/2 shrink-0 ${
                          isSelected
                            ? "bg-[var(--theme-primary)] border-[var(--theme-primary)]"
                            : "bg-[var(--theme-surface)] border-[var(--theme-border)] group-hover:border-[var(--theme-primary)]/50"
                        }`}
                      />

                      <div className="shrink-0 mt-0.5">
                        <Icon
                          name={fileIconName(entry)}
                          size="xs"
                          className={fileIconColor(entry)}
                        />
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-medium truncate ${
                          isSelected ? "text-[var(--theme-primary)]" : "text-[var(--theme-text)]"
                        }`}>
                          {entry.name}
                        </p>
                        <p className="text-[10px] text-[var(--theme-text-muted)] truncate opacity-60 mt-0.5">
                          {entry.path}
                        </p>
                      </div>

                      <div className="shrink-0 text-right">
                        {entry.modified && (
                          <p className="text-[10px] text-[var(--theme-text-muted)] font-mono opacity-70">
                            {fmtTime(entry.modified)}
                          </p>
                        )}
                        {entry.size !== undefined && (
                          <p className="text-[9px] text-[var(--theme-text-muted)] opacity-50 mt-0.5">
                            {fmtSize(entry.size)}
                          </p>
                        )}
                        {entry.indexed && (
                          <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wide bg-[var(--theme-primary)]/10 text-[var(--theme-primary)]">
                            {i18n._({ id: "indexed", message: "indexed" })}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TimelinePage;
