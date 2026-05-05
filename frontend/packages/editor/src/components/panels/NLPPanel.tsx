import React, { useState } from "react";
import { useEditor } from "../../store/editor-store";
import { runAnalysis, isNLPConnected } from "../../services/nlp-analyzer";
import type { NLPVisibilityFlags } from "../../models/editor-context";
import { POS_COLORS, NER_COLORS, posLabel } from "../../models/nlp";
import type { DocumentNLPSummary } from "../../models/nlp";
import { Icon } from "../Icon";
import type { IconName } from "../Icon";

interface FlagMeta {
  key: keyof NLPVisibilityFlags;
  label: string;
  icon: IconName;
  desc: string;
}

const FLAGS: FlagMeta[] = [
  { key: "showPOS",          label: "POS Tags",     icon: "tag",          desc: "Colour-code tokens by part of speech" },
  { key: "showNER",          label: "Entities",     icon: "bookmark",     desc: "Badge named entities (PERSON, ORG, GPE…)" },
  { key: "showKeywords",     label: "Keywords",     icon: "key",          desc: "Outline high TF-IDF keyword tokens" },
  { key: "showSpellErrors",  label: "Spell Check",  icon: "spell-check",  desc: "Underline spelling errors" },
  { key: "showReadability",  label: "Readability",  icon: "bar-chart",    desc: "Grade badge at end of each block" },
  { key: "showSentiment",    label: "Sentiment",    icon: "sentiment",    desc: "Polarity indicator per sentence" },
  { key: "showSynonyms",     label: "Synonyms",     icon: "shuffle",      desc: "Synonym tooltip on hover" },
  { key: "showDepTree",      label: "Dep. Tree",    icon: "git-branch",   desc: "Dependency arcs above block" },
];

// Stable legend entries derived from the color maps.
const POS_LEGEND = Object.entries(POS_COLORS).map(([tag, color]) => ({
  tag,
  color,
  label: posLabel(tag),
}));

const NER_LEGEND = Object.entries(NER_COLORS).map(([type, color]) => ({ type, color }));

function ToggleRow({
  meta,
  value,
  onChange,
}: {
  meta: FlagMeta;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2 py-1 group" title={meta.desc}>
      <span className="shrink-0 flex items-center justify-center w-4 text-[var(--theme-text-muted)]">
        <Icon name={meta.icon} size="xs" />
      </span>
      <span className="flex-1 text-[10px] text-[var(--theme-text)] leading-tight">{meta.label}</span>
      <button
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={[
          "relative inline-flex h-4 w-7 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200",
          value ? "bg-[var(--theme-primary)]" : "bg-[var(--theme-border)]",
        ].join(" ")}
      >
        <span
          className={[
            "pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-200",
            value ? "translate-x-3" : "translate-x-0",
          ].join(" ")}
        />
      </button>
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="inline-block w-3 h-3 rounded-sm shrink-0 border border-black/5"
        style={{ background: color }}
      />
      <span className="text-[8px] text-[var(--theme-text-muted)] font-mono truncate">{label}</span>
    </div>
  );
}

function SummarySection({ summary }: { summary: DocumentNLPSummary }) {
  return (
    <div className="px-3 py-2 space-y-3">
      <h3 className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60">
        Analysis Summary
      </h3>

      <div className="grid grid-cols-3 gap-1 text-center">
        {[
          ["Words",     summary.wordCount],
          ["Sentences", summary.sentenceCount],
          ["Keywords",  summary.keywordCount],
        ].map(([l, v]) => (
          <div key={l as string} className="rounded border border-[var(--theme-border)] py-1.5">
            <div className="text-[8px] text-[var(--theme-text-muted)] opacity-60 uppercase tracking-wide">{l}</div>
            <div className="text-sm font-black text-[var(--theme-text)] tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      {summary.readabilityScore > 0 && (
        <div className="text-[9px] text-[var(--theme-text-muted)]">
          Readability{" "}
          <span className="font-bold text-[var(--theme-text)]">
            {summary.readabilityScore.toFixed(1)}
          </span>
          {" · "}Grade{" "}
          <span className="font-bold text-[var(--theme-text)]">
            {summary.avgGrade.toFixed(1)}
          </span>
          {summary.language && (
            <span className="ml-1 opacity-60">· {summary.language.toUpperCase()}</span>
          )}
        </div>
      )}

      {summary.topKeywords.length > 0 && (
        <div>
          <div className="text-[8px] text-[var(--theme-text-muted)] opacity-60 uppercase tracking-wide mb-1">
            Top Keywords
          </div>
          <div className="flex flex-wrap gap-1">
            {summary.topKeywords.slice(0, 10).map((kw) => (
              <span
                key={kw.term}
                className="text-[8px] px-1.5 py-0.5 rounded bg-[var(--theme-primary)]/10 text-[var(--theme-primary)] border border-[var(--theme-primary)]/20 font-mono"
              >
                {kw.term}
                {kw.frequency > 1 && (
                  <span className="opacity-50 ml-0.5">×{kw.frequency}</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {summary.entities.length > 0 && (
        <div>
          <div className="text-[8px] text-[var(--theme-text-muted)] opacity-60 uppercase tracking-wide mb-1">
            Named Entities
          </div>
          <div className="flex flex-wrap gap-1">
            {summary.entities.slice(0, 12).map((e) => {
              const color = NER_COLORS[e.type] ?? "hsl(210,20%,90%)";
              return (
                <span
                  key={`${e.text}|${e.type}`}
                  className="text-[8px] px-1.5 py-0.5 rounded font-medium"
                  style={{ background: color, color: "rgba(0,0,0,0.7)" }}
                  title={e.type}
                >
                  {e.text}
                  {e.count > 1 && <span className="opacity-60 ml-0.5">×{e.count}</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="text-[8px] text-[var(--theme-text-muted)] opacity-40">
        Computed {new Date(summary.computedAt).toLocaleTimeString()}
      </div>
    </div>
  );
}

export function NLPPanel() {
  const { state, dispatch } = useEditor();
  const { nlpFlags, nlpSummary, isAnalyzing, doc } = state;

  const [error, setError] = useState<string | null>(null);

  const setFlag = (key: keyof NLPVisibilityFlags, value: boolean) => {
    dispatch({ type: "SET_NLP_FLAGS", flags: { [key]: value } });
  };

  const handleAnalyze = async () => {
    if (!doc) return;
    setError(null);
    dispatch({ type: "SET_ANALYZING", value: true });
    try {
      const result = await runAnalysis(doc);
      dispatch({ type: "SET_NLP_SUMMARY", summary: result.summary });
      dispatch({ type: "SET_DOCUMENT", doc: result.doc });
      if (result.count === 0) {
        dispatch({ type: "SET_STATUS", text: "No text blocks to analyze", kind: "warning" });
      } else {
        dispatch({ type: "SET_STATUS", text: `Analyzed ${result.count} block${result.count === 1 ? "" : "s"}`, kind: "success" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      dispatch({ type: "SET_STATUS", text: msg, kind: "error" });
    } finally {
      dispatch({ type: "SET_ANALYZING", value: false });
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden text-[var(--theme-text)]">
      <div className="px-2 py-1.5 border-b border-[var(--theme-border)] shrink-0 bg-[var(--theme-bg)]/40">
        <span className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-70">
          NLP Annotations
        </span>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-[var(--theme-border)]">
        {/* Layer toggles */}
        <div className="px-3 py-2">
          <h3 className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 mb-1.5">
            Show Layers
          </h3>
          {FLAGS.map((f) => (
            <ToggleRow
              key={f.key}
              meta={f}
              value={nlpFlags[f.key]}
              onChange={(v) => setFlag(f.key, v)}
            />
          ))}
        </div>

        {/* POS legend */}
        <div className="px-3 py-2">
          <h3 className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 mb-1.5">
            POS Colors
          </h3>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {POS_LEGEND.map(({ tag, color, label }) => (
              <Swatch key={tag} color={color} label={`${tag} · ${label}`} />
            ))}
          </div>
        </div>

        {/* NER legend */}
        <div className="px-3 py-2">
          <h3 className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 mb-1.5">
            NER Colors
          </h3>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {NER_LEGEND.map(({ type, color }) => (
              <Swatch key={type} color={color} label={type} />
            ))}
          </div>
        </div>

        {/* Summary */}
        {nlpSummary && <SummarySection summary={nlpSummary} />}

        {/* Actions */}
        <div className="px-3 py-3 space-y-2">
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing || !doc}
            className={[
              "w-full py-1.5 rounded text-[10px] font-bold transition-all",
              isAnalyzing || !doc
                ? "bg-[var(--theme-border)] text-[var(--theme-text-muted)] cursor-not-allowed"
                : "bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] hover:opacity-90",
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
          {error && <p className="text-[9px] text-rose-500">{error}</p>}
          {!doc && (
            <p className="text-[9px] text-[var(--theme-text-muted)] opacity-50 italic text-center">
              No document loaded
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
