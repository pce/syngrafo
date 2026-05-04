import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { dms } from "../../services/dms-service";
import Icon from "../Icon";

// ── Data model ────────────────────────────────────────────────────────────────

interface KanbanComment {
  id: string;
  text: string;
  date: string;
}

interface KanbanCard {
  id: string;    // session UUID (React key; regenerated each load)
  key: string;   // stable ID embedded in the markdown as <!-- id:... -->
  lineIdx: number;
  title: string;
  done: boolean;
  description: string;
  comments: KanbanComment[];
}

interface KanbanLane {
  name: string;
  filePath: string;
  cards: KanbanCard[];
  rawLines: string[];
}

type LaneSidecar = Record<string, { description: string; comments: KanbanComment[] }>;

export interface KanbanViewProps {
  kanbanDir: string;
}

// ── Lane accent palette ───────────────────────────────────────────────────────

const LANE_COLORS = [
  { border: "#10b981", bg: "rgba(16,185,129,0.07)" },
  { border: "#3b82f6", bg: "rgba(59,130,246,0.07)" },
  { border: "#f59e0b", bg: "rgba(245,158,11,0.07)" },
  { border: "#8b5cf6", bg: "rgba(139,92,246,0.07)" },
  { border: "#f43f5e", bg: "rgba(244,63,94,0.07)" },
] as const;

type LaneColor = (typeof LANE_COLORS)[number];

// ── Parse helpers ─────────────────────────────────────────────────────────────
// Cards now embed a stable id comment:  - [ ] Card title <!-- id:uuid -->
// On first parse of old-style lines (no id), a fresh UUID is generated
// and will be written back on the next save.

const TASK_RE = /^- \[([ x])\] (.+?)(?:\s+<!--\s*id:([a-f0-9-]+)\s*-->)?\s*$/i;

function parseCards(content: string): { cards: KanbanCard[]; rawLines: string[] } {
  const rawLines = content.split("\n");
  const cards: KanbanCard[] = [];
  rawLines.forEach((line, idx) => {
    const m = line.match(TASK_RE);
    if (m) {
      const key = m[3] ?? crypto.randomUUID();
      cards.push({ id: crypto.randomUUID(), key, lineIdx: idx, done: (m[1] ?? "").toLowerCase() === "x", title: (m[2] ?? "").trim(), description: "", comments: [] });
    }
  });
  return { cards, rawLines };
}

function serialiseCards(lane: KanbanLane): string {
  const byLine = new Map<number, KanbanCard>();
  lane.cards.forEach((c) => byLine.set(c.lineIdx, c));
  return lane.rawLines.map((line, idx) => {
    const card = byLine.get(idx);
    if (card && TASK_RE.test(line)) return `- [${card.done ? "x" : " "}] ${card.title} <!-- id:${card.key} -->`;
    return line;
  }).join("\n");
}

// ── Sidecar helpers ───────────────────────────────────────────────────────────
// Extended card metadata (description + comments) lives in a JSON sidecar
// alongside the lane markdown file: "LaneName.json".

function sidecarPath(p: string): string { return p.replace(/\.md$/, ".json"); }

async function loadSidecar(filePath: string): Promise<LaneSidecar> {
  const res = await dms.readFile(sidecarPath(filePath));
  if (!res.ok || !res.data?.content) return {};
  try { return JSON.parse(res.data.content) as LaneSidecar; } catch { return {}; }
}

async function saveSidecar(filePath: string, sc: LaneSidecar) {
  await dms.writeFile(sidecarPath(filePath), JSON.stringify(sc, null, 2));
}

function buildSidecar(cards: KanbanCard[]): LaneSidecar {
  const sc: LaneSidecar = {};
  for (const c of cards) {
    if (c.description || c.comments.length > 0) sc[c.key] = { description: c.description, comments: c.comments };
  }
  return sc;
}

// ── Default starter lanes ─────────────────────────────────────────────────────

const STARTER_LANES = [
  { name: "Backlog",     content: "# Backlog\n\n" },
  { name: "In Progress", content: "# In Progress\n\n" },
  { name: "Done",        content: "# Done\n\n" },
];

interface DragState { laneIdx: number; cardId: string; }

// =============================================================================
// KanbanView
// =============================================================================

const KanbanView: React.FC<KanbanViewProps> = ({ kanbanDir }) => {
  const [lanes,       setLanes]       = useState<KanbanLane[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [addingLane,  setAddingLane]  = useState(false);
  const [newLaneName, setNewLaneName] = useState("");
  const [detailCard,  setDetailCard]  = useState<{ card: KanbanCard; laneIdx: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);

  // ── loadBoard ────────────────────────────────────────────────────────────────

  const loadBoard = useCallback(async () => {
    setLoading(true);
    try {
      const existsRes = await dms.pathExists(kanbanDir);
      if (!existsRes.ok || !existsRes.data?.exists) await dms.createDir(kanbanDir);
      const scanRes = await dms.scanDir(kanbanDir);
      if (!scanRes.ok || !scanRes.data) return;
      let mdFiles = scanRes.data.entries.filter((e) => e.kind === "file" && e.name.endsWith(".md"));
      if (mdFiles.length === 0) {
        for (const sl of STARTER_LANES) await dms.writeFile(`${kanbanDir}/${sl.name}.md`, sl.content);
        const s2 = await dms.scanDir(kanbanDir);
        if (s2.ok && s2.data) mdFiles = s2.data.entries.filter((e) => e.kind === "file" && e.name.endsWith(".md"));
      }
      const loaded: KanbanLane[] = [];
      for (const file of mdFiles) {
        const readRes = await dms.readFile(file.path);
        const content = readRes.ok && readRes.data?.content != null ? readRes.data.content : "";
        const { cards, rawLines } = parseCards(content);
        const sidecar = await loadSidecar(file.path);
        const cardsWithMeta = cards.map((c) => ({
          ...c,
          description: sidecar[c.key]?.description ?? "",
          comments:    sidecar[c.key]?.comments    ?? [],
        }));
        loaded.push({ name: file.name.replace(/\.md$/, ""), filePath: file.path, cards: cardsWithMeta, rawLines });
      }
      setLanes(loaded);
    } finally { setLoading(false); }
  }, [kanbanDir]);

  useEffect(() => { loadBoard(); }, [loadBoard]);

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const writeLane = async (lane: KanbanLane) => { await dms.writeFile(lane.filePath, serialiseCards(lane)); };

  const toggleCard = async (laneIdx: number, cardId: string) => {
    const lane = lanes[laneIdx];
    if (!lane) return;
    const updatedCards = lane.cards.map((c) => c.id === cardId ? { ...c, done: !c.done } : c);
    await writeLane({ ...lane, cards: updatedCards });
    await loadBoard();
  };

  const deleteCard = async (laneIdx: number, cardId: string) => {
    const lane = lanes[laneIdx];
    if (!lane) return;
    const card = lane.cards.find((c) => c.id === cardId);
    if (!card) return;
    const { lineIdx } = card;
    const updatedRawLines = lane.rawLines.filter((_, i) => i !== lineIdx);
    const updatedCards = lane.cards.filter((c) => c.id !== cardId).map((c) => c.lineIdx > lineIdx ? { ...c, lineIdx: c.lineIdx - 1 } : c);
    await writeLane({ ...lane, rawLines: updatedRawLines, cards: updatedCards });
    await saveSidecar(lane.filePath, buildSidecar(updatedCards));
    await loadBoard();
  };

  const addCard = async (laneIdx: number, title: string) => {
    if (!title.trim()) return;
    const lane = lanes[laneIdx];
    if (!lane) return;
    const key = crypto.randomUUID();
    const newLine = `- [ ] ${title.trim()} <!-- id:${key} -->`;
    const updatedRawLines = [...lane.rawLines, newLine];
    const newCard: KanbanCard = { id: crypto.randomUUID(), key, lineIdx: updatedRawLines.length - 1, title: title.trim(), done: false, description: "", comments: [] };
    await writeLane({ ...lane, rawLines: updatedRawLines, cards: [...lane.cards, newCard] });
    await loadBoard();
  };

  const deleteLane = async (laneIdx: number) => {
    const lane = lanes[laneIdx];
    if (!lane) return;
    await dms.deleteFiles([lane.filePath]);
    await dms.deleteFiles([sidecarPath(lane.filePath)]).catch(() => {});
    if (detailCard?.laneIdx === laneIdx) setDetailCard(null);
    await loadBoard();
  };

  const renameLane = async (laneIdx: number, newName: string) => {
    if (!newName.trim()) return;
    const lane = lanes[laneIdx];
    if (!lane) return;
    const newPath = `${kanbanDir}/${newName.trim()}.md`;
    await dms.writeFile(newPath, serialiseCards(lane));
    const sc = await loadSidecar(lane.filePath);
    if (Object.keys(sc).length > 0) await saveSidecar(newPath, sc);
    await dms.deleteFiles([lane.filePath]);
    await dms.deleteFiles([sidecarPath(lane.filePath)]).catch(() => {});
    await loadBoard();
  };

  const addLane = async () => {
    if (!newLaneName.trim()) return;
    await dms.writeFile(`${kanbanDir}/${newLaneName.trim()}.md`, `# ${newLaneName.trim()}\n\n`);
    setNewLaneName(""); setAddingLane(false);
    await loadBoard();
  };

  // ── Card meta: description + comments (optimistic + sidecar) ─────────────────

  const updateCardDescription = useCallback(async (laneIdx: number, cardId: string, description: string) => {
    setLanes((prev) => {
      const next = [...prev];
      const cur = next[laneIdx];
      if (!cur) return next;
      next[laneIdx] = { ...cur, cards: cur.cards.map((c) => c.id === cardId ? { ...c, description } : c) };
      return next;
    });
    const lane = lanes[laneIdx];
    if (!lane) return;
    const updatedCards = lane.cards.map((c) => c.id === cardId ? { ...c, description } : c);
    await saveSidecar(lane.filePath, buildSidecar(updatedCards));
  }, [lanes]);

  const addComment = useCallback(async (laneIdx: number, cardId: string, text: string) => {
    if (!text.trim()) return;
    const newComment: KanbanComment = { id: crypto.randomUUID(), text: text.trim(), date: new Date().toISOString() };
    setLanes((prev) => {
      const next = [...prev];
      const cur = next[laneIdx];
      if (!cur) return next;
      next[laneIdx] = { ...cur, cards: cur.cards.map((c) => c.id === cardId ? { ...c, comments: [...c.comments, newComment] } : c) };
      return next;
    });
    const lane = lanes[laneIdx];
    if (!lane) return;
    const updatedCards = lane.cards.map((c) => c.id === cardId ? { ...c, comments: [...c.comments, newComment] } : c);
    await saveSidecar(lane.filePath, buildSidecar(updatedCards));
  }, [lanes]);

  // ── Drag & drop ───────────────────────────────────────────────────────────────

  const handleDragStart = (laneIdx: number, cardId: string) => { dragRef.current = { laneIdx, cardId }; };

  const handleDrop = async (targetLaneIdx: number) => {
    const drag = dragRef.current; dragRef.current = null;
    if (!drag || drag.laneIdx === targetLaneIdx) return;
    const srcLane = lanes[drag.laneIdx]; const tgtLane = lanes[targetLaneIdx];
    if (!srcLane || !tgtLane) return;
    const card = srcLane.cards.find((c) => c.id === drag.cardId); if (!card) return;
    const { lineIdx } = card;
    const newSrcRaw = srcLane.rawLines.filter((_, i) => i !== lineIdx);
    const newSrcCards = srcLane.cards.filter((c) => c.id !== drag.cardId).map((c) => c.lineIdx > lineIdx ? { ...c, lineIdx: c.lineIdx - 1 } : c);
    const appendedLine = srcLane.rawLines[lineIdx] ?? `- [${card.done ? "x" : " "}] ${card.title} <!-- id:${card.key} -->`;
    const newTgtRaw = [...tgtLane.rawLines, appendedLine];
    const movedCard: KanbanCard = { ...card, lineIdx: newTgtRaw.length - 1 };
    const newTgtCards = [...tgtLane.cards, movedCard];
    await writeLane({ ...srcLane, rawLines: newSrcRaw, cards: newSrcCards });
    await writeLane({ ...tgtLane, rawLines: newTgtRaw, cards: newTgtCards });
    await saveSidecar(srcLane.filePath, buildSidecar(newSrcCards));
    await saveSidecar(tgtLane.filePath, buildSidecar(newTgtCards));
    await loadBoard();
  };

  // ── Derived ───────────────────────────────────────────────────────────────────

  const totalCards = useMemo(() => lanes.reduce((s, l) => s + l.cards.length, 0), [lanes]);
  const doneCards  = useMemo(() => lanes.reduce((s, l) => s + l.cards.filter((c) => c.done).length, 0), [lanes]);

  // Keep detailCard in sync after loadBoard replaces card objects
  useEffect(() => {
    if (!detailCard) return;
    const lane = lanes[detailCard.laneIdx];
    if (!lane) { setDetailCard(null); return; }
    const card = lane.cards.find((c) => c.id === detailCard.card.id);
    if (!card) { setDetailCard(null); return; }
    setDetailCard({ card, laneIdx: detailCard.laneIdx });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lanes]);

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center h-full gap-2 text-[var(--theme-text-muted)]">
      <Icon name="refresh" size="md" className="animate-spin" />
      <span className="text-sm">Loading board...</span>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Board header */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-[var(--theme-border)] bg-[var(--theme-surface)]">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Icon name="rows" size="xs" className="text-[var(--theme-text-muted)] shrink-0" />
          <span className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)]">Kanban</span>
          <div className="h-3 w-px bg-[var(--theme-border)] mx-0.5" />
          <span className="text-[10px] text-[var(--theme-text-muted)] tabular-nums">{doneCards}/{totalCards} done</span>
        </div>
        <button onClick={() => setAddingLane(true)} title="Add lane"
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)] hover:bg-[var(--theme-primary)]/10 transition-colors">
          <Icon name="plus" size="xs" />Lane
        </button>
      </div>

      {/* Scrollable board */}
      <div className="flex flex-row gap-4 p-4 flex-1 overflow-x-auto overflow-y-hidden">
        {lanes.map((lane, laneIdx) => (
          <LaneColumn key={lane.filePath} lane={lane} laneIdx={laneIdx}
            color={LANE_COLORS[laneIdx % LANE_COLORS.length]!}
            onToggleCard={toggleCard} onDeleteCard={deleteCard} onAddCard={addCard}
            onDeleteLane={deleteLane} onRenameLane={renameLane}
            onDragStart={handleDragStart} onDrop={handleDrop}
            onOpenCard={(card) => setDetailCard({ card, laneIdx })} />
        ))}

        {/* Add lane column */}
        <div className="flex-shrink-0 w-[260px]">
          {addingLane ? (
            <div className="bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-xl p-3 shadow-sm">
              <input autoFocus
                className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg px-3 py-2 text-sm text-[var(--theme-text)] placeholder-[var(--theme-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)] mb-2"
                placeholder="Lane name..." value={newLaneName} onChange={(e) => setNewLaneName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void addLane(); if (e.key === "Escape") { setAddingLane(false); setNewLaneName(""); } }} />
              <div className="flex gap-2">
                <button onClick={() => void addLane()} className="flex-1 py-1.5 bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity">Add</button>
                <button onClick={() => { setAddingLane(false); setNewLaneName(""); }} className="flex-1 py-1.5 bg-[var(--theme-border)] text-[var(--theme-text)] rounded-lg text-xs hover:bg-[var(--theme-bg)] transition-colors">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddingLane(true)}
              className="flex items-center gap-2 px-3 py-2.5 w-full rounded-xl border border-dashed border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:border-[var(--theme-primary)] hover:text-[var(--theme-primary)] transition-colors text-sm">
              <Icon name="plus" size="sm" />Add lane
            </button>
          )}
        </div>
      </div>

      {/* Card detail modal */}
      {detailCard && (
        <CardDetailModal card={detailCard.card} laneIdx={detailCard.laneIdx}
          laneName={lanes[detailCard.laneIdx]?.name ?? ""}
          laneColor={LANE_COLORS[detailCard.laneIdx % LANE_COLORS.length]!}
          onClose={() => setDetailCard(null)} onToggle={toggleCard}
          onUpdateDescription={updateCardDescription} onAddComment={addComment} />
      )}
    </div>
  );
};

// =============================================================================
// LaneColumn
// =============================================================================

interface LaneColumnProps {
  lane: KanbanLane; laneIdx: number; color: LaneColor;
  onToggleCard: (laneIdx: number, cardId: string) => void;
  onDeleteCard: (laneIdx: number, cardId: string) => void;
  onAddCard: (laneIdx: number, title: string) => void;
  onDeleteLane: (laneIdx: number) => void;
  onRenameLane: (laneIdx: number, newName: string) => void;
  onDragStart: (laneIdx: number, cardId: string) => void;
  onDrop: (targetLaneIdx: number) => void;
  onOpenCard: (card: KanbanCard) => void;
}

const LaneColumn: React.FC<LaneColumnProps> = ({
  lane, laneIdx, color,
  onToggleCard, onDeleteCard, onAddCard, onDeleteLane, onRenameLane,
  onDragStart, onDrop, onOpenCard,
}) => {
  const [renaming,      setRenaming]      = useState(false);
  const [nameInput,     setNameInput]     = useState(lane.name);
  const [addingCard,    setAddingCard]    = useState(false);
  const [newCardTitle,  setNewCardTitle]  = useState("");
  const [isDragOver,    setIsDragOver]    = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dragCounterRef = useRef(0);

  useEffect(() => { if (!renaming) setNameInput(lane.name); }, [lane.name, renaming]);

  const commitRename = () => {
    setRenaming(false);
    if (nameInput.trim() && nameInput.trim() !== lane.name) onRenameLane(laneIdx, nameInput.trim());
  };

  const commitCard = () => {
    if (newCardTitle.trim()) onAddCard(laneIdx, newCardTitle.trim());
    setNewCardTitle(""); setAddingCard(false);
  };

  return (
    <div className="flex-shrink-0 w-[260px] flex flex-col rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] overflow-hidden"
      style={{ borderTopColor: color.border, borderTopWidth: 3 }}>

      {/* Lane header */}
      <div className="flex items-center gap-1.5 px-3 pt-3 pb-2">
        {renaming ? (
          <input autoFocus value={nameInput} onChange={(e) => setNameInput(e.target.value)} onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") { setRenaming(false); setNameInput(lane.name); } }}
            className="flex-1 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-md px-2 py-1 text-sm font-semibold text-[var(--theme-text)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]" />
        ) : confirmDelete ? (
          <>
            <span className="flex-1 text-[10px] text-red-500 truncate">Delete "{lane.name}"?</span>
            <button onClick={() => { void onDeleteLane(laneIdx); setConfirmDelete(false); }} className="px-2 py-0.5 text-[10px] font-bold rounded bg-red-500 text-white hover:bg-red-600 transition-colors shrink-0">Yes</button>
            <button onClick={() => setConfirmDelete(false)} className="px-2 py-0.5 text-[10px] rounded border border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] transition-colors shrink-0">No</button>
          </>
        ) : (
          <>
            <h3 className="flex-1 font-bold text-sm text-[var(--theme-text)] truncate" title={lane.name}>{lane.name}</h3>
            <span className="text-[11px] text-[var(--theme-text-muted)] tabular-nums min-w-[1.25rem] text-right">{lane.cards.length}</span>
            <button onClick={() => { setRenaming(true); setNameInput(lane.name); }} title="Rename lane"
              className="p-1 rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-bg)] transition-colors">
              <Icon name="edit" size="xs" />
            </button>
            <button onClick={() => setConfirmDelete(true)} title="Delete lane"
              className="p-1 rounded text-[var(--theme-text-muted)] hover:text-red-500 hover:bg-[var(--theme-bg)] transition-colors">
              <Icon name="close" size="xs" />
            </button>
          </>
        )}
      </div>

      {/* Card list (drop target) */}
      <div className={`flex-1 overflow-y-auto px-2 pb-1 min-h-[48px] transition-colors duration-100 ${isDragOver ? "bg-[var(--theme-bg)]" : ""}`}
        onDragEnter={(e) => { e.preventDefault(); dragCounterRef.current++; setIsDragOver(true); }}
        onDragOver={(e) => { e.preventDefault(); }}
        onDragLeave={() => { dragCounterRef.current--; if (dragCounterRef.current === 0) setIsDragOver(false); }}
        onDrop={() => { dragCounterRef.current = 0; setIsDragOver(false); void onDrop(laneIdx); }}>
        {lane.cards.length === 0 && (
          <div className={`mx-1 my-2 rounded-lg border-2 border-dashed flex items-center justify-center min-h-[40px] transition-opacity ${isDragOver ? "opacity-60" : "opacity-20"}`}
            style={{ borderColor: color.border }}>
            {!isDragOver && <span className="text-[var(--theme-text-muted)] text-xs">No cards</span>}
          </div>
        )}
        {lane.cards.map((card) => (
          <CardItem key={card.id} card={card} color={color}
            onToggle={() => onToggleCard(laneIdx, card.id)}
            onDelete={() => onDeleteCard(laneIdx, card.id)}
            onDragStart={() => onDragStart(laneIdx, card.id)}
            onOpen={() => onOpenCard(card)} />
        ))}
        {isDragOver && lane.cards.length > 0 && (
          <div className="mx-1 mb-1.5 h-1 rounded-full opacity-60" style={{ backgroundColor: color.border }} />
        )}
      </div>

      {/* Add card */}
      <div className="px-2 pb-2 pt-1 border-t border-[var(--theme-border)]">
        {addingCard ? (
          <div className="bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-2 mt-1">
            <input autoFocus value={newCardTitle} onChange={(e) => setNewCardTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitCard(); if (e.key === "Escape") { setAddingCard(false); setNewCardTitle(""); } }}
              placeholder="Card title..." className="w-full bg-transparent text-sm text-[var(--theme-text)] placeholder-[var(--theme-text-muted)] focus:outline-none mb-2" />
            <div className="flex gap-1.5">
              <button onClick={commitCard} className="flex-1 py-1 text-xs rounded-md font-semibold text-[var(--theme-primary-fg)] bg-[var(--theme-primary)] hover:opacity-90 transition-opacity">Add</button>
              <button onClick={() => { setAddingCard(false); setNewCardTitle(""); }} className="flex-1 py-1 text-xs rounded-md text-[var(--theme-text-muted)] bg-[var(--theme-border)] hover:bg-[var(--theme-surface)] transition-colors">Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAddingCard(true)}
            className="flex w-full items-center gap-1.5 px-2 py-1.5 mt-0.5 rounded-lg text-xs text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] hover:text-[var(--theme-text)] transition-colors">
            <Icon name="plus" size="xs" />Add card
          </button>
        )}
      </div>
    </div>
  );
};

// =============================================================================
// CardItem
// =============================================================================

interface CardItemProps {
  card: KanbanCard; color: LaneColor;
  onToggle: () => void; onDelete: () => void; onDragStart: () => void; onOpen: () => void;
}

const CardItem: React.FC<CardItemProps> = ({ card, color, onToggle, onDelete, onDragStart, onOpen }) => {
  const [hovered, setHovered] = useState(false);
  const hasDesc = Boolean(card.description.trim());
  const commentCount = card.comments.length;

  return (
    <div draggable
      className={`group relative rounded-lg mb-1.5 border-l-[3px] select-none transition-colors ${card.done ? "opacity-60" : ""}`}
      style={{ borderLeftColor: color.border, backgroundColor: hovered ? color.bg : "var(--theme-bg)" }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(); }}>

      {/* Title row */}
      <div className="flex items-start gap-2 px-2 pt-2 pb-1.5">
        {/* Drag handle */}
        <span className="mt-0.5 shrink-0 text-[var(--theme-text-muted)] opacity-30 group-hover:opacity-70 transition-opacity cursor-grab active:cursor-grabbing" aria-hidden>
          <Icon name="grab" size="xs" />
        </span>

        {/* Checkbox */}
        <button onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className={`mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-colors ${card.done ? "border-[var(--theme-primary)] bg-[var(--theme-primary)]" : "border-[var(--theme-border)] bg-transparent hover:border-[var(--theme-primary)]"}`}
          title={card.done ? "Mark as todo" : "Mark as done"}>
          {card.done && <Icon name="check" size="xs" className="text-[var(--theme-primary-fg)]" />}
        </button>

        {/* Title (click = open detail) */}
        <button onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className={`flex-1 text-left text-sm leading-snug break-words min-w-0 hover:underline transition-all ${card.done ? "line-through text-[var(--theme-text-muted)]" : "text-[var(--theme-text)]"}`}>
          {card.title}
        </button>

        {/* Delete */}
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className={`shrink-0 mt-0.5 p-0.5 rounded text-[var(--theme-text-muted)] hover:text-red-500 transition-all ${hovered ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          title="Delete card">
          <Icon name="close" size="xs" />
        </button>
      </div>

      {/* Meta badges: description indicator + comment count — right-aligned */}
      {(hasDesc || commentCount > 0) && (
        <div className="flex items-center justify-end gap-1.5 px-2 pb-1.5">
          {hasDesc && (
            <span
              className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-semibold
                         text-[var(--theme-text-muted)] bg-[var(--theme-surface)] border border-[var(--theme-border)]"
              title="Has description"
            >
              <Icon name="edit" size="xs" />
            </span>
          )}
          {commentCount > 0 && (
            <span
              className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-semibold
                         text-[var(--theme-text-muted)] bg-[var(--theme-surface)] border border-[var(--theme-border)]"
              title={`${commentCount} comment${commentCount !== 1 ? "s" : ""}`}
            >
              <Icon name="paragraph" size="xs" />{commentCount}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

// =============================================================================
// CardDetailModal — Trello-like card detail with description + dated comments
// =============================================================================

interface CardDetailModalProps {
  card: KanbanCard; laneIdx: number; laneName: string; laneColor: LaneColor;
  onClose: () => void;
  onToggle: (laneIdx: number, cardId: string) => void;
  onUpdateDescription: (laneIdx: number, cardId: string, text: string) => Promise<void>;
  onAddComment: (laneIdx: number, cardId: string, text: string) => Promise<void>;
}

const CardDetailModal: React.FC<CardDetailModalProps> = ({
  card, laneIdx, laneName, laneColor, onClose, onToggle, onUpdateDescription, onAddComment,
}) => {
  const [descDraft,    setDescDraft]    = useState(card.description);
  const [commentDraft, setCommentDraft] = useState("");
  const [saving,       setSaving]       = useState(false);
  const descTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync description draft if the card was updated externally
  useEffect(() => { setDescDraft(card.description); }, [card.description]);

  // Auto-save description with 800 ms debounce
  const handleDescChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value; setDescDraft(val);
    if (descTimerRef.current) clearTimeout(descTimerRef.current);
    descTimerRef.current = setTimeout(() => { void onUpdateDescription(laneIdx, card.id, val); }, 800);
  };

  const handlePostComment = async () => {
    if (!commentDraft.trim()) return;
    setSaving(true);
    await onAddComment(laneIdx, card.id, commentDraft);
    setCommentDraft(""); setSaving(false);
  };

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    /* Backdrop */
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.45)" }} onClick={onClose}>
      {/* Panel */}
      <div className="bg-[var(--theme-bg)] rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden"
        style={{ maxHeight: "85vh" }} onClick={(e) => e.stopPropagation()}>

        {/* Header: lane badge + done checkbox + title + close */}
        <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-[var(--theme-border)] shrink-0">
          <span className="shrink-0 mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold text-white select-none"
            style={{ backgroundColor: laneColor.border }}>{laneName}</span>
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <button onClick={() => onToggle(laneIdx, card.id)}
              className={`mt-1 shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${card.done ? "border-[var(--theme-primary)] bg-[var(--theme-primary)]" : "border-[var(--theme-border)] bg-transparent hover:border-[var(--theme-primary)]"}`}
              title={card.done ? "Mark as todo" : "Mark as done"}>
              {card.done && <Icon name="check" size="xs" className="text-[var(--theme-primary-fg)]" />}
            </button>
            <h2 className={`flex-1 text-base font-semibold leading-snug ${card.done ? "line-through opacity-60" : "text-[var(--theme-text)]"}`}>{card.title}</h2>
          </div>
          <button onClick={onClose}
            className="shrink-0 mt-0.5 p-1 rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-surface)] transition-colors">
            <Icon name="close" size="sm" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Description */}
          <div className="px-5 py-4">
            <label className="text-[10px] font-black uppercase tracking-wider text-[var(--theme-text-muted)] block mb-2">Description</label>
            <textarea value={descDraft} onChange={handleDescChange}
              placeholder="Add a more detailed description..." rows={4}
              className="w-full bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-xl px-3 py-2 text-sm text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)] transition-shadow" />
          </div>

          <div className="mx-5 border-t border-[var(--theme-border)]" />

          {/* Comments list */}
          <div className="px-5 py-4">
            <label className="text-[10px] font-black uppercase tracking-wider text-[var(--theme-text-muted)] block mb-3">
              Comments
              {card.comments.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-[var(--theme-surface)] text-[var(--theme-text-muted)] text-[9px] font-bold">{card.comments.length}</span>
              )}
            </label>
            {card.comments.length === 0
              ? <p className="text-[11px] text-[var(--theme-text-muted)] italic">No comments yet.</p>
              : (
                <div className="flex flex-col gap-2">
                  {[...card.comments].reverse().map((c) => (
                    <div key={c.id} className="rounded-xl bg-[var(--theme-surface)] border border-[var(--theme-border)] px-3 py-2.5">
                      <div className="text-[10px] text-[var(--theme-text-muted)] mb-1 tabular-nums">{fmtDate(c.date)}</div>
                      <p className="text-sm text-[var(--theme-text)] whitespace-pre-wrap leading-relaxed">{c.text}</p>
                    </div>
                  ))}
                </div>
              )
            }
          </div>
        </div>

        {/* Add comment footer */}
        <div className="shrink-0 px-5 pb-4 pt-3 border-t border-[var(--theme-border)] bg-[var(--theme-surface)]">
          <textarea value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handlePostComment(); }}
            placeholder="Write a comment... (Cmd+Enter to post)" rows={2}
            className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-xl px-3 py-2 text-sm text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)] transition-shadow mb-2" />
          <button onClick={() => void handlePostComment()} disabled={!commentDraft.trim() || saving}
            className="px-4 py-1.5 text-xs font-bold text-[var(--theme-primary-fg)] bg-[var(--theme-primary)] rounded-lg hover:opacity-90 disabled:opacity-40 transition-opacity select-none">
            {saving ? "Posting..." : "Post comment"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default KanbanView;
