import React, { useState, useEffect, useRef } from "react";
import { useLingui } from "@lingui/react";
import { nlp, type StreamChunk, type HealthStatus, type NLPStreamRequest } from "../services/nlp-service";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

interface SidebarProps {
  documentContent: string;
}

interface AnalysisResults {
  language?: { code: string; confidence: number };
  sentiment?: { label: string; score: number };
  readability?: { complexity: string; grade: string };
  safety?: { isToxic: boolean; category?: string };
  terminology?: string[];
  posSummary?: string;
}

/**
 * Sidebar Component for NLP Studio.
 * Focuses on real-time C++ engine output and structured dashboard results.
 */
const Sidebar: React.FC<SidebarProps> = ({ documentContent = "" }) => {
  const { _ } = useLingui();
  const [activeTab, setActiveTab] = useState<"analysis" | "settings">(
    "analysis",
  );
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamLog, setStreamLog] = useState("");
  const [results, setResults] = useState<AnalysisResults>({});
  const [health, setHealth] = useState<HealthStatus>({
    status: "checking",
    engine_ready: false,
  });

  const [config, setConfig] = useState({
    posTagging: true,
    terminology: true,
    safety: true,
  });

  const streamCleanupRef = useRef<(() => void) | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [streamLog]);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const status = await nlp.checkHealth();
        setHealth(status);
      } catch (e) {
        setHealth({ status: "error", engine_ready: false });
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  const parseLogLine = (line: string) => {
    if (line.includes("Language:")) {
      const match = line.match(/Language: (\w+) • confidence: (\d+)%/);
      if (match)
        setResults((prev) => ({
          ...prev,
          language: {
            code: match[1] || "unknown",
            confidence: parseInt(match[2] || "0"),
          },
        }));
    }
    else if (line.includes("Sentiment:")) {
      const match = line.match(/Sentiment: (\w+) • score: ([\d.-]+)/);
      if (match)
        setResults((prev) => ({
          ...prev,
          sentiment: {
            label: match[1] || "neutral",
            score: parseFloat(match[2] || "0"),
          },
        }));
    }
    else if (line.includes("Complexity:")) {
      const match = line.match(/Complexity: (\w+) • Grade: ([\d.N/A]+)/);
      if (match)
        setResults((prev) => ({
          ...prev,
          readability: {
            complexity: match[1] || "unknown",
            grade: match[2] || "unknown",
          },
        }));
    }
    else if (line.includes("Keywords:") || line.includes("Terminology:")) {
      const terms = line
        .replace("Keywords: ", "")
        .replace(/Terminology: Found \d+ technical terms\./, "")
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0 && !t.includes("Found"));

      if (terms.length > 0) {
        setResults((prev) => ({
          ...prev,
          terminology: [...new Set([...(prev.terminology || []), ...terms])],
        }));
      }
    }
    else if (line.includes("Content Safety: Clean")) {
      setResults((prev) => ({ ...prev, safety: { isToxic: false } }));
    } else if (line.includes("Warning: Content flagged")) {
      const cat = line.split("as ")[1]?.trim();
      setResults((prev) => ({
        ...prev,
        safety: { isToxic: true, category: cat },
      }));
    }
    else if (line.includes("POS Preview:") || line.includes("Tags:")) {
      const cleanLine = line.replace("POS Preview: ", "").replace("Tags: ", "");
      setResults((prev) => ({
        ...prev,
        posSummary: (prev.posSummary || "") + " " + cleanLine,
      }));
    }
  };

  const runAnalysis = async () => {
    if (isStreaming) return;

    setStreamLog("");
    setResults({});
    setIsStreaming(true);

    if (streamCleanupRef.current) streamCleanupRef.current();

    try {
      const request: NLPStreamRequest = {
        text: documentContent || "The",
        plugin: "default",
        options: {
          terminology: config.terminology ? "true" : "false",
          pos_tagging: config.posTagging ? "true" : "false",
          safety: config.safety ? "true" : "false",
        },
      };
      const cleanup = await nlp.streamNLP(
        request,
        (data: StreamChunk) => {
          if (data.chunk) {
            setStreamLog((prev) => prev + data.chunk);
            parseLogLine(data.chunk);
          }
          if (data.error) {
            setStreamLog((prev) => prev + `\n[Stream Error: ${data.error}]`);
          }
          if (data.is_final) setIsStreaming(false);
        },
        (err: unknown) => {
          console.error("Stream connection error:", err);
          setStreamLog(
            (prev) =>
              prev + "\n[Connection Error: Check if backend is running]",
          );
          setIsStreaming(false);
        },
      );
      streamCleanupRef.current = cleanup;
    } catch (err) {
      console.error("Analysis initiation failed:", err);
      setStreamLog((prev) => prev + "\n[Error: Failed to start analysis]");
      setIsStreaming(false);
    }
  };

  return (
    <div
      className="flex flex-col h-full w-[400px] bg-slate-50 dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 transition-all duration-300 shadow-2xl overflow-hidden font-sans"
      style={{
        backgroundColor: "var(--theme-bg)",
        borderColor: "var(--theme-border)",
      }}
    >
      {/* Navigation */}
      <nav
        className="flex p-1.5 bg-slate-100 dark:bg-slate-900 m-3 rounded-xl gap-1 shrink-0 border border-slate-200/50 dark:border-slate-800/50"
        style={{
          backgroundColor: "var(--theme-surface)",
          borderColor: "var(--theme-border)",
        }}
      >
        {[
          { id: "analysis", icon: "activity", label: _("Analysis") },
            { id: "settings", icon: "settings", label: _("Settings") },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-[9px] font-black uppercase tracking-widest rounded-lg transition-all ${
              activeTab === tab.id
                ? "bg-white dark:bg-slate-800 text-blue-600 shadow-sm ring-1 ring-slate-200 dark:ring-slate-700"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
            style={
              activeTab === tab.id
                ? {
                    backgroundColor: "var(--theme-bg)",
                    color: "var(--theme-primary)",
                    borderColor: "var(--theme-border)",
                  }
                : { color: "var(--theme-text-muted)" }
            }
            onClick={() => setActiveTab(tab.id as "analysis" | "settings")}
          >
            <Icon
              name={tab.icon as IconName}
              size="sm"
              style={
                activeTab === tab.id ? { color: "var(--theme-primary)" } : {}
              }
            />
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-4 pt-0 space-y-6">
        {activeTab === "analysis" && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <header className="flex justify-between items-center px-1">
              <div className="flex flex-col">
                <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                  {_("NLP Engine")}
                </h2>
                <div
                  className="flex gap-1.5 mt-1.5 p-1 bg-white dark:bg-slate-900 rounded-full border border-slate-200 dark:border-slate-800 w-fit"
                  style={{
                    backgroundColor: "var(--theme-surface)",
                    borderColor: "var(--theme-border)",
                  }}
                >
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${health.engine_ready ? "bg-blue-600" : "bg-red-500"}`}
                    style={
                      health.engine_ready
                        ? { backgroundColor: "var(--theme-primary)" }
                        : {}
                    }
                  ></div>
                  <div className="w-1.5 h-1.5 bg-blue-500 rounded-full opacity-60"></div>
                  <div className="w-1.5 h-1.5 bg-blue-400 rounded-full opacity-30"></div>
                </div>
              </div>
              <button
                onClick={runAnalysis}
                disabled={!health.engine_ready || isStreaming}
                className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                  isStreaming || !health.engine_ready
                    ? "bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500"
                    : "bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-500/20"
                }`}
                style={
                  !isStreaming && health.engine_ready
                    ? { backgroundColor: "var(--theme-primary)" }
                    : {
                        backgroundColor: "var(--theme-surface)",
                        color: "var(--theme-text-muted)",
                      }
                }
              >
                {isStreaming ? _("Processing") : _("Analyze")}
              </button>
            </header>

            <div className="grid grid-cols-1 gap-3">
              <div
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-start gap-3 shadow-sm"
                style={{
                  backgroundColor: "var(--theme-surface)",
                  borderColor: "var(--theme-border)",
                }}
              >
                <Icon
                  name="language"
                  size="md"
                  className="text-blue-500 mt-0.5"
                  style={{ color: "var(--theme-primary)" }}
                />
                <div className="flex-1 min-w-0">
                  <h3
                    className="font-black text-[9px] uppercase tracking-widest text-slate-400"
                    style={{ color: "var(--theme-text-muted)" }}
                  >
                    {_("Language")}
                  </h3>
                  <div
                    className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-0.5 truncate"
                    style={{ color: "var(--theme-text)" }}
                  >
                    {results.language
                      ? `${results.language.code.toUpperCase()} (${results.language.confidence}%)`
                      : _("Pending...")}
                  </div>
                </div>
              </div>
              <div
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-start gap-3 shadow-sm"
                style={{
                  backgroundColor: "var(--theme-surface)",
                  borderColor: "var(--theme-border)",
                }}
              >
                <Icon
                  name="sentiment"
                  size="md"
                  className="text-emerald-500 mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <h3
                    className="font-black text-[9px] uppercase tracking-widest text-slate-400"
                    style={{ color: "var(--theme-text-muted)" }}
                  >
                    {_("Sentiment")}
                  </h3>
                  <div
                    className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-0.5 truncate"
                    style={{ color: "var(--theme-text)" }}
                  >
                    {results.sentiment
                      ? `${results.sentiment.label.toUpperCase()} (${results.sentiment.score.toFixed(2)})`
                      : _("Pending...")}
                  </div>
                </div>
              </div>
              {config.terminology && (
                <div
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-start gap-3 shadow-sm transition-all duration-300"
                  style={{
                    backgroundColor: "var(--theme-surface)",
                    borderColor: "var(--theme-border)",
                  }}
                >
                  <Icon
                    name="tree"
                    size="md"
                    className="text-amber-600 mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <h3
                      className="font-black text-[9px] uppercase tracking-widest text-slate-400"
                      style={{ color: "var(--theme-text-muted)" }}
                    >
                      {_("Terminology")}
                    </h3>
                    <div
                      className="text-[10px] font-bold text-slate-600 dark:text-slate-300 mt-1 flex flex-wrap gap-1"
                      style={{ color: "var(--theme-text)" }}
                    >
                      {results.terminology && results.terminology.length > 0 ? (
                        results.terminology.map((t, i) => (
                          <span
                            key={i}
                            className="px-1.5 py-0.5 bg-amber-50 dark:bg-amber-900/20 rounded border border-amber-100 dark:border-amber-900/40 text-amber-700 dark:text-amber-400"
                          >
                            {t}
                          </span>
                        ))
                      ) : isStreaming ? (
                        <span className="opacity-50 italic">{_("Analyzing...")}</span>
                      ) : results.language ? (
                        <span className="opacity-40 italic">
                          {_("No technical terms found")}
                        </span>
                      ) : (
                        _("Pending...")
                      )}
                    </div>
                  </div>
                </div>
              )}

              {config.posTagging && (
                <div
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-start gap-3 shadow-sm"
                  style={{
                    backgroundColor: "var(--theme-surface)",
                    borderColor: "var(--theme-border)",
                  }}
                >
                  <Icon
                    name="activity"
                    size="md"
                    className="text-indigo-500 mt-0.5"
                    style={{ color: "var(--theme-primary)" }}
                  />
                  <div className="flex-1 min-w-0">
                    <h3
                      className="font-black text-[9px] uppercase tracking-widest text-slate-400"
                      style={{ color: "var(--theme-text-muted)" }}
                    >
                      {_("POS Tags")}
                    </h3>
                    <div
                      className="text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-1 line-clamp-2"
                      style={{ color: "var(--theme-text-muted)" }}
                    >
                      {results.posSummary || _("Pending analysis...")}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <h3
                  className="text-[9px] font-black uppercase tracking-widest text-slate-400"
                  style={{ color: "var(--theme-text-muted)" }}
                >
                  {_("Native Stream")}
                </h3>
                {isStreaming && (
                  <div
                    className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"
                    style={{ backgroundColor: "var(--theme-primary)" }}
                  />
                )}
              </div>
              <textarea
                readOnly
                value={
                  streamLog || _("Invoke analysis to stream logs from C++...")
                }
                className="w-full h-40 bg-slate-950 text-blue-400/90 p-4 rounded-2xl font-mono text-[10px] leading-relaxed border border-slate-800 focus:outline-none resize-none scrollbar-thin scrollbar-thumb-slate-800"
                style={{
                  backgroundColor: "var(--theme-bg)",
                  borderColor: "var(--theme-border)",
                  color: "var(--theme-primary)",
                }}
              />
              <div ref={logEndRef} />
            </div>
          </div>
        )}

        {activeTab === "settings" && (
          <div className="space-y-6 animate-in slide-in-from-right duration-300">
            <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
              {_("Configuration")}
              </h2>
            <div className="space-y-3">
              {([
                { id: "posTagging" as const, label: _("POS Tagging"), icon: "activity" as IconName },
                {
                  id: "terminology" as const,
                  label: _("Terminology Extraction"),
                  icon: "sparkles" as IconName,
                },
                { id: "safety" as const, label: _("Content Safety"), icon: "safety" as IconName },
              ] satisfies Array<{ id: keyof typeof config; label: string; icon: IconName }>).map((item) => (
                <label
                  key={item.id}
                  className="flex items-center justify-between p-4 bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-all group"
                  style={{
                    backgroundColor: "var(--theme-surface)",
                    borderColor: "var(--theme-border)",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <Icon
                      name={item.icon}
                      size="sm"
                      className="text-slate-400 group-hover:text-blue-500 transition-colors"
                      style={{ color: "var(--theme-text-muted)" }}
                    />
                    <span
                      className="text-xs font-bold text-slate-600 dark:text-slate-300"
                      style={{ color: "var(--theme-text)" }}
                    >
                      {item.label}
                    </span>
                  </div>
                  <div className="relative flex items-center">
                    <input
                      type="checkbox"
                      checked={config[item.id]}
                      onChange={(e) =>
                        setConfig({ ...config, [item.id]: e.target.checked })
                      }
                      className="peer sr-only"
                    />
                    <div
                      className="w-5 h-5 rounded-full border-2 border-slate-300 dark:border-slate-600 peer-checked:border-emerald-500 peer-checked:bg-emerald-500 transition-all flex items-center justify-center"
                      style={{
                        borderColor: config[item.id]
                          ? "var(--theme-primary)"
                          : "var(--theme-border)",
                      }}
                    >
                      <div className="w-2 h-2 rounded-full bg-white scale-0 peer-checked:scale-100 transition-transform" />
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      <footer
        className="p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shrink-0 flex justify-between items-center"
        style={{
          backgroundColor: "var(--theme-surface)",
          borderTopColor: "var(--theme-border)",
        }}
      >
        <span
          className="text-[8px] font-black tracking-widest text-slate-400 uppercase"
          style={{ color: "var(--theme-text-muted)" }}
        >
          NLP STUDIO CORE v2.0
        </span>
        <div
          className={`text-[8px] font-black uppercase ${health.engine_ready ? "text-emerald-500" : "text-rose-500"}`}
        >
          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
          <span>{health.engine_ready ? _("Engine Linked") : _("No Core")}</span>
        </div>
      </footer>
    </div>
  );
};

export default Sidebar;
