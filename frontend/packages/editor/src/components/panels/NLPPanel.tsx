import React, { useState } from "react";
import { useEditor, useEditorDoc, useSelectedBlock } from "../../store/editor-store";
import { runAnalysis, analyzeText } from "../../services/nlp-analyzer";
import type { NLPVisibilityFlags } from "../../models/editor-context";
import { POS_COLORS, NER_COLORS, posLabel } from "../../models/nlp";

interface FlagMeta {
  key: keyof NLPVisibilityFlags;
  label: string;
  icon: string;
  desc: string;
}

const FLAGS: FlagMeta[] = [
  { key: "showPOS", label: "POS Tags", icon: "🏷", desc: "Colour-code tokens by part of speech" },
  { key: "showNER", label: "Entities", icon: "🔖", desc: "Badge named entities (PERSON, ORG, GPE…)" },
  { key: "showKeywords", label: "Keywords", icon: "⚷", desc: "Outline high TF-IDF keyword tokens" },
  { key: "showSpellErrors", label: "Spell Check", icon: "✎", desc: "Underline spelling errors" },
  { key: "showReadability", label: "Readability", icon: "📊", desc: "Grade badge at end of each block" },
  { key: "showSentiment", label: "Sentiment", icon: "⟁", desc: "Polarity indicator per sentence" },
  { key: "showSynonyms", label: "Synonyms", icon: "⟺", desc: "Synonym tooltip on hover (nouns, verbs)" },
  { key: "showDepTree", label: "Dep. Tree", icon: "⌥", desc: "Dependency arcs above block" },
];

function ToggleRow({ meta, value, onChange }: { meta: FlagMeta; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-2 py-1 group">
      <span className="text-[11px] shrink-0 w-4 text-center leading-none">{meta.icon}</span>
      <span className="flex-1 text-[10px] text-[var(--theme-text)] leading-tight" title={meta.desc}>
        {meta.label}
      </span>
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
      <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ background: color }} />
      <span className="text-[8px] text-[var(--theme-text-muted)] font-mono">{label}</span>
    </div>
  );
}

export function NLPPanel() {
  const { state, dispatch } = useEditor();
  const doc = useEditorDoc();
  const block = useSelectedBlock();
  const { nlpFlags, isAnalyzing } = state;

  const [blockAnalyzing, setBlockAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setFlag = (key: keyof NLPVisibilityFlags, value: boolean) => {
    dispatch({ type: "SET_NLP_FLAGS", flags: { [key]: value } });
  };

  const handleAnalyzeAll = async () => {
    setError(null);
    dispatch({ type: "SET_ANALYZING", isAnalyzing: true });
    try {
      const { summary } = await runAnalysis(doc);
      dispatch({ type: "SET_NLP_SUMMARY", summary });
      dispatch({ type: "SET_STATUS", text: "Analysis complete", statusType: "success" });
    } catch (e) {
      setError(String(e));
    } finally {
      dispatch({ type: "SET_ANALYZING", isAnalyzing: false });
    }
  };

  const handleAnalyzeBlock = async () => {
    if (!block) return;
    setBlockAnalyzing(true);
    setError(null);
    try {
      const annotation = await analyzeText(block.getContent(), {
        entities: true,
        keywords: true,
        readability: true,
        spellCheck: true,
      });
      block.setNLPAnnotation(annotation);
      dispatch({ type: "SET_DIRTY", isDirty: true });
      dispatch({ type: "SET_STATUS", text: "Block analyzed", statusType: "success" });
    } catch (e) {
      setError(String(e));
    } finally {
      setBlockAnalyzing(false);
    }
  };

  const blockAnnotation = block?.getNLPAnnotation();
  const keywords = blockAnnotation?.tokens.filter((t) => t.isKeyword) ?? [];
  const spellErrors = blockAnnotation?.tokens.filter((t) => t.spellError) ?? [];

  const POS_LEGEND = [
    { tag: "NN", label: "Noun" },
    { tag: "VB", label: "Verb" },
    { tag: "JJ", label: "Adj" },
    { tag: "RB", label: "Adv" },
    { tag: "IN", label: "Prep" },
    { tag: "MD", label: "Modal" },
    { tag: "PRP", label: "Pron" },
    { tag: "CD", label: "Num" },
  ];

  const NER_LEGEND = ["PERSON", "ORG", "GPE", "LOC", "DATE", "MONEY", "PRODUCT", "EVENT"];

  return (
    <div className="flex flex-col h-full overflow-y-auto text-[var(--theme-text)]">
      <div className="px-2 py-1.5 border-b border-[var(--theme-border)] shrink-0 bg-[var(--theme-bg)]/40">
        <span className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-70">NLP Annotations</span>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-[var(--theme-border)]">
        <div className="px-3 py-2">
          <h3 className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 mb-1.5">Show Layers</h3>
          {FLAGS.map((f) => (
            <ToggleRow key={f.key} meta={f} value={nlpFlags[f.key]} onChange={(v) => setFlag(f.key, v)} />
          ))}
        </div>

        <div className="px-3 py-2">
          <h3 className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 mb-1.5">POS Colors</h3>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {POS_LEGEND.map(({ tag, label }) => (
              <Swatch key={tag} color={POS_COLORS[tag] ?? "#eee"} label={`${tag} · ${label}`} />
            ))}
          </div>
        </div>

        <div className="px-3 py-2">
          <h3 className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 mb-1.5">NER Colors</h3>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {NER_LEGEND.map((type) => (
              <Swatch key={type} color={NER_COLORS[type] ?? "#eee"} label={type} />
            ))}
          </div>
        </div>

        {block && (
          <div className="px-3 py-2">
            <h3 className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 mb-1.5">Selected Block</h3>

            {blockAnnotation ? (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-1 text-center">
                  {[
                    ["Tokens", blockAnnotation.tokens.length],
                    ["Keywords", keywords.length],
                    ["Errors", spellErrors.length],
                  ].map(([l, v]) => (
                    <div key={l as string} className="rounded border border-[var(--theme-border)] py-1">
                      <div className="text-[8px] text-[var(--theme-text-muted)] opacity-60 uppercase tracking-wide">{l}</div>
                      <div className="text-sm font-black text-[var(--theme-text)] tabular-nums">{v}</div>
                    </div>
                  ))}
                </div>

                {blockAnnotation.readability && (
                  <div className="text-[9px] text-[var(--theme-text-muted)]">
                    Grade <span className="font-bold text-[var(--theme-text)]">{blockAnnotation.readability.fleschKincaidGrade.toFixed(1)}</span> ·{" "}
                    <span className="font-bold text-[var(--theme-text)]">{blockAnnotation.readability.complexity}</span>
                  </div>
                )}

                {keywords.length > 0 && (
                  <div>
                    <div className="text-[8px] text-[var(--theme-text-muted)] opacity-60 uppercase tracking-wide mb-1">Keywords</div>
                    <div className="flex flex-wrap gap-1">
                      {keywords.slice(0, 8).map((t, i) => (
                        <span
                          key={i}
                          className="text-[8px] px-1.5 py-0.5 rounded bg-[var(--theme-primary)]/10 text-[var(--theme-primary)] border border-[var(--theme-primary)]/20 font-mono"
                        >
                          {t.text}
                          {t.keywordScore != null && <span className="opacity-50 ml-0.5">{(t.keywordScore * 100).toFixed(0)}%</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {spellErrors.length > 0 && (
                  <div>
                    <div className="text-[8px] text-[var(--theme-text-muted)] opacity-60 uppercase tracking-wide mb-1">Spell Errors</div>
                    <div className="space-y-0.5">
                      {spellErrors.slice(0, 5).map((t, i) => (
                        <div key={i} className="flex items-center gap-1 text-[9px]">
                          <span className="text-rose-500 underline decoration-wavy decoration-rose-400 font-mono">{t.text}</span>
                          {t.suggestion && (
                            <>
                              <span className="opacity-40">→</span>
                              <span className="text-emerald-600 font-mono">{t.suggestion}</span>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="text-[8px] text-[var(--theme-text-muted)] opacity-40">Analyzed {new Date(blockAnnotation.analyzedAt).toLocaleTimeString()}</div>
              </div>
            ) : (
              <p className="text-[9px] text-[var(--theme-text-muted)] opacity-50 italic">No annotation — click "Analyze Block" below.</p>
            )}
          </div>
        )}

        <div className="px-3 py-3 space-y-2">
          <button
            onClick={handleAnalyzeAll}
            disabled={isAnalyzing}
            className={[
              "w-full py-1.5 rounded text-[10px] font-bold transition-all",
              isAnalyzing
                ? "bg-[var(--theme-border)] text-[var(--theme-text-muted)] cursor-not-allowed"
                : "bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] hover:opacity-90",
            ].join(" ")}
          >
            {isAnalyzing ? "⟳ Analyzing…" : "⚡ Analyze All Blocks"}
          </button>

          {block && (
            <button
              onClick={handleAnalyzeBlock}
              disabled={blockAnalyzing}
              className={[
                "w-full py-1.5 rounded text-[10px] font-bold border transition-all",
                blockAnalyzing
                  ? "border-[var(--theme-border)] text-[var(--theme-text-muted)] cursor-not-allowed"
                  : "border-[var(--theme-primary)] text-[var(--theme-primary)] hover:bg-[var(--theme-primary)]/10",
              ].join(" ")}
            >
              {blockAnalyzing ? "⟳ Analyzing…" : "🏷 Analyze Block"}
            </button>
          )}

          {error && <p className="text-[9px] text-rose-500">{error}</p>}
        </div>
      </div>
    </div>
  );
}
