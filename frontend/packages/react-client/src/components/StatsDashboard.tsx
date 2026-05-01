import React, { useEffect, useState } from "react";
import Icon from "./Icon";

interface EngineStats {
  ram_mb: number;
  cpu_percent: number;
  uptime_seconds: number;
  threads: number;
  active_tasks?: Array<{
    id: string;
    type: string;
    elapsed: number;
  }>;
}

/**
 * StatsDashboard Component
 * Polls the /health endpoint to display real-time metrics from the C++ native engine.
 * Refactored to handle its own visibility state.
 */
const StatsDashboard: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch("/health");
        if (!response.ok) throw new Error("Health check failed");
        const data = await response.json();

        setStats({
          ...data.stats,
          active_tasks: data.stats?.active_tasks || [],
        });
        setError(false);
      } catch (e) {
        console.error("Stats fetch failed", e);
        setError(true);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 2000);
    return () => clearInterval(interval);
  }, []);

  if (!stats) return null;

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h > 0 ? h + "h " : ""}${m > 0 ? m + "m " : ""}${s}s`;
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
          isOpen
            ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/30"
            : "bg-slate-100 dark:bg-slate-800 text-indigo-600 hover:bg-slate-200 dark:hover:bg-slate-700"
        }`}
        title="Toggle Engine Profiler"
      >
        <Icon name="activity" size="sm" />
      </button>

      {isOpen && (
        <div
          className="absolute right-0 top-full mt-3 w-72 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-4 z-50 animate-in fade-in zoom-in-95 duration-200 origin-top-right"
          style={{
            backgroundColor: "var(--theme-surface)",
            borderColor: "var(--theme-border)",
          }}
        >
          <div
            className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100 dark:border-slate-800"
            style={{ borderBottomColor: "var(--theme-border)" }}
          >
            <h4
              className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2"
              style={{ color: "var(--theme-text-muted)" }}
            >
              <Icon name="activity" size="sm" />
              Engine Profiler
            </h4>
            <div
              className={`w-2 h-2 rounded-full ${error ? "bg-red-500 animate-pulse" : "bg-emerald-500"}`}
            ></div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span
                  className="text-[10px] font-bold uppercase tracking-tighter"
                  style={{ color: "var(--theme-text-muted)" }}
                >
                  CPU Load
                </span>
                <span
                  className="text-xs font-black"
                  style={{ color: "var(--theme-primary)" }}
                >
                  {stats.cpu_percent}%
                </span>
              </div>
              <div
                className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden"
                style={{ backgroundColor: "var(--theme-bg)" }}
              >
                <div
                  className="bg-indigo-500 dark:bg-indigo-400 h-full transition-all duration-500 shadow-[0_0_8px_rgba(99,102,241,0.4)]"
                  style={{
                    width: `${Math.min(stats.cpu_percent, 100)}%`,
                    backgroundColor: "var(--theme-primary)",
                  }}
                ></div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div
                className="bg-slate-50 dark:bg-slate-800/40 p-2 rounded-xl border border-slate-100 dark:border-slate-700/30"
                style={{
                  backgroundColor: "var(--theme-bg)",
                  borderColor: "var(--theme-border)",
                }}
              >
                <span
                  className="text-[9px] font-bold uppercase block mb-0.5"
                  style={{ color: "var(--theme-text-muted)" }}
                >
                  Memory
                </span>
                <div
                  className="text-xs font-black"
                  style={{ color: "var(--theme-text)" }}
                >
                  {stats.ram_mb} MB
                </div>
              </div>
              <div
                className="bg-slate-50 dark:bg-slate-800/40 p-2 rounded-xl border border-slate-100 dark:border-slate-700/30"
                style={{
                  backgroundColor: "var(--theme-bg)",
                  borderColor: "var(--theme-border)",
                }}
              >
                <span
                  className="text-[9px] font-bold uppercase block mb-0.5"
                  style={{ color: "var(--theme-text-muted)" }}
                >
                  Threads
                </span>
                <div
                  className="text-xs font-black"
                  style={{ color: "var(--theme-text)" }}
                >
                  {stats.threads}
                </div>
              </div>
            </div>

            <div
              className="pt-3 border-t border-slate-100 dark:border-slate-800"
              style={{ borderTopColor: "var(--theme-border)" }}
            >
              <h5
                className="text-[9px] font-black uppercase tracking-widest mb-2 flex items-center gap-1.5"
                style={{ color: "var(--theme-text-muted)" }}
              >
                <Icon name="list" size="xs" />
                <span>Active Tasks ({stats.active_tasks?.length || 0})</span>
              </h5>
              <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1 scrollbar-thin">
                {stats.active_tasks && stats.active_tasks.length > 0 ? (
                  stats.active_tasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 p-1.5 rounded-lg border border-slate-100 dark:border-slate-700/50"
                      style={{
                        backgroundColor: "var(--theme-bg)",
                        borderColor: "var(--theme-border)",
                      }}
                    >
                      <div className="flex flex-col">
                        <span
                          className="text-[9px] font-black"
                          style={{ color: "var(--theme-primary)" }}
                        >
                          {task.type}
                        </span>
                        <span
                          className="text-[8px] font-mono truncate w-24"
                          style={{ color: "var(--theme-text-muted)" }}
                        >
                          {task.id}
                        </span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span
                          className="text-[9px] font-bold"
                          style={{ color: "var(--theme-text-muted)" }}
                        >
                          {task.elapsed}s
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div
                    className="text-[9px] font-medium italic text-center py-2"
                    style={{ color: "var(--theme-text-muted)" }}
                  >
                    No active tasks
                  </div>
                )}
              </div>
            </div>

            <div
              className="pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center"
              style={{ borderTopColor: "var(--theme-border)" }}
            >
              <span
                className="text-[9px] font-bold uppercase"
                style={{ color: "var(--theme-text-muted)" }}
              >
                Uptime
              </span>
              <span
                className="text-[10px] font-mono font-medium"
                style={{ color: "var(--theme-text-muted)" }}
              >
                {formatUptime(stats.uptime_seconds)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StatsDashboard;
