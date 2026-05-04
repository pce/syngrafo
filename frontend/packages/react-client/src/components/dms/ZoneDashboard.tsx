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
import { useDms } from "../../store/dms-store";
import { dms, type Bookmark, type DiskUsageInfo, type ZoneDiskUsage } from "@/services/dms-service.ts";
import Icon from "../Icon";
import type { IconName } from "../Icon";
import NetHealthWidget from "../widgets/NetHealthWidget";
import WelcomeToDayWidget from "../widgets/WelcomeToDayWidget";
import Widget from "../ui/Widget";
import { useNetHealth } from "../../hooks/useNetHealth";

const IC = (n: string) => n as IconName;


// ZoneInfoWidget
const ZoneInfoWidget: React.FC<{
  zone: { name: string; description: string; taxonomy_domain: string; in_path: string; out_path: string };
  onEdit: () => void;
}> = ({ zone, onEdit }) => (
  <Widget title="Zone" icon={<Icon name={IC("layers")} size="xs" />}>
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
          title="Edit Zone"
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

// BookmarksWidget
const BookmarksWidget: React.FC<{
  bookmarks: Bookmark[];
  zoneName: string;
  onNavigate: (path: string, isDir: boolean) => void;
  onManage: () => void;
}> = ({ bookmarks, zoneName, onNavigate, onManage }) => {
  const handleGoTo = async (bm: Bookmark) => {
    const res = await dms.bookmark.resolve(zoneName, bm.target);
    if (res.ok && res.data?.abs_path)
      onNavigate(res.data.abs_path, res.data.kind === "folder");
  };

  return (
    <Widget
      title="Bookmarks"
      icon={<Icon name="bookmark" size="xs" />}
      className="col-span-2"
    >
      {bookmarks.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <Icon name="bookmark" size="md" className="text-[var(--theme-text-muted)] opacity-30" />
          <p className="text-[11px] text-[var(--theme-text-muted)]">No bookmarks yet.</p>
          <button onClick={onManage} className="text-[10px] font-bold text-[var(--theme-primary)] hover:underline">
            Manage Bookmarks →
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

/** Pure render — data fetching is owned by ZoneDashboard. */
const StatsWidget: React.FC<{ data: StatsData | null }> = ({ data }) => (
    <Widget title="Overview" icon={<Icon name={IC("trending-up")} size="xs" />}>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-2xl font-black text-[var(--theme-text)]">{data?.total ?? "–"}</span>
          <span className="text-[9px] text-[var(--theme-text-muted)] uppercase tracking-widest font-bold">Docs indexed</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-2xl font-black text-[var(--theme-text)]">{data?.indexed ?? "–"}</span>
          <span className="text-[9px] text-[var(--theme-text-muted)] uppercase tracking-widest font-bold">Searchable</span>
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

// ── ColorPaletteWidget ────────────────────────────────────────────────────────

/**
 * Zone color palette — stores brand / project styleguide colors per zone.
 * Persisted to localStorage keyed by zone name (future: zone DB).
 */
const ColorPaletteWidget: React.FC<{ zoneName: string }> = ({ zoneName }) => {
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
      title="Color Palette"
      icon={<Icon name={IC("color-swatch")} size="xs" />}
      className="col-span-2"
    >
      <div className="flex flex-col gap-3">
        <p className="text-[10px] text-[var(--theme-text-muted)] leading-relaxed">
          Brand / project styleguide colours saved to this Zone.
        </p>

        {/* Colour swatches */}
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
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}

          {/* Add colour button */}
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
                Add
              </button>
              <button
                onClick={() => setPicker(false)}
                className="px-2 py-1 text-[9px] font-bold rounded-lg border border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setPicker(true)}
              className="w-9 h-9 rounded-xl border-2 border-dashed border-[var(--theme-border)] hover:border-[var(--theme-primary)]/60 flex items-center justify-center text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)] transition-colors"
              title="Add colour"
            >
              <Icon name="plus" size="xs" />
            </button>
          )}
        </div>

        {/* Hex values */}
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


/** Format bytes → human-readable string (no library, no rounding surprises). */
function humanSize(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
  const v = bytes / (1 << (i * 10));
  return `${i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

/** SVG donut ring — pure CSS, no chart library. */
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
      {/* background track */}
      <circle cx={cx} cy={cx} r={r} fill="none"
        stroke={bg} strokeWidth={stroke} />
      {/* used arc */}
      <circle cx={cx} cy={cx} r={r} fill="none"
        stroke={color} strokeWidth={stroke}
        strokeDasharray={`${used} ${circ}`}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.5s ease" }} />
    </svg>
  );
};

/** Disk-usage row for one path (in_path or out_path). */
const DiskUsageRow: React.FC<{ label: string; info: DiskUsageInfo }> = ({ label, info }) => {
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
        {/* bar */}
        <div className="h-1 rounded-full overflow-hidden bg-[var(--theme-border)]">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${pct}%`, background: color }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[9px] text-[var(--theme-text-muted)] font-mono">
            {humanSize(info.used)} used
          </span>
          <span className="text-[9px] text-[var(--theme-text-muted)] font-mono">
            {humanSize(info.available)} free
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

/** Pure render — data fetching is owned by ZoneDashboard. */
const DiskUsageWidget: React.FC<DiskUsageState> = ({ data, loading, error }) => (
    <Widget title="Disk Usage" icon={<Icon name={IC("database")} size="xs" />}>
      {loading ? (
        <p className="text-[10px] text-[var(--theme-text-muted)] animate-pulse py-2">Loading…</p>
      ) : error ? (
        <p className="text-[10px] text-[var(--theme-danger,#ef4444)]">{error}</p>
      ) : data ? (
        <div className="flex flex-col gap-4">
          <DiskUsageRow label="Input path" info={data.in_path} />
          {data.out_path && (
            <DiskUsageRow label="Workspace" info={data.out_path} />
          )}
          <p className="text-[8px] text-[var(--theme-text-muted)] opacity-50 leading-tight">
            Volume capacity: {humanSize(data.in_path.capacity)}
          </p>
        </div>
      ) : null}
    </Widget>
);

//  ZoneModeBadge
const ZONE_MODE_LABELS: Record<string, { label: string; icon: string }> = {
  "general":              { label: "General",               icon: "layers"  },
  "document-management":  { label: "Document Management",   icon: "document" },
  "creative-workbench":   { label: "Creative Workbench",    icon: "sparkles" },
  "game-assets-2d":       { label: "Game Assets — 2D Zone", icon: "grid"    },
  "game-assets-3d":       { label: "Game Assets — 3D Zone", icon: "cube"    },
  "social-media":         { label: "Social Media Studio",   icon: "share"   },
  "photography":          { label: "Photography",           icon: "image"   },
};

const ZoneModeBadge: React.FC<{ mode: string }> = ({ mode }) => {
  const meta = ZONE_MODE_LABELS[mode] ?? ZONE_MODE_LABELS["general"];
  if (!meta) return null;
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest"
      style={{ background: "var(--theme-border)", color: "var(--theme-text-muted)" }}>
      <Icon name={IC(meta.icon)} size="xs" />
      {meta.label}
    </span>
  );
};

// QuickActionsWidget
const QuickActionsWidget: React.FC<{
  onManageBookmarks: () => void;
  onEditZone: () => void;
  onTheme: () => void;
}> = ({ onManageBookmarks, onEditZone, onTheme }) => {
  const actions = [
    { icon: "bookmark" as const, label: "Bookmarks",  action: onManageBookmarks  },
    { icon: "edit"     as const, label: "Edit Zone",   action: onEditZone        },
    { icon: "sparkles" as const, label: "Theme",       action: onTheme           },
  ];
  return (
    <Widget title="Quick Actions" icon={<Icon name={IC("star")} size="xs" />}>
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

// ── Main ZoneDashboard ────────────────────────────────────────────────────────

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
  const zone = state.zone;
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  // ── query state owned here; widgets are pure renderers ────────────────────
  const [statsData, setStatsData]       = useState<StatsData | null>(null);
  const [diskData, setDiskData]         = useState<ZoneDiskUsage | null>(null);
  const [diskLoading, setDiskLoading]   = useState(true);
  const [diskError, setDiskError]       = useState<string | null>(null);
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

  if (!zone) return null;

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--theme-bg)] p-6">
      {/* Page title */}
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1">
            <h1 className="text-xs font-black uppercase tracking-widest text-[var(--theme-text-muted)] mb-0.5">
              Zone Dashboard
            </h1>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xl font-black text-[var(--theme-text)]">{zone.name}</span>
              <ZoneModeBadge mode={zoneMode} />
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              title="Close dashboard"
              className="p-1.5 rounded-lg hover:bg-[var(--theme-surface)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors shrink-0"
            >
              <Icon name="close" size="xs" />
            </button>
          )}
        </div>

        {/* Widget grid — responsive 3-col layout */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-auto">

          {/* [ col 0-1 ] Date & Time — spans 2 cols */}
          <div className="sm:col-span-2 lg:col-span-2">
            <WelcomeToDayWidget zoneName={zone.name} />
          </div>

          {/* [ col 2 ] Zone Info */}
          <div className="sm:col-span-2 lg:col-span-1">
            <ZoneInfoWidget
              zone={zone}
              onEdit={onEditZone}
            />
          </div>

          {/* Bookmarks — spans 2 */}
          <div className="sm:col-span-2 lg:col-span-2">
            <BookmarksWidget
              bookmarks={bookmarks}
              zoneName={zone.name}
              onNavigate={onNavigate}
              onManage={onManageBookmarks}
            />
          </div>

          {/* Quick actions */}
          <div className="sm:col-span-2 lg:col-span-1">
            <QuickActionsWidget
              onManageBookmarks={onManageBookmarks}
              onEditZone={onEditZone}
              onTheme={onTheme}
            />
          </div>

          {/* Stats */}
          <div className="sm:col-span-1 lg:col-span-1">
            <StatsWidget data={statsData} />
          </div>

          {/* Disk Usage */}
          <div className="sm:col-span-1 lg:col-span-2">
            <DiskUsageWidget data={diskData} loading={diskLoading} error={diskError} />
          </div>

          {/* Color Palette */}
          <div className="sm:col-span-2 lg:col-span-2">
            <ColorPaletteWidget zoneName={zone.name} />
          </div>

          {/* Net Health — fills last col */}
          <div className="sm:col-span-2 lg:col-span-1">
            <NetHealthWidget {...netHealth} />
          </div>

        </div>
      </div>
    </div>
  );
};

export { ZoneDashboard, ZONE_MODE_LABELS };
export type { ZoneDashboardProps };
export default ZoneDashboard;
