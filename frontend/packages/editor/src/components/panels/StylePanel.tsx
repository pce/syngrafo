import React, { useState } from "react";
import { useEditor, useSelectedBlock } from "../../store/editor-store";
import {
  isTextBlock,
  type SBlock,
  type CalloutVariant,
  type AlignH,
  type AlignV,
  type ImgFit,
  type SpacingToken,
  type SStyleProps,
  type FontToken,
  type SizeToken,
  type WeightToken,
  type LeadingToken,
  type SStyleClass,
} from "../../models/sdm";
import { Icon } from "../Icon";
import type { IconName } from "../Icon";
import { ipcRawCall, parseIpcResult } from "../../services/ipc";



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
  const [isPickingImage, setIsPickingImage] = useState(false);

  const styles = doc?.styles ?? {};
  const styleIds = Object.keys(styles);
  const visibleIds = showAllStyles ? styleIds : styleIds.slice(0, 12);

  const currentStyleId = block.style ?? null;

  // editMode: "class" = editing the style class definition itself;
  //           "override" = editing per-block styleOverrides.
  // Defaults to "class" when a class is selected, "override" otherwise.
  const [editMode, setEditMode] = React.useState<"class" | "override">(() =>
    currentStyleId ? "class" : "override"
  );

  // Reset editMode whenever the selected block or its class changes.
  React.useEffect(() => {
    setEditMode(currentStyleId ? "class" : "override");
  }, [block.id, currentStyleId]);

  const isText = isTextBlock(block);
  const textValue = isText ? block.spans.map((s) => s.text).join("") : "";
  const imageBlock = block.type === "img" ? block : null;



  // Helper to update block's styleOverrides.
  // Accepts Record<string, unknown> so callers can pass `undefined` to
  // delete a key — required because exactOptionalPropertyTypes is enabled.
  const patchOverrides = (patch: Record<string, unknown>) => {
    const merged: Record<string, unknown> = { ...(block.styleOverrides ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) {
        delete merged[k];
      } else {
        merged[k] = v;
      }
    }
    dispatch({
      type: "UPDATE_BLOCK",
      id: block.id,
      patch: {
        styleOverrides: Object.keys(merged).length > 0
          ? (merged as Partial<SStyleProps>)
          : undefined,
      } as unknown as Partial<Omit<SBlock, "type" | "id">>,
    });
  };

  // Dispatches to either UPDATE_STYLE_CLASS (class mode) or patchOverrides (override mode).
  const patchStyle = (patch: Record<string, unknown>) => {
    if (editMode === "class" && currentStyleId) {
      dispatch({
        type: "UPDATE_STYLE_CLASS",
        id: currentStyleId,
        patch: patch as Partial<SStyleProps>,
      });
    } else {
      patchOverrides(patch);
    }
  };

  // Clears all props for the current edit target (class or block overrides).
  const clearCurrentProps = () => {
    if (editMode === "class" && currentStyleId) {
      dispatch({ type: "ADD_STYLE_CLASS", id: currentStyleId, cls: { props: {} } });
    } else {
      dispatch({
        type: "UPDATE_BLOCK",
        id: block.id,
        patch: { styleOverrides: undefined } as unknown as Partial<Omit<SBlock, "type" | "id">>,
      });
    }
  };

  const overrides = block.styleOverrides ?? {};

  // What the Typography section reads and writes — depends on editMode.
  const currentProps: Partial<SStyleProps> =
    editMode === "class" && currentStyleId
      ? (styles[currentStyleId]?.props ?? {})
      : overrides;

  // Mode toggle bar — only visible when a class is selected.
  const modeToggle = currentStyleId && (
    <div className="flex border-b border-[var(--theme-border)] bg-[var(--theme-bg)]/20">
      {(["class", "override"] as const).map((m) => (
        <button
          key={m}
          onClick={() => setEditMode(m)}
          className={[
            "flex-1 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors",
            editMode === m
              ? "bg-[var(--theme-primary)] text-[var(--theme-primary-fg)]"
              : "text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)]",
          ].join(" ")}
          title={
            m === "class"
              ? `Edit style class "${currentStyleId}" (changes apply to all blocks using this class)`
              : "Edit per-block style overrides"
          }
        >
          {m === "class" ? `Class: ${currentStyleId}` : "Block overrides"}
        </button>
      ))}
    </div>
  );

  const typographySection = (
    <Section title="Typography">
      {/* Font */}
      <FieldLabel>Font</FieldLabel>
      <select
        value={currentProps.font ?? ""}
        onChange={(e) => patchStyle({ font: (e.target.value as FontToken) || undefined })}
        className={SELECT_CLASS}
      >
        <option value="">— inherit —</option>
        <option value="sans">Sans-serif</option>
        <option value="serif">Serif</option>
        <option value="mono">Monospace</option>
      </select>

      {/* Size */}
      <FieldLabel>Size</FieldLabel>
      <select
        value={currentProps.size ?? ""}
        onChange={(e) => patchStyle({ size: (e.target.value as SizeToken) || undefined })}
        className={SELECT_CLASS}
      >
        <option value="">— inherit —</option>
        {(["xs","sm","md","lg","xl","2xl","3xl","4xl"] as SizeToken[]).map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      {/* Weight */}
      <FieldLabel>Weight</FieldLabel>
      <select
        value={currentProps.weight ?? ""}
        onChange={(e) => patchStyle({ weight: (e.target.value as WeightToken) || undefined })}
        className={SELECT_CLASS}
      >
        <option value="">— inherit —</option>
        <option value="normal">Normal</option>
        <option value="medium">Medium</option>
        <option value="semibold">Semibold</option>
        <option value="bold">Bold</option>
      </select>

      {/* Style */}
      <FieldLabel>Style</FieldLabel>
      <div className="flex rounded border border-[var(--theme-border)] overflow-hidden text-[9px]">
        {(["normal", "italic"] as const).map((s) => (
          <button
            key={s}
            onClick={() => patchStyle({ style: currentProps.style === s ? undefined : s })}
            className={[
              "flex-1 py-0.5 capitalize transition-colors",
              currentProps.style === s
                ? "bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] font-bold"
                : "hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)]",
            ].join(" ")}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Leading */}
      <FieldLabel>Line height</FieldLabel>
      <select
        value={currentProps.leading ?? ""}
        onChange={(e) => patchStyle({ leading: (e.target.value as LeadingToken) || undefined })}
        className={SELECT_CLASS}
      >
        <option value="">— inherit —</option>
        {(["tight","snug","normal","relaxed","loose"] as LeadingToken[]).map((l) => (
          <option key={l} value={l}>{l}</option>
        ))}
      </select>

      {/* Text align */}
      <FieldLabel>Text align</FieldLabel>
      <div className="flex gap-1">
        {(["left","center","right","justify"] as const).map((a) => (
          <button
            key={a}
            onClick={() => patchStyle({ align: currentProps.align === a ? undefined : a })}
            className={[
              "flex-1 py-0.5 rounded border text-[9px] font-mono transition-all capitalize",
              currentProps.align === a
                ? "border-[var(--theme-primary)] bg-[var(--theme-primary)]/10 text-[var(--theme-primary)] font-bold"
                : "border-[var(--theme-border)] hover:border-[var(--theme-primary)]/50 text-[var(--theme-text-muted)]",
            ].join(" ")}
            title={a}
          >
            {a[0]?.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Color */}
      <FieldLabel>Text color</FieldLabel>
      <div className="flex gap-1.5 items-center">
        <input
          type="color"
          value={currentProps.color ?? "#000000"}
          onChange={(e) => patchStyle({ color: e.target.value })}
          className="w-7 h-7 rounded border border-[var(--theme-border)] cursor-pointer p-0.5 bg-transparent"
          title="Text color"
        />
        <input
          type="text"
          value={currentProps.color ?? ""}
          onChange={(e) => patchStyle({ color: e.target.value || undefined })}
          placeholder="inherit"
          className="flex-1 rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] text-[9px] px-1.5 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]"
        />
        {currentProps.color && (
          <button
            onClick={() => patchStyle({ color: undefined })}
            className="text-[9px] text-[var(--theme-text-muted)] hover:text-rose-500 transition-colors"
            title="Clear"
          >
            ✕
          </button>
        )}
      </div>

      {/* Background */}
      <FieldLabel>Background</FieldLabel>
      <div className="flex gap-1.5 items-center">
        <input
          type="color"
          value={currentProps.background ?? "#ffffff"}
          onChange={(e) => patchStyle({ background: e.target.value })}
          className="w-7 h-7 rounded border border-[var(--theme-border)] cursor-pointer p-0.5 bg-transparent"
          title="Background color"
        />
        <input
          type="text"
          value={currentProps.background ?? ""}
          onChange={(e) => patchStyle({ background: e.target.value || undefined })}
          placeholder="none"
          className="flex-1 rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] text-[9px] px-1.5 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]"
        />
        {currentProps.background && (
          <button
            onClick={() => patchStyle({ background: undefined })}
            className="text-[9px] text-[var(--theme-text-muted)] hover:text-rose-500 transition-colors"
            title="Clear"
          >
            ✕
          </button>
        )}
      </div>

      {/* Border radius */}
      <FieldLabel>Rounding</FieldLabel>
      <select
        value={currentProps.border?.radius ?? ""}
        onChange={(e) => {
          const radius = e.target.value || undefined;
          const existingBorder = currentProps.border ?? {};
          const newBorder = radius
            ? { ...existingBorder, radius }
            : Object.keys(existingBorder).filter((k) => k !== "radius").length > 0
              ? (({ radius: _r, ...rest }) => rest)(existingBorder)
              : undefined;
          patchStyle({ border: newBorder });
        }}
        className={SELECT_CLASS}
      >
        <option value="">— none —</option>
        <option value="none">none</option>
        <option value="sm">sm</option>
        <option value="md">md</option>
        <option value="lg">lg</option>
        <option value="full">full (pill)</option>
      </select>

      {/* Clear / Reset button */}
      {editMode === "override" && Object.keys(overrides).length > 0 && (
        <button
          onClick={clearCurrentProps}
          className="text-[9px] text-rose-500 hover:underline mt-0.5"
        >
          Clear all overrides
        </button>
      )}
      {editMode === "class" && currentStyleId && Object.keys(currentProps).length > 0 && (
        <button
          onClick={clearCurrentProps}
          className="text-[9px] text-rose-500 hover:underline mt-0.5"
        >
          Reset class props
        </button>
      )}
    </Section>
  );

  const [newClassName, setNewClassName] = useState("");

  const saveAsClassSection = editMode === "override" && Object.keys(overrides).length > 0 && (
    <Section title="Save as Style Class">
      <p className="text-[9px] text-[var(--theme-text-muted)] opacity-60 leading-snug">
        Save the current overrides as a reusable named class.
      </p>
      <div className="flex gap-1">
        <input
          type="text"
          value={newClassName}
          onChange={(e) => setNewClassName(e.target.value)}
          placeholder="class-name"
          className="flex-1 rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] text-[9px] px-1.5 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]"
        />
        <button
          disabled={!newClassName.trim() || !!styles[newClassName.trim()]}
          onClick={() => {
            const clsId = newClassName.trim();
            if (!clsId || styles[clsId]) return;
            const newCls: SStyleClass = { props: { ...overrides } };
            dispatch({ type: "ADD_STYLE_CLASS", id: clsId, cls: newCls });
            dispatch({ type: "UPDATE_BLOCK", id: block.id, patch: { style: clsId, styleOverrides: undefined } as unknown as Partial<Omit<SBlock, "type" | "id">> });
            setNewClassName("");
          }}
          className="px-2 py-1 rounded bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] text-[9px] font-bold disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0"
          title={styles[newClassName.trim()] ? "Name already in use" : "Save and apply"}
        >
          Save
        </button>
      </div>
      {newClassName && styles[newClassName.trim()] && (
        <p className="text-[9px] text-amber-600">Name already in use — choose another.</p>
      )}
    </Section>
  );



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
      {currentStyleId && (
        <button
          onClick={() => dispatch({ type: "REMOVE_STYLE_CLASS", id: currentStyleId })}
          className="text-[9px] text-rose-500 hover:underline mt-0.5"
          title="Remove this style class from the document (will unset it on all blocks)"
        >
          Delete "{currentStyleId}"
        </button>
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

  const imageSection = imageBlock && (
    <Section title="Image">
      <FieldLabel>Source</FieldLabel>
      <input
        type="text"
        value={imageBlock.src}
        onChange={(e) =>
          dispatch({
            type: "UPDATE_BLOCK",
            id: block.id,
            patch: { src: e.target.value } as unknown as Partial<Omit<SBlock, "type" | "id">>,
          })
        }
        className={SELECT_CLASS}
        placeholder="asset://image.png · local:///path/file.png · https://…"
      />

      <div className="flex gap-1">
        <button
          onClick={async () => {
            if (isPickingImage) return;
            setIsPickingImage(true);
            try {
              const raw = await ipcRawCall("dms_select_files");
              const paths = parseIpcResult<{ paths: string[] }>(raw).data?.paths ?? [];
              const nextPath = paths[0];
              if (!nextPath) return;
              dispatch({
                type: "UPDATE_BLOCK",
                id: block.id,
                patch: { src: `local://${nextPath}` } as unknown as Partial<Omit<SBlock, "type" | "id">>,
              });
            } finally {
              setIsPickingImage(false);
            }
          }}
          className="flex-1 rounded border border-[var(--theme-border)] px-2 py-1 text-[10px] font-medium text-[var(--theme-text)] hover:border-[var(--theme-primary)]/50 hover:bg-[var(--theme-bg)] transition-colors"
        >
          {isPickingImage ? "Picking..." : "Pick Image"}
        </button>
        <button
          onClick={() =>
            dispatch({
              type: "UPDATE_BLOCK",
              id: block.id,
              patch: { src: "" } as unknown as Partial<Omit<SBlock, "type" | "id">>,
            })
          }
          className="rounded border border-[var(--theme-border)] px-2 py-1 text-[10px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-bg)] transition-colors"
          title="Clear source"
        >
          Clear
        </button>
      </div>

      <FieldLabel>Alt text</FieldLabel>
      <input
        type="text"
        value={imageBlock.alt ?? ""}
        onChange={(e) =>
          dispatch({
            type: "UPDATE_BLOCK",
            id: block.id,
            patch: { alt: e.target.value || undefined } as unknown as Partial<Omit<SBlock, "type" | "id">>,
          })
        }
        className={SELECT_CLASS}
        placeholder="Describe the image"
      />

      <FieldLabel>Caption</FieldLabel>
      <input
        type="text"
        value={imageBlock.caption ?? ""}
        onChange={(e) =>
          dispatch({
            type: "UPDATE_BLOCK",
            id: block.id,
            patch: { caption: e.target.value || undefined } as unknown as Partial<Omit<SBlock, "type" | "id">>,
          })
        }
        className={SELECT_CLASS}
        placeholder="Optional caption"
      />

      <FieldLabel>Fit</FieldLabel>
      <select
        value={imageBlock.fit ?? "contain"}
        onChange={(e) =>
          dispatch({
            type: "UPDATE_BLOCK",
            id: block.id,
            patch: { fit: e.target.value as ImgFit } as unknown as Partial<Omit<SBlock, "type" | "id">>,
          })
        }
        className={SELECT_CLASS}
      >
        <option value="contain">Contain</option>
        <option value="cover">Cover</option>
        <option value="fill">Fill</option>
      </select>
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
        {modeToggle}
        {typographySection}
        {saveAsClassSection}
        {contentSection}
        {imageSection}
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
