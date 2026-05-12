import React, { useEffect, useMemo, useState } from "react";
import { useLingui } from "@lingui/react";
import { i18n } from "@/i18n";
import Widget from "../ui/Widget";
import { Icon } from "../Icon";
import { dms, type FolderDashboardData } from "../../services/dms-service";

function fmtBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function fmtDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

const FolderDashboard: React.FC<{
  path: string;
  onNavigate: (path: string, isDir: boolean) => void;
}> = ({ path, onNavigate }) => {
  useLingui();
  const [data, setData] = useState<FolderDashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [workflowFilter, setWorkflowFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    dms.lifecycle.folderDashboard(path).then((res) => {
      if (!cancelled && res.ok && res.data) setData(res.data);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [path]);

  const workflowLabels = useMemo(() => {
    const map = new Map<string, string>();
    data?.workflow.states.forEach((state) => map.set(state.key, state.label));
    return map;
  }, [data]);

  const hotItems = useMemo(() => {
    if (!data) return [];
    if (workflowFilter === "all") return data.hotItems;
    return data.hotItems.filter((item) => item.workflowState === workflowFilter);
  }, [data, workflowFilter]);

  if (loading && !data) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-[var(--theme-text-muted)]">
        {i18n._({ id: "Loading folder dashboard…", message: "Loading folder dashboard…" })}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-[var(--theme-text-muted)]">
        {i18n._({ id: "No folder data available", message: "No folder data available" })}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--theme-bg)] p-4">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[var(--theme-text-muted)]">
              {i18n._({ id: "Folder Dashboard", message: "Folder Dashboard" })}
            </p>
            <h2 className="text-2xl font-black text-[var(--theme-text)] mt-1">{data.name}</h2>
            <p className="text-[11px] text-[var(--theme-text-muted)] font-mono break-all">{data.path}</p>
          </div>
          {data.parentPath && (
            <button
              onClick={() => onNavigate(data.parentPath, true)}
              className="px-3 py-1.5 rounded-xl border border-[var(--theme-border)] text-[11px] font-bold text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-surface)] transition-colors"
            >
              {i18n._({ id: "Parent Folder", message: "Parent Folder" })}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <Widget title={i18n._({ id: "Overview", message: "Overview" })} icon={<Icon name="folder" size="xs" />} className="xl:col-span-4">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-[24px] font-black text-[var(--theme-text)]">{data.fileCount}</p>
                <p className="text-[9px] uppercase tracking-widest font-bold text-[var(--theme-text-muted)]">{i18n._({ id: "Files", message: "Files" })}</p>
              </div>
              <div>
                <p className="text-[24px] font-black text-[var(--theme-text)]">{data.directoryCount}</p>
                <p className="text-[9px] uppercase tracking-widest font-bold text-[var(--theme-text-muted)]">{i18n._({ id: "Folders", message: "Folders" })}</p>
              </div>
              <div>
                <p className="text-[24px] font-black text-[var(--theme-text)]">{fmtBytes(data.totalSize)}</p>
                <p className="text-[9px] uppercase tracking-widest font-bold text-[var(--theme-text-muted)]">{i18n._({ id: "Size", message: "Size" })}</p>
              </div>
            </div>
          </Widget>

          <Widget title={i18n._({ id: "Workflow", message: "Workflow" })} icon={<Icon name="layers" size="xs" />} className="xl:col-span-4">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setWorkflowFilter("all")}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition-colors ${workflowFilter === "all" ? "bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] border-[var(--theme-primary)]" : "border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)]"}`}
              >
                {i18n._({ id: "All", message: "All" })}
              </button>
              {data.workflowCounts.map((item) => (
                <button
                  key={item.stateKey}
                  onClick={() => setWorkflowFilter(item.stateKey)}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition-colors ${workflowFilter === item.stateKey ? "bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] border-[var(--theme-primary)]" : "border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)]"}`}
                >
                  {workflowLabels.get(item.stateKey) ?? item.stateKey} · {item.count}
                </button>
              ))}
            </div>
          </Widget>

          <Widget title={i18n._({ id: "Heatmap", message: "Heatmap" })} icon={<Icon name="clock" size="xs" />} className="xl:col-span-4">
            <div className="flex items-end gap-1 h-20">
              {data.heatmap.map((cell) => (
                <div key={cell.dayOffset} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t bg-[var(--theme-primary)]/70"
                    style={{ height: `${Math.max(10, cell.count * 10)}px`, opacity: Math.min(1, 0.25 + cell.count * 0.2) }}
                    title={`${cell.count} items`}
                  />
                  <span className="text-[8px] text-[var(--theme-text-muted)]">{cell.dayOffset === 0 ? "0" : `-${cell.dayOffset}`}</span>
                </div>
              ))}
            </div>
          </Widget>

          <Widget title={i18n._({ id: "Hot Items", message: "Hot Items" })} icon={<Icon name="trending-up" size="xs" />} className="xl:col-span-7">
            <div className="space-y-1.5">
              {hotItems.length === 0 ? (
                <p className="text-[11px] text-[var(--theme-text-muted)]">{i18n._({ id: "No items match the current filter.", message: "No items match the current filter." })}</p>
              ) : hotItems.map((item) => (
                <button
                  key={item.path}
                  onClick={() => onNavigate(item.path, false)}
                  className="w-full text-left px-3 py-2 rounded-xl border border-[var(--theme-border)] hover:bg-[var(--theme-surface)] transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold text-[var(--theme-text)] truncate">{item.name}</p>
                      <p className="text-[9px] text-[var(--theme-text-muted)] font-mono truncate">{item.path}</p>
                    </div>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--theme-primary)]">
                      {workflowLabels.get(item.workflowState ?? "") ?? item.workflowState ?? ""}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[9px] text-[var(--theme-text-muted)]">
                    <span>{fmtDate(item.mtime)}</span>
                    <span>{fmtBytes(item.size)}</span>
                  </div>
                </button>
              ))}
            </div>
          </Widget>

          <Widget title={i18n._({ id: "Tag Cloud", message: "Tag Cloud" })} icon={<Icon name="tag" size="xs" />} className="xl:col-span-5">
            <div className="flex flex-wrap gap-1.5">
              {data.tagCloud.length === 0 ? (
                <p className="text-[11px] text-[var(--theme-text-muted)]">{i18n._({ id: "No tags yet.", message: "No tags yet." })}</p>
              ) : data.tagCloud.map((tag) => (
                <span key={tag.tag} className="px-2 py-1 rounded-full bg-[var(--theme-surface)] border border-[var(--theme-border)] text-[10px] text-[var(--theme-text)]">
                  {tag.tag} <span className="text-[var(--theme-text-muted)]">{tag.count}</span>
                </span>
              ))}
            </div>
          </Widget>

          <Widget title={i18n._({ id: "Recent Files", message: "Recent Files" })} icon={<Icon name="clock" size="xs" />} className="xl:col-span-6">
            <div className="space-y-1.5">
              {data.recentItems.map((item) => (
                <button
                  key={item.path}
                  onClick={() => onNavigate(item.path, false)}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-[var(--theme-surface)] transition-colors"
                >
                  <p className="text-[11px] font-bold text-[var(--theme-text)] truncate">{item.name}</p>
                  <div className="mt-0.5 flex items-center justify-between text-[9px] text-[var(--theme-text-muted)]">
                    <span>{fmtDate(item.mtime)}</span>
                    <span>{fmtBytes(item.size)}</span>
                  </div>
                </button>
              ))}
            </div>
          </Widget>

          <Widget title={i18n._({ id: "Blockers & Revisit", message: "Blockers & Revisit" })} icon={<Icon name="link" size="xs" />} className="xl:col-span-6">
            <div className="space-y-1.5">
              {data.links.length === 0 ? (
                <p className="text-[11px] text-[var(--theme-text-muted)]">{i18n._({ id: "No blockers or revisit links for this folder.", message: "No blockers or revisit links for this folder." })}</p>
              ) : data.links.map((link) => (
                <div key={link.id} className="px-3 py-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--theme-primary)]">{link.type}</span>
                    <span className="text-[9px] text-[var(--theme-text-muted)]">{fmtDate(link.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-[10px] text-[var(--theme-text)] break-all">{link.note || `${link.sourceRef} → ${link.targetRef}`}</p>
                </div>
              ))}
            </div>
          </Widget>
        </div>
      </div>
    </div>
  );
};

export default FolderDashboard;
