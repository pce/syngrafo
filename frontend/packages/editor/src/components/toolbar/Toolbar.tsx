import React, { useState, useRef } from "react";
import { useEditor, useSelectedBlock, useCanUndo, useCanRedo } from "../../store/editor-store";
import { useClickOutside } from "../../hooks/useClickOutside";
import { isTextBlock, type TextBlockType, type SBlock } from "../../models/sdm";
import { Icon } from "../Icon";
import type { IconName } from "../Icon";

// Text block types that can be freely switched between.
const SWITCHABLE_TEXT_TYPES: TextBlockType[] = ["p", "h1", "h2", "h3", "h4", "quote"];

const TEXT_TYPE_LABEL: Record<string, string> = {
  p: "Paragraph", h1: "Heading 1", h2: "Heading 2",
  h3: "Heading 3", h4: "Heading 4", quote: "Blockquote",
};

const TEXT_ALIGN_ICONS: Record<string, IconName> = {
  left: "align-left", center: "align-center",
  right: "align-right", justify: "align-justify",
};

function Divider() {
  return <div className="w-px h-4 bg-[var(--theme-border)] shrink-0 mx-0.5" />;
}

function ToolBtn({
  icon, label, active, onClick, disabled,
}: {
  icon: IconName; label: string; active?: boolean; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex items-center justify-center w-6 h-6 rounded transition-colors",
        active
          ? "bg-[var(--theme-primary)]/15 text-[var(--theme-primary)]"
          : "text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] hover:text-[var(--theme-text)]",
        disabled ? "opacity-30 cursor-not-allowed" : "",
      ].join(" ")}
    >
      <Icon name={icon} size="xs" />
    </button>
  );
}

/** Block type switcher dropdown — only for SWITCHABLE_TEXT_TYPES. */
function BlockTypeSwitcher() {
  const { dispatch } = useEditor();
  const block = useSelectedBlock();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useClickOutside(ref, () => setOpen(false), open);

  if (!block || !isTextBlock(block) || !SWITCHABLE_TEXT_TYPES.includes(block.type as TextBlockType)) {
    return (
      <span className="flex items-center gap-1 text-[9px] text-[var(--theme-text-muted)] opacity-40 px-2 font-mono">
        <Icon name="type" size="xs" />
        {block ? block.type.toUpperCase() : "—"}
      </span>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2 h-6 rounded border border-[var(--theme-border)] text-[9px] font-mono font-bold text-[var(--theme-text)] hover:border-[var(--theme-primary)]/50 transition-colors"
        title="Change block type"
      >
        <Icon name="type" size="xs" />
        <span>{TEXT_TYPE_LABEL[block.type] ?? block.type.toUpperCase()}</span>
        <Icon name="chevron-down" size="xs" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-0.5 z-30 bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-lg shadow-lg min-w-[140px] overflow-hidden">
          {SWITCHABLE_TEXT_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => {
                dispatch({ type: "CHANGE_BLOCK_TYPE", id: block.id, newType: t });
                setOpen(false);
              }}
              className={[
                "w-full text-left px-3 py-1.5 text-[10px] transition-colors",
                block.type === t
                  ? "bg-[var(--theme-primary)]/10 text-[var(--theme-primary)] font-bold"
                  : "text-[var(--theme-text)] hover:bg-[var(--theme-bg)]",
              ].join(" ")}
            >
              <span className="font-mono opacity-50 text-[8px] mr-2">{t.toUpperCase()}</span>
              {TEXT_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Style class quick-picker dropdown. */
function StyleClassPicker() {
  const { state, dispatch } = useEditor();
  const block = useSelectedBlock();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useClickOutside(ref, () => setOpen(false), open);

  if (!block) return null;

  const styles = state.doc?.styles ?? {};
  const styleIds = Object.keys(styles);
  const currentStyle = block.style ?? null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2 h-6 rounded border border-[var(--theme-border)] text-[9px] font-mono text-[var(--theme-text-muted)] hover:border-[var(--theme-primary)]/50 transition-colors max-w-[120px]"
        title="Apply style class"
      >
        <Icon name="palette" size="xs" />
        <span className="truncate">{currentStyle ?? "no class"}</span>
        <Icon name="chevron-down" size="xs" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-0.5 z-30 bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-lg shadow-lg min-w-[160px] max-h-52 overflow-y-auto">
          <button
            onClick={() => {
              dispatch({ type: "UPDATE_BLOCK", id: block.id, patch: { style: undefined } as unknown as Partial<Omit<SBlock, "type" | "id">> });
              setOpen(false);
            }}
            className={[
              "w-full text-left px-3 py-1.5 text-[10px] transition-colors",
              !currentStyle
                ? "bg-[var(--theme-primary)]/10 text-[var(--theme-primary)] font-bold"
                : "text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)]",
            ].join(" ")}
          >
            None
          </button>
          {styleIds.map((id) => (
            <button
              key={id}
              onClick={() => {
                dispatch({ type: "UPDATE_BLOCK", id: block.id, patch: { style: id } });
                setOpen(false);
              }}
              className={[
                "w-full text-left px-3 py-1.5 text-[10px] transition-colors font-mono truncate",
                id === currentStyle
                  ? "bg-[var(--theme-primary)]/10 text-[var(--theme-primary)] font-bold"
                  : "text-[var(--theme-text)] hover:bg-[var(--theme-bg)]",
              ].join(" ")}
            >
              {id}
            </button>
          ))}
          {styleIds.length === 0 && (
            <p className="px-3 py-2 text-[9px] text-[var(--theme-text-muted)] opacity-50 italic">
              No style classes defined.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Formatting toolbar rendered between the context tabs and the canvas.
 * Shows block type switcher, text alignment, and style class picker for the
 * currently selected block.
 */
export function Toolbar(): React.ReactElement {
  const { dispatch } = useEditor();
  const block = useSelectedBlock();
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();

  const currentAlign = block?.styleOverrides?.align ?? null;

  const setAlign = (a: "left" | "center" | "right" | "justify") => {
    if (!block) return;
    dispatch({
      type: "UPDATE_BLOCK",
      id: block.id,
      patch: {
        styleOverrides: {
          ...(block.styleOverrides ?? {}),
          align: currentAlign === a ? undefined : a,
        },
      } as unknown as Partial<Omit<SBlock, "type" | "id">>,
    });
  };

  return (
    <div className="sgf-ui shrink-0 flex items-center gap-1 px-2 py-1 border-b border-[var(--theme-border)] bg-[var(--theme-surface)] overflow-x-auto">
      {/* Undo / Redo */}
      <ToolBtn
        icon="undo"
        label="Undo (⌘Z)"
        onClick={() => dispatch({ type: "UNDO" })}
        disabled={!canUndo}
      />
      <ToolBtn
        icon="redo"
        label="Redo (⌘⇧Z)"
        onClick={() => dispatch({ type: "REDO" })}
        disabled={!canRedo}
      />

      <Divider />

      {/* Block type */}
      <BlockTypeSwitcher />

      <Divider />

      {/* Text alignment */}
      {(["left", "center", "right", "justify"] as const).map((a) => (
        <ToolBtn
          key={a}
          icon={TEXT_ALIGN_ICONS[a] as IconName}
          label={`Align ${a}`}
          active={currentAlign === a}
          onClick={() => setAlign(a)}
          disabled={!block}
        />
      ))}

      <Divider />

      {/* Style class */}
      <StyleClassPicker />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Block actions */}
      {block && (
        <>
          <ToolBtn
            icon="chevron-up"
            label="Move block up"
            onClick={() => dispatch({ type: "MOVE_BLOCK", id: block.id, direction: "up" })}
          />
          <ToolBtn
            icon="chevron-down"
            label="Move block down"
            onClick={() => dispatch({ type: "MOVE_BLOCK", id: block.id, direction: "down" })}
          />
          <ToolBtn
            icon="copy"
            label="Duplicate block"
            onClick={() => dispatch({ type: "DUPLICATE_BLOCK", id: block.id })}
          />
          <ToolBtn
            icon="trash"
            label="Delete block"
            onClick={() => {
              dispatch({ type: "DELETE_BLOCK", id: block.id });
              dispatch({ type: "SELECT_BLOCK", id: null });
            }}
          />
        </>
      )}
    </div>
  );
}
