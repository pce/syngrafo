import React, { useState, useEffect, useCallback } from "react";
import { useLingui } from "@lingui/react";
import { i18n } from "@/i18n";
import { useDms } from "../../store/dms-store";
import { dms, type Bookmark, type BookmarkRoot } from "../../services/dms-service";
import { Icon } from "../Icon";

interface BookmarksViewProps {
  onNavigate: (absPath: string, isDir: boolean) => void;
  onClose?:   () => void;
}

function fmtDate(ts: number): string {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: "short", day: "numeric",
  });
}

const BOOKMARK_ROOTS: Array<{ value: BookmarkRoot; label: string }> = [
  { value: "source",    label: "Source" },
  { value: "workspace", label: "Workspace" },
  { value: "notes",     label: "Notes" },
  { value: "kanban",    label: "Kanban" },
];

function isBookmarkRoot(value: string): value is BookmarkRoot {
  return BOOKMARK_ROOTS.some((root) => root.value === value);
}

interface EditState {
  id:     number | null;
  root:   BookmarkRoot;
  label:  string;
  target: string;
}

const EMPTY_EDIT: EditState = { id: null, root: "workspace", label: "", target: "" };

export const BookmarksView: React.FC<BookmarksViewProps> = ({ onNavigate, onClose }) => {
  const { state } = useDms();
  useLingui();
  const zone      = state.zone;
  const zoneName  = zone?.name ?? "";

  const [rows,    setRows]    = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [edit,    setEdit]    = useState<EditState>(EMPTY_EDIT);
  const [saving,  setSaving]  = useState(false);

  const reload = useCallback(async () => {
    if (!zoneName) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await dms.bookmark.list(zoneName);
      if (res.ok && res.data) setRows(res.data);
      else setError(res.error ?? i18n._({ id: "Failed to load bookmarks", message: "Failed to load bookmarks" }));
    } finally {
      setLoading(false);
    }
  }, [zoneName]);

  useEffect(() => { void reload(); }, [reload]);

  const goTo = useCallback(async (row: Bookmark) => {
    if (!zone) return;
    const res = await dms.bookmark.resolve(zone.name, row.root, row.target);
    if (!res.ok || !res.data) {
      setError(res.error ?? i18n._({ id: "Failed to resolve bookmark", message: "Failed to resolve bookmark" }));
      return;
    }
    onNavigate(res.data.abs_path, res.data.kind === "folder");
  }, [zone, onNavigate]);

  const startAdd = () => setEdit(EMPTY_EDIT);

  const startEdit = (row: Bookmark) =>
    setEdit({ id: row.id, root: row.root, label: row.label, target: row.target });

  const cancelEdit = () => setEdit(EMPTY_EDIT);

  const commitEdit = useCallback(async () => {
    if (saving) return;
    const label  = edit.label.trim();
    const target = edit.target.trim();
    if (!label) { cancelEdit(); return; }

    setSaving(true);
    try {
      if (edit.id === null) {
        const res = await dms.bookmark.add(zoneName, edit.root, label, target);
        if (res.ok && res.data) setRows(prev => [...prev, res.data!]);
        else setError(res.error ?? i18n._({ id: "Failed to add bookmark", message: "Failed to add bookmark" }));
      } else {
        const row = rows.find(r => r.id === edit.id);
        if (!row) { cancelEdit(); return; }
        const res = await dms.bookmark.update(edit.id, edit.root, label, target, row.sort_order);
        if (res.ok && res.data)
          setRows(prev => prev.map(r => r.id === res.data!.id ? res.data! : r));
        else setError(res.error ?? i18n._({ id: "Failed to update bookmark", message: "Failed to update bookmark" }));
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
      dms.bookmark.update(a.id, a.root, a.label, a.target, a.sort_order),
      dms.bookmark.update(b.id, b.root, b.label, b.target, b.sort_order),
    ]).catch(() => { setError(i18n._({ id: "Reorder failed", message: "Reorder failed" })); void reload(); });
  }, [rows, reload]);

  if (!zoneName) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--theme-text-muted)] text-xs italic">
        {i18n._({ id: "Open a zone to see its bookmarks.", message: "Open a zone to see its bookmarks." })}
      </div>
    );
  }

  const sorted = [...rows].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const isAdding = edit.id === null && (edit.label !== "" || edit.target !== "");

  const editForm = (
    <div className="flex items-center gap-1.5 px-3 py-2 bg-[var(--theme-primary)]/5
                    border border-[var(--theme-primary)]/20 rounded-lg mx-3 mb-1">
      <input
        autoFocus
        value={edit.label}
        onChange={e => setEdit(p => ({ ...p, label: e.target.value }))}
        onKeyDown={e => { if (e.key === "Enter") void commitEdit(); if (e.key === "Escape") cancelEdit(); }}
        placeholder={i18n._({ id: "Label", message: "Label" })}
        className="w-32 min-w-0 text-[11px] bg-transparent border-b border-[var(--theme-primary)]/40
                   text-[var(--theme-text)] placeholder-[var(--theme-text-muted)]/50
                   focus:outline-none focus:border-[var(--theme-primary)] py-0.5"
      />
      <select
        value={edit.root}
        onChange={e => {
          const { value } = e.target;
          if (!isBookmarkRoot(value)) return;
          setEdit(p => ({ ...p, root: value }));
        }}
        className="w-28 min-w-0 text-[11px] bg-transparent border-b border-[var(--theme-primary)]/40
                   text-[var(--theme-text)] focus:outline-none focus:border-[var(--theme-primary)] py-0.5"
      >
        {BOOKMARK_ROOTS.map((root) => (
          <option key={root.value} value={root.value}>
            {root.label}
          </option>
        ))}
      </select>
      <input
        value={edit.target}
        onChange={e => setEdit(p => ({ ...p, target: e.target.value }))}
        onKeyDown={e => { if (e.key === "Enter") void commitEdit(); if (e.key === "Escape") cancelEdit(); }}
        placeholder={i18n._({ id: "path inside root (blank = root)", message: "path inside root (blank = root)" })}
        className="flex-1 min-w-0 text-[11px] font-mono bg-transparent border-b
                   border-[var(--theme-primary)]/40 text-[var(--theme-text-muted)]
                   placeholder-[var(--theme-text-muted)]/40
                   focus:outline-none focus:border-[var(--theme-primary)] py-0.5"
      />
      <button
        onClick={() => void commitEdit()}
        disabled={saving || !edit.label.trim()}
        title={i18n._({ id: "Save", message: "Save" })}
        className="p-1 rounded text-[var(--theme-primary)] hover:bg-[var(--theme-primary)]/10
                   disabled:opacity-30 transition-colors shrink-0"
      >
        <Icon name="check" size="xs" />
      </button>
      <button onClick={cancelEdit} title={i18n._({ id: "Cancel", message: "Cancel" })}
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
            title={i18n._({ id: "Add bookmark", message: "Add bookmark" })}
          className="p-1 rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)]
                     hover:bg-[var(--theme-bg)] transition-colors"
        >
          <Icon name="plus" size="xs" />
        </button>
        {onClose && (
          <button onClick={onClose} title={i18n._({ id: "Close", message: "Close" })}
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
            {i18n._({ id: "Loading…", message: "Loading…" })}
          </div>
        )}

        {!loading && sorted.length === 0 && !isAdding && (
          <div className="px-4 py-10 text-center text-[var(--theme-text-muted)] text-xs italic">
            {i18n._({ id: "No bookmarks yet — click + to add one.", message: "No bookmarks yet — click + to add one." })}
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
               onClick={() => void goTo(row)}
               onKeyDown={e => (e.key === "Enter" || e.key === " ") && void goTo(row)}
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
                <div className="flex items-center gap-1.5 text-[9px] font-mono text-[var(--theme-text-muted)] truncate opacity-60">
                  <span className="px-1 py-0.5 rounded bg-[var(--theme-bg)] border border-[var(--theme-border)] uppercase">
                    {row.root}
                  </span>
                  <span className="truncate">{row.target || "/"}</span>
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
                  title={i18n._({ id: "Move up", message: "Move up" })}
                  className="p-0.5 rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)]
                             disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                >
                  <Icon name="chevron-up" size="xs" />
                </button>
                <button
                  onClick={() => void moveRow(row.id, "down")}
                  disabled={idx === sorted.length - 1}
                  title={i18n._({ id: "Move down", message: "Move down" })}
                  className="p-0.5 rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)]
                             disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                >
                  <Icon name="chevron-down" size="xs" />
                </button>
                <button
                  onClick={() => startEdit(row)}
                  title={i18n._({ id: "Edit", message: "Edit" })}
                  className="p-0.5 rounded text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)] transition-colors"
                >
                  <Icon name="edit" size="xs" />
                </button>
                <button
                  onClick={() => void deleteRow(row.id)}
                  title={i18n._({ id: "Delete", message: "Delete" })}
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
            {i18n._({ id: "Add bookmark", message: "Add bookmark" })}
          </button>
        </div>
      )}
    </div>
  );
};

export default BookmarksView;
