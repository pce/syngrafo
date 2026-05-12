import React, { useState, useEffect, useCallback, useRef } from "react";
import { useLingui } from "@lingui/react";
import { i18n } from "@/i18n";
import { useDms } from "../../store/dms-store";
import {
  dms,
  type ZoneWorkflow,
  type WorkflowState,
  type WorkflowTransition,
  type FolderDashboardData,
  type FolderDashboardItem,
} from "../../services/dms-service";
import { Icon } from "../Icon";

function fmtBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Format a Unix-seconds timestamp as a short relative duration. */
function timeAgo(unixSec: number): string {
  const diffMs = Date.now() - unixSec * 1000;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return i18n._({ id: "just now", message: "just now" });
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export interface WorkflowsPageProps {
  /** Optionally pre-scroll to a specific workflow state section. */
  stateFilter?: string;
  /** Navigate back (e.g., to zone dashboard). */
  onClose: () => void;
  /** Open ZoneDashboard workflow editor. */
  onEditWorkflow: () => void;
}

// ─── SchemaPanel ─────────────────────────────────────────────────────────────

interface SchemaPanelProps {
  workflow: ZoneWorkflow | null;
  loading: boolean;
  error: string | null;
  onEditWorkflow: () => void;
}

const SchemaPanel: React.FC<SchemaPanelProps> = ({ workflow, loading, error, onEditWorkflow }) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-[var(--theme-text-muted)]">
        <span className="w-4 h-4 border-2 border-[var(--theme-primary)]/20 border-t-[var(--theme-primary)] rounded-full animate-spin" />
        <span className="text-xs font-bold uppercase tracking-widest">
          {i18n._({ id: "Loading…", message: "Loading…" })}
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 flex items-start gap-2 text-xs text-red-500">
        <Icon name="warning" size="xs" className="mt-0.5 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  if (!workflow || workflow.states.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-6 py-16 text-center">
        <Icon name="layers" size="lg" className="opacity-20 text-[var(--theme-text)]" />
        <p className="text-xs font-bold text-[var(--theme-text)]">
          {i18n._({ id: "No workflow defined for this zone", message: "No workflow defined for this zone" })}
        </p>
        <p className="text-[10px] text-[var(--theme-text-muted)] max-w-xs leading-relaxed">
          {i18n._({
            id: "Define states and transitions in the zone settings.",
            message: "Define states and transitions in the zone settings.",
          })}
        </p>
        <button
          onClick={onEditWorkflow}
          className="mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] text-[10px] font-bold hover:opacity-90 transition-opacity"
        >
          <Icon name="edit" size="xs" />
          {i18n._({ id: "Edit Workflow", message: "Edit Workflow" })}
        </button>
      </div>
    );
  }

  const orderedStates = [...workflow.states].sort((a, b) => a.sortOrder - b.sortOrder);

  const outgoing = (stateKey: string): WorkflowTransition[] =>
    workflow.transitions
      .filter((t) => t.from === stateKey)
      .sort((a, b) => a.sortOrder - b.sortOrder);

  const stateLabel = (key: string): string =>
    workflow.states.find((s) => s.key === key)?.label ?? key;

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--theme-text-muted)] mb-0.5">
          {i18n._({ id: "Workflow Schema", message: "Workflow Schema" })}
        </p>
        <h2 className="text-base font-black text-[var(--theme-text)]">{workflow.name}</h2>
        <p className="text-[10px] text-[var(--theme-text-muted)] mt-0.5">
          {orderedStates.length}{" "}
          {i18n._({ id: "states", message: "states" })}
          {" · "}
          {workflow.transitions.length}{" "}
          {i18n._({ id: "transitions", message: "transitions" })}
        </p>
      </div>

      <div className="space-y-2">
        {orderedStates.map((ws) => {
          const txns = outgoing(ws.key);
          return (
            <div
              key={ws.key}
              className="rounded-xl border border-[var(--theme-border)] overflow-hidden bg-[var(--theme-surface)]"
              style={{ borderLeftColor: ws.color || "#64748b", borderLeftWidth: "3px" }}
            >
              <div className="px-3 py-2.5">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[var(--theme-text)] truncate">{ws.label}</p>
                    <p className="text-[9px] font-mono text-[var(--theme-text-muted)] opacity-60 mt-0.5">
                      {ws.key}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap justify-end shrink-0">
                    {ws.isDefault && (
                      <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wide bg-[var(--theme-primary)]/10 text-[var(--theme-primary)] whitespace-nowrap">
                        {i18n._({ id: "Default", message: "Default" })}
                      </span>
                    )}
                    {ws.isTerminal && (
                      <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wide bg-red-500/10 text-red-500 whitespace-nowrap">
                        {i18n._({ id: "Terminal", message: "Terminal" })}
                      </span>
                    )}
                    {ws.category && (
                      <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wide bg-[var(--theme-bg)] border border-[var(--theme-border)] text-[var(--theme-text-muted)] whitespace-nowrap">
                        {ws.category}
                      </span>
                    )}
                  </div>
                </div>

                {txns.length > 0 && (
                  <ul className="mt-2 space-y-0.5 pl-0.5">
                    {txns.map((t) => (
                      <li
                        key={`${t.from}-${t.to}`}
                        className="flex items-center gap-1 text-[9px] text-[var(--theme-text-muted)]"
                      >
                        <Icon name="arrow-right" size="xs" className="shrink-0 opacity-40" />
                        <span className="font-semibold text-[var(--theme-text)] opacity-70">
                          {stateLabel(t.to)}
                        </span>
                        {t.label && (
                          <>
                            <span className="opacity-30 mx-0.5">·</span>
                            <span className="italic opacity-60">{t.label}</span>
                          </>
                        )}
                        {t.requiresReason && (
                          <span
                            title={i18n._({ id: "Reason required", message: "Reason required" })}
                            className="ml-auto text-amber-400 opacity-70"
                          >
                            <Icon name="info" size="xs" />
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── TransitionCard ───────────────────────────────────────────────────────────

interface TransitionCardProps {
  item: FolderDashboardItem;
  workflow: ZoneWorkflow;
  onDone: () => void;
  onDeselect: () => void;
}

const TransitionCard: React.FC<TransitionCardProps> = ({ item, workflow, onDone, onDeselect }) => {
  const currentStateKey = item.workflowState ?? "";
  const currentState = workflow.states.find((s) => s.key === currentStateKey);
  const transitions = workflow.transitions
    .filter((t) => t.from === currentStateKey)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingTxn, setPendingTxn] = useState<WorkflowTransition | null>(null);
  const [reason, setReason] = useState("");

  const stateLabel = (key: string) => workflow.states.find((s) => s.key === key)?.label ?? key;
  const stateColor = (key: string) => workflow.states.find((s) => s.key === key)?.color ?? "#64748b";

  const executeTransition = useCallback(
    async (t: WorkflowTransition, reasonText: string) => {
      setBusy(true);
      setError(null);
      const res = await dms.lifecycle.transition(item.path, t.to, "user", reasonText);
      setBusy(false);
      if (!res.ok) {
        setError(res.error ?? i18n._({ id: "Transition failed", message: "Transition failed" }));
        return;
      }
      setPendingTxn(null);
      setReason("");
      onDone();
    },
    [item.path, onDone],
  );

  const initiateTransition = (t: WorkflowTransition) => {
    if (t.requiresReason) {
      setPendingTxn(t);
      setReason("");
    } else {
      void executeTransition(t, "");
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-[var(--theme-primary)]/30 bg-[var(--theme-surface)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--theme-border)] bg-[var(--theme-primary)]/5">
        <Icon name="arrow-right" size="xs" className="text-[var(--theme-primary)] shrink-0" />
        <span className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text)] flex-1">
          {i18n._({ id: "Transition", message: "Transition" })}
        </span>
        <button
          onClick={onDeselect}
          disabled={busy}
          className="p-0.5 rounded hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors disabled:opacity-40"
          title={i18n._({ id: "Deselect", message: "Deselect" })}
        >
          <Icon name="close" size="xs" />
        </button>
      </div>

      <div className="px-3 py-3 space-y-2">
        <p
          className="text-[11px] font-semibold text-[var(--theme-text)] truncate"
          title={item.path}
        >
          {item.name}
        </p>
        <p className="text-[10px] text-[var(--theme-text-muted)]">
          {i18n._({ id: "Current state:", message: "Current state:" })}{" "}
          <span className="font-bold" style={{ color: currentState?.color || "inherit" }}>
            {(currentState?.label ?? currentStateKey) || i18n._({ id: "(none)", message: "(none)" })}
          </span>
        </p>

        {pendingTxn ? (
          <div className="space-y-2 pt-1">
            <p className="text-[10px] text-[var(--theme-text)]">
              {i18n._({ id: "Reason required to move to", message: "Reason required to move to" })}{" "}
              <span className="font-bold" style={{ color: stateColor(pendingTxn.to) }}>
                {stateLabel(pendingTxn.to)}
              </span>
              {":"}
            </p>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && reason.trim()) void executeTransition(pendingTxn, reason);
              }}
              placeholder={i18n._({ id: "Enter reason…", message: "Enter reason…" })}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[11px] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:border-[var(--theme-primary)]/60 transition-colors"
              autoFocus
              disabled={busy}
            />
            <div className="flex gap-1.5">
              <button
                onClick={() => { setPendingTxn(null); setReason(""); }}
                disabled={busy}
                className="flex-1 px-2 py-1.5 rounded-lg border border-[var(--theme-border)] text-[10px] font-bold text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] hover:text-[var(--theme-text)] transition-colors disabled:opacity-40"
              >
                {i18n._({ id: "Cancel", message: "Cancel" })}
              </button>
              <button
                onClick={() => void executeTransition(pendingTxn, reason)}
                disabled={!reason.trim() || busy}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] text-[10px] font-bold hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {busy && (
                  <span className="w-3 h-3 border border-[var(--theme-primary-fg)]/40 border-t-[var(--theme-primary-fg)] rounded-full animate-spin" />
                )}
                {i18n._({ id: "Confirm", message: "Confirm" })}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-1 pt-1">
            {transitions.length === 0 ? (
              <p className="text-[10px] text-[var(--theme-text-muted)] italic">
                {i18n._({
                  id: "No transitions available from this state.",
                  message: "No transitions available from this state.",
                })}
              </p>
            ) : (
              transitions.map((t) => (
                <button
                  key={`${t.from}-${t.to}`}
                  onClick={() => initiateTransition(t)}
                  disabled={busy}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-[var(--theme-border)] text-[10px] font-bold text-[var(--theme-text)] hover:bg-[var(--theme-bg)] hover:border-[var(--theme-primary)]/30 transition-colors disabled:opacity-40 group"
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0 transition-transform group-hover:scale-110"
                    style={{ backgroundColor: stateColor(t.to) }}
                  />
                  <Icon name="arrow-right" size="xs" className="shrink-0 opacity-40" />
                  <span className="flex-1 text-left truncate">{stateLabel(t.to)}</span>
                  {t.label && (
                    <span className="opacity-40 font-normal italic truncate max-w-[80px]">
                      {t.label}
                    </span>
                  )}
                  {t.requiresReason && (
                    <span
                      title={i18n._({ id: "Reason required", message: "Reason required" })}
                      className="shrink-0 text-amber-400 opacity-70"
                    >
                      <Icon name="info" size="xs" />
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-1.5 text-[10px] text-red-500 pt-1">
            <Icon name="warning" size="xs" className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── InstancesPanel ───────────────────────────────────────────────────────────

interface InstancesPanelProps {
  workflow: ZoneWorkflow | null;
  dashboard: FolderDashboardData | null;
  dashLoading: boolean;
  dashError: string | null;
  selectedItem: FolderDashboardItem | null;
  stateFilter?: string;
  onSelectDoc: (item: FolderDashboardItem) => void;
  onDeselect: () => void;
  onTransitionDone: () => void;
  onReload: () => void;
}

const InstancesPanel: React.FC<InstancesPanelProps> = ({
  workflow,
  dashboard,
  dashLoading,
  dashError,
  selectedItem,
  stateFilter,
  onSelectDoc,
  onDeselect,
  onTransitionDone,
  onReload,
}) => {
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  /** Scroll the stateFilter section into view once data is ready. */
  useEffect(() => {
    if (!stateFilter || !workflow || !dashboard) return;
    const el = sectionRefs.current.get(stateFilter);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [stateFilter, workflow, dashboard]);

  const countForState = (key: string): number =>
    dashboard?.workflowCounts.find((wc) => wc.stateKey === key)?.count ?? 0;

  const itemsForState = (key: string): FolderDashboardItem[] =>
    (dashboard?.hotItems ?? []).filter((it) => it.workflowState === key);

  const orderedStates: WorkflowState[] = workflow
    ? [...workflow.states].sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--theme-border)] bg-[var(--theme-surface)] shrink-0">
        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--theme-text-muted)]">
          {i18n._({ id: "Instances by State", message: "Instances by State" })}
        </span>
        <div className="flex-1" />
        <button
          onClick={onReload}
          disabled={dashLoading}
          className="p-1 rounded hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors disabled:opacity-40"
          title={i18n._({ id: "Reload", message: "Reload" })}
        >
          <svg
            className={`w-3.5 h-3.5 ${dashLoading ? "animate-spin" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {dashLoading && !dashboard && (
          <div className="flex items-center justify-center gap-2 py-12 text-[var(--theme-text-muted)]">
            <span className="w-4 h-4 border-2 border-[var(--theme-primary)]/20 border-t-[var(--theme-primary)] rounded-full animate-spin" />
            <span className="text-xs font-bold uppercase tracking-widest">
              {i18n._({ id: "Loading…", message: "Loading…" })}
            </span>
          </div>
        )}

        {!dashLoading && dashError && (
          <div className="flex items-start gap-2 p-3 rounded-xl border border-red-500/20 bg-red-500/5 text-red-500 text-xs">
            <Icon name="warning" size="xs" className="mt-0.5 shrink-0" />
            <span>{dashError}</span>
          </div>
        )}

        {!workflow && !dashLoading && !dashError && (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Icon name="activity" size="lg" className="opacity-20 text-[var(--theme-text)]" />
            <p className="text-xs text-[var(--theme-text-muted)]">
              {i18n._({ id: "No workflow loaded.", message: "No workflow loaded." })}
            </p>
          </div>
        )}

        {workflow && dashboard && (
          <div className="space-y-3">
            {orderedStates.map((ws) => {
              const items = itemsForState(ws.key);
              const count = countForState(ws.key);
              const isHighlighted = stateFilter === ws.key;

              return (
                <div
                  key={ws.key}
                  ref={(el) => { if (el) sectionRefs.current.set(ws.key, el); }}
                  className={`rounded-xl border overflow-hidden transition-colors ${
                    isHighlighted
                      ? "border-[var(--theme-primary)]/40 bg-[var(--theme-primary)]/5"
                      : "border-[var(--theme-border)] bg-[var(--theme-surface)]"
                  }`}
                >
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--theme-border)]">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: ws.color || "#64748b" }}
                    />
                    <span className="text-xs font-bold text-[var(--theme-text)]">{ws.label}</span>
                    <span className="ml-auto px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-[var(--theme-bg)] border border-[var(--theme-border)] text-[var(--theme-text-muted)]">
                      {count}
                    </span>
                  </div>

                  {items.length === 0 ? (
                    <p className="px-3 py-3 text-[10px] text-[var(--theme-text-muted)] italic">
                      {i18n._({
                        id: "No documents in this state.",
                        message: "No documents in this state.",
                      })}
                    </p>
                  ) : (
                    <ul className="divide-y divide-[var(--theme-border)]">
                      {items.map((item) => {
                        const isSelected = selectedItem?.path === item.path;
                        return (
                          <li
                            key={item.path}
                            onClick={() => onSelectDoc(item)}
                            className={`flex items-start gap-2 px-3 py-2 cursor-pointer transition-colors group ${
                              isSelected
                                ? "bg-[var(--theme-primary)]/10"
                                : "hover:bg-[var(--theme-bg)]"
                            }`}
                          >
                            <Icon
                              name="file"
                              size="xs"
                              className={`mt-0.5 shrink-0 ${
                                isSelected
                                  ? "text-[var(--theme-primary)]"
                                  : "text-[var(--theme-text-muted)]"
                              }`}
                            />
                            <div className="flex-1 min-w-0">
                              <p
                                className={`text-[11px] font-semibold truncate ${
                                  isSelected
                                    ? "text-[var(--theme-primary)]"
                                    : "text-[var(--theme-text)]"
                                }`}
                              >
                                {item.name}
                              </p>
                              <p className="text-[9px] text-[var(--theme-text-muted)] font-mono truncate opacity-60">
                                {item.path}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-[9px] text-[var(--theme-text-muted)] opacity-70">
                                {timeAgo(item.mtime)}
                              </p>
                              <p className="text-[9px] text-[var(--theme-text-muted)] opacity-50 mt-0.5">
                                {fmtBytes(item.size)}
                              </p>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}

            {selectedItem && (
              <TransitionCard
                item={selectedItem}
                workflow={workflow}
                onDone={onTransitionDone}
                onDeselect={onDeselect}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── WorkflowsPage ────────────────────────────────────────────────────────────

const WorkflowsPage: React.FC<WorkflowsPageProps> = ({ stateFilter, onClose, onEditWorkflow }) => {
  const { state } = useDms();
  useLingui();
  const zone = state.zone;

  const [workflow, setWorkflow] = useState<ZoneWorkflow | null>(null);
  const [wfLoading, setWfLoading] = useState(false);
  const [wfError, setWfError] = useState<string | null>(null);

  const [dashboard, setDashboard] = useState<FolderDashboardData | null>(null);
  const [dashLoading, setDashLoading] = useState(false);
  const [dashError, setDashError] = useState<string | null>(null);

  const [selectedItem, setSelectedItem] = useState<FolderDashboardItem | null>(null);

  const loadWorkflow = useCallback(async (zoneName: string) => {
    setWfLoading(true);
    setWfError(null);
    const res = await dms.lifecycle.workflow(zoneName);
    if (res.ok && res.data) setWorkflow(res.data);
    else setWfError(res.error ?? i18n._({ id: "Failed to load workflow", message: "Failed to load workflow" }));
    setWfLoading(false);
  }, []);

  const loadDashboard = useCallback(async (inPath: string) => {
    setDashLoading(true);
    setDashError(null);
    const res = await dms.lifecycle.folderDashboard(inPath, 50);
    if (res.ok && res.data) setDashboard(res.data);
    else setDashError(res.error ?? i18n._({ id: "Failed to load instances", message: "Failed to load instances" }));
    setDashLoading(false);
  }, []);

  useEffect(() => {
    if (!zone) return;
    void loadWorkflow(zone.name);
    void loadDashboard(zone.in_path);
  }, [zone, loadWorkflow, loadDashboard]);

  const handleTransitionDone = () => {
    setSelectedItem(null);
    if (zone) void loadDashboard(zone.in_path);
  };

  if (!zone) {
    return (
      <div className="h-full flex flex-col bg-[var(--theme-bg)]">
        <header className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--theme-border)] bg-[var(--theme-surface)] shrink-0">
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors"
          >
            <Icon name="arrow-left" size="xs" />
          </button>
          <span className="text-xs font-black uppercase tracking-widest text-[var(--theme-text)]">
            {i18n._({ id: "Workflows", message: "Workflows" })}
          </span>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
          <Icon name="layers" size="lg" className="opacity-20 text-[var(--theme-text)]" />
          <p className="text-sm font-bold text-[var(--theme-text)]">
            {i18n._({ id: "No active zone", message: "No active zone" })}
          </p>
          <p className="text-xs text-[var(--theme-text-muted)] max-w-xs leading-relaxed">
            {i18n._({
              id: "Open a zone first to manage its workflow.",
              message: "Open a zone first to manage its workflow.",
            })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[var(--theme-bg)] overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--theme-border)] bg-[var(--theme-surface)] shrink-0">
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors shrink-0"
          title={i18n._({ id: "Back", message: "Back" })}
        >
          <Icon name="arrow-left" size="xs" />
        </button>

        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-bold text-[var(--theme-text)] truncate">{zone.name}</span>
          <span className="text-[var(--theme-text-muted)] opacity-40 text-xs">·</span>
          <span className="text-xs font-black uppercase tracking-widest text-[var(--theme-text)]">
            {i18n._({ id: "Workflows", message: "Workflows" })}
          </span>
        </div>

        <div className="flex-1" />

        <button
          onClick={onEditWorkflow}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[var(--theme-border)] text-[10px] font-bold text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-bg)] transition-colors shrink-0"
        >
          <Icon name="edit" size="xs" />
          <span>{i18n._({ id: "Edit", message: "Edit" })}</span>
        </button>
      </header>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
        <aside className="md:w-[40%] shrink-0 border-b md:border-b-0 md:border-r border-[var(--theme-border)] overflow-y-auto">
          <SchemaPanel
            workflow={workflow}
            loading={wfLoading}
            error={wfError}
            onEditWorkflow={onEditWorkflow}
          />
        </aside>

        <div className="flex-1 min-w-0 overflow-hidden">
          <InstancesPanel
            workflow={workflow}
            dashboard={dashboard}
            dashLoading={dashLoading}
            dashError={dashError}
            selectedItem={selectedItem}
            stateFilter={stateFilter}
            onSelectDoc={setSelectedItem}
            onDeselect={() => setSelectedItem(null)}
            onTransitionDone={handleTransitionDone}
            onReload={() => void loadDashboard(zone.in_path)}
          />
        </div>
      </div>
    </div>
  );
};

export default WorkflowsPage;
