import React, { useState, useEffect, useRef, useCallback } from "react";
import { useDms } from "../store/dms-store";
import { dms } from "../services/dms-service";
import { nlp } from "../services/nlp-service";
import type { Zone } from "../services/dms-service";
import FileBrowser from "./dms/FileBrowser";
import DocumentViewer from "./dms/DocumentViewer";
import NotesView from "./dms/NotesView";
import KanbanView from "./dms/KanbanView";
import AnalysisPanel from "./dms/AnalysisPanel";
import ZonePanel from "./dms/ZonePanel";
import SearchBar from "./dms/SearchBar";
import SearchResults from "./dms/SearchResults";
import FilePanel from "./dms/FilePanel";
import CommandBar from "./dms/CommandBar";
import ThemePanel from "./ThemePanel";
import BookmarksView from "./collections/BookmarksView";
import Icon from "./Icon";
import TimelinePage from "./dms/TimelinePage";
import ZoneDashboard from "./dms/ZoneDashboard";
import { EditorPortal } from "./EditorPortal";

// Zone avatar colour (stable hash)
const PALETTE = [
  "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500",
  "bg-rose-500",  "bg-cyan-500",    "bg-orange-500", "bg-pink-500",
  "bg-teal-500",  "bg-indigo-500",
];
function zoneColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return PALETTE[Math.abs(h) % PALETTE.length] ?? "bg-blue-500";
}

// Zone profile dropdown?
// Appears top-right, like an account/profile menu in typical apps.
// Lets switch between zones, create a new one, or leave the active zone.
const ZoneDropdown: React.FC<{
  onNewZone: () => void;
  onEditZone: () => void;
}> = ({
  onNewZone,
  onEditZone,
}) => {
  const { state, dispatch } = useDms();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activate = async (z: Zone) => {
    setOpen(false);
    const res = await dms.openZoneDb(z.name);
    if (res.ok) dispatch({ type: "SET_ZONE", zone: z });
    else dispatch({ type: "SET_ERROR", error: res.error || "Failed to open zone" });
  };

  const leaveZone = () => {
    setOpen(false);
    dispatch({ type: "SET_ZONE", zone: null });
  };

  const color = state.zone ? zoneColor(state.zone.name) : "";

  return (
    <div className="relative" ref={ref}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${
          open ? "bg-black/5 dark:bg-white/5" : ""
        }`}
        title={state.zone ? `Zone: ${state.zone.name}` : "No zone active — click to manage"}
      >
        {state.zone ? (
          <span
            className={`w-5 h-5 rounded-full ${color} text-white text-[9px] font-black flex items-center justify-center shrink-0`}
          >
            {state.zone.name.charAt(0).toUpperCase()}
          </span>
        ) : (
          <span className="w-5 h-5 rounded-full bg-[var(--theme-border)] flex items-center justify-center shrink-0">
            <Icon name="folder" size="xs" className="text-[var(--theme-text-muted)]" />
          </span>
        )}
        <span className="text-xs font-semibold text-[var(--theme-text)] max-w-[90px] truncate hidden sm:block">
          {state.zone?.name ?? "No Zone"}
        </span>
        <Icon name="chevron-down" size="xs" className="text-[var(--theme-text-muted)]" />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-64 bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-xl shadow-2xl overflow-hidden z-50">

          {/* Current zone info (or "no zone" hint) */}
          {state.zone ? (
            <div className="px-3 py-2.5 border-b border-[var(--theme-border)]">
              <div className="flex items-center gap-2 mb-0.5">
                <span
                  className={`w-6 h-6 rounded-full ${color} text-white text-[10px] font-black flex items-center justify-center shrink-0`}
                >
                  {state.zone.name.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[var(--theme-text)] truncate">{state.zone.name}</p>
                  {state.zone.taxonomy_domain && state.zone.taxonomy_domain !== "General" && (
                    <p className="text-[9px] text-[var(--theme-text-muted)] uppercase tracking-wider">{state.zone.taxonomy_domain}</p>
                  )}
                </div>
              </div>
              {state.zone.description && (
                <p className="text-[10px] text-[var(--theme-text-muted)] ml-8 leading-relaxed">
                  {state.zone.description}
                </p>
              )}
              <button
                onClick={() => { setOpen(false); onEditZone(); }}
                className="ml-8 mt-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--theme-primary)] hover:underline"
              >
                Edit Zone
              </button>
            </div>
          ) : (
            <div className="px-3 py-2.5 border-b border-[var(--theme-border)]">
              <p className="text-xs text-[var(--theme-text-muted)] italic">
                No zone active — browsing freely
              </p>
            </div>
          )}

          {/* Zone list */}
          {state.zones.length > 0 && (
            <div className="py-1 max-h-48 overflow-y-auto">
              <p className="px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60">
                Zones
              </p>
              {state.zones.map((z) => {
                const isActive = state.zone?.name === z.name;
                return (
                  <button
                    key={z.name}
                    onClick={() => !isActive && activate(z)}
                    disabled={isActive}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                      isActive
                        ? "opacity-50 cursor-default"
                        : "hover:bg-[var(--theme-bg)]"
                    }`}
                  >
                    <span
                      className={`w-5 h-5 rounded-full ${zoneColor(z.name)} text-white text-[9px] font-black flex items-center justify-center shrink-0`}
                    >
                      {z.name.charAt(0).toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[var(--theme-text)] truncate">{z.name}</p>
                      {z.taxonomy_domain && z.taxonomy_domain !== "General" && (
                        <p className="text-[9px] text-[var(--theme-text-muted)] truncate">{z.taxonomy_domain}</p>
                      )}
                    </div>
                    {isActive && (
                      <Icon name="check" size="xs" className="text-[var(--theme-primary)] shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Actions */}
          <div className="border-t border-[var(--theme-border)] py-1">
            <button
              onClick={() => { setOpen(false); onNewZone(); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--theme-bg)] transition-colors"
            >
              <Icon name="plus" size="xs" className="text-[var(--theme-primary)]" />
              <span className="text-xs font-semibold text-[var(--theme-text)]">New Zone…</span>
            </button>
            {state.zone && (
              <button
                onClick={leaveZone}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--theme-bg)] transition-colors"
              >
                <Icon name="home" size="xs" className="text-[var(--theme-text-muted)]" />
                <span className="text-xs font-semibold text-[var(--theme-text-muted)]">Leave Zone</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Missing workspace directory modal
const CreateDirModal: React.FC<{
  path:      string;
  onConfirm: () => void;
  onCancel:  () => void;
}> = ({ path, onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
    <div className="w-full max-w-md bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-2xl p-6 shadow-2xl">
      <h2 className="text-sm font-black text-[var(--theme-text)] mb-2">Zone workspace not found</h2>
      <p className="text-xs text-[var(--theme-text-muted)] mb-3">
        The workspace directory for this zone does not exist yet:
      </p>
      <code className="block text-[10px] font-mono bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg px-3 py-2 text-[var(--theme-text)] break-all mb-5">
        {path}
      </code>
      <p className="text-xs text-[var(--theme-text-muted)] mb-5">
        Create it now? Syngrafo will also initialise the zone database inside it.
      </p>
      <div className="flex justify-end gap-3">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-xs font-bold bg-[var(--theme-bg)] hover:bg-[var(--theme-surface)] border border-[var(--theme-border)] text-[var(--theme-text)] rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="px-4 py-2 text-xs font-bold bg-[var(--theme-primary)] hover:opacity-90 text-[var(--theme-primary-fg)] rounded-lg transition-colors"
        >
          Create workspace
        </button>
      </div>
    </div>
  </div>
);


const Dashboard: React.FC = () => {
  const { state, dispatch } = useDms();
  const [showEditor,  setShowEditor]  = useState(false);
  const [showZone,   setShowZone]   = useState(false);
  const [showTheme,  setShowTheme]  = useState(false);
  const [activeView, setActiveView] = useState<"dms" | "timeline">("dms");
  // "bookmarks" and "zone-dashboard" override the path-based center panel routing
  const [centerView, setCenterView] = useState<"default" | "bookmarks" | "zone-dashboard">("default");
  const [missingDir, setMissingDir] = useState<string | null>(null);
  const [engineVersion, setEngineVersion] = useState("–");
  const [engineOk,      setEngineOk]      = useState<boolean | null>(null);


  const [leftWidth,       setLeftWidth]       = useState(256);
  const [rightPanelWidth, setRightPanelWidth] = useState(260);
  const [analysisWidth,   setAnalysisWidth]   = useState(288);

  // Visibility — all three side panels are independently togglable
  const [leftOpen,       setLeftOpen]       = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [analysisOpen,   setAnalysisOpen]   = useState(true);


  const [leftSelection,       setLeftSelection]   = useState<string[]>([]);
  const [leftPath,            setLeftPath]        = useState("");
  const [rightSelection,      setRightSelection]  = useState<string[]>([]);
  const [rightPath,           setRightPath]       = useState("");
  const [activePanel,         setActivePanel]     = useState<"left" | "right">("left");

  // Sync leftPath with store's currentPath (FileBrowser updates store)
  useEffect(() => { setLeftPath(state.currentPath); }, [state.currentPath]);

  // Auto-show Zone Dashboard when entering a new zone
  useEffect(() => {
    if (state.zone) setCenterView("zone-dashboard");
    else setCenterView("default");
  }, [state.zone?.name]);


  const resizeDragRef = useRef<{
    panel: "left" | "rightPanel" | "analysis";
    startX: number;
    startW: number;
  } | null>(null);

  const startResize = (panel: "left" | "rightPanel" | "analysis") =>
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startW = panel === "left" ? leftWidth : panel === "rightPanel" ? rightPanelWidth : analysisWidth;
      resizeDragRef.current = { panel, startX: e.clientX, startW };
    };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizeDragRef.current) return;
      const { panel, startX, startW } = resizeDragRef.current;
      const delta = e.clientX - startX;
      const sign  = panel === "left" ? 1 : -1;
      const newW  = Math.max(160, Math.min(600, startW + sign * delta));
      if (panel === "left")       setLeftWidth(newW);
      else if (panel === "rightPanel") setRightPanelWidth(newW);
      else                        setAnalysisWidth(newW);
    };
    const onUp = () => { resizeDragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);


  const handleCommandBarRefresh = () => {
    if (leftPath)  dms.scanDir(leftPath).then(res => { if (res.ok && res.data) dispatch({ type: "SET_ENTRIES", entries: res.data.entries }); });
    // right panel auto-refreshes via its own navigate()
  };

  // Engine health
  useEffect(() => {
    nlp.health().then((r) => {
      if (r.ok && r.data) { setEngineVersion(r.data.version); setEngineOk(true); }
      else setEngineOk(false);
    });
  }, []);

  // Load zones on mount
  useEffect(() => {
    dms.getZones().then((res) => {
      if (res.ok && res.data) dispatch({ type: "SET_ZONES", zones: res.data });
    });
  }, []);

  // File selected → dismiss zone dashboard so the viewer appears
  useEffect(() => {
    if (state.selectedPath) setCenterView("default");
  }, [state.selectedPath]);

  // Auto-load file content + metadata on file selection
  useEffect(() => {
    const path = state.selectedPath;
    if (!path) return;
    (async () => {
      dispatch({ type: "SET_VIEWER", path, content: "" });


      const statsRes = await dms.fileStats(path);
      if (statsRes.ok && statsRes.data) {
        dispatch({ type: "SET_FILE_STATS", stats: statsRes.data });
      }
      // Fire-and-forget registration: ensures every viewed file is tracked
      // in the DB by kind/size/ext even before explicit indexing.
      dms.registerFile(path).catch(() => { /* best-effort */ });


      const fileRes = await dms.readFile(path);
      if (fileRes.ok && fileRes.data && fileRes.data.content !== null) {
        dispatch({ type: "SET_VIEWER", path, content: fileRes.data.content });
      }


      dispatch({ type: "SET_ANALYSIS_LOADING", loading: true });
      const metaRes = await dms.getMetadata(path);
      dispatch({ type: "SET_METADATA", metadata: metaRes.ok && metaRes.data ? metaRes.data : null });
    })();
  }, [state.selectedPath]);

  // After zone activation, verify workspace exists
  const verifyZoneWorkspace = async () => {
    if (!state.zone) return;
    const check = await dms.pathExists(state.zone.out_path);
    if (check.ok && check.data && !check.data.exists) {
      setMissingDir(state.zone.out_path);
    }
  };

  const handleCreateMissingDir = async () => {
    if (!missingDir || !state.zone) return;
    const res = await dms.createDir(missingDir);
    setMissingDir(null);
    if (!res.ok) {
      dispatch({ type: "SET_ERROR", error: res.error ?? `Could not create ${missingDir}` });
      return;
    }
    const openRes = await dms.openZoneDb(state.zone.name);
    if (!openRes.ok) {
      dispatch({ type: "SET_ERROR", error: openRes.error ?? "Failed to open zone DB" });
    }
  };


  // Using useCallback with [] deps because the setters (setLeftSelection etc.)
  // are permanently stable references from useState.
  const handleLeftSelectionChange = useCallback((paths: string[]) => {
    setLeftSelection(paths);
    setActivePanel("left");
  }, []);
  const handleLeftFocus      = useCallback(() => setActivePanel("left"), []);
  const handleLeftPathChange = useCallback((p: string) => setLeftPath(p), []);

  const dotColor =
    engineOk === null ? "bg-amber-400 animate-pulse" :
    engineOk          ? "bg-emerald-400" : "bg-rose-400";

  return (
    <div className="flex flex-col h-screen bg-[var(--theme-bg)] text-[var(--theme-text)] overflow-hidden">

      <header className="grid grid-cols-[auto_1fr_auto] items-center gap-4 px-4 py-2 bg-[var(--theme-surface)] border-b border-[var(--theme-border)] shrink-0 shadow-sm relative z-50">

        <div className="flex items-center gap-2 shrink-0">
          <span className="font-black text-sm tracking-tight text-[var(--theme-text)]">Syngrafo</span>
          <span className="text-[9px] font-bold opacity-40 text-[var(--theme-text-muted)]">DMS</span>

          {/* Active zone badge — visual only; zone is managed via the ZoneDropdown */}
          {state.zone && (
            <>
              <div className="h-4 w-px bg-[var(--theme-border)] mx-0.5" />
              <span
                className="text-[10px] font-bold text-[var(--theme-text-muted)] truncate max-w-[100px]"
                title={`Zone: ${state.zone.in_path}`}
              >
                {state.zone.name}
              </span>
            </>
          )}

          <div className="h-4 w-px bg-[var(--theme-border)] mx-0.5" />
          <div className="flex items-center gap-0.5">
            {(["dms", "timeline"] as const).map((v) => (
              <button
                key={v}
                onClick={() => {
                  setActiveView(v);
                  // DMS = home: if a zone is active, the dashboard is the landing page
                  if (v === "dms" && state.zone) setCenterView("zone-dashboard");
                }}
                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide transition-colors ${
                  activeView === v
                    ? "bg-[var(--theme-primary)] text-[var(--theme-primary-fg)]"
                    : "text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] hover:text-[var(--theme-text)]"
                }`}
              >
                {{ dms: "DMS", timeline: "Timeline" }[v]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-center relative">
          <SearchBar />
          <SearchResults />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* New Document */}
          <button
            onClick={() => setShowEditor(true)}
            title="New Document"
            className="p-1.5 rounded-lg hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors"
          >
            <Icon name="edit" size="xs" />
          </button>
          <div className="h-4 w-px bg-[var(--theme-border)]" />
          {/* Palette / Theme button */}
          <button
            onClick={() => setShowTheme(true)}
            title="Theme settings"
            className="p-1.5 rounded-lg hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors"
          >
            <Icon name="sparkles" size="xs" />
          </button>
          <div className="h-4 w-px bg-[var(--theme-border)]" />
          <ZoneDropdown
            onNewZone={() => setShowZone(true)}
            onEditZone={() => setShowZone(true)}
          />
          <div className="h-4 w-px bg-[var(--theme-border)]" />
          <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
          <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)] hidden sm:block">
            {engineOk === null ? "…" : engineOk ? `NLP v${engineVersion}` : "offline"}
          </span>
        </div>
      </header>

      {showTheme && <ThemePanel onClose={() => setShowTheme(false)} />}

      {showZone && (
        <ZonePanel
          onClose={() => {
            setShowZone(false);
            dms.getZones().then((res) => {
              if (res.ok && res.data) dispatch({ type: "SET_ZONES", zones: res.data });
            });
            verifyZoneWorkspace();
          }}
        />
      )}

      {missingDir && (
        <CreateDirModal
          path={missingDir}
          onConfirm={handleCreateMissingDir}
          onCancel={() => setMissingDir(null)}
        />
      )}

      {state.error && (
        <div className="flex items-center gap-3 px-4 py-2 bg-rose-500/10 border-b border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs shrink-0">
          <span className="flex-1 truncate">{state.error}</span>
          <button
            onClick={() => dispatch({ type: "CLEAR_ERROR" })}
            className="font-bold hover:underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {activeView === "timeline" && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <TimelinePage />
        </div>
      )}

      {/* DMS workspace — mounted but flex-hidden when timeline is active */}
      <div
        className="flex flex-1 min-h-0 overflow-hidden"
        style={{ display: activeView === "dms" ? "flex" : "none" }}
      >

        {/* 1. Left file browser */}
        {/* Collapsed stripe */}
        {!leftOpen && (
          <button
            onClick={() => setLeftOpen(true)}
            title="Open file browser"
            className="w-5 shrink-0 flex flex-col items-center justify-center gap-0.5 border-r border-[var(--theme-border)] bg-[var(--theme-surface)] hover:bg-[var(--theme-bg)] transition-colors text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)]"
          >
            <Icon name="chevron-right" size="xs" />
            <span
              className="text-[8px] font-black uppercase tracking-widest"
              style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
            >
              Files
            </span>
          </button>
        )}

        {/* Open panel */}
        {leftOpen && (
          <>
            <aside
              className="shrink-0 border-r border-[var(--theme-border)] overflow-hidden flex flex-col bg-[var(--theme-surface)] transition-[width] duration-150"
              style={{ width: leftWidth }}
            >
              <div
                onClick={() => setLeftOpen(false)}
                title="Click to collapse"
                className="flex items-center gap-1 px-2 py-0.5 border-b border-[var(--theme-border)] bg-[var(--theme-bg)]/40 shrink-0 cursor-pointer hover:bg-[var(--theme-bg)]/70 transition-colors select-none group"
              >
                <Icon name="folder" size="xs" className="text-[var(--theme-text-muted)]" />
                <span className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 flex-1">
                  Files
                </span>
                <Icon
                  name="chevron-right"
                  size="xs"
                  className="text-[var(--theme-text-muted)] opacity-0 group-hover:opacity-30 transition-opacity"
                />
              </div>
              <FileBrowser
                onSelectionChange={handleLeftSelectionChange}
                onFocus={handleLeftFocus}
                onPathChange={handleLeftPathChange}
              />
            </aside>

            {/* Resize handle — left panel */}
            <div
              onMouseDown={startResize("left")}
              className="w-1 shrink-0 cursor-col-resize hover:bg-[var(--theme-primary)]/30 active:bg-[var(--theme-primary)]/50 transition-colors group relative"
              title="Drag to resize"
            >
              <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-[var(--theme-primary)]/10" />
            </div>
          </>
        )}

        {/* 2. Center: document viewer / notes / kanban / bookmarks */}
        <main className="flex-1 min-w-0 overflow-hidden flex flex-col bg-[var(--theme-bg)]">
          {/* Path-specific views take priority over overlay centerView */}
          {state.zone && leftPath.startsWith(state.zone.out_path + "/.notes") ? (
            <NotesView notesDir={state.zone.out_path + "/.notes"} />
          ) : state.zone && leftPath.startsWith(state.zone.out_path + "/.kanban") ? (
            <KanbanView kanbanDir={state.zone.out_path + "/.kanban"} />
          ) : centerView === "zone-dashboard" ? (
            <ZoneDashboard
              onNavigate={async (absPath, isDir) => {
                setCenterView("default");
                if (isDir) {
                  dispatch({ type: "SET_PATH", path: absPath });
                  const res = await dms.scanDir(absPath);
                  if (res.ok && res.data)
                    dispatch({ type: "SET_ENTRIES", entries: res.data.entries });
                } else {
                  dispatch({ type: "SELECT_FILE", path: absPath });
                }
              }}
              onManageBookmarks={() => setCenterView("bookmarks")}
              onEditZone={() => setShowZone(true)}
              onTheme={() => setShowTheme(true)}
              onClose={() => setCenterView("default")}
            />
          ) : centerView === "bookmarks" ? (
            <BookmarksView
              onNavigate={async (absPath, isDir) => {
                setCenterView("default");
                if (isDir) {
                  dispatch({ type: "SET_PATH", path: absPath });
                  const res = await dms.scanDir(absPath);
                  if (res.ok && res.data)
                    dispatch({ type: "SET_ENTRIES", entries: res.data.entries });
                } else {
                  dispatch({ type: "SELECT_FILE", path: absPath });
                }
              }}
              onClose={() => setCenterView("default")}
            />
          ) : (
            <DocumentViewer />
          )}
        </main>

        {/* 3. Right file panel (optional) */}
        {rightPanelOpen && (
          <>
            {/* Resize handle — right panel */}
            <div
              onMouseDown={startResize("rightPanel")}
              className="w-1 shrink-0 cursor-col-resize hover:bg-[var(--theme-primary)]/30 active:bg-[var(--theme-primary)]/50 transition-colors group relative"
              title="Drag to resize"
            >
              <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-[var(--theme-primary)]/10" />
            </div>

            <aside
              className="shrink-0 border-l border-[var(--theme-border)] overflow-hidden flex flex-col bg-[var(--theme-surface)]"
              style={{ width: rightPanelWidth }}
            >
              <div
                onClick={() => setRightPanelOpen(false)}
                title="Click to collapse"
                className="flex items-center gap-1 px-2 py-0.5 border-b border-[var(--theme-border)] bg-[var(--theme-bg)]/40 shrink-0 cursor-pointer hover:bg-[var(--theme-bg)]/70 transition-colors select-none group"
              >
                <Icon name="columns" size="xs" className="text-[var(--theme-text-muted)]" />
                <span className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 flex-1">
                  Second Panel
                </span>
                <Icon
                  name="chevron-right"
                  size="xs"
                  className="text-[var(--theme-text-muted)] opacity-0 group-hover:opacity-30 transition-opacity"
                />
              </div>
              <FilePanel
                panelId="right"
                initialPath={state.zone?.in_path ?? ""}
                onSelectionChange={(paths) => { setRightSelection(paths); setActivePanel("right"); }}
                onPathChange={(p) => { setRightPath(p); }}
                onFocus={(id) => setActivePanel(id)}
                onFileOpen={(path) => dispatch({ type: "SELECT_FILE", path })}
                className="flex-1 min-h-0"
              />
            </aside>
          </>
        )}

        {/* Right panel toggle stripe (when closed) */}
        {!rightPanelOpen && (
          <button
            onClick={() => setRightPanelOpen(true)}
            title="Open second file panel"
            className="w-5 shrink-0 flex flex-col items-center justify-center gap-0.5 border-l border-[var(--theme-border)] bg-[var(--theme-surface)] hover:bg-[var(--theme-bg)] transition-colors text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)]"
          >
            <Icon name="chevron-left" size="xs" />
            <span
              className="text-[8px] font-black uppercase tracking-widest"
              style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
            >
              Panel
            </span>
          </button>
        )}

        {/* 4. Analysis panel */}
        {analysisOpen ? (
          <>
            {/* Resize handle — analysis */}
            <div
              onMouseDown={startResize("analysis")}
              className="w-1 shrink-0 cursor-col-resize hover:bg-[var(--theme-primary)]/30 active:bg-[var(--theme-primary)]/50 transition-colors group relative"
              title="Drag to resize"
            >
              <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-[var(--theme-primary)]/10" />
            </div>

            <aside
              className="shrink-0 border-l border-[var(--theme-border)] overflow-hidden flex flex-col bg-[var(--theme-surface)]"
              style={{ width: analysisWidth }}
            >
              <div
                onClick={() => setAnalysisOpen(false)}
                title="Click to collapse"
                className="flex items-center gap-1 px-2 py-0.5 border-b border-[var(--theme-border)] bg-[var(--theme-bg)]/40 shrink-0 cursor-pointer hover:bg-[var(--theme-bg)]/70 transition-colors select-none group"
              >
                <Icon name="brain" size="xs" className="text-[var(--theme-text-muted)]" />
                <span className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 flex-1">
                  Analysis
                </span>
                <Icon
                  name="chevron-right"
                  size="xs"
                  className="text-[var(--theme-text-muted)] opacity-0 group-hover:opacity-30 transition-opacity"
                />
              </div>
              <div className="flex-1 overflow-y-auto">
                <AnalysisPanel />
              </div>
            </aside>
          </>
        ) : (
          /* Analysis toggle stripe */
          <button
            onClick={() => setAnalysisOpen(true)}
            title="Open NLP analysis panel"
            className="w-5 shrink-0 flex flex-col items-center justify-center gap-0.5 border-l border-[var(--theme-border)] bg-[var(--theme-surface)] hover:bg-[var(--theme-bg)] transition-colors text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)]"
          >
            <Icon name="chevron-left" size="xs" />
            <span
              className="text-[8px] font-black uppercase tracking-widest"
              style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
            >
              NLP
            </span>
          </button>
        )}
      </div>

      {activeView === "dms" && (
        <CommandBar
          leftPanel={{ path: leftPath, selection: leftSelection }}
          rightPanel={{ path: rightPath, selection: rightSelection }}
          activePanel={activePanel}
          onRefresh={handleCommandBarRefresh}
        />
      )}
      <EditorPortal open={showEditor} onClose={() => setShowEditor(false)} />
    </div>
  );
};

export default Dashboard;
