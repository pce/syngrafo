import React, { useState, useCallback, useRef } from "react";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useEditor } from "../../store/editor-store";
import { isTextBlock, type SBlock, type SBlockType } from "../../models/sdm";
import { createBlock } from "../../models/sdm-factory";
import { Icon } from "../Icon";
import type { IconName } from "../Icon";



const BLOCK_ICON: Partial<Record<SBlockType, IconName>> = {
  h1: "heading1", h2: "heading2", h3: "heading3", h4: "heading3",
  p: "paragraph", quote: "paragraph",
  ul: "list", ol: "list", li: "list",
  img: "image",
  table: "grid", tr: "grid", td: "paragraph", th: "paragraph",
  code: "code",
  hr: "minus",
  callout: "message-square",
  hbox: "columns", vbox: "rows", col: "columns", grid: "grid",
  pagebreak: "scissors",
};

const BLOCK_LABEL: Partial<Record<SBlockType, string>> = {
  h1: "H1", h2: "H2", h3: "H3", h4: "H4",
  p: "P", quote: "QUOTE",
  ul: "UL", ol: "OL", li: "LI",
  img: "IMG",
  table: "TABLE", tr: "TR", td: "TD", th: "TH",
  code: "CODE", hr: "HR",
  callout: "CALLOUT",
  hbox: "HBOX", vbox: "VBOX", col: "COL", grid: "GRID",
  pagebreak: "PB",
};

/** Block types that hold child blocks and get a collapse toggle. */
const CONTAINER_TYPES = new Set<SBlockType>([
  "hbox", "vbox", "col", "grid", "callout", "ul", "ol", "table", "tr",
]);



function blockIconName(type: SBlockType): IconName {
  return (BLOCK_ICON[type] as IconName | undefined) ?? "grid";
}

function blockLabel(type: SBlockType): string {
  return BLOCK_LABEL[type] ?? type.toUpperCase();
}

function previewText(block: SBlock): string {
  if (isTextBlock(block)) {
    const full = block.spans.map((s) => s.text).join("");
    return full.length > 40 ? full.slice(0, 40) + "…" : full || "(empty)";
  }
  if (block.type === "code") {
    return block.text.length > 40 ? block.text.slice(0, 40) + "…" : block.text || "(empty)";
  }
  if (block.type === "img") return block.alt ?? block.src.split("/").pop() ?? "[img]";
  return `[${block.type}]`;
}

function getBlockChildren(block: SBlock): SBlock[] {
  const b = block as { children?: unknown };
  return Array.isArray(b.children) ? (b.children as SBlock[]) : [];
}

// ─── Block type picker ───────────────────────────────────────────────────────

interface BlockCategory {
  label: string;
  types: SBlockType[];
}

const BLOCK_CATEGORIES: BlockCategory[] = [
  { label: "Text",      types: ["h1", "h2", "h3", "h4", "p", "quote", "figcaption"] },
  { label: "List",      types: ["ul", "ol"] },
  { label: "Media",     types: ["img", "code"] },
  { label: "Structure", types: ["hr", "pagebreak"] },
  { label: "Layout",    types: ["hbox", "vbox", "grid", "callout"] },
  { label: "Table",     types: ["table"] },
];

const BLOCK_TYPE_LABEL: Partial<Record<SBlockType, string>> = {
  h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", h4: "Heading 4",
  p: "Paragraph", quote: "Blockquote", figcaption: "Caption",
  ul: "Bullet list", ol: "Numbered list",
  img: "Image", code: "Code block",
  hr: "Divider", pagebreak: "Page break",
  hbox: "Horizontal box", vbox: "Vertical box",
  grid: "Grid", callout: "Callout",
  table: "Table",
};

interface BlockPickerPopoverProps {
  onPick: (type: SBlockType) => void;
  onClose: () => void;
}

function BlockPickerPopover({ onPick, onClose }: BlockPickerPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useClickOutside(ref, onClose, true);

  return (
    <div
      ref={ref}
      className="absolute top-full right-0 z-30 mt-0.5 w-52 bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-lg shadow-lg overflow-y-auto max-h-72"
      onClick={(e) => e.stopPropagation()}
    >
      {BLOCK_CATEGORIES.map((cat) => (
        <div key={cat.label}>
          <div className="px-2 py-1 text-[8px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-50 bg-[var(--theme-bg)]/40 sticky top-0">
            {cat.label}
          </div>
          <div className="px-1 pb-1">
            {cat.types.map((t) => (
              <button
                key={t}
                onClick={() => { onPick(t); onClose(); }}
                className="w-full text-left flex items-center gap-2 px-2 py-1 rounded text-[10px] text-[var(--theme-text)] hover:bg-[var(--theme-primary)]/10 hover:text-[var(--theme-primary)] transition-colors"
              >
                <span className="font-mono opacity-50 text-[9px] w-12 shrink-0">{t.toUpperCase()}</span>
                <span>{BLOCK_TYPE_LABEL[t] ?? t}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}



interface TreeRowProps {
  block: SBlock;
  selectedId: string | null;
  expandedIds: Set<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onDuplicate: (id: string) => void;
}

function TreeRow({
  block,
  selectedId,
  expandedIds,
  onSelect,
  onToggle,
  onDelete,
  onMoveUp,
  onMoveDown,
  onDuplicate,
}: TreeRowProps) {
  const id = block.id;
  const isSelected = id === selectedId;
  const isContainer = CONTAINER_TYPES.has(block.type);
  const isExpanded = expandedIds.has(id);
  const children = getBlockChildren(block);

  const childProps: Omit<TreeRowProps, "block"> = {
    selectedId, expandedIds,
    onSelect, onToggle, onDelete, onMoveUp, onMoveDown, onDuplicate,
  };

  return (
    <div>
      <div
        className={[
          "flex items-center gap-1.5 px-1.5 py-[3px] rounded cursor-pointer select-none text-xs transition-colors group",
          "hover:bg-[var(--theme-bg)]",
          isSelected
            ? "bg-[var(--theme-primary)]/15 text-[var(--theme-primary)] font-medium"
            : "text-[var(--theme-text)]",
        ].join(" ")}
        onClick={() => onSelect(id)}
      >
        {isContainer ? (
          <button
            className="w-3.5 h-3.5 flex items-center justify-center text-[8px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] shrink-0"
            onClick={(e) => { e.stopPropagation(); onToggle(id); }}
            title={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}

        <span className="shrink-0 opacity-60 flex items-center">
          <Icon name={blockIconName(block.type)} size="xs" />
        </span>

        <span className="flex-1 truncate font-mono min-w-0" title={previewText(block)}>
          <span className="opacity-50 text-[9px] uppercase mr-1">{blockLabel(block.type)}</span>
          <span className="opacity-80 text-[10px]">{previewText(block)}</span>
          {isContainer && children.length > 0 && (
            <span className="opacity-40 text-[9px] ml-1">({children.length})</span>
          )}
        </span>

        <span className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition-opacity">
          <button
            className="p-0.5 rounded hover:bg-[var(--theme-surface)] text-[var(--theme-text-muted)]"
            onClick={(e) => { e.stopPropagation(); onMoveUp(id); }}
            title="Move up"
          >
            <span className="text-[8px] leading-none">▲</span>
          </button>
          <button
            className="p-0.5 rounded hover:bg-[var(--theme-surface)] text-[var(--theme-text-muted)]"
            onClick={(e) => { e.stopPropagation(); onMoveDown(id); }}
            title="Move down"
          >
            <span className="text-[8px] leading-none">▼</span>
          </button>
          <button
            className="p-0.5 rounded hover:bg-[var(--theme-surface)] text-[var(--theme-text-muted)]"
            onClick={(e) => { e.stopPropagation(); onDuplicate(id); }}
            title="Duplicate"
          >
            <Icon name="copy" size="xs" />
          </button>
          <button
            className="p-0.5 rounded hover:bg-rose-500/10 text-rose-500"
            onClick={(e) => { e.stopPropagation(); onDelete(id); }}
            title="Delete"
          >
            <Icon name="trash" size="xs" />
          </button>
        </span>
      </div>

      {isContainer && isExpanded && (
        <div className="border-l border-[var(--theme-border)] ml-3 pl-0.5">
          {children.length === 0 ? (
            <div className="text-[9px] text-[var(--theme-text-muted)] px-2 py-1 italic opacity-60">empty</div>
          ) : (
            children.map((child) => (
              <TreeRow key={child.id} block={child} {...childProps} />
            ))
          )}
        </div>
      )}
    </div>
  );
}



export function BlockTreePanel() {
  const { state, dispatch } = useEditor();
  const { doc, selectedBlockId } = state;
  const blocks = doc?.blocks ?? [];

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const handleSelect = useCallback((id: string) => {
    dispatch({ type: "SELECT_BLOCK", id });
  }, [dispatch]);

  const handleDelete = useCallback((id: string) => {
    dispatch({ type: "DELETE_BLOCK", id });
    if (selectedBlockId === id) dispatch({ type: "SELECT_BLOCK", id: null });
  }, [dispatch, selectedBlockId]);

  const handleMoveUp = useCallback((id: string) => {
    dispatch({ type: "MOVE_BLOCK", id, direction: "up" });
  }, [dispatch]);

  const handleMoveDown = useCallback((id: string) => {
    dispatch({ type: "MOVE_BLOCK", id, direction: "down" });
  }, [dispatch]);

  const handleDuplicate = useCallback((id: string) => {
    dispatch({ type: "DUPLICATE_BLOCK", id });
  }, [dispatch]);

  const [pickerOpen, setPickerOpen] = useState(false);

  const handleAdd = useCallback((type: SBlockType = "p") => {
    if (!doc) return;
    const block = createBlock(type);
    dispatch({
      type: "ADD_BLOCK",
      block,
      ...(selectedBlockId != null ? { afterId: selectedBlockId } : {}),
    });
    dispatch({ type: "SELECT_BLOCK", id: block.id });
    setPickerOpen(false);
  }, [dispatch, doc, selectedBlockId]);

  const rowProps: Omit<TreeRowProps, "block"> = {
    selectedId: selectedBlockId,
    expandedIds,
    onSelect: handleSelect,
    onToggle: toggleExpanded,
    onDelete: handleDelete,
    onMoveUp: handleMoveUp,
    onMoveDown: handleMoveDown,
    onDuplicate: handleDuplicate,
  };

  return (
    <div className="flex flex-col h-full overflow-hidden text-[var(--theme-text)]">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[var(--theme-border)] shrink-0 bg-[var(--theme-bg)]/40">
        <span className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-70 flex-1">
          Blocks
        </span>
        <span className="text-[9px] text-[var(--theme-text-muted)] opacity-50">{blocks.length}</span>
        <div className="relative shrink-0">
          <button
            onClick={() => setPickerOpen((v) => !v)}
            disabled={!doc}
            className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] text-[10px] font-bold hover:opacity-90 transition-opacity disabled:opacity-40 whitespace-nowrap shrink-0"
            title="Insert a new block"
          >
            <Icon name="plus" size="xs" />
            <span>Add</span>
            <Icon name="chevron-down" size="xs" />
          </button>
          {pickerOpen && (
            <BlockPickerPopover
              onPick={handleAdd}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1 px-0.5">
        {blocks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 text-[var(--theme-text-muted)] opacity-50 gap-1">
            <span className="text-2xl">□</span>
            <span className="text-[9px] font-medium uppercase tracking-wide">No blocks</span>
          </div>
        ) : (
          blocks.map((block) => (
            <TreeRow key={block.id} block={block} {...rowProps} />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 flex items-center gap-3 px-2 py-1 border-t border-[var(--theme-border)] text-[9px] text-[var(--theme-text-muted)] opacity-60">
        <span>{blocks.length} block{blocks.length !== 1 ? "s" : ""}</span>
        {selectedBlockId && (
          <span>sel: #{blocks.findIndex((b) => b.id === selectedBlockId) + 1}</span>
        )}
      </div>
    </div>
  );
}
