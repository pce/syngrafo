// components/dms/NotesView.tsx ─────────────────────────────────────────────────
// Two-panel notes editor shown when the FileBrowser navigates into .notes/.
//
// Left pane  (~220 px): flat list of .md files, sorted by modified desc.
// Right pane (flex-1):  textarea (edit) + live markdown preview, side-by-side.
//
// Features:
//   • Auto-save with 600 ms debounce (stale-closure-safe via refs)
//   • Create note: window.prompt → slugify → dms.writeFile + dir creation
//   • Delete note: window.confirm → dms.deleteFiles
//   • Handles missing .notes dir gracefully (shows empty state)
//   • Simple MVP markdown renderer (no external deps)
// ──────────────────────────────────────────────────────────────────────────────

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { dms } from "../../services/dms-service";
import type { FsEntry } from "../../services/dms-service";
import { useDms } from "../../store/dms-store";
import Icon from "../Icon";

// ── Props ──────────────────────────────────────────────────────────────────────

export interface NotesViewProps {
  /** Absolute path to the .notes folder, e.g. "/home/user/zone/.notes" */
  notesDir: string;
}

// ── Internal types ─────────────────────────────────────────────────────────────

type SaveStatus = "idle" | "saving" | "saved" | "error";

// ── Markdown renderer (MVP, no external deps) ──────────────────────────────────

/** Escape HTML special chars *before* applying inline spans. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Apply inline markup: **bold**, *italic*, _italic_ */
function applyInline(raw: string): string {
  return escapeHtml(raw)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/_(.+?)_/g, "<em>$1</em>");
}

/**
 * Convert markdown string to an HTML string.
 * Processes line-by-line; no block-level nesting.
 */
function renderMarkdown(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let prevWasBlank = false;

  for (const line of lines) {
    // Blank line → paragraph break, but collapse consecutive blanks into one.
    if (line.trim() === "") {
      if (!prevWasBlank) out.push("<br /><br />");
      prevWasBlank = true;
      continue;
    }
    prevWasBlank = false;

    // Headings (check ### before ## before #)
    if (line.startsWith("### ")) {
      out.push(
        `<h3 class="text-base font-semibold mb-1">${applyInline(line.slice(4))}</h3>`
      );
      continue;
    }
    if (line.startsWith("## ")) {
      out.push(
        `<h2 class="text-lg font-bold mb-1">${applyInline(line.slice(3))}</h2>`
      );
      continue;
    }
    if (line.startsWith("# ")) {
      out.push(
        `<h1 class="text-xl font-bold mb-2">${applyInline(line.slice(2))}</h1>`
      );
      continue;
    }

    // Task list items — must be tested before plain bullet
    if (/^- \[ \] /.test(line)) {
      const text = applyInline(line.slice(6));
      out.push(
        `<div class="flex items-start gap-2 my-0.5">` +
          `<input type="checkbox" disabled class="mt-1 shrink-0 accent-current" />` +
          `<span>${text}</span>` +
        `</div>`
      );
      continue;
    }
    if (/^- \[x\] /i.test(line)) {
      const text = applyInline(line.slice(6));
      out.push(
        `<div class="flex items-start gap-2 my-0.5">` +
          `<input type="checkbox" disabled checked class="mt-1 shrink-0 accent-current" />` +
          `<span class="line-through opacity-60">${text}</span>` +
        `</div>`
      );
      continue;
    }

    // Plain bullet
    if (line.startsWith("- ")) {
      out.push(
        `<div class="flex items-start gap-2 my-0.5">` +
          `<span class="mt-2 w-1.5 h-1.5 rounded-full bg-current shrink-0 inline-block"></span>` +
          `<span>${applyInline(line.slice(2))}</span>` +
        `</div>`
      );
      continue;
    }

    // Default: paragraph
    out.push(`<p class="my-0.5">${applyInline(line)}</p>`);
  }

  return out.join("\n");
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Convert a human title into a safe ASCII filename slug.
 * Transliterates common accented / umlauted characters before stripping
 * so that titles like "Gesundheitsförderung" don't collapse to an empty string.
 */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    // Transliterate common accented characters
    .replace(/[äàáâãåæ]/g, "a")
    .replace(/[öòóôõø]/g, "o")
    .replace(/[üùúû]/g, "u")
    .replace(/[ëèéê]/g, "e")
    .replace(/[ïìíî]/g, "i")
    .replace(/[ýÿ]/g, "y")
    .replace(/ß/g, "ss")
    .replace(/ñ/g, "n")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

/** Format a Unix-ms timestamp as a short locale date string. */
function fmtDate(ms: number | undefined): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day:   "numeric",
    year:  "2-digit",
  });
}

// ── Component ──────────────────────────────────────────────────────────────────

const NotesView: React.FC<NotesViewProps> = ({ notesDir }) => {
  // ── Store (for Analysis panel sync) ──────────────────────────────────────────
  const { dispatch: storeDispatch } = useDms();

  // ── Local state ──────────────────────────────────────────────────────────────
  const [notes,        setNotes]        = useState<FsEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content,      setContent]      = useState<string>("");
  const [saveStatus,   setSaveStatus]   = useState<SaveStatus>("idle");
  const [listLoading,  setListLoading]  = useState(false);

  // ── Inline create / delete state ─────────────────────────────────────────
  // We avoid window.prompt/confirm because WKWebView does not implement them.
  const [creatingNote,  setCreatingNote]  = useState(false);
  const [newNoteTitle,  setNewNoteTitle]  = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // ── Refs (keep latest values accessible inside debounce callback) ────────────
  const contentRef      = useRef<string>("");
  const selectedPathRef = useRef<string | null>(null);
  const saveTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mirror state into refs every render so the debounce closure is always fresh.
  contentRef.current      = content;
  selectedPathRef.current = selectedPath;

  // ── Load notes list ──────────────────────────────────────────────────────────

  const loadNotes = useCallback(async () => {
    setListLoading(true);
    const res = await dms.scanDir(notesDir);
    setListLoading(false);

    if (!res.ok || !res.data) {
      // Directory doesn't exist yet — show empty state, let ＋ create it.
      setNotes([]);
      return;
    }

    const mdFiles = res.data.entries
      .filter((e) => e.kind === "file" && e.name.endsWith(".md"))
      .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0));

    setNotes(mdFiles);
  }, [notesDir]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  // ── Sync selected note into the store ────────────────────────────────────────
  // The Analysis panel reads state.selectedPath / state.metadata from the store.
  // Without this sync it would keep showing stale metadata from whatever was
  // last clicked in the file browser.
  //
  // Dispatching SELECT_FILE:
  //   • clears state.metadata in the reducer immediately
  //   • triggers Dashboard's useEffect(selectedPath) which auto-loads the
  //     note's metadata and populates the Analysis panel correctly.
  //
  // On mount we clear any leftover selection from the file browser.
  // On unmount we clear again so the panel doesn't linger with note data.
  useEffect(() => {
    storeDispatch({ type: "SELECT_FILE", path: selectedPath });
  }, [selectedPath, storeDispatch]);

  useEffect(() => {
    // Clear stale file-browser selection the moment NotesView mounts.
    storeDispatch({ type: "SELECT_FILE", path: null });
    return () => {
      // Also clear when leaving Notes view.
      storeDispatch({ type: "SELECT_FILE", path: null });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load note content when the selected path changes ─────────────────────────

  useEffect(() => {
    if (!selectedPath) {
      setContent("");
      setSaveStatus("idle");
      return;
    }

    // Cancel any pending save for the previous note.
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setSaveStatus("idle");

    let cancelled = false;
    dms.readFile(selectedPath).then((res) => {
      if (cancelled) return;
      const text =
        res.ok && res.data?.content != null ? res.data.content : "";
      setContent(text);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedPath]);

  // ── Debounced auto-save ───────────────────────────────────────────────────────

  /**
   * Schedule a save 600 ms after the last keystroke.
   * Reads from refs so it never captures stale state.
   */
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus("saving");

    saveTimerRef.current = setTimeout(async () => {
      const path = selectedPathRef.current;
      if (!path) return;

      const res = await dms.writeFile(path, contentRef.current);
      setSaveStatus(res.ok ? "saved" : "error");
      // Auto-reset the "Saved" badge so it doesn't linger.
      if (res.ok) {
        setTimeout(
          () => setSaveStatus((s) => (s === "saved" ? "idle" : s)),
          2000,
        );
      }
    }, 600);
  }, []); // intentionally no deps — refs carry the latest values

  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setContent(e.target.value);
      scheduleSave();
    },
    [scheduleSave]
  );

  // ── Create a new note ─────────────────────────────────────────────────────────

  /**
   * Called when the inline form is committed (Enter or ✓ button).
   * Takes the title string directly — no window.prompt.
   */
  const createNote = useCallback(async (title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;

    const baseSlug = slugify(trimmed) || "note";

    // Guard against filename collisions with already-existing notes.
    const existingPaths = new Set(notes.map((n) => n.path));
    let filePath = `${notesDir}/${baseSlug}.md`;
    if (existingPaths.has(filePath)) {
      let n = 2;
      while (existingPaths.has(`${notesDir}/${baseSlug}-${n}.md`)) n++;
      filePath = `${notesDir}/${baseSlug}-${n}.md`;
    }

    // Ensure the .notes directory exists (idempotent).
    await dms.createDir(notesDir);

    const res = await dms.writeFile(filePath, `# ${trimmed}\n\n`);
    if (!res.ok) {
      console.error("[NotesView] Failed to create note:", res.error);
      return;
    }

    await loadNotes();
    setSelectedPath(filePath);
  }, [notesDir, notes, loadNotes]);

  /** Commit the inline new-note form. */
  const commitNewNote = useCallback(async () => {
    const title = newNoteTitle.trim();
    setCreatingNote(false);
    setNewNoteTitle("");
    if (title) await createNote(title);
  }, [newNoteTitle, createNote]);

  // ── Delete a note ─────────────────────────────────────────────────────────────

  /** Actually removes the file after the inline confirmation is accepted. */
  const confirmAndDelete = useCallback(
    async (path: string) => {
      setConfirmDelete(null);
      const res = await dms.deleteFiles([path]);
      if (res.ok) {
        if (selectedPath === path) {
          setSelectedPath(null);
          setContent("");
        }
        await loadNotes();
      } else {
        console.error("[NotesView] Delete failed:", res.error);
      }
    },
    [selectedPath, loadNotes]
  );

  // ── Derived values ────────────────────────────────────────────────────────────

  // Memoised so markdown parsing only re-runs when content actually changes,
  // not on every hover event or other incidental re-render.
  const preview = useMemo(() => renderMarkdown(content), [content]);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden bg-[var(--theme-bg)]">

      {/* ══════════════════════════════════════════════════════════════════════
          Left pane — note list
      ══════════════════════════════════════════════════════════════════════ */}
      <div
        className="flex flex-col shrink-0 border-r border-[var(--theme-border)] bg-[var(--theme-surface)]"
        style={{ width: 220 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--theme-border)] shrink-0">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">
            Notes
          </span>
          <button
            onClick={() => {
              setConfirmDelete(null); // dismiss any open delete confirmation
              setCreatingNote(true);
              setNewNoteTitle("");
            }}
            title="New note"
            className="w-6 h-6 flex items-center justify-center rounded transition-colors
                       text-[var(--theme-primary)] hover:bg-[var(--theme-primary)]/10
                       active:scale-95"
          >
            <Icon name="plus" size="xs" />
          </button>
        </div>

        {/* Inline new-note form — shown instead of window.prompt */}
        {creatingNote && (
          <div className="px-2 pt-2 pb-1.5 border-b border-[var(--theme-border)] bg-[var(--theme-bg)] shrink-0">
            <input
              autoFocus
              type="text"
              value={newNoteTitle}
              onChange={(e) => setNewNoteTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter")  void commitNewNote();
                if (e.key === "Escape") { setCreatingNote(false); setNewNoteTitle(""); }
              }}
              placeholder="Note title…"
              className="w-full bg-[var(--theme-surface)] border border-[var(--theme-border)]
                         rounded-md px-2 py-1 text-xs text-[var(--theme-text)]
                         placeholder:text-[var(--theme-text-muted)]
                         focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]"
            />
            <div className="flex gap-1 mt-1.5">
              <button
                onClick={() => void commitNewNote()}
                disabled={!newNoteTitle.trim()}
                className="flex-1 py-1 text-[10px] font-bold uppercase tracking-wider
                           rounded bg-[var(--theme-primary)] text-white
                           hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                Create
              </button>
              <button
                onClick={() => { setCreatingNote(false); setNewNoteTitle(""); }}
                className="flex-1 py-1 text-[10px] font-bold uppercase tracking-wider
                           rounded bg-[var(--theme-border)] text-[var(--theme-text-muted)]
                           hover:bg-[var(--theme-bg)] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* List body */}
        <div className="flex-1 overflow-y-auto">
          {listLoading ? (
            /* Spinner while scanning */
            <div className="flex items-center justify-center py-10">
              <span
                className="w-4 h-4 rounded-full border-2 animate-spin
                           border-[var(--theme-primary)]/20 border-t-[var(--theme-primary)]"
              />
            </div>

          ) : notes.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-10 px-4 gap-2 text-center">
              <Icon
                name="file"
                size="md"
                className="opacity-20 text-[var(--theme-text)]"
              />
              <p className="text-[10px] leading-relaxed text-[var(--theme-text-muted)]">
                No notes yet.
                <br />
                Press&nbsp;＋&nbsp;to create one.
              </p>
            </div>

          ) : (
            /* Note rows */
            notes.map((note) => {
              const isSelected = note.path === selectedPath;
              const label      = note.name.replace(/\.md$/, "");

              // Inline delete confirmation replaces the row
              if (confirmDelete === note.path) {
                return (
                  <div
                    key={note.path}
                    className="flex items-center gap-1.5 px-2 py-2 bg-red-500/8 border-b border-red-500/15"
                  >
                    <span className="flex-1 text-[10px] text-red-600 dark:text-red-400 truncate">
                      Delete &ldquo;{label}&rdquo;?
                    </span>
                    <button
                      onClick={() => void confirmAndDelete(note.path)}
                      className="px-2 py-0.5 text-[10px] font-bold rounded bg-red-500 text-white hover:bg-red-600 transition-colors shrink-0"
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="px-2 py-0.5 text-[10px] rounded border border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] transition-colors shrink-0"
                    >
                      No
                    </button>
                  </div>
                );
              }

              return (
                <div
                  key={note.path}
                  onClick={() => { setConfirmDelete(null); setSelectedPath(note.path); }}
                  className={[
                    "group relative flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors select-none",
                    isSelected
                      ? "bg-[var(--theme-primary)] text-white"
                      : "hover:bg-[var(--theme-bg)] text-[var(--theme-text)]",
                  ].join(" ")}
                >
                  {/* Text block */}
                  <div className="flex-1 min-w-0">
                    <div
                      className={[
                        "text-xs font-medium truncate",
                        isSelected ? "text-white" : "text-[var(--theme-text)]",
                      ].join(" ")}
                    >
                      {label}
                    </div>
                    {note.modified != null && (
                      <div
                        className={[
                          "text-[10px] mt-0.5",
                          isSelected
                            ? "text-white/70"
                            : "text-[var(--theme-text-muted)]",
                        ].join(" ")}
                      >
                        {fmtDate(note.modified)}
                      </div>
                    )}
                  </div>

                  {/* Trash button — always in DOM, shown via CSS group-hover
                      so we don't need hover state (avoids a re-render + markdown
                      re-parse on every mouse-enter). */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(note.path); }}
                    title="Delete note"
                    className={[
                      "shrink-0 w-5 h-5 flex items-center justify-center rounded transition-all",
                      isSelected
                        ? "text-white/60 hover:text-white hover:bg-white/20"
                        : "text-[var(--theme-text-muted)] hover:text-red-500 hover:bg-red-500/10",
                      // Hidden until the row is hovered; pointer-events blocked
                      // so it doesn't intercept clicks on invisible area.
                      isSelected
                        ? "opacity-100"
                        : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto",
                    ].join(" ")}
                  >
                    <Icon name="trash" size="xs" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          Right pane — editor + preview
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        {selectedPath == null ? (
          /* ── No selection: empty state ── */
          <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center p-8">
            <Icon
              name="edit"
              size="xl"
              className="opacity-20 text-[var(--theme-text)]"
            />
            <p className="text-sm text-[var(--theme-text-muted)]">
              Select a note or create one
            </p>
          </div>

        ) : (
          <>
            {/* ── Editor + Preview panels ── */}
            <div className="flex flex-1 min-h-0 overflow-hidden">

              {/* Textarea (left half) */}
              <div className="flex flex-col flex-1 min-w-0 border-r border-[var(--theme-border)]">
                {/* Sub-header — show the note's filename as a title */}
                <div className="shrink-0 px-3 py-1.5 border-b border-[var(--theme-border)] bg-[var(--theme-surface)] flex items-center gap-2">
                  <span className="flex-1 text-xs font-semibold truncate text-[var(--theme-text)]">
                    {selectedPath?.split("/").pop()?.replace(/\.md$/, "") ?? ""}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] shrink-0">
                    md
                  </span>
                </div>

                <textarea
                  value={content}
                  onChange={handleContentChange}
                  spellCheck={false}
                  placeholder="Start writing…"
                  className="flex-1 w-full resize-none outline-none font-mono text-sm leading-relaxed
                             p-4 bg-[var(--theme-bg)] text-[var(--theme-text)]
                             placeholder:text-[var(--theme-text-muted)]"
                />
              </div>

              {/* Preview (right half) */}
              <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
                {/* Sub-header */}
                <div className="shrink-0 px-3 py-1.5 border-b border-[var(--theme-border)] bg-[var(--theme-surface)]">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">
                    Preview
                  </span>
                </div>

                <div
                  className="flex-1 overflow-y-auto p-4 text-sm text-[var(--theme-text)] leading-relaxed"
                  // Safe: content is authored by the user themselves,
                  // and escapeHtml() is applied to all user text before
                  // any HTML tags are injected by renderMarkdown().
                  dangerouslySetInnerHTML={{ __html: preview }}
                />
              </div>
            </div>

            {/* ── Status bar ── */}
            <div
              className="shrink-0 flex items-center justify-end gap-2 px-4 py-1
                         border-t border-[var(--theme-border)] bg-[var(--theme-surface)]"
              style={{ minHeight: 28 }}
            >
              {saveStatus === "saving" && (
                <span className="flex items-center gap-1.5 text-[10px] text-[var(--theme-text-muted)]">
                  <span
                    className="w-2.5 h-2.5 rounded-full border border-[var(--theme-primary)]/40
                               border-t-[var(--theme-primary)] animate-spin"
                  />
                  Saving…
                </span>
              )}

              {saveStatus === "saved" && (
                <span className="flex items-center gap-1 text-[10px] text-green-500 font-medium">
                  <Icon name="check" size="xs" />
                  Saved
                </span>
              )}

              {saveStatus === "error" && (
                <span className="text-[10px] font-medium text-red-500">
                  Save failed
                </span>
              )}

              {/* Idle: invisible spacer to keep the bar height stable */}
              {saveStatus === "idle" && (
                <span className="text-[10px] opacity-0 select-none" aria-hidden>
                  &nbsp;
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default NotesView;
