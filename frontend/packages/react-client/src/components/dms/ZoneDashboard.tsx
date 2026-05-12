/**
 * ZoneDashboard.tsx — Zone Landing Page.
 *
 * Displayed when a user enters a Zone (clicks the Zone button / compass icon).
 * A beautifully arranged responsive widget grid showing:
 *   • Today's date & greeting
 *   • Bookmarks / Shortcuts
 *   • Recent files
 *   • Zone info & stats
 *   • Color palette (brand / project styleguide)
 */

import React, { useState, useEffect } from "react";
import { useLingui } from "@lingui/react";
import { i18n } from "@/i18n";
import { useDms } from "../../store/dms-store";
import { dms, type Bookmark, type DiskUsageInfo, type ZoneDiskUsage, type ZoneWorkflow, type WorkflowState, type WorkflowTransition } from "@/services/dms-service.ts";
import { Icon } from "../Icon";
import type { IconName } from "../Icon";
import NetHealthWidget from "../widgets/NetHealthWidget";
import WelcomeToDayWidget from "../widgets/WelcomeToDayWidget";
import Widget from "../ui/Widget";
import { useNetHealth } from "../../hooks/useNetHealth";

const IC = (n: string) => n as IconName;


const ZoneInfoWidget: React.FC<{
  zone: { name: string; description: string; taxonomy_domain: string; in_path: string; out_path: string };
  onEdit: () => void;
}> = ({ zone, onEdit }) => {
  useLingui();
  return (
    <Widget title={i18n._({ id: "Zone", message: "Zone" })} icon={<Icon name={IC("layers")} size="xs" />}>
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-black text-[var(--theme-text)] truncate">{zone.name}</p>
            {zone.taxonomy_domain && zone.taxonomy_domain !== "General" && (
              <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)] opacity-70">
                {zone.taxonomy_domain}
              </span>
            )}
          </div>
          <button
            onClick={onEdit}
            className="shrink-0 p-1 rounded hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)] transition-colors"
            title={i18n._({ id: "Edit Zone", message: "Edit Zone" })}
          >
            <Icon name="edit" size="xs" />
          </button>
        </div>
        {zone.description && (
          <p className="text-[11px] text-[var(--theme-text-muted)] leading-relaxed line-clamp-3">
            {zone.description}
          </p>
        )}
        <div className="mt-1 flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 text-[9px] text-[var(--theme-text-muted)] font-mono truncate">
            <Icon name="folder" size="xs" />
            <span className="truncate">{zone.in_path}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[9px] text-[var(--theme-text-muted)] font-mono truncate">
            <Icon name="database" size="xs" />
            <span className="truncate">{zone.out_path}</span>
          </div>
        </div>
      </div>
    </Widget>
  );
};

const BookmarksWidget: React.FC<{
  bookmarks: Bookmark[];
  zoneName: string;
  onNavigate: (path: string, isDir: boolean) => void;
  onManage: () => void;
}> = ({ bookmarks, zoneName, onNavigate, onManage }) => {
  useLingui();
  const handleGoTo = async (bm: Bookmark) => {
    const res = await dms.bookmark.resolve(zoneName, bm.root, bm.target);
    if (res.ok && res.data?.abs_path)
      onNavigate(res.data.abs_path, res.data.kind === "folder");
  };

  return (
    <Widget
      title={i18n._({ id: "Bookmarks", message: "Bookmarks" })}
      icon={<Icon name="bookmark" size="xs" />}
      className="col-span-2"
    >
      {bookmarks.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <Icon name="bookmark" size="md" className="text-[var(--theme-text-muted)] opacity-30" />
          <p className="text-[11px] text-[var(--theme-text-muted)]">{i18n._({ id: "No bookmarks yet.", message: "No bookmarks yet." })}</p>
          <button onClick={onManage} className="text-[10px] font-bold text-[var(--theme-primary)] hover:underline">
            {i18n._({ id: "Manage Bookmarks →", message: "Manage Bookmarks →" })}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {bookmarks.slice(0, 6).map((bm) => (
            <button
              key={bm.id}
              onClick={() => handleGoTo(bm)}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-[var(--theme-bg)] transition-colors text-left group"
            >
              <span className="shrink-0 w-6 h-6 rounded-lg flex items-center justify-center"
                style={{ background: "var(--theme-primary)", opacity: 0.15 }}>
                <Icon
                  name={bm.kind === "folder" ? "folder" : "file"}
                  size="xs"
                  className="text-[var(--theme-primary)]"
                  style={{ opacity: 1 }}
                />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[var(--theme-text)] truncate">{bm.label}</p>
                <p className="text-[9px] font-mono text-[var(--theme-text-muted)] truncate">{bm.target}</p>
              </div>
              <Icon
                name="arrow-right"
                size="xs"
                className="shrink-0 text-[var(--theme-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
              />
            </button>
          ))}
          <button
            onClick={onManage}
            className="mt-1.5 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-bold text-[var(--theme-primary)] hover:bg-[var(--theme-bg)] transition-colors"
          >
            <Icon name="list" size="xs" />
            Manage all {bookmarks.length > 6 ? `${bookmarks.length} ` : ""}Bookmarks
          </button>
        </div>
      )}
    </Widget>
  );
};

interface StatsData { total: number; indexed: number; lastIndexed?: number }

const StatsWidget: React.FC<{ data: StatsData | null }> = ({ data }) => {
  useLingui();
  return (
    <Widget title={i18n._({ id: "Overview", message: "Overview" })} icon={<Icon name={IC("trending-up")} size="xs" />}>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-2xl font-black text-[var(--theme-text)]">{data?.total ?? "–"}</span>
          <span className="text-[9px] text-[var(--theme-text-muted)] uppercase tracking-widest font-bold">{i18n._({ id: "Docs indexed", message: "Docs indexed" })}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-2xl font-black text-[var(--theme-text)]">{data?.indexed ?? "–"}</span>
          <span className="text-[9px] text-[var(--theme-text-muted)] uppercase tracking-widest font-bold">{i18n._({ id: "Searchable", message: "Searchable" })}</span>
        </div>
        {data?.lastIndexed && data.lastIndexed > 0 && (
          <div className="col-span-2 flex items-center gap-1.5 mt-1">
            <Icon name={IC("clock")} size="xs" className="text-[var(--theme-text-muted)]" />
            <span className="text-[9px] text-[var(--theme-text-muted)]">
              Last indexed {new Date(data.lastIndexed).toLocaleDateString()}
            </span>
          </div>
        )}
      </div>
    </Widget>
  );
};

const ColorPaletteWidget: React.FC<{ zoneName: string }> = ({ zoneName }) => {
  useLingui();
  const storageKey = `zone_palette_${zoneName}`;

  const [colors, setColors] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [picker, setPicker] = useState(false);
  const [newColor, setNewColor] = useState("#6366f1");

  const persist = (next: string[]) => {
    setColors(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };

  const addColor = () => {
    if (!colors.includes(newColor)) persist([...colors, newColor]);
    setPicker(false);
  };

  const removeColor = (c: string) => persist(colors.filter((x) => x !== c));

  return (
    <Widget
      title={i18n._({ id: "Color Palette", message: "Color Palette" })}
      icon={<Icon name={IC("color-swatch")} size="xs" />}
      className="col-span-2"
    >
      <div className="flex flex-col gap-3">
        <p className="text-[10px] text-[var(--theme-text-muted)] leading-relaxed">
          {i18n._({ id: "Brand / project styleguide colours saved to this Zone.", message: "Brand / project styleguide colours saved to this Zone." })}
        </p>

        <div className="flex flex-wrap gap-2 items-center">
          {colors.map((c) => (
            <div key={c} className="relative group">
              <div
                className="w-9 h-9 rounded-xl border-2 border-transparent group-hover:border-[var(--theme-text-muted)]/40 transition-all cursor-pointer shadow-sm"
                style={{ background: c }}
                title={c}
              />
              <button
                onClick={() => removeColor(c)}
                className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-[var(--theme-danger)] text-white text-[8px] hidden group-hover:flex items-center justify-center leading-none"
                title={i18n._({ id: "Remove", message: "Remove" })}
              >
                ×
              </button>
            </div>
          ))}

          {picker ? (
            <div className="flex items-center gap-1.5">
              <input
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                className="w-9 h-9 rounded-xl border border-[var(--theme-border)] cursor-pointer"
              />
              <button
                onClick={addColor}
                className="px-2 py-1 text-[9px] font-black rounded-lg bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] hover:opacity-90 transition-opacity"
              >
                {i18n._({ id: "Add", message: "Add" })}
              </button>
              <button
                onClick={() => setPicker(false)}
                className="px-2 py-1 text-[9px] font-bold rounded-lg border border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] transition-colors"
              >
                {i18n._({ id: "Cancel", message: "Cancel" })}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setPicker(true)}
              className="w-9 h-9 rounded-xl border-2 border-dashed border-[var(--theme-border)] hover:border-[var(--theme-primary)]/60 flex items-center justify-center text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)] transition-colors"
              title={i18n._({ id: "Add colour", message: "Add colour" })}
            >
              <Icon name="plus" size="xs" />
            </button>
          )}
        </div>

        {colors.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {colors.map((c) => (
              <span key={c} className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                style={{ background: `${c}20`, color: c, border: `1px solid ${c}40` }}>
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    </Widget>
  );
};


function humanSize(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
  const v = bytes / (1 << (i * 10));
  return `${i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

const Donut: React.FC<{
  ratio: number;       // 0.0 – 1.0
  size?: number;       // viewBox size (default 80)
  stroke?: number;     // ring thickness (default 10)
  color?: string;
  bg?: string;
}> = ({ ratio, size = 80, stroke = 10, color = "var(--theme-primary)", bg = "var(--theme-border)" }) => {
  const r   = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const used = Math.max(0, Math.min(1, ratio)) * circ;
  const cx  = size / 2;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={cx} cy={cx} r={r} fill="none"
        stroke={bg} strokeWidth={stroke} />
      <circle cx={cx} cy={cx} r={r} fill="none"
        stroke={color} strokeWidth={stroke}
        strokeDasharray={`${used} ${circ}`}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.5s ease" }} />
    </svg>
  );
};

const DiskUsageRow: React.FC<{ label: string; info: DiskUsageInfo }> = ({ label, info }) => {
  useLingui();
  const pct = Math.round(info.usedRatio * 100);
  // Color gradient: green → amber → red by usage
  const color =
    pct < 60 ? "var(--theme-success, #22c55e)"
    : pct < 80 ? "var(--theme-warning, #f59e0b)"
    : "var(--theme-danger, #ef4444)";

  return (
    <div className="flex items-center gap-3">
      <Donut ratio={info.usedRatio} size={56} stroke={7} color={color} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)]">
            {label}
          </span>
          <span className="text-[10px] font-black tabular-nums"
            style={{ color }}>{pct}%</span>
        </div>
        <div className="h-1 rounded-full overflow-hidden bg-[var(--theme-border)]">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${pct}%`, background: color }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[9px] text-[var(--theme-text-muted)] font-mono">
            {humanSize(info.used)} {i18n._({ id: "used", message: "used" })}
          </span>
          <span className="text-[9px] text-[var(--theme-text-muted)] font-mono">
            {humanSize(info.available)} {i18n._({ id: "free", message: "free" })}
          </span>
        </div>
        <p className="text-[8px] text-[var(--theme-text-muted)] font-mono truncate mt-0.5 opacity-60">
          {info.path}
        </p>
      </div>
    </div>
  );
};

interface DiskUsageState {
  data:    ZoneDiskUsage | null;
  loading: boolean;
  error:   string | null;
}

const DiskUsageWidget: React.FC<DiskUsageState> = ({ data, loading, error }) => {
  useLingui();
  return (
    <Widget title={i18n._({ id: "Disk Usage", message: "Disk Usage" })} icon={<Icon name={IC("database")} size="xs" />}>
      {loading ? (
        <p className="text-[10px] text-[var(--theme-text-muted)] animate-pulse py-2">{i18n._({ id: "Loading…", message: "Loading…" })}</p>
      ) : error ? (
        <p className="text-[10px] text-[var(--theme-danger,#ef4444)]">{error}</p>
      ) : data ? (
        <div className="flex flex-col gap-4">
          <DiskUsageRow label={i18n._({ id: "Input path", message: "Input path" })} info={data.in_path} />
          {data.out_path && (
            <DiskUsageRow label={i18n._({ id: "Workspace", message: "Workspace" })} info={data.out_path} />
          )}
          <p className="text-[8px] text-[var(--theme-text-muted)] opacity-50 leading-tight">
            Volume capacity: {humanSize(data.in_path.capacity)}
          </p>
        </div>
      ) : null}
    </Widget>
  );
};

const ZONE_MODE_LABELS: Record<string, { label: { id: string; message: string }; icon: string }> = {
  "general":              { label: { id: "General", message: "General" }, icon: "layers"  },
  "document-management":  { label: { id: "Document Management", message: "Document Management" }, icon: "document" },
  "creative-workbench":   { label: { id: "Creative Workbench", message: "Creative Workbench" }, icon: "sparkles" },
  "game-assets-2d":       { label: { id: "Game Assets — 2D Zone", message: "Game Assets — 2D Zone" }, icon: "grid"    },
  "game-assets-3d":       { label: { id: "Game Assets — 3D Zone", message: "Game Assets — 3D Zone" }, icon: "cube"    },
  "social-media":         { label: { id: "Social Media Studio", message: "Social Media Studio" }, icon: "share"   },
  "photography":          { label: { id: "Photography", message: "Photography" }, icon: "image"   },
};

const ZoneModeBadge: React.FC<{ mode: string }> = ({ mode }) => {
  useLingui();
  const meta = ZONE_MODE_LABELS[mode] ?? ZONE_MODE_LABELS["general"];
  if (!meta) return null;
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest"
      style={{ background: "var(--theme-border)", color: "var(--theme-text-muted)" }}>
      <Icon name={IC(meta.icon)} size="xs" />
      {i18n._(meta.label)}
    </span>
  );
};

const QuickActionsWidget: React.FC<{
  onManageBookmarks: () => void;
  onEditZone: () => void;
  onTheme: () => void;
}> = ({ onManageBookmarks, onEditZone, onTheme }) => {
  useLingui();
  const actions = [
    { icon: "bookmark" as const, label: i18n._({ id: "Bookmarks", message: "Bookmarks" }),  action: onManageBookmarks  },
    { icon: "edit"     as const, label: i18n._({ id: "Edit Zone", message: "Edit Zone" }),   action: onEditZone        },
    { icon: "sparkles" as const, label: i18n._({ id: "Theme", message: "Theme" }),       action: onTheme           },
  ];
  return (
    <Widget title={i18n._({ id: "Quick Actions", message: "Quick Actions" })} icon={<Icon name={IC("star")} size="xs" />}>
      <div className="flex flex-col gap-1">
        {actions.map(({ icon, label, action }) => (
          <button
            key={label}
            onClick={action}
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-[var(--theme-bg)] transition-colors text-left group"
          >
            <Icon name={icon} size="xs" className="text-[var(--theme-text-muted)] group-hover:text-[var(--theme-primary)] transition-colors" />
            <span className="text-xs font-semibold text-[var(--theme-text)]">{label}</span>
            <Icon name="chevron-right" size="xs" className="ml-auto text-[var(--theme-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        ))}
      </div>
    </Widget>
  );
};

function makeWorkflowStateKey(label: string, fallbackIndex: number): string {
  const cleaned = label
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return cleaned || `STATE_${fallbackIndex + 1}`;
}

const WorkflowEditorWidget: React.FC<{
  workflow: ZoneWorkflow | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  onChange: (next: ZoneWorkflow) => void;
  onSave: () => void;
  onReload: () => void;
}> = ({ workflow, loading, saving, error, onChange, onSave, onReload }) => {
  useLingui();

  if (loading) {
    return (
      <Widget title={i18n._({ id: "Workflow Schema", message: "Workflow Schema" })} icon={<Icon name={IC("flow")} size="xs" />}>
        <p className="text-[10px] text-[var(--theme-text-muted)] animate-pulse py-2">{i18n._({ id: "Loading workflow…", message: "Loading workflow…" })}</p>
      </Widget>
    );
  }

  if (!workflow) return null;

  const updateStates = (states: WorkflowState[]) => onChange({ ...workflow, states });
  const updateTransitions = (transitions: WorkflowTransition[]) => onChange({ ...workflow, transitions });
  const renameStateKey = (oldKey: string, nextKey: string, nextStates: WorkflowState[]) => {
    const nextTransitions = oldKey === nextKey ? workflow.transitions : workflow.transitions.map((transition) => ({
      ...transition,
      from: transition.from === oldKey ? nextKey : transition.from,
      to: transition.to === oldKey ? nextKey : transition.to,
    }));
    onChange({ ...workflow, states: nextStates, transitions: nextTransitions });
  };

  const setDefaultState = (key: string) => {
    updateStates(workflow.states.map((state) => ({ ...state, isDefault: state.key === key })));
  };

  const removeState = (key: string) => {
    const remaining = workflow.states.filter((state) => state.key !== key);
    if (remaining.length === 0) return;
    if (!remaining.some((state) => state.isDefault)) remaining[0] = { ...remaining[0], isDefault: true };
    updateStates(remaining);
    updateTransitions(workflow.transitions.filter((transition) => transition.from !== key && transition.to !== key));
  };

  const addState = () => {
    const index = workflow.states.length;
    updateStates([
      ...workflow.states,
      {
        key: `STATE_${index + 1}`,
        label: `State ${index + 1}`,
        color: "#64748b",
        category: "custom",
        isDefault: workflow.states.length === 0,
        isTerminal: false,
        sortOrder: (index + 1) * 10,
      },
    ]);
  };

  const addTransition = () => {
    if (workflow.states.length < 2) return;
    updateTransitions([
      ...workflow.transitions,
      {
        from: workflow.states[0]?.key ?? "",
        to: workflow.states[1]?.key ?? workflow.states[0]?.key ?? "",
        label: workflow.states[1]?.label ?? workflow.states[0]?.label ?? "Transition",
        requiresReason: false,
        sortOrder: (workflow.transitions.length + 1) * 10,
      },
    ]);
  };

  return (
    <Widget
      title={i18n._({ id: "Workflow Schema", message: "Workflow Schema" })}
      icon={<Icon name={IC("flow")} size="xs" />}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <label className="flex-1 min-w-0">
            <span className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)]">
              {i18n._({ id: "Workflow name", message: "Workflow name" })}
            </span>
            <input
              value={workflow.name}
              onChange={(e) => onChange({ ...workflow, name: e.target.value })}
              className="mt-1 w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-xs text-[var(--theme-text)]"
              placeholder={i18n._({ id: "Workflow name placeholder", message: "Editorial workflow" })}
            />
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={onReload}
              className="px-3 py-2 rounded-xl border border-[var(--theme-border)] text-[10px] font-bold text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] transition-colors"
            >
              {i18n._({ id: "Reload workflow", message: "Reload" })}
            </button>
            <button
              onClick={onSave}
              disabled={saving}
              className="px-3 py-2 rounded-xl bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] text-[10px] font-black hover:opacity-90 disabled:opacity-60 transition-opacity"
            >
              {saving ? i18n._({ id: "Saving workflow", message: "Saving…" }) : i18n._({ id: "Save workflow", message: "Save workflow" })}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-[var(--theme-danger,#ef4444)]/30 bg-[var(--theme-danger,#ef4444)]/10 px-3 py-2 text-[10px] text-[var(--theme-danger,#ef4444)]">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <section className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)]">
                  {i18n._({ id: "States", message: "States" })}
                </p>
                <p className="text-[10px] text-[var(--theme-text-muted)]">
                  {i18n._({ id: "States help", message: "Exactly one default state is required." })}
                </p>
              </div>
              <button
                onClick={addState}
                className="px-2.5 py-1.5 rounded-lg border border-[var(--theme-border)] text-[10px] font-bold text-[var(--theme-text-muted)] hover:bg-[var(--theme-surface)] transition-colors"
              >
                {i18n._({ id: "Add state", message: "Add state" })}
              </button>
            </div>
            <div className="space-y-3">
              {workflow.states.map((state, index) => (
                <div key={state.key || index} className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3">
                  <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr] gap-2">
                    <label>
                      <span className="text-[8px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)]">{i18n._({ id: "Label", message: "Label" })}</span>
                      <input
                        value={state.label}
                        onChange={(e) => {
                          const next = [...workflow.states];
                          const oldKey = next[index].key;
                          const label = e.target.value;
                          next[index] = { ...next[index], label, key: makeWorkflowStateKey(label, index) };
                          renameStateKey(oldKey, next[index].key, next);
                        }}
                        className="mt-1 w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2.5 py-1.5 text-xs text-[var(--theme-text)]"
                      />
                    </label>
                    <label>
                      <span className="text-[8px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)]">{i18n._({ id: "Key", message: "Key" })}</span>
                      <input
                        value={state.key}
                        onChange={(e) => {
                          const next = [...workflow.states];
                          const oldKey = next[index].key;
                          next[index] = { ...next[index], key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") };
                          renameStateKey(oldKey, next[index].key, next);
                        }}
                        className="mt-1 w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2.5 py-1.5 text-xs font-mono text-[var(--theme-text)]"
                      />
                    </label>
                  </div>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-[auto_1fr_1fr_auto] gap-2 items-end">
                    <label>
                      <span className="text-[8px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)]">{i18n._({ id: "Color", message: "Color" })}</span>
                      <input
                        type="color"
                        value={state.color || "#64748b"}
                        onChange={(e) => {
                          const next = [...workflow.states];
                          next[index] = { ...next[index], color: e.target.value };
                          updateStates(next);
                        }}
                        className="mt-1 h-9 w-12 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)]"
                      />
                    </label>
                    <label>
                      <span className="text-[8px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)]">{i18n._({ id: "Category", message: "Category" })}</span>
                      <input
                        value={state.category}
                        onChange={(e) => {
                          const next = [...workflow.states];
                          next[index] = { ...next[index], category: e.target.value };
                          updateStates(next);
                        }}
                        className="mt-1 w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2.5 py-1.5 text-xs text-[var(--theme-text)]"
                      />
                    </label>
                    <div className="flex gap-4 px-1 pb-1">
                      <label className="flex items-center gap-1.5 text-[10px] text-[var(--theme-text-muted)]">
                        <input type="radio" checked={state.isDefault} onChange={() => setDefaultState(state.key)} />
                        {i18n._({ id: "Default", message: "Default" })}
                      </label>
                      <label className="flex items-center gap-1.5 text-[10px] text-[var(--theme-text-muted)]">
                        <input
                          type="checkbox"
                          checked={state.isTerminal}
                          onChange={(e) => {
                            const next = [...workflow.states];
                            next[index] = { ...next[index], isTerminal: e.target.checked };
                            updateStates(next);
                          }}
                        />
                        {i18n._({ id: "Terminal", message: "Terminal" })}
                      </label>
                    </div>
                    <button
                      onClick={() => removeState(state.key)}
                      disabled={workflow.states.length === 1}
                      className="h-9 px-2.5 rounded-lg border border-[var(--theme-border)] text-[10px] font-bold text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] disabled:opacity-40 transition-colors"
                    >
                      {i18n._({ id: "Remove", message: "Remove" })}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)]">
                  {i18n._({ id: "Transitions", message: "Transitions" })}
                </p>
                <p className="text-[10px] text-[var(--theme-text-muted)]">
                  {i18n._({ id: "Transitions help", message: "Allowed moves between workflow states." })}
                </p>
              </div>
              <button
                onClick={addTransition}
                disabled={workflow.states.length < 2}
                className="px-2.5 py-1.5 rounded-lg border border-[var(--theme-border)] text-[10px] font-bold text-[var(--theme-text-muted)] hover:bg-[var(--theme-surface)] disabled:opacity-40 transition-colors"
              >
                {i18n._({ id: "Add transition", message: "Add transition" })}
              </button>
            </div>
            <div className="space-y-3">
              {workflow.transitions.length === 0 ? (
                <p className="text-[10px] text-[var(--theme-text-muted)]">{i18n._({ id: "No transitions yet", message: "No transitions yet." })}</p>
              ) : workflow.transitions.map((transition, index) => (
                <div key={`${transition.from}-${transition.to}-${index}`} className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3">
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-2">
                    <label>
                      <span className="text-[8px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)]">{i18n._({ id: "From", message: "From" })}</span>
                      <select
                        value={transition.from}
                        onChange={(e) => {
                          const next = [...workflow.transitions];
                          next[index] = { ...next[index], from: e.target.value };
                          updateTransitions(next);
                        }}
                        className="mt-1 w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2.5 py-1.5 text-xs text-[var(--theme-text)]"
                      >
                        {workflow.states.map((state) => <option key={state.key} value={state.key}>{state.label}</option>)}
                      </select>
                    </label>
                    <label>
                      <span className="text-[8px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)]">{i18n._({ id: "To", message: "To" })}</span>
                      <select
                        value={transition.to}
                        onChange={(e) => {
                          const next = [...workflow.transitions];
                          next[index] = { ...next[index], to: e.target.value };
                          updateTransitions(next);
                        }}
                        className="mt-1 w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2.5 py-1.5 text-xs text-[var(--theme-text)]"
                      >
                        {workflow.states.map((state) => <option key={state.key} value={state.key}>{state.label}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 items-end">
                    <label>
                      <span className="text-[8px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)]">{i18n._({ id: "Action label", message: "Action label" })}</span>
                      <input
                        value={transition.label}
                        onChange={(e) => {
                          const next = [...workflow.transitions];
                          next[index] = { ...next[index], label: e.target.value };
                          updateTransitions(next);
                        }}
                        className="mt-1 w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2.5 py-1.5 text-xs text-[var(--theme-text)]"
                      />
                    </label>
                    <label className="flex items-center gap-1.5 px-1 pb-2 text-[10px] text-[var(--theme-text-muted)]">
                      <input
                        type="checkbox"
                        checked={transition.requiresReason}
                        onChange={(e) => {
                          const next = [...workflow.transitions];
                          next[index] = { ...next[index], requiresReason: e.target.checked };
                          updateTransitions(next);
                        }}
                      />
                      {i18n._({ id: "Reason required", message: "Reason required" })}
                    </label>
                    <button
                      onClick={() => updateTransitions(workflow.transitions.filter((_, rowIndex) => rowIndex !== index))}
                      className="h-9 px-2.5 rounded-lg border border-[var(--theme-border)] text-[10px] font-bold text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] transition-colors"
                    >
                      {i18n._({ id: "Remove transition", message: "Remove" })}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </Widget>
  );
};

interface ZoneDashboardProps {
  onNavigate:        (absPath: string, isDir: boolean) => void;
  onManageBookmarks: () => void;
  onEditZone:        () => void;
  onTheme:           () => void;
  onClose?:          () => void;
}

const ZoneDashboard: React.FC<ZoneDashboardProps> = ({
  onNavigate,
  onManageBookmarks,
  onEditZone,
  onTheme,
  onClose,
}) => {
  const { state } = useDms();
  useLingui();
  const zone = state.zone;
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  const [statsData, setStatsData]       = useState<StatsData | null>(null);
  const [diskData, setDiskData]         = useState<ZoneDiskUsage | null>(null);
  const [diskLoading, setDiskLoading]   = useState(true);
  const [diskError, setDiskError]       = useState<string | null>(null);
  const [workflow, setWorkflow]         = useState<ZoneWorkflow | null>(null);
  const [workflowLoading, setWorkflowLoading] = useState(true);
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const netHealth                       = useNetHealth(3000);

  // Zone Mode persisted to localStorage
  const modeKey = `zone_mode_${zone?.name ?? ""}`;
  const [zoneMode] = useState<string>(() => {
    try { return localStorage.getItem(modeKey) ?? "general"; } catch { return "general"; }
  });

  useEffect(() => {
    if (!zone?.name) return;
    dms.bookmark.list(zone.name).then((r) => {
      if (r.ok && r.data) setBookmarks(r.data);
    });
  }, [zone?.name]);

  useEffect(() => {
    if (!zone?.name) return;
    dms.indexStatus().then((r) => {
      if (r.ok && r.data)
        setStatsData({ total: r.data.totalDocs, indexed: r.data.totalDocs, lastIndexed: r.data.lastIndexedAt });
    });
  }, [zone?.name]);

  useEffect(() => {
    if (!zone?.name) return;
    setDiskLoading(true);
    setDiskError(null);
    dms.zone.diskUsage(zone.name).then((r) => {
      if (r.ok && r.data) setDiskData(r.data);
      else setDiskError(r.error ?? "Unknown error");
      setDiskLoading(false);
    });
  }, [zone?.name]);

  useEffect(() => {
    if (!zone?.name) return;
    setWorkflowLoading(true);
    setWorkflowError(null);
    dms.lifecycle.workflow(zone.name).then((r) => {
      if (r.ok && r.data) setWorkflow(r.data);
      else setWorkflowError(r.error ?? "Failed to load workflow");
      setWorkflowLoading(false);
    });
  }, [zone?.name]);

  const handleReloadWorkflow = () => {
    if (!zone?.name) return;
    setWorkflowLoading(true);
    setWorkflowError(null);
    dms.lifecycle.workflow(zone.name).then((r) => {
      if (r.ok && r.data) setWorkflow(r.data);
      else setWorkflowError(r.error ?? "Failed to load workflow");
      setWorkflowLoading(false);
    });
  };

  const handleSaveWorkflow = async () => {
    if (!zone?.name || !workflow) return;
    const states = workflow.states.map((item, index) => ({
      ...item,
      key: item.key.trim(),
      label: (item.label || item.key).trim(),
      category: (item.category || "custom").trim(),
      color: item.color || "#64748b",
      sortOrder: (index + 1) * 10,
    }));
    if (states.length === 0) {
      setWorkflowError("Workflow must contain at least one state.");
      return;
    }
    if (states.some((item) => !item.key)) {
      setWorkflowError("Every workflow state needs a key.");
      return;
    }
    if (new Set(states.map((item) => item.key)).size !== states.length) {
      setWorkflowError("Workflow state keys must be unique.");
      return;
    }
    if (states.filter((item) => item.isDefault).length !== 1) {
      setWorkflowError("Choose exactly one default workflow state.");
      return;
    }

    const stateKeys = new Set(states.map((item) => item.key));
    const transitions = workflow.transitions.map((item, index) => ({
      ...item,
      from: item.from.trim(),
      to: item.to.trim(),
      label: (item.label || item.to).trim(),
      sortOrder: (index + 1) * 10,
    }));
    if (transitions.some((item) => !stateKeys.has(item.from) || !stateKeys.has(item.to))) {
      setWorkflowError("Every transition must reference existing states.");
      return;
    }
    const transitionPairs = new Set(transitions.map((item) => `${item.from}→${item.to}`));
    if (transitionPairs.size !== transitions.length) {
      setWorkflowError("Workflow transitions must be unique.");
      return;
    }

    setWorkflowSaving(true);
    setWorkflowError(null);
    const res = await dms.lifecycle.saveWorkflow(zone.name, {
      ...workflow,
      name: workflow.name.trim() || `${zone.name} workflow`,
      states,
      transitions,
    });
    setWorkflowSaving(false);
    if (!res.ok || !res.data) {
      setWorkflowError(res.error ?? "Failed to save workflow");
      return;
    }
    setWorkflow(res.data);
  };

  if (!zone) return null;

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--theme-bg)] p-6">
      {/* Page title */}
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1">
            <h1 className="text-xs font-black uppercase tracking-widest text-[var(--theme-text-muted)] mb-0.5">
              {i18n._({ id: "Zone Dashboard", message: "Zone Dashboard" })}
            </h1>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xl font-black text-[var(--theme-text)]">{zone.name}</span>
              <ZoneModeBadge mode={zoneMode} />
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              title={i18n._({ id: "Close dashboard", message: "Close dashboard" })}
              className="p-1.5 rounded-lg hover:bg-[var(--theme-surface)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors shrink-0"
            >
              <Icon name="close" size="xs" />
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-auto">

          <div className="sm:col-span-2 lg:col-span-2">
            <WelcomeToDayWidget zoneName={zone.name} />
          </div>

          <div className="sm:col-span-2 lg:col-span-1">
            <ZoneInfoWidget
              zone={zone}
              onEdit={onEditZone}
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-2">
            <BookmarksWidget
              bookmarks={bookmarks}
              zoneName={zone.name}
              onNavigate={onNavigate}
              onManage={onManageBookmarks}
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-1">
            <QuickActionsWidget
              onManageBookmarks={onManageBookmarks}
              onEditZone={onEditZone}
              onTheme={onTheme}
            />
          </div>

          <div className="sm:col-span-1 lg:col-span-1">
            <StatsWidget data={statsData} />
          </div>

          <div className="sm:col-span-1 lg:col-span-2">
            <DiskUsageWidget data={diskData} loading={diskLoading} error={diskError} />
          </div>

          <div className="sm:col-span-2 lg:col-span-2">
            <ColorPaletteWidget zoneName={zone.name} />
          </div>

          <div className="sm:col-span-2 lg:col-span-1">
            <NetHealthWidget {...netHealth} />
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <WorkflowEditorWidget
              workflow={workflow}
              loading={workflowLoading}
              saving={workflowSaving}
              error={workflowError}
              onChange={setWorkflow}
              onSave={handleSaveWorkflow}
              onReload={handleReloadWorkflow}
            />
          </div>

        </div>
      </div>
    </div>
  );
};

export { ZoneDashboard, ZONE_MODE_LABELS };
export type { ZoneDashboardProps };
export default ZoneDashboard;
