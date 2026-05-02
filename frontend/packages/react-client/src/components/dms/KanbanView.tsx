import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { dms } from "../../services/dms-service";
import Icon from "../Icon";

// ── Data model ────────────────────────────────────────────────────────────────

interface KanbanCard {
  /** Stable UUID used as React key and for in-memory lookups. */
  id: string;
  /** Current line index in rawLines — used only for serialisation. */
  lineIdx: number;
  title: string;
  done: boolean;
}

interface KanbanLane {
  name: string;       // filename without .md extension
  filePath: string;
  cards: KanbanCard[];
  rawLines: string[]; // full source lines for round-trip serialisation
}

export interface KanbanViewProps {
  kanbanDir: string; // e.g. "/home/user/zone/.kanban"
}

// ── Lane accent palette ───────────────────────────────────────────────────────

const LANE_COLORS = [
  { border: "#10b981", bg: "rgba(16,185,129,0.07)" },  // emerald
  { border: "#3b82f6", bg: "rgba(59,130,246,0.07)" },  // blue
  { border: "#f59e0b", bg: "rgba(245,158,11,0.07)" },  // amber
  { border: "#8b5cf6", bg: "rgba(139,92,246,0.07)" },  // violet
  { border: "#f43f5e", bg: "rgba(244,63,94,0.07)" },   // rose
] as const;

type LaneColor = (typeof LANE_COLORS)[number];

// ── Parse helpers ─────────────────────────────────────────────────────────────

const TASK_RE = /^- \[( |x)\] (.+)/i;

function parseCards(content: string): { cards: KanbanCard[]; rawLines: string[] } {
  const rawLines = content.split("\n");
  const cards: KanbanCard[] = [];

  rawLines.forEach((line, idx) => {
    const m = line.match(TASK_RE);
    if (m) {
      cards.push({
        id: crypto.randomUUID(),   // stable within session; React key
        lineIdx: idx,              // real file position; used by serialiseCards
        done: m[1].toLowerCase() === "x",
        title: m[2],
      });
    }
  });

  return { cards, rawLines };
}

function serialiseCards(lane: KanbanLane): string {
  // Build lookup by lineIdx (not id) so the mapping is independent of UUIDs.
  const cardByLineIdx = new Map<number, KanbanCard>();
  lane.cards.forEach((c) => cardByLineIdx.set(c.lineIdx, c));

  return lane.rawLines
    .map((line, idx) => {
      const card = cardByLineIdx.get(idx);
      if (card && TASK_RE.test(line)) {
        return `- [${card.done ? "x" : " "}] ${card.title}`;
      }
      return line;
    })
    .join("\n");
}

// ── Default starter content ───────────────────────────────────────────────────

const STARTER_LANES = [
  { name: "Backlog",      content: "# Backlog\n\n- [ ] First task\n" },
  { name: "In Progress",  content: "# In Progress\n\n" },
  { name: "Done",         content: "# Done\n\n" },
];

// ── Drag state (no re-render needed) ─────────────────────────────────────────

interface DragState {
  laneIdx: number;
  cardId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// KanbanView
// ─────────────────────────────────────────────────────────────────────────────

const KanbanView: React.FC<KanbanViewProps> = ({ kanbanDir }) => {
  const [lanes, setLanes]           = useState<KanbanLane[]>([]);
  const [loading, setLoading]       = useState(true);
  const [addingLane, setAddingLane] = useState(false);
  const [newLaneName, setNewLaneName] = useState("");

  const dragRef = useRef<DragState | null>(null);

  // ── loadBoard ──────────────────────────────────────────────────────────────

  const loadBoard = useCallback(async () => {
    setLoading(true);
    try {
      // Ensure the kanban directory exists
      const existsRes = await dms.pathExists(kanbanDir);
      if (!existsRes.ok || !existsRes.data?.exists) {
        await dms.createDir(kanbanDir);
      }

      // Scan for .md files
      const scanRes = await dms.scanDir(kanbanDir);
      if (!scanRes.ok || !scanRes.data) return;

      let mdFiles = scanRes.data.entries.filter(
        (e) => e.kind === "file" && e.name.endsWith(".md"),
      );

      // First open: seed with starter lanes when the directory is empty
      if (mdFiles.length === 0) {
        for (const sl of STARTER_LANES) {
          await dms.writeFile(`${kanbanDir}/${sl.name}.md`, sl.content);
        }
        const scan2 = await dms.scanDir(kanbanDir);
        if (scan2.ok && scan2.data) {
          mdFiles = scan2.data.entries.filter(
            (e) => e.kind === "file" && e.name.endsWith(".md"),
          );
        }
      }

      // Read and parse each file
      const loaded: KanbanLane[] = [];
      for (const file of mdFiles) {
        const readRes = await dms.readFile(file.path);
        const content =
          readRes.ok && readRes.data?.content != null ? readRes.data.content : "";
        const { cards, rawLines } = parseCards(content);
        loaded.push({
          name: file.name.replace(/\.md$/, ""),
          filePath: file.path,
          cards,
          rawLines,
        });
      }

      setLanes(loaded);
    } finally {
      setLoading(false);
    }
  }, [kanbanDir]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const writeLane = async (lane: KanbanLane) => {
    await dms.writeFile(lane.filePath, serialiseCards(lane));
  };

  const toggleCard = async (laneIdx: number, cardId: string) => {
    const lane = lanes[laneIdx];
    const updatedCards = lane.cards.map((c) =>
      c.id === cardId ? { ...c, done: !c.done } : c,
    );
    await writeLane({ ...lane, cards: updatedCards });
    await loadBoard();
  };

  const deleteCard = async (laneIdx: number, cardId: string) => {
    const lane = lanes[laneIdx];
    const card = lane.cards.find((c) => c.id === cardId);
    if (!card) return;
    const lineIdx = card.lineIdx;
    const updatedRawLines = lane.rawLines.filter((_, i) => i !== lineIdx);
    // Shift lineIdx down for every card that came after the deleted line.
    const updatedCards = lane.cards
      .filter((c) => c.id !== cardId)
      .map((c) => (c.lineIdx > lineIdx ? { ...c, lineIdx: c.lineIdx - 1 } : c));
    await writeLane({ ...lane, rawLines: updatedRawLines, cards: updatedCards });
    await loadBoard();
  };

  const addCard = async (laneIdx: number, title: string) => {
    if (!title.trim()) return;
    const lane = lanes[laneIdx];
    const newLine = `- [ ] ${title.trim()}`;
    const updatedRawLines = [...lane.rawLines, newLine];
    const newCard: KanbanCard = {
      id: crypto.randomUUID(),
      lineIdx: updatedRawLines.length - 1,
      title: title.trim(),
      done: false,
    };
    await writeLane({ ...lane, rawLines: updatedRawLines, cards: [...lane.cards, newCard] });
    await loadBoard();
  };

  const deleteLane = async (laneIdx: number) => {
    const lane = lanes[laneIdx];
    if (!window.confirm(`Delete lane "${lane.name}"? This cannot be undone.`)) return;
    await dms.deleteFiles([lane.filePath]);
    await loadBoard();
  };

  const renameLane = async (laneIdx: number, newName: string) => {
    if (!newName.trim()) return;
    const lane = lanes[laneIdx];
    const newPath = `${kanbanDir}/${newName.trim()}.md`;
    await dms.writeFile(newPath, serialiseCards(lane));
    await dms.deleteFiles([lane.filePath]);
    await loadBoard();
  };

  const addLane = async () => {
    if (!newLaneName.trim()) return;
    const path = `${kanbanDir}/${newLaneName.trim()}.md`;
    await dms.writeFile(path, `# ${newLaneName.trim()}\n\n`);
    setNewLaneName("");
    setAddingLane(false);
    await loadBoard();
  };

  // ── Drag & drop ────────────────────────────────────────────────────────────

  const handleDragStart = (laneIdx: number, cardId: string) => {
    dragRef.current = { laneIdx, cardId };
  };

  const handleDrop = async (targetLaneIdx: number) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.laneIdx === targetLaneIdx) return;

    const srcLane = lanes[drag.laneIdx];
    const tgtLane = lanes[targetLaneIdx];
    const card = srcLane.cards.find((c) => c.id === drag.cardId);
    if (!card) return;

    const srcLineIdx = card.lineIdx;
    const srcLine = srcLane.rawLines[srcLineIdx];

    // Remove the card line from the source lane; shift subsequent lineIdx values.
    const newSrcRawLines = srcLane.rawLines.filter((_, i) => i !== srcLineIdx);
    const newSrcCards = srcLane.cards
      .filter((c) => c.id !== drag.cardId)
      .map((c) => (c.lineIdx > srcLineIdx ? { ...c, lineIdx: c.lineIdx - 1 } : c));

    // Append the card line to the target lane; assign new lineIdx.
    const appendedLine = srcLine ?? `- [${card.done ? "x" : " "}] ${card.title}`;
    const newTgtRawLines = [...tgtLane.rawLines, appendedLine];
    const movedCard: KanbanCard = {
      ...card,
      lineIdx: newTgtRawLines.length - 1, // UUID stays the same
    };
    const newTgtCards = [...tgtLane.cards, movedCard];

    await writeLane({ ...srcLane, rawLines: newSrcRawLines, cards: newSrcCards });
    await writeLane({ ...tgtLane, rawLines: newTgtRawLines, cards: newTgtCards });
    await loadBoard();
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const totalCards = useMemo(
    () => lanes.reduce((sum, l) => sum + l.cards.length, 0),
    [lanes],
  );
  const doneCards = useMemo(
    () => lanes.reduce((sum, l) => sum + l.cards.filter((c) => c.done).length, 0),
    [lanes],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-[var(--theme-text-muted)]">
        <Icon name="refresh" size="md" className="animate-spin" />
        <span className="text-sm">Loading board…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Board header bar ─────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-[var(--theme-border)] bg-[var(--theme-surface)]">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Icon name="rows" size="xs" className="text-[var(--theme-text-muted)] shrink-0" />
          <span className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)]">
            Kanban
          </span>
          <div className="h-3 w-px bg-[var(--theme-border)] mx-0.5" />
          <span className="text-[10px] text-[var(--theme-text-muted)] tabular-nums">
            {doneCards}/{totalCards} done
          </span>
        </div>
        <button
          onClick={() => setAddingLane(true)}
          title="Add lane"
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)] hover:bg-[var(--theme-primary)]/10 transition-colors"
        >
          <Icon name="plus" size="xs" />
          Lane
        </button>
      </div>

      {/* ── Scrollable board ─────────────────────────────────────────────── */}
    <div className="flex flex-row gap-4 p-4 flex-1 overflow-x-auto overflow-y-hidden">
      {lanes.map((lane, laneIdx) => (
        <LaneColumn
          key={lane.filePath}
          lane={lane}
          laneIdx={laneIdx}
          color={LANE_COLORS[laneIdx % LANE_COLORS.length]}
          onToggleCard={toggleCard}
          onDeleteCard={deleteCard}
          onAddCard={addCard}
          onDeleteLane={deleteLane}
          onRenameLane={renameLane}
          onDragStart={handleDragStart}
          onDrop={handleDrop}
        />
      ))}

      {/* ── Add lane ── */}
      <div className="flex-shrink-0 w-[260px]">
        {addingLane ? (
          <div className="bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-xl p-3 shadow-sm">
            <input
              autoFocus
              className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg px-3 py-2 text-sm text-[var(--theme-text)] placeholder-[var(--theme-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)] mb-2"
              placeholder="Lane name…"
              value={newLaneName}
              onChange={(e) => setNewLaneName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addLane();
                if (e.key === "Escape") {
                  setAddingLane(false);
                  setNewLaneName("");
                }
              }}
            />
            <div className="flex gap-2">
              <button
                onClick={() => void addLane()}
                className="flex-1 py-1.5 bg-[var(--theme-primary)] text-white rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity"
              >
                Add
              </button>
              <button
                onClick={() => {
                  setAddingLane(false);
                  setNewLaneName("");
                }}
                className="flex-1 py-1.5 bg-[var(--theme-border)] text-[var(--theme-text)] rounded-lg text-xs hover:bg-[var(--theme-bg)] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingLane(true)}
            className="flex items-center gap-2 px-3 py-2.5 w-full rounded-xl border border-dashed border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:border-[var(--theme-primary)] hover:text-[var(--theme-primary)] transition-colors text-sm"
          >
            <Icon name="plus" size="sm" />
            Add lane
          </button>
        )}
      </div>
    </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// LaneColumn
// ─────────────────────────────────────────────────────────────────────────────

interface LaneColumnProps {
  lane: KanbanLane;
  laneIdx: number;
  color: LaneColor;
  onToggleCard: (laneIdx: number, cardId: string) => void;
  onDeleteCard: (laneIdx: number, cardId: string) => void;
  onAddCard: (laneIdx: number, title: string) => void;
  onDeleteLane: (laneIdx: number) => void;
  onRenameLane: (laneIdx: number, newName: string) => void;
  onDragStart: (laneIdx: number, cardId: string) => void;
  onDrop: (targetLaneIdx: number) => void;
}

const LaneColumn: React.FC<LaneColumnProps> = ({
  lane,
  laneIdx,
  color,
  onToggleCard,
  onDeleteCard,
  onAddCard,
  onDeleteLane,
  onRenameLane,
  onDragStart,
  onDrop,
}) => {
  const [renaming, setRenaming]         = useState(false);
  const [nameInput, setNameInput]       = useState(lane.name);
  const [addingCard, setAddingCard]     = useState(false);
  const [newCardTitle, setNewCardTitle] = useState("");
  const [isDragOver, setIsDragOver]     = useState(false);

  // Counter-based drag tracking — prevents false `onDragLeave` when the
  // pointer moves over a child element (cards, placeholder, etc.).
  const dragCounterRef = useRef(0);

  // Keep the rename input in sync if the lane is reloaded externally
  // (e.g. a sibling lane was mutated and loadBoard ran while !renaming).
  useEffect(() => {
    if (!renaming) setNameInput(lane.name);
  }, [lane.name, renaming]);

  const commitRename = () => {
    setRenaming(false);
    if (nameInput.trim() && nameInput.trim() !== lane.name) {
      onRenameLane(laneIdx, nameInput.trim());
    }
  };

  const commitCard = () => {
    if (newCardTitle.trim()) {
      onAddCard(laneIdx, newCardTitle.trim());
    }
    setNewCardTitle("");
    setAddingCard(false);
  };

  return (
    <div
      className="flex-shrink-0 w-[260px] flex flex-col rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] overflow-hidden"
      style={{ borderTopColor: color.border, borderTopWidth: 3 }}
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-1.5 px-3 pt-3 pb-2">
        {renaming ? (
          <input
            autoFocus
            className="flex-1 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-md px-2 py-1 text-sm font-semibold text-[var(--theme-text)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setRenaming(false);
                setNameInput(lane.name);
              }
            }}
          />
        ) : (
          <>
            <h3
              className="flex-1 font-bold text-sm text-[var(--theme-text)] truncate"
              title={lane.name}
            >
              {lane.name}
            </h3>
            <span className="text-[11px] text-[var(--theme-text-muted)] tabular-nums min-w-[1.25rem] text-right">
              {lane.cards.length}
            </span>
            <button
              onClick={() => {
                setRenaming(true);
                setNameInput(lane.name);
              }}
              className="p-1 rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-bg)] transition-colors"
              title="Rename lane"
            >
              <Icon name="edit" size="xs" />
            </button>
            <button
              onClick={() => onDeleteLane(laneIdx)}
              className="p-1 rounded text-[var(--theme-text-muted)] hover:text-red-500 hover:bg-[var(--theme-bg)] transition-colors"
              title="Delete lane"
            >
              <Icon name="close" size="xs" />
            </button>
          </>
        )}
      </div>

      {/* ── Card list (drop target) ── */}
      <div
        className={`flex-1 overflow-y-auto px-2 pb-1 min-h-[48px] transition-colors duration-100 ${
          isDragOver ? "bg-[var(--theme-bg)]" : ""
        }`}
        onDragEnter={(e) => {
          e.preventDefault();
          dragCounterRef.current++;
          setIsDragOver(true);
        }}
        onDragOver={(e) => {
          // Must call preventDefault to allow drop events to fire.
          e.preventDefault();
        }}
        onDragLeave={() => {
          dragCounterRef.current--;
          if (dragCounterRef.current === 0) setIsDragOver(false);
        }}
        onDrop={() => {
          dragCounterRef.current = 0;
          setIsDragOver(false);
          void onDrop(laneIdx);
        }}
      >
        {lane.cards.length === 0 && (
          <div
            className={`mx-1 my-2 rounded-lg border-2 border-dashed flex items-center justify-center min-h-[40px] transition-opacity ${
              isDragOver ? "opacity-60" : "opacity-20"
            }`}
            style={{ borderColor: color.border }}
          >
            {!isDragOver && (
              <span className="text-[var(--theme-text-muted)] text-xs">No cards</span>
            )}
          </div>
        )}

        {lane.cards.map((card) => (
          <CardItem
            key={card.id}
            card={card}
            color={color}
            onToggle={() => onToggleCard(laneIdx, card.id)}
            onDelete={() => onDeleteCard(laneIdx, card.id)}
            onDragStart={() => onDragStart(laneIdx, card.id)}
          />
        ))}

        {/* Drop indicator at bottom when dragging over a non-empty lane */}
        {isDragOver && lane.cards.length > 0 && (
          <div
            className="mx-1 mb-1.5 h-1 rounded-full opacity-60"
            style={{ backgroundColor: color.border }}
          />
        )}
      </div>

      {/* ── Add card ── */}
      <div className="px-2 pb-2 pt-1 border-t border-[var(--theme-border)]">
        {addingCard ? (
          <div className="bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-2 mt-1">
            <input
              autoFocus
              className="w-full bg-transparent text-sm text-[var(--theme-text)] placeholder-[var(--theme-text-muted)] focus:outline-none mb-2"
              placeholder="Card title…"
              value={newCardTitle}
              onChange={(e) => setNewCardTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitCard();
                if (e.key === "Escape") {
                  setAddingCard(false);
                  setNewCardTitle("");
                }
              }}
            />
            <div className="flex gap-1.5">
              <button
                onClick={commitCard}
                className="flex-1 py-1 text-xs rounded-md font-semibold text-white bg-[var(--theme-primary)] hover:opacity-90 transition-opacity"
              >
                Add
              </button>
              <button
                onClick={() => {
                  setAddingCard(false);
                  setNewCardTitle("");
                }}
                className="flex-1 py-1 text-xs rounded-md text-[var(--theme-text-muted)] bg-[var(--theme-border)] hover:bg-[var(--theme-surface)] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingCard(true)}
            className="flex w-full items-center gap-1.5 px-2 py-1.5 mt-0.5 rounded-lg text-xs text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] hover:text-[var(--theme-text)] transition-colors"
          >
            <Icon name="plus" size="xs" />
            Add card
          </button>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CardItem
// ─────────────────────────────────────────────────────────────────────────────

interface CardItemProps {
  card: KanbanCard;
  color: LaneColor;
  onToggle: () => void;
  onDelete: () => void;
  onDragStart: () => void;
}

const CardItem: React.FC<CardItemProps> = ({
  card,
  color,
  onToggle,
  onDelete,
  onDragStart,
}) => {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      draggable
      className={`group relative flex items-start gap-2 rounded-lg px-2 py-2 mb-1.5 border-l-[3px] cursor-grab active:cursor-grabbing select-none transition-colors ${
        card.done ? "opacity-60" : ""
      }`}
      style={{
        borderLeftColor: color.border,
        backgroundColor: hovered ? color.bg : "var(--theme-bg)",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
    >
      {/* Drag handle */}
      <span
        className="mt-0.5 shrink-0 text-[var(--theme-text-muted)] opacity-30 group-hover:opacity-70 transition-opacity"
        aria-hidden
      >
        <Icon name="grab" size="xs" />
      </span>

      {/* Checkbox */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={`mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-colors ${
          card.done
            ? "border-[var(--theme-primary)] bg-[var(--theme-primary)]"
            : "border-[var(--theme-border)] bg-transparent hover:border-[var(--theme-primary)]"
        }`}
        title={card.done ? "Mark as todo" : "Mark as done"}
      >
        {card.done && (
          <Icon name="check" size="xs" className="text-white dark:text-[var(--theme-bg)]" />
        )}
      </button>

      {/* Title */}
      <span
        className={`flex-1 text-sm leading-snug break-words min-w-0 ${
          card.done
            ? "line-through text-[var(--theme-text-muted)]"
            : "text-[var(--theme-text)]"
        }`}
      >
        {card.title}
      </span>

      {/* Delete button — visible on hover */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className={`shrink-0 mt-0.5 p-0.5 rounded text-[var(--theme-text-muted)] hover:text-red-500 transition-all ${
          hovered ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        title="Delete card"
      >
        <Icon name="close" size="xs" />
      </button>
    </div>
  );
};

export default KanbanView;
