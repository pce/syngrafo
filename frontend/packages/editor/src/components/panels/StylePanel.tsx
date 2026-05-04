import React, { useState } from "react";
import { useEditor, useEditorDoc, useSelectedBlock } from "../../store/editor-store";
import { useSignal, useSignalState } from "../../hooks/useSignal";
import type { Block, CalloutVariant } from "../../models/block";
import type { StyleClass } from "../../models/style";
import { Icon } from "../Icon";
import type { IconName } from "../Icon";

const CALLOUT_COLORS: Record<CalloutVariant, string> = {
  info: "bg-blue-100 border-blue-400 text-blue-800",
  tip: "bg-emerald-100 border-emerald-400 text-emerald-800",
  warning: "bg-amber-100 border-amber-400 text-amber-800",
  danger: "bg-rose-100 border-rose-400 text-rose-800",
  success: "bg-green-100 border-green-400 text-green-800",
  note: "bg-slate-100 border-slate-400 text-slate-700",
};

const CALLOUT_ICONS: Record<CalloutVariant, IconName> = {
  info: "info",
  tip: "lightbulb",
  warning: "warning",
  danger: "alert-circle",
  success: "check",
  note: "file-text",
};

const CALLOUT_VARIANTS: CalloutVariant[] = ["info", "tip", "warning", "danger", "success", "note"];

function ratiosToString(ratios: number[]): string {
  return ratios.map((r) => Math.round(r * 100)).join("/");
}

function parseRatios(s: string): number[] | null {
  const parts = s.split("/").map((p) => parseFloat(p.trim()));
  if (parts.some(isNaN)) return null;
  const sum = parts.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 1) return null;
  return parts.map((p) => p / 100);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--theme-border)] last:border-0">
      <div className="px-2 py-1.5 text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 bg-[var(--theme-bg)]/30">
        {title}
      </div>
      <div className="px-2 pb-2 pt-1">{children}</div>
    </div>
  );
}

function StylePanelContent({ block, doc }: { block: Block; doc: ReturnType<typeof useEditorDoc> }) {
  const { dispatch } = useEditor();
  const [showAllStyles, setShowAllStyles] = useState(false);

  const styleRef = useSignal(block.getStyleRefSignal());
  const stylesMap = useSignal(doc.getStyleLibrary().getStylesSignal());
  const [content, setContent] = useSignalState(block.getContentSignal());

  const allStyles = Array.from(stylesMap.values());
  const visibleStyles = showAllStyles ? allStyles : allStyles.slice(0, 12);

  const btype = block.getType();
  const meta = block.getMetadata();
  const isContainer = block.isLayoutContainer();
  const isCallout = btype === "callout";
  const isReveal = btype === "reveal";
  const isColumns = btype === "columns";
  const isTextBlock = block.isTextBlock() || btype === "code" || btype === "li";

  const applyStyle = (sc: StyleClass) => {
    block.setStyleId(sc.getId());
    dispatch({ type: "SET_DIRTY", isDirty: true });
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto text-[var(--theme-text)] text-xs">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--theme-border)] shrink-0 bg-[var(--theme-bg)]/40">
        <span className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-70 flex-1">
          Style — <span className="text-[var(--theme-primary)]">{btype}</span>
        </span>
        <span className="text-[9px] text-[var(--theme-text-muted)] opacity-50 font-mono truncate max-w-20">{styleRef.styleId}</span>
      </div>

      {isTextBlock && !isContainer && (
        <Section title="Content">
          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              dispatch({ type: "SET_DIRTY", isDirty: true });
            }}
            rows={4}
            className="w-full resize-y rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] text-xs px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)] font-mono leading-relaxed"
            placeholder="Block content…"
          />
        </Section>
      )}

      <Section title="Style Class">
        <div className="grid grid-cols-2 gap-1">
          {visibleStyles.map((sc) => {
            const isActive = sc.getId() === styleRef.styleId;
            const props = sc.getProperties();
            return (
              <button
                key={sc.getId()}
                onClick={() => applyStyle(sc)}
                title={sc.getName()}
                className={[
                  "text-left px-2 py-1 rounded border text-[10px] leading-tight transition-all truncate",
                  isActive
                    ? "border-[var(--theme-primary)] bg-[var(--theme-primary)]/10 text-[var(--theme-primary)] font-bold"
                    : "border-[var(--theme-border)] hover:border-[var(--theme-primary)]/50 text-[var(--theme-text)]",
                ].join(" ")}
                style={{
                  fontFamily: props.fontFamily ?? undefined,
                  fontWeight: props.fontWeight ?? undefined,
                  fontStyle: props.fontStyle ?? undefined,
                  fontSize: "10px",
                }}
              >
                {sc.getName()}
              </button>
            );
          })}
        </div>
        {allStyles.length > 12 && (
          <button onClick={() => setShowAllStyles((v) => !v)} className="mt-1 text-[9px] text-[var(--theme-primary)] hover:underline">
            {showAllStyles ? "Show less" : `+ ${allStyles.length - 12} more styles`}
          </button>
        )}
      </Section>

      {isCallout && (
        <Section title="Callout Variant">
          <div className="grid grid-cols-3 gap-1">
            {CALLOUT_VARIANTS.map((v) => {
              const isActive = (meta.variant ?? "info") === v;
              return (
                <button
                  key={v}
                  onClick={() => {
                    block.updateMetadata("variant", v);
                    dispatch({ type: "SET_DIRTY", isDirty: true });
                  }}
                  className={[
                    "flex flex-col items-center gap-0.5 px-1 py-1.5 rounded border text-[9px] font-medium transition-all",
                    CALLOUT_COLORS[v],
                    isActive ? "ring-2 ring-offset-1 ring-current opacity-100" : "opacity-70 hover:opacity-90",
                  ].join(" ")}
                >
                  <Icon name={CALLOUT_ICONS[v]} size="xs" />
                  <span>{v}</span>
                </button>
              );
            })}
          </div>
        </Section>
      )}

      {isReveal && (
        <Section title="Reveal Settings">
          <label className="block mb-2">
            <span className="text-[9px] text-[var(--theme-text-muted)] uppercase tracking-wide font-bold block mb-1">
              Split Ratio: {Math.round(((meta.splitRatio as number) ?? 0.5) * 100)}%
            </span>
            <input
              type="range"
              min={10}
              max={90}
              value={Math.round(((meta.splitRatio as number) ?? 0.5) * 100)}
              onChange={(e) => {
                block.updateMetadata("splitRatio", Number(e.target.value) / 100);
                dispatch({ type: "SET_DIRTY", isDirty: true });
              }}
              className="w-full h-1.5 accent-[var(--theme-primary)]"
            />
          </label>
          <label className="flex items-center justify-between mb-2">
            <span className="text-[9px] text-[var(--theme-text-muted)] uppercase tracking-wide font-bold">Axis</span>
            <div className="flex rounded border border-[var(--theme-border)] overflow-hidden text-[9px]">
              {(["v", "h"] as const).map((ax) => (
                <button
                  key={ax}
                  onClick={() => {
                    block.updateMetadata("splitAxis", ax);
                    dispatch({ type: "SET_DIRTY", isDirty: true });
                  }}
                  className={[
                    "px-2 py-0.5 font-mono transition-colors",
                    (meta.splitAxis ?? "v") === ax
                      ? "bg-[var(--theme-primary)] text-[var(--theme-primary-fg)]"
                      : "hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)]",
                  ].join(" ")}
                >
                  {ax === "v" ? "⇔ H" : "⇕ V"}
                </button>
              ))}
            </div>
          </label>
          <label className="flex items-center justify-between">
            <span className="text-[9px] text-[var(--theme-text-muted)] uppercase tracking-wide font-bold">Interactive</span>
            <input
              type="checkbox"
              checked={(meta.interactive as boolean) ?? true}
              onChange={(e) => {
                block.updateMetadata("interactive", e.target.checked);
                dispatch({ type: "SET_DIRTY", isDirty: true });
              }}
              className="accent-[var(--theme-primary)]"
            />
          </label>
        </Section>
      )}

      {isColumns && (
        <Section title="Column Ratios">
          <ColumnsRatioEditor block={block} onDirty={() => dispatch({ type: "SET_DIRTY", isDirty: true })} />
        </Section>
      )}
    </div>
  );
}

export function StylePanel() {
  const doc = useEditorDoc();
  const block = useSelectedBlock();
  if (!block) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--theme-text-muted)] opacity-50 gap-2 p-4">
        <Icon name="sparkles" size="md" />
        <span className="text-[9px] font-medium uppercase tracking-wide text-center">Select a block to edit its style</span>
      </div>
    );
  }
  return <StylePanelContent block={block} doc={doc} />;
}

function ColumnsRatioEditor({ block, onDirty }: { block: Block; onDirty: () => void }) {
  const meta = block.getMetadata();
  const currentRatios = (meta.ratios as number[] | undefined) ?? [0.5, 0.5];
  const [input, setInput] = useState(ratiosToString(currentRatios));
  const [error, setError] = useState<string | null>(null);

  const PRESETS = [
    { label: "50/50", value: [0.5, 0.5] },
    { label: "70/30", value: [0.7, 0.3] },
    { label: "30/70", value: [0.3, 0.7] },
    { label: "33/33/34", value: [0.33, 0.33, 0.34] },
    { label: "25/50/25", value: [0.25, 0.5, 0.25] },
  ];

  const apply = (ratios: number[]) => {
    block.updateMetadata("ratios", ratios);
    setInput(ratiosToString(ratios));
    setError(null);
    onDirty();
  };

  const handleBlur = () => {
    const parsed = parseRatios(input);
    if (parsed) {
      apply(parsed);
    } else {
      setError("Parts must sum to 100, e.g. 70/30");
      setInput(ratiosToString(currentRatios));
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1 flex-wrap">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => apply(p.value)}
            className="text-[9px] px-1.5 py-0.5 rounded border border-[var(--theme-border)] hover:border-[var(--theme-primary)] hover:text-[var(--theme-primary)] transition-colors font-mono"
          >
            {p.label}
          </button>
        ))}
      </div>
      <div>
        <input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleBlur();
          }}
          className="w-full rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] text-xs px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]"
          placeholder="e.g. 70/30"
        />
        {error && <p className="text-[9px] text-rose-500 mt-0.5">{error}</p>}
      </div>
    </div>
  );
}
