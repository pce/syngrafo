import React from "react";
import { useEditor } from "../../store/editor-store";
import { NER_COLORS } from "../../models/nlp";
import type { DocumentNLPSummary } from "../../models/nlp";
import { isNLPConnected } from "../../services/nlp-analyzer";
import { Icon } from "../Icon";
import { useNLPAnalyze } from "../../hooks/useNLPAnalyze";
import { useDocumentStats } from "../../hooks/useDocumentStats";

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] px-3 py-2.5 flex flex-col gap-0.5">
      <div className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60">
        {label}
      </div>
      <div className="text-lg font-black text-[var(--theme-text)] leading-none tabular-nums">{value}</div>
      {sub && <div className="text-[8px] text-[var(--theme-text-muted)] opacity-50">{sub}</div>}
    </div>
  );
}

function ReadabilityMeter({ grade }: { grade: number }) {
  const pct = Math.min(100, Math.max(0, (grade / 18) * 100));
  const color =
    grade < 6 ? "bg-emerald-500" : grade < 10 ? "bg-amber-500" : "bg-rose-500";
  const label = grade < 6 ? "Easy" : grade < 10 ? "Medium" : "Complex";
  const textColor =
    grade < 6 ? "text-emerald-600" : grade < 10 ? "text-amber-600" : "text-rose-600";

  return (
    <div>
      <div className="flex items-baseline justify-between text-xs mb-1.5">
        <span className="font-mono text-[11px] font-bold text-[var(--theme-text)]">
          Grade {grade.toFixed(1)}
        </span>
        <span className={`text-[9px] font-black uppercase tracking-wide ${textColor}`}>
          {label}
        </span>
      </div>
      <div className="h-2.5 bg-[var(--theme-bg)] rounded-full overflow-hidden border border-[var(--theme-border)]">
        <div
          className={`h-full ${color} rounded-full transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-[8px] text-[var(--theme-text-muted)] opacity-50 mt-0.5">
        <span>0 (Easy)</span>
        <span>18 (Complex)</span>
      </div>
    </div>
  );
}

function NERBadge({ type }: { type: string }) {
  const color = NER_COLORS[type] ?? "hsl(210,20%,90%)";
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wide"
      style={{ background: color, color: "rgba(0,0,0,0.7)" }}
    >
      {type}
    </span>
  );
}

function EntityList({ entities }: { entities: DocumentNLPSummary["entities"] }) {
  const groups: Record<string, typeof entities> = {};
  for (const e of entities) {
    if (!groups[e.type]) groups[e.type] = [];
    groups[e.type]!.push(e);
  }
  return (
    <div className="space-y-2">
      {Object.entries(groups).map(([type, items]) => (
        <div key={type}>
          <div className="flex items-center gap-1.5 mb-1">
            <NERBadge type={type} />
            <span className="text-[9px] text-[var(--theme-text-muted)] opacity-50">{items.length}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {items.slice(0, 8).map((e) => (
              <span
                key={e.text}
                className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--theme-bg)] border border-[var(--theme-border)] text-[var(--theme-text)] font-medium"
              >
                {e.text}
                {e.count > 1 && <span className="opacity-50 ml-1">×{e.count}</span>}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatsPanel() {
  const { state } = useEditor();
  const { doc, nlpSummary } = state;

  const stats = useDocumentStats(doc);
  const { analyze: handleAnalyze, isAnalyzing, error: analyzeError } = useNLPAnalyze(
    !!doc && !!stats && stats.wordCount > 0,
  );

  if (!doc || !stats) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--theme-text-muted)] opacity-50 p-4">
        <span className="text-[9px] font-medium uppercase tracking-wide">No document loaded</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto text-[var(--theme-text)] p-3 gap-4">
      {/* Document stats */}
      <div>
        <h3 className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 mb-2">
          Document Statistics
        </h3>
        <div className="grid grid-cols-3 gap-2">
          <StatCard label="Words"    value={stats.wordCount.toLocaleString()} />
          <StatCard label="Chars"    value={stats.charCount.toLocaleString()} />
          <StatCard label="Blocks"   value={stats.blockCount} />
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <StatCard label="Headings" value={stats.headingCount} />
          <StatCard
            label="Read time"
            value={`~${stats.readingTimeMins} min`}
            sub={`@ 200 wpm`}
          />
        </div>
      </div>

      {/* Readability */}
      <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3">
        <h3 className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 mb-2">
          Readability
        </h3>
        {nlpSummary ? (
          <ReadabilityMeter grade={nlpSummary.avgGrade} />
        ) : (
          <p className="text-[10px] text-[var(--theme-text-muted)] opacity-50 italic">
            Run analysis to compute readability score.
          </p>
        )}
      </div>

      {/* Analyse button */}
      <div className="flex flex-col gap-1.5">
        <button
          onClick={handleAnalyze}
          disabled={isAnalyzing || stats.wordCount === 0}
          className={[
            "w-full py-2 rounded-lg text-xs font-bold transition-all",
            isAnalyzing || stats.wordCount === 0
              ? "bg-[var(--theme-border)] text-[var(--theme-text-muted)] cursor-not-allowed opacity-50"
              : "bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] hover:opacity-90 active:scale-[0.98]",
          ].join(" ")}
        >
          <span className="flex items-center justify-center gap-1.5">
            <Icon name={isAnalyzing ? "refresh" : "zap"} size="xs" />
            {isAnalyzing ? "Analyzing…" : "Analyze Document"}
          </span>
        </button>
        {!isNLPConnected() && (
          <p className="text-[9px] text-amber-500 font-medium">NLP engine offline — whitespace fallback only</p>
        )}
        {analyzeError && <p className="text-[9px] text-rose-500">{analyzeError}</p>}
        {nlpSummary && (
          <p className="text-[9px] text-[var(--theme-text-muted)] opacity-50 text-center">
            Last analyzed {new Date(nlpSummary.computedAt).toLocaleTimeString()}
            {nlpSummary.language && ` · ${nlpSummary.language.toUpperCase()}`}
          </p>
        )}
      </div>

      {/* Top keywords */}
      {nlpSummary && nlpSummary.topKeywords.length > 0 && (
        <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3">
          <h3 className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 mb-2">
            Top Keywords
          </h3>
          <div className="space-y-1">
            {nlpSummary.topKeywords.slice(0, 10).map((kw) => {
              const maxScore = nlpSummary.topKeywords[0]?.score ?? 1;
              const pct = maxScore > 0 ? (kw.score / maxScore) * 100 : 0;
              return (
                <div key={kw.term} className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-[var(--theme-text)] min-w-[80px] truncate">
                    {kw.term}
                  </span>
                  <div className="flex-1 h-1.5 bg-[var(--theme-bg)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[var(--theme-primary)] rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[8px] text-[var(--theme-text-muted)] opacity-50 tabular-nums min-w-[22px] text-right">
                    {kw.frequency}×
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Named entities */}
      {nlpSummary && nlpSummary.entities.length > 0 && (
        <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3">
          <h3 className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 mb-2">
            Named Entities
          </h3>
          <EntityList entities={nlpSummary.entities} />
        </div>
      )}

      {/* Sentence analysis */}
      {nlpSummary && (
        <div className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3">
          <h3 className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 mb-2">
            Sentence Analysis
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <StatCard label="Sentences" value={nlpSummary.sentenceCount} />
            <StatCard
              label="Avg Length"
              value={
                nlpSummary.sentenceCount > 0
                  ? Math.round(nlpSummary.wordCount / nlpSummary.sentenceCount)
                  : 0
              }
              sub="words / sentence"
            />
          </div>
        </div>
      )}
    </div>
  );
}
