/**
 * BookmarksView.tsx — Zone bookmarks · Excel-style inline-edit table
 *
 * Features
 * ────────────────────────────────────────────────────────────────────
 * • Shows every bookmark for the active zone as an editable row.
 * • An empty "new row" is always present at the bottom (Excel pattern).
 *   The row is committed to the backend only when at least `label` and
 *   `target` are both non-empty and the field loses focus / Enter is pressed.
 * • Columns: # (sort_order), Label, Target, Kind, Created, Updated, Actions
 * • Up / Down arrows to move rows — updates sort_order on the server.
 * • "Go To" arrow in the Target cell resolves the path and calls `onNavigate`.
 * • `onClose` callback so the view can be dismissed.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useDms } from "../../store/dms-store";
import { dms, type Bookmark, type BookmarkKind } from "../../services/dms-service";
import Icon from "../Icon";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtTs(ts: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function guessKind(target: string): BookmarkKind {
  return target.endsWith("/") ? "folder" : "file";
}

// ── types ─────────────────────────────────────────────────────────────────────

interface DraftRow {
  isDraft: true;
  label:   string;
  target:  string;
}

interface BookmarksViewProps {
  onNavigate: (absPath: string) => void;
  onClose?:   () => void;
}

// ── component ─────────────────────────────────────────────────────────────────

const BookmarksView: React.FC<BookmarksViewProps> = ({ onNavigate, onClose }) => {
  const { state } = useDms();
  const zoneName  = state.zone?.name ?? "";

  const [rows,    setRows]    = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [saving,  setSaving]  = useState(false);

  const [draft, setDraft] = useState<DraftRow>({ isDraft: true, label: "", target: "" });

  type EditField = "label" | "target" | "sort_order";
  type EditCell  = { id: number; field: EditField };
  const [editCell,  setEditCell]  = useState<EditCell | null>(null);
  const [editValue, setEditValue] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const reload = useCallback(async () => {
    if (!zoneName) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await dms.bookmark.list(zoneName);
      if (res.ok && res.data) setRows(res.data);
      else setError(res.error ?? "Failed to load bookmarks");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [zoneName]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (editCell) setTimeout(() => inputRef.current?.focus(), 0);
  }, [editCell]);

  // ── Commit edit ────────────────────────────────────────────────────────────

  const commitEdit = useCallback(async () => {
    if (!editCell || saving) return;

    // Draft row (id = -1)
    if (editCell.id === -1) {
      const newLabel  = editCell.field === "label"  ? editValue : draft.label;
      const newTarget = editCell.field === "target" ? editValue : draft.target;
      setDraft({ isDraft: true, label: newLabel, target: newTarget });
      setEditCell(null);

      if (newLabel.trim() && newTarget.trim()) {
        setSaving(true);
        try {
          const res = await dms.bookmark.add(zoneName, newLabel.trim(), newTarget.trim());
          if (res.ok && res.data) {
            setRows(prev => [...prev, res.data!]);
            setDraft({ isDraft: true, label: "", target: "" });
          } else {
            setError(res.error ?? "Failed to add bookmark");
          }
        } catch (e) {
          setError(String(e));
        } finally {
          setSaving(false);
        }
      }
      return;
    }

    // Existing row
    const row = rows.find(r => r.id === editCell.id);
    if (!row) { setEditCell(null); return; }

    const oldVal = String((row as unknown as Record<string, unknown>)[editCell.field] ?? "");
    if (editValue === oldVal) { setEditCell(null); return; }

    if (editCell.field === "target" && !editValue.trim()) {
      setError("Target must not be empty.");
      setEditCell(null);
      return;
    }

    setSaving(true);
    try {
      const newLabel  = editCell.field === "label"      ? editValue        : row.label;
      const newTarget = editCell.field === "target"     ? editValue.trim() : row.target;
      const newOrder  = editCell.field === "sort_order" ? Number(editValue) : row.sort_order;
      const res = await dms.bookmark.update(row.id, newLabel, newTarget, newOrder);
      if (res.ok && res.data) {
        setRows(prev => prev.map(r => r.id === res.data!.id ? res.data! : r));
      } else {
        setError(res.error ?? "Failed to update bookmark");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
      setEditCell(null);
    }
  }, [editCell, editValue, draft, rows, zoneName, saving]);

  // ── Delete ─────────────────────────────────────────────────────────────────

  const deleteRow = useCallback(async (id: number) => {
    if (!window.confirm("Delete this bookmark?")) return;
    try {
      await dms.bookmark.delete(id);
      setRows(prev => prev.filter(r => r.id !== id));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // ── Reorder ────────────────────────────────────────────────────────────────

  const moveRow = useCallback(async (id: number, direction: "up" | "down") => {
    const sorted = [...rows].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    const idx    = sorted.findIndex(r => r.id === id);
    if (idx === -1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    const a = sorted[idx]!;
    const b = sorted[swapIdx]!;
    const newA = { ...a, sort_order: b.sort_order };
    const newB = { ...b, sort_order: a.sort_order };

    setRows(prev =>
      prev.map(r => r.id === newA.id ? newA : r.id === newB.id ? newB : r)
    );

    try {
      await Promise.all([
        dms.bookmark.update(newA.id, newA.label, newA.target, newA.sort_order),
        dms.bookmark.update(newB.id, newB.label, newB.target, newB.sort_order),
      ]);
    } catch (e) {
      setError(String(e));
      void reload();
    }
  }, [rows, reload]);

  // ── Go To ──────────────────────────────────────────────────────────────────

  const goTo = useCallback(async (target: string) => {
    if (!zoneName) return;
    const res = await dms.bookmark.resolve(zoneName, target);
    if (res.ok && res.data?.abs_path) onNavigate(res.data.abs_path);
    else setError(res.error ?? "Could not resolve path");
  }, [zoneName, onNavigate]);

  const openEdit = (id: number, field: EditField, value: string) => {
    setEditCell({ id, field });
    setEditValue(value);
  };

  if (!zoneName) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--theme-text-muted)] text-xs italic">
        Open a zone to see its bookmarks.
      </div>
    );
  }

  const sortedRows = [...rows].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const COL = "grid-cols-[2.5rem_1fr_1.8fr_3.5rem_8.5rem_8.5rem_5.5rem]";

  // Inline input helper
  const CellInput = ({ id, field, type = "text" }: { id: number; field: EditField; type?: "text" | "number" }) => (
    <input
      ref={inputRef}
      type={type}
      value={editValue}
      onChange={e => setEditValue(e.target.value)}
      onBlur={() => void commitEdit()}
      onKeyDown={e => {
        if (e.key === "Enter")  { e.preventDefault(); void commitEdit(); }
        if (e.key === "Escape") { e.preventDefault(); setEditCell(null); }
      }}
      className="w-full min-w-0 text-[11px] bg-[var(--theme-bg)]
                 border border-[var(--theme-primary)]/60 rounded px-1.5 py-0.5
                 text-[var(--theme-text)] focus:outline-none focus:ring-1
                 focus:ring-[var(--theme-primary)]"
    />
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--theme-border)] bg-[var(--theme-surface)] shrink-0">
        <Icon name="bookmark" size="xs" className="text-[var(--theme-primary)]" />
        <span className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] flex-1">
          Bookmarks — {zoneName}
        </span>
        {saving && (
          <span className="w-3 h-3 border-2 border-[var(--theme-primary)] border-t-transparent rounded-full animate-spin" />
        )}
        {onClose && (
          <button
            onClick={onClose}
            title="Close bookmarks"
            className="p-1 rounded hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors"
          >
            <Icon name="close" size="xs" />
          </button>
        )}
      </div>

      {/* ── Error bar ───────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-rose-500/10 border-b border-rose-500/20 text-rose-500 text-xs shrink-0">
          <span className="flex-1 truncate">{error}</span>
          <button onClick={() => setError(null)} className="font-bold hover:underline">✕</button>
        </div>
      )}

      {/* ── Column headers ──────────────────────────────────────────────────── */}
      <div className={`grid ${COL} px-3 py-1 border-b border-[var(--theme-border)] bg-[var(--theme-bg)]/50 shrink-0 gap-x-2`}>
        {["#", "Label", "Target", "Kind", "Created", "Updated", "Actions"].map(h => (
          <span key={h} className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] truncate">
            {h}
          </span>
        ))}
      </div>

      {/* ── Rows ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">

        {loading && (
          <div className="flex items-center justify-center py-12 text-[var(--theme-text-muted)] text-xs">
            <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
            Loading…
          </div>
        )}

        {!loading && sortedRows.length === 0 && (
          <div className="px-4 py-10 text-center text-[var(--theme-text-muted)] text-xs italic">
            No bookmarks yet — fill in the row below to add one.
          </div>
        )}

        {/* Existing rows */}
        {!loading && sortedRows.map((row, idx) => (
          <div
            key={row.id}
            className={`grid ${COL} px-3 gap-x-2 border-b border-[var(--theme-border)]/50 hover:bg-[var(--theme-bg)]/60 group transition-colors`}
          >
            {/* Sort order + move buttons */}
            <div className="flex items-center gap-0.5 py-1.5">
              {editCell?.id === row.id && editCell.field === "sort_order" ? (
                <CellInput id={row.id} field="sort_order" type="number" />
              ) : (
                <span
                  onClick={() => openEdit(row.id, "sort_order", String(row.sort_order))}
                  title="Click to edit order"
                  className="text-[10px] text-[var(--theme-text-muted)] cursor-text hover:text-[var(--theme-primary)] w-5 text-center select-none"
                >
                  {row.sort_order}
                </span>
              )}
              <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => void moveRow(row.id, "up")}
                  disabled={idx === 0}
                  title="Move up"
                  className="p-0 leading-none text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)] disabled:opacity-20 disabled:cursor-not-allowed"
                >
                  <Icon name="chevron-up" size="xs" />
                </button>
                <button
                  onClick={() => void moveRow(row.id, "down")}
                  disabled={idx === sortedRows.length - 1}
                  title="Move down"
                  className="p-0 leading-none text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)] disabled:opacity-20 disabled:cursor-not-allowed"
                >
                  <Icon name="chevron-down" size="xs" />
                </button>
              </div>
            </div>

            {/* Label */}
            <div className="flex items-center py-1.5 min-w-0">
              {editCell?.id === row.id && editCell.field === "label" ? (
                <CellInput id={row.id} field="label" />
              ) : (
                <span
                  onClick={() => openEdit(row.id, "label", row.label)}
                  title="Click to edit"
                  className="text-[11px] text-[var(--theme-text)] cursor-text hover:text-[var,--theme-primary)] truncate flex-1 transition-colors"
                >
                  {row.label || <em className="text-[var(--theme-text-muted)] opacity-50">—</em>}
                </span>
              )}
            </div>

            {/* Target */}
            <div className="flex items-center gap-1 py-1.5 min-w-0">
              {editCell?.id === row.id && editCell.field === "target" ? (
                <CellInput id={row.id} field="target" />
              ) : (
                <>
                  <span
                    onClick={() => openEdit(row.id, "target", row.target)}
                    title={row.target || "Click to edit"}
                    className="text-[11px] font-mono text-[var(--theme-text-muted)] cursor-text hover:text-[var(--theme-primary)] truncate flex-1 transition-colors"
                  >
                    {row.target || <em className="opacity-40">empty</em>}
                  </span>
                  {row.target && (
                    <button
                      onClick={() => void goTo(row.target)}
                      title="Go To"
                      className="shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)] transition-all"
                    >
                      <Icon name="arrow-right" size="xs" />
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Kind */}
            <div className="flex items-center py-1.5">
              <Icon
                name={row.kind === "folder" ? "folder" : "file"}
                size="xs"
                className={row.kind === "folder" ? "text-amber-500/70" : "text-[var(--theme-text-muted)]"}
              />
            </div>

            {/* Created */}
            <div className="flex items-center py-1.5">
              <span className="text-[9px] text-[var(--theme-text-muted)] truncate" title={fmtTs(row.created_at)}>
                {fmtTs(row.created_at)}
              </span>
            </div>

            {/* Updated */}
            <div className="flex items-center py-1.5">
              <span className="text-[9px] text-[var(--theme-text-muted)] truncate" title={fmtTs(row.updated_at)}>
                {fmtTs(row.updated_at)}
              </span>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-1 py-1.5">
              <button
                onClick={() => void deleteRow(row.id)}
                title="Delete bookmark"
                className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--theme-text-muted)] hover:text-rose-500 transition-all"
              >
                <Icon name="trash" size="xs" />
              </button>
            </div>
          </div>
        ))}

        {/* ── Draft / new row (always shown at bottom) ─────────────────────── */}
        {!loading && (
          <div
            className={`grid ${COL} px-3 gap-x-2 border-b border-dashed border-[var(--theme-border)]/50 hover:bg-[var(--theme-primary)]/5 group transition-colors`}
            title="New bookmark — fill Label and Target to save"
          >
            {/* # placeholder */}
            <div className="flex items-center py-1.5 justify-center">
              <span className="text-[10px] text-[var(--theme-primary)] opacity-40 font-bold">+</span>
            </div>

            {/* Draft label */}
            <div className="flex items-center py-1.5 min-w-0">
              {editCell?.id === -1 && editCell.field === "label" ? (
                <CellInput id={-1} field="label" />
              ) : (
                <span
                  onClick={() => openEdit(-1, "label", draft.label)}
                  className={`text-[11px] cursor-text truncate flex-1 transition-colors hover:text-[var(--theme-primary)] ${
                    draft.label ? "text-[var(--theme-text)]" : "text-[var(--theme-text-muted)] italic"
                  }`}
                >
                  {draft.label || "New bookmark label…"}
                </span>
              )}
            </div>

            {/* Draft target */}
            <div className="flex items-center gap-1 py-1.5 min-w-0">
              {editCell?.id === -1 && editCell.field === "target" ? (
                <CellInput id={-1} field="target" />
              ) : (
                <span
                  onClick={() => openEdit(-1, "target", draft.target)}
                  className={`text-[11px] font-mono cursor-text truncate flex-1 transition-colors hover:text-[var(--theme-primary)] ${
                    draft.target ? "text-[var(--theme-text-muted)]" : "text-[var(--theme-text-muted)] italic opacity-60"
                  }`}
                >
                  {draft.target || "zone-relative/path/to/file…"}
                </span>
              )}
            </div>

            {/* Kind guess */}
            <div className="flex items-center py-1.5">
              {draft.target && (
                <Icon
                  name={guessKind(draft.target) === "folder" ? "folder" : "file"}
                  size="xs"
                  className="text-[var(--theme-text-muted)] opacity-40"
                />
              )}
            </div>

            {/* Created / Updated placeholders */}
            <div className="flex items-center py-1.5">
              <span className="text-[9px] text-[var(--theme-text-muted)] opacity-25 italic">—</span>
            </div>
            <div className="flex items-center py-1.5">
              <span className="text-[9px] text-[var(--theme-text-muted)] opacity-25 italic">—</span>
            </div>

            {/* Discard draft */}
            <div className="flex items-center justify-end gap-1 py-1.5">
              {(draft.label || draft.target) && (
                <button
                  onClick={() => { setDraft({ isDraft: true, label: "", target: "" }); setEditCell(null); }}
                  title="Clear draft"
                  className="p-1 rounded text-[var(--theme-text-muted)] hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Icon name="close" size="xs" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Usage hint */}
        {!loading && (
          <div className="px-3 py-2 text-[9px] text-[var(--theme-text-muted)] opacity-40 italic select-none">
            Click any cell to edit · Enter or Tab to confirm · Esc to cancel ·
            Fill Label + Target in the bottom row to create a new bookmark
          </div>
        )}
      </div>
    </div>
  );
};

export default BookmarksView;

