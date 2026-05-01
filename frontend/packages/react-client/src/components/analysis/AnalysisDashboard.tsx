import React, { useMemo } from "react";
import Icon from "../Icon";

interface NLPStats {
  tokens?: number;
  sentences?: number;
  readability_score?: number;
  sentiment_score?: number;
  pos_distribution?: Record<string, number>;
  entities?: Array<{ text: string; label: string }>;
  duplicates?: Array<{ text: string; offset: number; length: number }>;
  [key: string]: any;
}

interface AnalysisDashboardProps {
  results: string;
  isProcessing: boolean;
}

/**
 * AnalysisDashboard Component
 * A scientific, "dashboardy" panel for visualizing NLP engine results.
 * Parses raw JSON/text output from the C++ engine into visual components.
 */
const AnalysisDashboard: React.FC<AnalysisDashboardProps> = ({
  results,
  isProcessing,
}) => {
  // Parse results safely. The engine might return raw text or a JSON string.
  const data = useMemo(() => {
    if (!results) return null;
    try {
      return JSON.parse(results) as NLPStats;
    } catch (e) {
      // If not JSON, it might be streaming raw text or partial data
      return null;
    }
  }, [results]);

  if (!results && !isProcessing) {
    return (
      <div className="h-64 flex flex-col items-center justify-center text-slate-400 space-y-4 animate-in fade-in duration-500">
        <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center opacity-50">
          <Icon name="analytics" size="lg" />
        </div>
        <p className="text-[10px] font-black uppercase tracking-[0.3em]">
          Awaiting Engine Analysis
        </p>
      </div>
    );
  }

  // Fallback for raw text streaming (if it's not JSON yet)
  if (!data && results) {
    return (
      <div className="p-6 bg-slate-900 rounded-2xl border border-slate-800 font-mono text-xs text-emerald-400 leading-relaxed overflow-y-auto max-h-[500px] shadow-inner">
        <div className="flex items-center gap-2 mb-4 text-[10px] font-black uppercase tracking-widest text-emerald-500/50">
          <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
          Raw Stream Data
        </div>
        {results}
        {isProcessing && (
          <span className="inline-block w-2 h-4 ml-1 bg-emerald-500 animate-pulse" />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      {/* High Level Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Sentiment"
          value={data?.sentiment_score?.toFixed(2) || "0.00"}
          icon="sentiment"
          color="text-blue-500"
          trend={
            data?.sentiment_score && data.sentiment_score > 0
              ? "positive"
              : "negative"
          }
        />
        <StatCard
          label="Readability"
          value={data?.readability_score?.toFixed(1) || "0.0"}
          icon="readability"
          color="text-amber-500"
        />
        <StatCard
          label="Tokens"
          value={data?.tokens?.toString() || "0"}
          icon="brain"
          color="text-indigo-500"
        />
        <StatCard
          label="Sentences"
          value={data?.sentences?.toString() || "0"}
          icon="rows"
          color="text-emerald-500"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* POS Distribution Histogram */}
        <div className="md:col-span-2 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-6 flex items-center gap-2">
            <Icon name="stats" size="sm" />
            Linguistic Distribution
          </h3>
          <div className="space-y-4">
            {data?.pos_distribution ? (
              Object.entries(data.pos_distribution)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .slice(0, 6)
                .map(([tag, count], idx) => (
                  <div key={tag} className="space-y-1 group">
                    <div className="flex justify-between text-[10px] font-bold uppercase tracking-tighter">
                      <span className="text-slate-500 group-hover:text-indigo-600 transition-colors">
                        {tag}
                      </span>
                      <span className="text-slate-400">{count}</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full transition-all duration-1000 ease-out"
                        style={{
                          width: `${Math.min(100, ((count as number) / (data.tokens || 1)) * 200)}%`,
                          transitionDelay: `${idx * 100}ms`,
                        }}
                      />
                    </div>
                  </div>
                ))
            ) : (
              <p className="text-xs text-slate-400 italic">
                No distribution data available
              </p>
            )}
          </div>
        </div>

        {/* Duplicates / Highlights Panel */}
        {data?.duplicates && data.duplicates.length > 0 && (
          <div className="md:col-span-3 bg-white dark:bg-slate-900/50 rounded-3xl border border-slate-200 dark:border-slate-800 p-8 shadow-2xl animate-in fade-in slide-in-from-bottom-8 duration-700 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
              <Icon
                name="search"
                size="lg"
                className="scale-[4] text-rose-500 rotate-12"
              />
            </div>

            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10 relative z-10">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-rose-500/10 rounded-xl">
                    <Icon name="search" size="sm" className="text-rose-500" />
                  </div>
                  <h3 className="text-[11px] font-black uppercase tracking-[0.4em] text-rose-500">
                    Redundancy Report
                  </h3>
                </div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                  Pattern matching results from C++ Deduplication Addon
                </p>
              </div>

              <div className="flex items-baseline gap-2 bg-rose-500/5 px-4 py-2 rounded-2xl border border-rose-500/10">
                <span className="text-3xl font-black text-rose-500 tracking-tighter tabular-nums">
                  {data.duplicates.length}
                </span>
                <span className="text-[9px] font-black uppercase tracking-widest text-rose-400/70">
                  Duplicates
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 relative z-10">
              {data.duplicates.map((dup, i) => (
                <div
                  key={i}
                  className="group/card p-5 rounded-2xl bg-white dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/50 hover:border-rose-500/30 hover:bg-rose-500/[0.02] transition-all duration-300 shadow-sm hover:shadow-xl"
                >
                  <div className="flex justify-between items-center mb-4">
                    <div className="flex items-center gap-2">
                      <span className="flex items-center justify-center w-5 h-5 rounded-lg bg-slate-100 dark:bg-slate-800 text-[9px] font-black text-slate-400 group-hover/card:bg-rose-500 group-hover/card:text-white transition-colors">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 group-hover/card:text-rose-400 transition-colors">
                        Pattern
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col items-end">
                        <span className="text-[7px] font-black uppercase tracking-tighter text-slate-300">
                          Offset
                        </span>
                        <span className="text-[9px] font-mono font-bold text-slate-500">
                          {String(dup.offset).padStart(4, "0")}
                        </span>
                      </div>
                      <div className="w-px h-4 bg-slate-100 dark:bg-slate-800" />
                      <div className="flex flex-col items-end">
                        <span className="text-[7px] font-black uppercase tracking-tighter text-slate-300">
                          Size
                        </span>
                        <span className="text-[9px] font-mono font-bold text-slate-500">
                          {dup.length}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="relative pl-3 border-l-2 border-slate-100 dark:border-slate-800 group-hover/card:border-rose-500/30 transition-colors">
                    <p className="text-[12px] leading-relaxed font-serif text-slate-600 dark:text-slate-400 italic group-hover/card:text-slate-900 dark:group-hover/card:text-slate-200 transition-colors line-clamp-3">
                      "{dup.text}"
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
              <div className="text-[8px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Deduplicator Mode: Detect
              </div>
              <div className="text-[8px] font-black uppercase tracking-widest text-slate-300">
                Engine: PCE-NLP-v2.0
              </div>
            </div>
          </div>
        )}

        {/* Entities / Keywords Panel */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-6 flex items-center gap-2">
            <Icon name="sparkles" size="sm" />
            Key Terminology
          </h3>
          <div className="flex flex-wrap gap-2">
            {data?.entities && data.entities.length > 0 ? (
              data.entities.map((entity, i) => (
                <span
                  key={i}
                  className="px-2 py-1 rounded-md bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 text-[10px] font-black uppercase border border-indigo-100 dark:border-indigo-800/50 hover:scale-105 transition-transform cursor-default"
                >
                  {entity.text}
                </span>
              ))
            ) : (
              <p className="text-xs text-slate-400 italic">
                Extracting entities...
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

interface StatCardProps {
  label: string;
  value: string;
  icon: any;
  color: string;
  trend?: "positive" | "negative";
}

const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  icon,
  color,
  trend,
}) => (
  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-all group">
    <div className="flex items-center justify-between mb-2">
      <div
        className={`p-2 rounded-xl bg-slate-50 dark:bg-slate-800 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-900/20 transition-colors ${color}`}
      >
        <Icon name={icon} size="sm" />
      </div>
      {trend && (
        <span
          className={`text-[8px] font-black px-1.5 py-0.5 rounded ${trend === "positive" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}
        >
          {trend === "positive" ? "↑" : "↓"}
        </span>
      )}
    </div>
    <div className="text-2xl font-black tracking-tight text-slate-800 dark:text-white leading-none">
      {value}
    </div>
    <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-1">
      {label}
    </div>
  </div>
);

export default AnalysisDashboard;
