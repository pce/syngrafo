import React, { useState } from "react";
import { useEditor, useSelectedBlock } from "../../store/editor-store";
import {
  isTextBlock,
  type SBlock,
  type CalloutVariant,
  type AlignH,
  type AlignV,
  type SpacingToken,
} from "../../models/sdm";
import { Icon } from "../Icon";
import type { IconName } from "../Icon";



const CALLOUT_VARIANTS: CalloutVariant[] = ["info", "tip", "warning", "danger", "success", "note"];

const CALLOUT_COLORS: Record<CalloutVariant, string> = {
  info:    "bg-blue-100 border-blue-400 text-blue-800",
  tip:     "bg-emerald-100 border-emerald-400 text-emerald-800",
  warning: "bg-amber-100 border-amber-400 text-amber-800",
  danger:  "bg-rose-100 border-rose-400 text-rose-800",
  success: "bg-green-100 border-green-400 text-green-800",
  note:    "bg-slate-100 border-slate-400 text-slate-700",
};

const CALLOUT_ICONS: Record<CalloutVariant, IconName> = {
  info:    "info",
  tip:     "lightbulb",
  warning: "warning",
  danger:  "alert-circle",
  success: "check",
  note:    "file-text",
};

const ALIGN_H: AlignH[] = ["start", "center", "end", "fill"];
const ALIGN_V: AlignV[] = ["top", "middle", "bottom", "fill"];
const SPACING: SpacingToken[] = ["none", "xs", "sm", "md", "lg", "xl", "2xl"];



function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--theme-border)] last:border-0">
      <div className="px-2 py-1.5 text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60 bg-[var(--theme-bg)]/30">
        {title}
      </div>
      <div className="px-2 pb-2 pt-1 space-y-1.5">{children}</div>
    </div>
  );
}

const SELECT_CLASS =
  "w-full rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] text-[10px] px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[8px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-60">
      {children}
    </div>
  );
}



function StylePanelContent() {
  const { state, dispatch } = useEditor();
  const block = useSelectedBlock()!; // caller guarantees non-null
  const { doc } = state;

  const [showAllStyles, setShowAllStyles] = useState(false);

  const styles = doc?.styles ?? {};
  const styleIds = Object.keys(styles);
  const visibleIds = showAllStyles ? styleIds : styleIds.slice(0, 12);

  const currentStyleId = block.style ?? null;



  const isText = isTextBlock(block);
  const textValue = isText ? block.spans.map((s) => s.text).join("") : "";



  const styleSection = (
    <Section title="Style Class">
      <div className="grid grid-cols-2 gap-1">
        {/* None option */}
        <button
          onClick={() =>
            dispatch({ type: "UPDATE_BLOCK", id: block.id, patch: { style: undefined } as unknown as Partial<Omit<SBlock, "type" | "id">> })
          }
          className={[
            "text-left px-2 py-1 rounded border text-[10px] leading-tight transition-all truncate",
            !currentStyleId
              ? "border-[var(--theme-primary)] bg-[var(--theme-primary)]/10 text-[var(--theme-primary)] font-bold"
              : "border-[var(--theme-border)] hover:border-[var(--theme-primary)]/50 text-[var(--theme-text-muted)]",
          ].join(" ")}
        >
          None
        </button>

        {visibleIds.map((id) => {
          const sc = styles[id];
          if (!sc) return null;
          const isActive = id === currentStyleId;
          const { props } = sc;
          return (
            <button
              key={id}
              onClick={() =>
                dispatch({ type: "UPDATE_BLOCK", id: block.id, patch: { style: id } })
              }
              title={id}
              className={[
                "text-left px-2 py-1 rounded border text-[10px] leading-tight transition-all truncate",
                isActive
                  ? "border-[var(--theme-primary)] bg-[var(--theme-primary)]/10 text-[var(--theme-primary)] font-bold"
                  : "border-[var(--theme-border)] hover:border-[var(--theme-primary)]/50 text-[var(--theme-text)]",
              ].join(" ")}
              style={{
                fontFamily: props.font ?? undefined,
                fontWeight: props.weight === "bold" ? "700" : props.weight === "semibold" ? "600" : undefined,
                fontStyle: props.style === "italic" ? "italic" : undefined,
              }}
            >
              {id}
            </button>
          );
        })}
      </div>

      {styleIds.length > 12 && (
        <button
          onClick={() => setShowAllStyles((v) => !v)}
          className="text-[9px] text-[var(--theme-primary)] hover:underline mt-1"
        >
          {showAllStyles ? "Show less" : `+ ${styleIds.length - 12} more`}
        </button>
      )}

      {/* Read-only props of the applied style */}
      {currentStyleId && styles[currentStyleId] && (
        <div className="mt-2 rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2 py-1.5 space-y-0.5">
          {Object.entries(styles[currentStyleId]!.props)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-1.5 text-[9px]">
                <span className="font-mono opacity-50 min-w-[60px]">{k}</span>
                <span className="text-[var(--theme-text)] font-medium truncate">
                  {typeof v === "object" ? JSON.stringify(v) : String(v)}
                </span>
              </div>
            ))}
        </div>
      )}
    </Section>
  );



  const contentSection = isText && (
    <Section title="Content">
      <textarea
        value={textValue}
        onChange={(e) =>
          dispatch({
            type: "SET_BLOCK_SPANS",
            id: block.id,
            spans: [{ text: e.target.value }],
          })
        }
        rows={4}
        className="w-full resize-y rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] text-xs px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)] font-mono leading-relaxed"
        placeholder="Block content…"
      />
    </Section>
  );



  const calloutSection = block.type === "callout" && (
    <Section title="Callout Variant">
      <div className="grid grid-cols-3 gap-1">
        {CALLOUT_VARIANTS.map((v) => {
          const isActive = block.variant === v;
          return (
            <button
              key={v}
              onClick={() =>
                dispatch({ type: "UPDATE_BLOCK", id: block.id, patch: { variant: v } as unknown as Partial<Omit<SBlock, "type" | "id">> })
              }
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
  );



  const alignH = block.align?.h;
  const alignV = block.align?.v;

  const alignSection = (
    <Section title="Alignment">
      <FieldLabel>Horizontal</FieldLabel>
      <div className="flex gap-1">
        {ALIGN_H.map((h) => (
          <button
            key={h}
            onClick={() =>
              dispatch({
                type: "UPDATE_BLOCK",
                id: block.id,
                patch: { align: { ...block.align, h } },
              })
            }
            className={[
              "flex-1 py-0.5 rounded border text-[9px] font-mono transition-all",
              alignH === h
                ? "border-[var(--theme-primary)] bg-[var(--theme-primary)]/10 text-[var(--theme-primary)] font-bold"
                : "border-[var(--theme-border)] hover:border-[var(--theme-primary)]/50 text-[var(--theme-text-muted)]",
            ].join(" ")}
            title={h}
          >
            {h[0]?.toUpperCase()}
          </button>
        ))}
      </div>

      <FieldLabel>Vertical</FieldLabel>
      <div className="flex gap-1">
        {ALIGN_V.map((v) => (
          <button
            key={v}
            onClick={() =>
              dispatch({
                type: "UPDATE_BLOCK",
                id: block.id,
                patch: { align: { ...block.align, v } },
              })
            }
            className={[
              "flex-1 py-0.5 rounded border text-[9px] font-mono transition-all",
              alignV === v
                ? "border-[var(--theme-primary)] bg-[var(--theme-primary)]/10 text-[var(--theme-primary)] font-bold"
                : "border-[var(--theme-border)] hover:border-[var(--theme-primary)]/50 text-[var(--theme-text-muted)]",
            ].join(" ")}
            title={v}
          >
            {v[0]?.toUpperCase()}
          </button>
        ))}
      </div>
    </Section>
  );



  const spacingSection = (
    <Section title="Spacing">
      <FieldLabel>Inner (padding)</FieldLabel>
      <select
        value={block.spacing?.inner ?? ""}
        onChange={(e) =>
          dispatch({
            type: "UPDATE_BLOCK",
            id: block.id,
            patch: {
              spacing: {
                ...block.spacing,
                inner: (e.target.value as SpacingToken) || undefined,
              },
            },
          })
        }
        className={SELECT_CLASS}
      >
        <option value="">— none —</option>
        {SPACING.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      <FieldLabel>Outer (margin)</FieldLabel>
      <select
        value={block.spacing?.outer ?? ""}
        onChange={(e) =>
          dispatch({
            type: "UPDATE_BLOCK",
            id: block.id,
            patch: {
              spacing: {
                ...block.spacing,
                outer: (e.target.value as SpacingToken) || undefined,
              },
            },
          })
        }
        className={SELECT_CLASS}
      >
        <option value="">— none —</option>
        {SPACING.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
    </Section>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden text-[var(--theme-text)] text-xs">
      {/* Header */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--theme-border)] shrink-0 bg-[var(--theme-bg)]/40">
        <span className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-70 flex-1">
          Style — <span className="text-[var(--theme-primary)]">{block.type}</span>
        </span>
        {currentStyleId && (
          <span className="text-[9px] text-[var(--theme-text-muted)] opacity-50 font-mono truncate max-w-[80px]">
            {currentStyleId}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {contentSection}
        {styleSection}
        {calloutSection}
        {alignSection}
        {spacingSection}
      </div>
    </div>
  );
}



export function StylePanel() {
  const block = useSelectedBlock();

  if (!block) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--theme-text-muted)] opacity-50 gap-2 p-4">
        <Icon name="sparkles" size="md" />
        <span className="text-[9px] font-medium uppercase tracking-wide text-center">
          Select a block to edit its style
        </span>
      </div>
    );
  }

  return <StylePanelContent />;
}
