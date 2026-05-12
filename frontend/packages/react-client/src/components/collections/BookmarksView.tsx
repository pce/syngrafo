import React, { useState, useEffect, useCallback, useRef } from "react";
import { useLingui } from "@lingui/react";
import { useDms } from "../../store/dms-store";
import { dms, type Bookmark } from "../../services/dms-service";
import { Icon } from "../Icon";

interface BookmarksViewProps {
  onNavigate: (absPath: string, isDir: boolean) => void;
  onClose?:   () => void;
}

function resolveAbs(target: string, zoneOutPath: string): string {
  const path = target.replace(/\?.*$/, "").replace(/\/$/, "");
  return path.startsWith("/") ? path : `${zoneOutPath}/${path}`;
}

function fmtDate(ts: number): string {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: "short", day: "numeric",
  });
}

interface EditState {
  id:     number | null;
  label:  string;
  target: string;
}

const EMPTY_EDIT: EditState = { id: null, label: "", target: "" };

export const BookmarksView: React.FC<BookmarksViewProps> = ({ onNavigate, onClose }) => {
  const { state } = useDms();
  const { _ } = useLingui();
  const zone      = state.zone;
  const zoneName  = zone?.name ?? "";

  const [rows,    setRows]    = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [edit,    setEdit]    = useState<EditState>(EMPTY_EDIT);
  const [saving,  setSaving]  = useState(false);

  const labelRef  = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    if (!zoneName) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await dms.bookmark.list(zoneName);
      if (res.ok && res.data) setRows(res.data);
      else setError(res.error ?? _("Failed to load bookmarks"));
    } finally {
      setLoading(false);
    }
  }, [zoneName]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (edit.id !== null || edit.id === null && (edit.label || edit.target)) {
      labelRef.current?.focus();
    }
  }, [edit.id, edit.label, edit.target]);

  const goTo = useCallback((row: Bookmark) => {
    if (!zone) return;
    const absPath = resolveAbs(row.target, zone.out_path);
    onNavigate(absPath, row.kind === "folder");
  }, [zone, onNavigate]);

  const startAdd = () => setEdit({ id: null, label: "", target: "" });

  const startEdit = (row: Bookmark) =>
    setEdit({ id: row.id, label: row.label, target: row.target });

  const cancelEdit = () => setEdit(EMPTY_EDIT);

  const commitEdit = useCallback(async () => {
    if (saving) return;
    const label  = edit.label.trim();
    const target = edit.target.trim();
    if (!label || !target) { cancelEdit(); return; }

    setSaving(true);
    try {
      if (edit.id === null) {
        const res = await dms.bookmark.add(zoneName, label, target);
        if (res.ok && res.data) setRows(prev => [...prev, res.data!]);
        else setError(res.error ?? _("Failed to add bookmark"));
      } else {
        const row = rows.find(r => r.id === edit.id);
        if (!row) { cancelEdit(); return; }
        const res = await dms.bookmark.update(edit.id, label, target, row.sort_order);
        if (res.ok && res.data)
          setRows(prev => prev.map(r => r.id === res.data!.id ? res.data! : r));
        else setError(res.error ?? _("Failed to update bookmark"));
      }
      setEdit(EMPTY_EDIT);
    } finally {
      setSaving(false);
    }
  }, [edit, rows, zoneName, saving]);

  const deleteRow = useCallback(async (id: number) => {
    try {
      await dms.bookmark.delete(id);
      setRows(prev => prev.filter(r => r.id !== id));
    } catch (e) { setError(String(e)); }
  }, []);

  const moveRow = useCallback(async (id: number, dir: "up" | "down") => {
    const sorted = [...rows].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    const idx    = sorted.findIndex(r => r.id === id);
    const swap   = dir === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || swap < 0 || swap >= sorted.length) return;
    const a = { ...sorted[idx]!,  sort_order: sorted[swap]!.sort_order };
    const b = { ...sorted[swap]!, sort_order: sorted[idx]!.sort_order };
    setRows(prev => prev.map(r => r.id === a.id ? a : r.id === b.id ? b : r));
    await Promise.all([
      dms.bookmark.update(a.id, a.label, a.target, a.sort_order),
      dms.bookmark.update(b.id, b.label, b.target, b.sort_order),
    ]).catch(() => { setError(_("Reorder failed")); void reload(); });
  }, [rows, reload]);

  if (!zoneName) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--theme-text-muted)] text-xs italic">
        {_("Open a zone to see its bookmarks.")}
      </div>
    );
  }

  const sorted = [...rows].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const isAdding = edit.id === null && (edit.label !== "" || edit.target !== "");

  const editForm = (
    <div className="flex items-center gap-1.5 px-3 py-2 bg-[var(--theme-primary)]/5
                    border border-[var(--theme-primary)]/20 rounded-lg mx-3 mb-1">
      <input
        ref={labelRef}
        value={edit.label}
        onChange={e => setEdit(p => ({ ...p, label: e.target.value }))}
        onKeyDown={e => { if (e.key === "Enter") void commitEdit(); if (e.key === "Escape") cancelEdit(); }}
        placeholder={_("Label")}
        className="w-32 min-w-0 text-[11px] bg-transparent border-b border-[var(--theme-primary)]/40
                   text-[var(--theme-text)] placeholder-[var(--theme-text-muted)]/50
                   focus:outline-none focus:border-[var(--theme-primary)] py-0.5"
      />
      <input
        value={edit.target}
        onChange={e => setEdit(p => ({ ...p, target: e.target.value }))}
        onKeyDown={e => { if (e.key === "Enter") void commitEdit(); if (e.key === "Escape") cancelEdit(); }}
        placeholder={_("zone-relative/path or .notes")}
        className="flex-1 min-w-0 text-[11px] font-mono bg-transparent border-b
                   border-[var(--theme-primary)]/40 text-[var(--theme-text-muted)]
                   placeholder-[var(--theme-text-muted)]/40
                   focus:outline-none focus:border-[var(--theme-primary)] py-0.5"
      />
      <button
        onClick={() => void commitEdit()}
        disabled={saving || !edit.label.trim() || !edit.target.trim()}
        title={_("Save")}
        className="p-1 rounded text-[var(--theme-primary)] hover:bg-[var(--theme-primary)]/10
                   disabled:opacity-30 transition-colors shrink-0"
      >
        <Icon name="check" size="xs" />
      </button>
      <button onClick={cancelEdit} title={_("Cancel")}
        className="p-1 rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]
                   hover:bg-[var(--theme-bg)] transition-colors shrink-0">
        <Icon name="x" size="xs" />
      </button>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">

      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--theme-border)]
                      bg-[var(--theme-surface)] shrink-0">
        <Icon name="bookmark" size="xs" className="text-[var(--theme-primary)]" />
        <span className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] flex-1">
          Bookmarks — {zoneName}
        </span>
        {saving && (
          <span className="w-3 h-3 border-2 border-[var(--theme-primary)] border-t-transparent
                           rounded-full animate-spin" />
        )}
        <button
          onClick={startAdd}
            title={_("Add bookmark")}
          className="p-1 rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)]
                     hover:bg-[var(--theme-bg)] transition-colors"
        >
          <Icon name="plus" size="xs" />
        </button>
        {onClose && (
          <button onClick={onClose} title={_("Close")}
            className="p-1 rounded hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)]
                       hover:text-[var(--theme-text)] transition-colors">
            <Icon name="close" size="xs" />
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-500/10 border-b
                        border-rose-500/20 text-rose-500 text-[10px] shrink-0">
          <span className="flex-1 truncate">{error}</span>
          <button onClick={() => setError(null)} className="font-bold shrink-0">
            <Icon name="x" size="xs" />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-1.5 flex flex-col gap-0.5">

        {loading && (
          <div className="flex items-center justify-center py-12 text-[var(--theme-text-muted)] text-xs">
            <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
            {_("Loading…")}
          </div>
        )}

        {!loading && sorted.length === 0 && !isAdding && (
          <div className="px-4 py-10 text-center text-[var(--theme-text-muted)] text-xs italic">
            {_("No bookmarks yet — click + to add one.")}
          </div>
        )}

        {!loading && sorted.map((row, idx) => {
          const isEditing = edit.id === row.id;
          if (isEditing) return (
            <div key={row.id} className="mx-3 mb-0.5">{editForm}</div>
          );

          return (
            <div
              key={row.id}
              role="button"
              tabIndex={0}
              onClick={() => goTo(row)}
              onKeyDown={e => (e.key === "Enter" || e.key === " ") && goTo(row)}
              className="group flex items-center gap-2 px-3 py-2 mx-1.5 rounded-lg
                         cursor-pointer transition-colors select-none
                         hover:bg-[var(--theme-bg)] focus:outline-none
                         focus:ring-1 focus:ring-[var(--theme-primary)]/40"
            >
              <Icon
                name={row.kind === "folder" ? "folder" : "file"}
                size="xs"
                className={row.kind === "folder" ? "text-amber-500/70 shrink-0" : "text-[var(--theme-text-muted)] shrink-0"}
              />

              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold text-[var(--theme-text)] truncate">
                  {row.label || <em className="text-[var(--theme-text-muted)] font-normal">—</em>}
                </div>
                <div className="text-[9px] font-mono text-[var(--theme-text-muted)] truncate opacity-60">
                  {row.target}
                </div>
              </div>

              <span className="text-[9px] text-[var(--theme-text-muted)] opacity-40 shrink-0 hidden sm:block">
                {fmtDate(row.updated_at || row.created_at)}
              </span>

              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                   onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => void moveRow(row.id, "up")}
                  disabled={idx === 0}
                  title={_("Move up")}
                  className="p-0.5 rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)]
                             disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                >
                  <Icon name="chevron-up" size="xs" />
                </button>
                <button
                  onClick={() => void moveRow(row.id, "down")}
                  disabled={idx === sorted.length - 1}
                  title={_("Move down")}
                  className="p-0.5 rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)]
                             disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                >
                  <Icon name="chevron-down" size="xs" />
                </button>
                <button
                  onClick={() => startEdit(row)}
                  title={_("Edit")}
                  className="p-0.5 rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)] transition-colors"
                >
                  <Icon name="edit" size="xs" />
                </button>
                <button
                  onClick={() => void deleteRow(row.id)}
                  title={_("Delete")}
                  className="p-0.5 rounded text-[var(--theme-text-muted)] hover:text-rose-500 transition-colors"
                >
                  <Icon name="trash" size="xs" />
                </button>
              </div>
            </div>
          );
        })}

        {!loading && isAdding && (
          <div className="mt-1">{editForm}</div>
        )}
      </div>

      {!loading && !isAdding && (
        <div className="px-3 py-2 border-t border-[var(--theme-border)] shrink-0">
          <button
            onClick={startAdd}
            className="flex items-center gap-1.5 w-full py-1.5 px-2 rounded-lg text-[10px]
                       text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)]
                       hover:bg-[var(--theme-bg)] transition-colors"
          >
            <Icon name="plus" size="xs" />
            {_("Add bookmark")}
          </button>
        </div>
      )}
    </div>
  );
};

export default BookmarksView;
