import React, { useState, useCallback, useRef, useEffect } from "react";
import { useEditor, useEditorDoc } from "../../store/editor-store";
import { useSignal } from "../../hooks/useSignal";
import { Block, type BlockType } from "../../models/block";
import { Icon } from "../Icon";
import type { IconName } from "../Icon";

const BLOCK_ICON: Record<string, IconName> = {
  h1: "heading1",
  h2: "heading2",
  h3: "heading3",
  p: "paragraph",
  ul: "list",
  ol: "list",
  li: "list",
  img: "image",
  figure: "image",
  figcaption: "image",
  table: "grid",
  code: "code",
  hr: "minus",
  callout: "message-square",
  reveal: "layers",
  stream: "refresh",
  "nlp-block": "tag",
  "nlp-tree": "tag",
  columns: "columns",
  hbox: "columns",
  vbox: "rows",
  pagebreak: "scissors",
  embed: "grid",
  "raw-html": "code",
};

const LABELS: Record<string, string> = {
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  p: "Paragraph",
  ul: "List",
  ol: "Ordered List",
  li: "List Item",
  img: "Image",
  figure: "Figure",
  figcaption: "Caption",
  table: "Table",
  code: "Code",
  hr: "Divider",
  callout: "Callout",
  reveal: "Reveal",
  stream: "Stream",
  "nlp-block": "NLP Block",
  "nlp-tree": "NLP Tree",
  columns: "Columns",
  hbox: "H-Box",
  vbox: "V-Box",
  pagebreak: "Page Break",
  embed: "Embed",
  "raw-html": "Raw HTML",
};

function blockIconName(type: BlockType): IconName {
  return BLOCK_ICON[type] ?? "grid";
}
function blockLabel(type: BlockType): string {
  return LABELS[type] ?? "Block";
}

function contentPreview(block: Block): string {
  const c = block.getContent();
  return c.length > 36 ? c.slice(0, 36) + "…" : c || "(empty)";
}

interface CtxMenu {
  blockId: string;
  x: number;
  y: number;
}

export function BlockTreePanel() {
  const { state, dispatch } = useEditor();
  const doc = useEditorDoc();
  const blocks = useSignal(doc.blocks);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverMode, setDragOverMode] = useState<"before" | "after" | "inside">("after");
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ctxMenu]);

  const getChildren = useCallback(
    (blockId: string): Block[] => {
      const b = blocks.find((x) => x.getId() === blockId);
      if (!b) return [];
      const childIds = b.getChildIds();
      return childIds.map((id) => blocks.find((x) => x.getId() === id)).filter((x): x is Block => Boolean(x));
    },
    [blocks],
  );

  const selectBlock = (id: string) => {
    dispatch({ type: "SELECT_BLOCK", blockId: id });
    document.querySelector(`[data-block-id="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const toggleExpanded = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-block-id", id);
    const ghost = window.document.createElement("div");
    Object.assign(ghost.style, {
      position: "absolute",
      top: "-9999px",
      padding: "6px 10px",
      background: "#6366f1",
      color: "white",
      borderRadius: "4px",
      fontSize: "11px",
    });
    ghost.textContent = blockLabel(blocks.find((b) => b.getId() === id)?.getType() ?? "p");
    window.document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => window.document.body.removeChild(ghost), 0);
    setDraggedId(id);
  };

  const handleDragOver = (e: React.DragEvent, id: string, mode: "before" | "after" | "inside") => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(id);
    setDragOverMode(mode);
  };

  const handleDrop = (e: React.DragEvent, targetId: string, mode: "before" | "after" | "inside") => {
    e.preventDefault();
    e.stopPropagation();
    const srcId = e.dataTransfer.getData("application/x-block-id");
    if (!srcId || srcId === targetId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    const all = [...doc.getBlocks()];
    const fromI = all.findIndex((b) => b.getId() === srcId);
    const toI = all.findIndex((b) => b.getId() === targetId);
    if (fromI === -1 || toI === -1) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    const [dragged] = all.splice(fromI, 1);
    if (!dragged) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }
    if (mode === "inside") {
      const target = all.find((b) => b.getId() === targetId);
      if (target?.isLayoutContainer()) {
        const kids = [...target.getChildIds()];
        kids.push(srcId);
        target.updateMetadata("children", kids);
        setExpandedIds((prev) => new Set([...prev, targetId]));
      }
    } else {
      const newToI = all.findIndex((b) => b.getId() === targetId);
      all.splice(mode === "before" ? newToI : newToI + 1, 0, dragged);
    }

    doc.setBlocks(all);
    dispatch({ type: "SET_DIRTY", isDirty: true });
    dispatch({ type: "SET_STATUS", text: `Moved ${blockLabel(dragged.getType())}`, statusType: "success" });
    setDraggedId(null);
    setDragOverId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  const ctxAddAfter = (blockId: string) => {
    const all = [...doc.getBlocks()];
    const idx = all.findIndex((b) => b.getId() === blockId);
    const src = all[idx];
    if (!src) return;
    const nb = new Block(`block-${Date.now()}`, "p", "");
    all.splice(idx + 1, 0, nb);
    doc.setBlocks(all);
    dispatch({ type: "SET_DIRTY", isDirty: true });
    dispatch({ type: "SELECT_BLOCK", blockId: nb.getId() });
    setCtxMenu(null);
  };

  const ctxDuplicate = (blockId: string) => {
    const all = [...doc.getBlocks()];
    const idx = all.findIndex((b) => b.getId() === blockId);
    const src = all[idx];
    if (!src) return;
    const dupe = new Block(`block-${Date.now()}`, src.getType(), src.getContent(), src.getStyleId(), { ...src.getMetadata() });
    all.splice(idx + 1, 0, dupe);
    doc.setBlocks(all);
    dispatch({ type: "SET_DIRTY", isDirty: true });
    dispatch({ type: "SET_STATUS", text: "Duplicated", statusType: "success" });
    setCtxMenu(null);
  };

  const ctxDelete = (blockId: string) => {
    doc.removeBlock(blockId);
    if (state.selectedBlockId === blockId) dispatch({ type: "SELECT_BLOCK", blockId: null });
    dispatch({ type: "SET_DIRTY", isDirty: true });
    dispatch({ type: "SET_STATUS", text: "Deleted", statusType: "success" });
    setCtxMenu(null);
  };

  const childIds = new Set<string>();
  blocks.forEach((b) => {
    if (b.isLayoutContainer()) b.getChildIds().forEach((id) => childIds.add(id));
  });

  const renderNode = (block: Block, depth = 0): React.ReactNode => {
    const id = block.getId();
    const isSelected = state.selectedBlockId === id;
    const isDragging = draggedId === id;
    const isOver = dragOverId === id;
    const isContainer = block.isLayoutContainer();
    const isExpanded = expandedIds.has(id);
    const children = getChildren(id);
    const btype = block.getType();

    return (
      <div key={id} style={{ marginLeft: depth * 14 }}>
        {isOver && dragOverMode === "before" && <div className="h-0.5 bg-indigo-500 rounded mx-1 my-px" />}

        <div
          className={[
            "flex items-center gap-1.5 px-1.5 py-[3px] rounded cursor-pointer select-none text-xs transition-colors group",
            "hover:bg-[var(--theme-bg)]",
            isSelected ? "bg-[var(--theme-primary)]/15 text-[var(--theme-primary)] font-medium" : "text-[var(--theme-text)]",
            isDragging ? "opacity-40" : "",
            isOver && dragOverMode === "inside" ? "ring-1 ring-indigo-500 bg-indigo-50/10" : "",
          ].join(" ")}
          draggable
          onClick={() => selectBlock(id)}
          onContextMenu={(e) => {
            e.preventDefault();
            setCtxMenu({ blockId: id, x: e.clientX, y: e.clientY });
          }}
          onDragStart={(e) => handleDragStart(e, id)}
          onDragOver={(e) => handleDragOver(e, id, isContainer ? "inside" : "after")}
          onDrop={(e) => handleDrop(e, id, isContainer ? "inside" : "after")}
          onDragEnd={handleDragEnd}
          onDragLeave={(e) => {
            e.stopPropagation();
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setDragOverId(null);
          }}
        >
          {isContainer ? (
            <button
              className="w-3.5 h-3.5 flex items-center justify-center text-[8px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] shrink-0"
              onClick={(e) => toggleExpanded(id, e)}
              title={isExpanded ? "Collapse" : "Expand"}
            >
              {isExpanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="w-3.5 shrink-0" />
          )}

          <span className="shrink-0 opacity-60 flex items-center">
            <Icon name={blockIconName(btype)} size="xs" />
          </span>

          <span className="flex-1 truncate font-mono" title={block.getContent()}>
            <span className="opacity-50 text-[9px] uppercase mr-1">{btype}</span>
            <span className="opacity-80">{contentPreview(block)}</span>
            {children.length > 0 && <span className="opacity-40 text-[9px] ml-1">({children.length})</span>}
          </span>

          <button
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--theme-surface)] text-[var(--theme-text-muted)] transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              setCtxMenu({ blockId: id, x: e.clientX, y: e.clientY });
            }}
            title="More options"
          >
            <Icon name="ellipsis" size="xs" />
          </button>
        </div>

        {isContainer && isExpanded && (
          <div className="border-l border-[var(--theme-border)] ml-3 pl-0.5">
            {children.length === 0 ? (
              <div className="text-[9px] text-[var(--theme-text-muted)] px-2 py-1 italic opacity-60">empty</div>
            ) : (
              children.map((c) => renderNode(c, depth + 1))
            )}
          </div>
        )}

        {isOver && dragOverMode === "after" && <div className="h-0.5 bg-indigo-500 rounded mx-1 my-px" />}
      </div>
    );
  };

  const rootBlocks = blocks.filter((b) => !childIds.has(b.getId()));

  return (
    <div className="flex flex-col h-full overflow-hidden text-[var(--theme-text)]">
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[var(--theme-border)] shrink-0 bg-[var(--theme-bg)]/40">
        <span className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] opacity-70 flex-1">Blocks</span>
        <span className="text-[9px] text-[var(--theme-text-muted)] opacity-50">{blocks.length}</span>
        <button
          onClick={() => {
            const nb = new Block(`block-${Date.now()}`, "p", "New paragraph");
            doc.addBlock(nb);
            dispatch({ type: "SET_DIRTY", isDirty: true });
            dispatch({ type: "SELECT_BLOCK", blockId: nb.getId() });
          }}
          className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] hover:opacity-90 transition-opacity font-bold"
          title="Add paragraph block"
        >
          + Add
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1 px-0.5">
        {blocks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 text-[var(--theme-text-muted)] opacity-50 gap-1">
            <span className="text-2xl">□</span>
            <span className="text-[9px] font-medium uppercase tracking-wide">No blocks</span>
          </div>
        ) : (
          rootBlocks.map((b) => renderNode(b))
        )}
      </div>

      <div className="shrink-0 flex items-center gap-3 px-2 py-1 border-t border-[var(--theme-border)] text-[9px] text-[var(--theme-text-muted)] opacity-60">
        <span>
          {blocks.length} block{blocks.length !== 1 ? "s" : ""}
        </span>
        {state.selectedBlockId && <span>sel: #{blocks.findIndex((b) => b.getId() === state.selectedBlockId) + 1}</span>}
      </div>

      {ctxMenu && (
        <div
          ref={ctxRef}
          style={{ position: "fixed", left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999 }}
          className="bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-lg shadow-xl py-1 min-w-[160px] text-xs"
        >
          <button
            onClick={() => ctxAddAfter(ctxMenu.blockId)}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--theme-bg)] text-[var(--theme-text)] transition-colors"
          >
            <Icon name="plus" size="xs" />
            Add Block After
          </button>
          <div className="h-px bg-[var(--theme-border)] my-1" />
          <button
            onClick={() => ctxDuplicate(ctxMenu.blockId)}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--theme-bg)] text-[var(--theme-text)] transition-colors"
          >
            <Icon name="copy" size="xs" />
            Duplicate
          </button>
          <button
            onClick={() => ctxDelete(ctxMenu.blockId)}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-rose-500/10 text-rose-600 dark:text-rose-400 transition-colors"
          >
            <Icon name="trash" size="xs" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
