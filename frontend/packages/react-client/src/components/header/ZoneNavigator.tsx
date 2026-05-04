import React from "react";
import { useDms } from "../../store/dms-store";
import Icon from "../Icon";
import { dms, type Zone } from "../../services/dms-service";

const ZoneNavigator: React.FC = () => {
  const { state, dispatch } = useDms();
  const { zone, zones, isGlobalMode } = state;

  const handleSwitchZone = async (z: Zone | "global") => {
    if (z === "global") {
      const res = await dms.openZoneDb("global");
      if (res.ok) {
        // Clears zone; SET_ZONE(null) sets currentPath="" so FileBrowser waits for "Select Inbox"
        dispatch({ type: "SET_ZONE", zone: null });
      } else {
        dispatch({ type: "SET_ERROR", error: res.error || "Failed to switch to global" });
      }
    } else {
      const res = await dms.openZoneDb(z.name);
      if (res.ok) {
        // SET_ZONE sets currentPath = zone.out_path; FileBrowser's useEffect auto-scans it
        dispatch({ type: "SET_ZONE", zone: z });
      } else {
        dispatch({ type: "SET_ERROR", error: res.error || "Failed to open zone" });
      }
    }
  };

  return (
    <div className="flex items-center gap-1 p-1 rounded-lg bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10">
      <button
        onClick={() => handleSwitchZone("global")}
        className={`px-3 py-1 text-xs font-bold uppercase tracking-wider rounded transition-all flex items-center gap-2 ${
          isGlobalMode
            ? "bg-white dark:bg-zinc-800 shadow-sm text-zinc-900 dark:text-white"
            : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        }`}
      >
        <Icon name="download" size="xs" />
        Input
      </button>

      <div className="w-px h-4 bg-black/10 dark:bg-white/10 mx-1" />

      <div className="flex gap-1 overflow-x-auto no-scrollbar max-w-[400px]">
        {zones.map((z) => (
          <button
            key={z.name}
            onClick={() => handleSwitchZone(z)}
            className={`group relative px-3 py-1 text-xs font-bold rounded transition-all whitespace-nowrap flex flex-col items-start gap-0.5 ${
              zone?.name === z.name
                ? "bg-primary/10 text-primary border border-primary/20"
                : "text-zinc-500 hover:bg-black/5 dark:hover:bg-white/5"
            }`}
            title={`${z.taxonomy_domain || 'General'}: ${z.description || z.name}`}
            style={zone?.name === z.name ? {
                backgroundColor: 'var(--theme-primary-muted, rgba(var(--theme-primary-rgb), 0.1))',
                color: 'var(--theme-primary)',
                borderColor: 'var(--theme-primary-border, rgba(var(--theme-primary-rgb), 0.2))'
            } : {}}
          >
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${zone?.name === z.name ? 'bg-primary' : 'bg-zinc-400'}`}
                   style={zone?.name === z.name ? { backgroundColor: 'var(--theme-primary)' } : {}} />
              <span>{z.name}</span>
            </div>
            {z.taxonomy_domain && z.taxonomy_domain !== 'General' && (
              <span className={`text-[9px] uppercase tracking-tighter opacity-70 group-hover:opacity-100 ${zone?.name === z.name ? 'text-primary' : 'text-zinc-500'}`}>
                {z.taxonomy_domain}
              </span>
            )}
          </button>
        ))}
        {zones.length === 0 && !isGlobalMode && (
           <span className="text-[10px] text-zinc-400 px-2 py-1">No zones</span>
        )}
      </div>
    </div>
  );
};

export default ZoneNavigator;
