/**
 * CollectionListView.tsx — Generic inline-edit CRUD table.
 *
 * Behaviour
 * ─────────
 * • Loads rows on mount via `config.fetch()`.
 * • Click an editable cell → inline text input; blur/Enter commits via `config.update()`.
 * • Actions column: delete button → ConfirmDialog → `config.remove()`.
 * • "Add row" bar at bottom (when `config.create` is provided).
 * • Per-column `actions[]` render icon buttons visible on row hover.
 *
 * No store, no context.  State is local.  The caller owns the config.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import type { CollectionConfig } from "../../services/collection-service";
import ConfirmDialog from "./ConfirmDialog";
import Icon from "../Icon";

interface EditCell {
  id:    number;
  key:   string;
  value: string;
}

interface DeletePending {
  id:    number;
  label: string;
}

interface Props<T extends { id: number }> {
  config: CollectionConfig<T>;
  /** Optional header label rendered above the table. */
  title?: string;
  className?: string;
}

function CollectionListView<T extends { id: number }>({
  config,
  title,
  className = "",
}: Props<T>) {
  const [rows,          setRows]          = useState<T[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const [editCell,      setEditCell]      = useState<EditCell | null>(null);
  const [deletePending, setDeletePending] = useState<DeletePending | null>(null);
  const [saving,        setSaving]        = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // ── Fetch ────────────────────────────────────────────────────────────────────

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await config.fetch();
      setRows(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => { void reload(); }, [reload]);

  // ── Focus input when edit cell is set ────────────────────────────────────────

  useEffect(() => {
    if (editCell) inputRef.current?.focus();
  }, [editCell]);

  // ── Commit edit ──────────────────────────────────────────────────────────────

  const commitEdit = useCallback(async () => {
    if (!editCell || saving) return;
    const original = rows.find(r => r.id === editCell.id);
    if (!original) { setEditCell(null); return; }
    const oldVal = String((original as Record<string, unknown>)[editCell.key] ?? "");
    if (editCell.value === oldVal) { setEditCell(null); return; }

    setSaving(true);
    try {
      const updated = await config.update(editCell.id, {
        [editCell.key]: editCell.value,
      } as Partial<T>);
      setRows(prev => prev.map(r => r.id === updated.id ? updated : r));
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
      setEditCell(null);
    }
  }, [editCell, saving, rows, config]);

  // ── Delete ───────────────────────────────────────────────────────────────────

  const confirmDelete = useCallback(async () => {
    if (!deletePending) return;
    try {
      await config.remove(deletePending.id);
      setRows(prev => prev.filter(r => r.id !== deletePending.id));
    } catch (e) {
      setError(String(e));
    } finally {
      setDeletePending(null);
    }
  }, [deletePending, config]);

  // ── Add row ──────────────────────────────────────────────────────────────────

  const addRow = useCallback(async () => {
    if (!config.create || !config.newRowFactory) return;
    try {
      const draft = config.newRowFactory();
      const created = await config.create(draft);
      setRows(prev => [...prev, created]);
      // Open label field of the new row for immediate edit
      const firstEditable = config.columns.find(c => c.editable !== false && c.type !== "readonly");
      if (firstEditable) {
        const val = String((created as Record<string, unknown>)[firstEditable.key] ?? "");
        setEditCell({ id: created.id, key: firstEditable.key, value: val });
      }
    } catch (e) {
      setError(String(e));
    }
  }, [config]);

  // ── Render ───────────────────────────────────────────────────────────────────

  const colTemplate = [
    ...config.columns.map(c => c.width ?? "1fr"),
    "auto",   // actions column
  ].join(" ");

  return (
    <div className={`flex flex-col h-full ${className}`}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      {(title || config.create) && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--theme-border)] bg-[var(--theme-bg)]/40 shrink-0">
          {title && (
            <span className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] flex-1">
              {title}
            </span>
          )}
          {config.create && (
            <button
              onClick={addRow}
              title="Add row"
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold
                         bg-[var(--theme-primary)]/10 text-[var(--theme-primary)]
                         border border-[var(--theme-primary)]/30
                         hover:bg-[var(--theme-primary)]/20 transition-colors"
            >
              <Icon name="plus" size="xs" />
              Add
            </button>
          )}
        </div>
      )}

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-rose-500/10 border-b border-rose-500/20 text-rose-500 text-xs shrink-0">
          <span className="flex-1 truncate">{error}</span>
          <button onClick={() => setError(null)} className="font-bold hover:underline shrink-0">✕</button>
        </div>
      )}

      {/* ── Column headers ─────────────────────────────────────────────────── */}
      <div
        className="grid px-3 py-1 border-b border-[var(--theme-border)] bg-[var(--theme-bg)]/50 shrink-0"
        style={{ gridTemplateColumns: colTemplate }}
      >
        {config.columns.map(col => (
          <span
            key={col.key}
            className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] truncate pr-2"
          >
            {col.header}
          </span>
        ))}
        <span className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] text-right">
          Actions
        </span>
      </div>

      {/* ── Rows ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading && (
          <div className="flex items-center justify-center py-12 text-[var(--theme-text-muted)] text-xs">
            <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
            Loading…
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div className="px-4 py-12 text-center text-[var(--theme-text-muted)] text-xs italic">
            {config.emptyMessage ?? "No items"}
          </div>
        )}

        {!loading && rows.map((row) => (
          <div
            key={row.id}
            className="grid px-3 border-b border-[var(--theme-border)]/50 hover:bg-[var(--theme-bg)]/60 group transition-colors"
            style={{ gridTemplateColumns: colTemplate }}
          >
            {config.columns.map((col) => {
              const rawVal = (row as Record<string, unknown>)[col.key];
              const isEditing = editCell?.id === row.id && editCell.key === col.key;
              const editable  = col.editable !== false && col.type !== "readonly";

              return (
                <div
                  key={col.key}
                  className="flex items-center gap-1 py-1.5 pr-2 min-w-0"
                >
                  {isEditing ? (
                    /* ── Inline input ─────────────────────────────────── */
                    <input
                      ref={inputRef}
                      type={col.type === "number" ? "number" : "text"}
                      value={editCell.value}
                      onChange={e => setEditCell(prev => prev ? { ...prev, value: e.target.value } : null)}
                      onBlur={commitEdit}
                      onKeyDown={e => {
                        if (e.key === "Enter")  { e.preventDefault(); void commitEdit(); }
                        if (e.key === "Escape") { e.preventDefault(); setEditCell(null); }
                      }}
                      className="flex-1 min-w-0 text-[11px] font-mono bg-[var(--theme-bg)] border border-[var(--theme-primary)]/60
                                 rounded px-1.5 py-0.5 text-[var(--theme-text)]
                                 focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]"
                    />
                  ) : (
                    /* ── Read cell ────────────────────────────────────── */
                    <div className="flex items-center gap-1 flex-1 min-w-0">
                      <span
                        onClick={() => {
                          if (!editable) return;
                          setEditCell({ id: row.id, key: col.key, value: String(rawVal ?? "") });
                        }}
                        title={editable ? "Click to edit" : undefined}
                        className={`flex-1 text-[11px] truncate text-[var(--theme-text)]
                          ${editable ? "cursor-text hover:text-[var(--theme-primary)] transition-colors" : ""}
                          ${col.type === "readonly" ? "text-[var(--theme-text-muted)]" : ""}
                        `}
                      >
                        {col.render
                          ? (col.render(rawVal as T[keyof T & string], row) ?? String(rawVal ?? ""))
                          : String(rawVal ?? "")}
                      </span>

                      {/* Per-column action buttons (visible on hover) */}
                      {col.actions?.map((act, i) => {
                        if (act.when && !act.when(row)) return null;
                        return (
                          <button
                            key={i}
                            onClick={() => act.handler(row)}
                            title={act.title}
                            className="shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded
                                       text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)]
                                       transition-all"
                          >
                            <Icon name={act.icon as IconName} size="xs" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* ── Actions column ─────────────────────────────────────────── */}
            <div className="flex items-center justify-end gap-1 py-1.5">
              <button
                onClick={() => {
                  // derive a human label from first column
                  const firstCol = config.columns[0];
                  const label = firstCol
                    ? String((row as Record<string, unknown>)[firstCol.key] ?? `#${row.id}`)
                    : `#${row.id}`;
                  setDeletePending({ id: row.id, label });
                }}
                title="Delete"
                className="opacity-0 group-hover:opacity-100 p-1 rounded
                           text-[var(--theme-text-muted)] hover:text-[var(--theme-danger)]
                           transition-all"
              >
                <Icon name="trash" size="xs" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ── Delete confirm dialog ───────────────────────────────────────────── */}
      {deletePending && (
        <ConfirmDialog
          title="Delete item"
          message={
            <>
              Delete <strong className="text-[var(--theme-text)]">"{deletePending.label}"</strong>?
              <br />This action cannot be undone.
            </>
          }
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onCancel={() => setDeletePending(null)}
        />
      )}
    </div>
  );
}

export default CollectionListView;

