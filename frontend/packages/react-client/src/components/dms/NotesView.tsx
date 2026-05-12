/**
 * @file NotesView.tsx
 * @brief Two-panel notes editor rendered when the FileBrowser navigates into .notes/.
 *
 * Left pane (~240 px) — root .md files + collapsible Collection groups.
 * Right pane (flex-1) — textarea editor with live markdown preview.
 *
 * Collections are one-level subdirectories inside .notes/ that group related notes.
 *
 * @remarks
 * - Auto-save with 600 ms debounce, stale-closure-safe via refs
 * - Create note / collection via inline forms; delete with inline confirm
 * - Cascade-delete removes all notes inside a collection before the directory
 * - Markdown renderer: headings, tasks, bold/italic, code, ASCII art, images
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLingui } from "@lingui/react";

import { dms } from "../../services/dms-service";
import type { FsEntry } from "../../services/dms-service";
import { useDms } from "../../store/dms-store";
import { Icon } from "../Icon";

export interface NotesViewProps {
  /** Absolute path to the .notes folder, e.g. "/home/user/zone/.notes" */
  notesDir: string;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface CollectionGroup {
  name: string;
  dirPath: string;
  notes: FsEntry[];
}

/** Escape HTML special chars. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Apply inline markup: `code`, **bold**, *italic*, _italic_, inline images.
 * Images are extracted before HTML-escaping so URLs survive intact.
 */
function applyInline(raw: string): string {
  // Step 1: extract images to placeholders
  const imgs: Array<{ src: string; alt: string }> = [];
  let s = raw.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => {
    imgs.push({ src, alt });
    return `\x00IMG${imgs.length - 1}\x00`;
  });
  // Step 2: HTML-escape everything
  s = escapeHtml(s);
  // Step 3: restore image tags
  s = s.replace(/\x00IMG(\d+)\x00/g, (_m, idx) => {
    const item = imgs[Number(idx)];
    if (!item) return "";
    const { src, alt } = item;
    const safeSrc = src.startsWith("/") ? `local:/${src}` : src;
    return (
      `<img src="${escapeHtml(safeSrc)}" alt="${escapeHtml(alt)}" ` +
      `class="max-w-full rounded-lg border border-[var(--theme-border)] my-1 inline-block" loading="lazy" />`
    );
  });
  // Step 4: inline patterns
  return s
    .replace(/`([^`]+)`/g,
      `<code class="font-mono text-[0.82em] px-1 py-0.5 rounded ` +
      `bg-[var(--theme-surface)] border border-[var(--theme-border)]">$1</code>`)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/_(.+?)_/g, "<em>$1</em>");
}

/**
 * Convert markdown string to HTML.
 * Supports: headings, task lists, bullets, hr, fenced code/ASCII art blocks
 * (```ascii / ```art / ```diagram), standalone image lines, inline markup.
 */
function renderMarkdown(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inCodeBlock = false;
  let codeLang = "";
  let codeLines: string[] = [];
  let prevWasBlank = false;

  const flushCode = () => {
    const escaped = codeLines.map((l) => escapeHtml(l)).join("\n");
    const isAscii = ["ascii", "art", "diagram", "txt"].includes(codeLang);
    out.push(
      `<pre class="my-2 overflow-x-auto rounded-lg p-3 text-[11px] leading-snug font-mono` +
        ` whitespace-pre bg-[var(--theme-surface)] border border-[var(--theme-border)]` +
        ` text-[var(--theme-text)]${isAscii ? " text-green-600 dark:text-green-400" : ""}">` +
      (codeLang && !isAscii
        ? `<span class="text-[9px] font-bold uppercase tracking-wider ` +
          `text-[var(--theme-text-muted)] block mb-1">${escapeHtml(codeLang)}</span>`
        : "") +
      `<code>${escaped}</code></pre>`
    );
    codeLines = [];
    codeLang = "";
  };

  for (const line of lines) {
    if (inCodeBlock) {
      if (line.trimEnd() === "```" || line.trimEnd() === "~~~") {
        flushCode();
        inCodeBlock = false;
      } else {
        codeLines.push(line);
      }
      prevWasBlank = false;
      continue;
    }

    if (line.startsWith("```") || line.startsWith("~~~")) {
      inCodeBlock = true;
      codeLang = line.slice(3).trim().toLowerCase();
      prevWasBlank = false;
      continue;
    }

    if (line.trim() === "") {
      if (!prevWasBlank) out.push("<br />");
      prevWasBlank = true;
      continue;
    }
    prevWasBlank = false;

    if (line.startsWith("### ")) {
      out.push(`<h3 class="text-base font-semibold mt-3 mb-1">${applyInline(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith("## ")) {
      out.push(`<h2 class="text-lg font-bold mt-4 mb-1">${applyInline(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith("# ")) {
      out.push(`<h1 class="text-xl font-bold mt-4 mb-2">${applyInline(line.slice(2))}</h1>`);
      continue;
    }

    if (/^[-*_]{3,}$/.test(line.trim())) {
      out.push('<hr class="my-3 border-[var(--theme-border)]" />');
      continue;
    }

    // Standalone image line
    const imgMatch = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      const alt = escapeHtml(imgMatch[1] as string);
      const src = imgMatch[2] as string;
      const safeSrc = src.startsWith("/") ? `local:/${src}` : src;
      out.push(
        `<img src="${escapeHtml(safeSrc)}" alt="${alt}" loading="lazy" ` +
        `class="max-w-full rounded-lg border border-[var(--theme-border)] my-2 block" />`
      );
      continue;
    }

    if (/^- \[ \] /.test(line)) {
      out.push(
        `<div class="flex items-start gap-2 my-0.5">` +
          `<input type="checkbox" disabled class="mt-1 shrink-0 accent-current" />` +
          `<span>${applyInline(line.slice(6))}</span>` +
        `</div>`
      );
      continue;
    }
    if (/^- \[x\] /i.test(line)) {
      out.push(
        `<div class="flex items-start gap-2 my-0.5">` +
          `<input type="checkbox" disabled checked class="mt-1 shrink-0 accent-current" />` +
          `<span class="line-through opacity-60">${applyInline(line.slice(6))}</span>` +
        `</div>`
      );
      continue;
    }

    if (line.startsWith("- ")) {
      out.push(
        `<div class="flex items-start gap-2 my-0.5">` +
          `<span class="mt-[7px] w-1.5 h-1.5 rounded-full bg-current shrink-0 inline-block"></span>` +
          `<span>${applyInline(line.slice(2))}</span>` +
        `</div>`
      );
      continue;
    }

    out.push(`<p class="my-0.5">${applyInline(line)}</p>`);
  }

  if (inCodeBlock) flushCode();
  return out.join("\n");
}

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

const NotesView: React.FC<NotesViewProps> = ({ notesDir }) => {
  const { state: storeState, dispatch: storeDispatch } = useDms();
  const { _ } = useLingui();

  const [rootNotes,    setRootNotes]    = useState<FsEntry[]>([]);
  const [collections,  setCollections]  = useState<CollectionGroup[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // Pending auto-select from search navigation (set by viewerPath watcher,
  // resolved once the note list has loaded).
  const [pendingAutoSelect, setPendingAutoSelect] = useState<string | null>(null);
  const [content,      setContent]      = useState<string>("");
  const [saveStatus,   setSaveStatus]   = useState<SaveStatus>("idle");
  const [listLoading,  setListLoading]  = useState(false);

  const [collapsedCols, setCollapsedCols] = useState<Set<string>>(new Set());

  const [creatingNote,      setCreatingNote]      = useState(false);
  const [newNoteTitle,      setNewNoteTitle]       = useState("");
  const [newNoteCollection, setNewNoteCollection] = useState<string>("");

  const [creatingCollection, setCreatingCollection] = useState(false);
  const [newCollectionName,  setNewCollectionName]  = useState("");

  const [confirmDeleteNote, setConfirmDeleteNote] = useState<string | null>(null);
  const [confirmDeleteCol,  setConfirmDeleteCol]  = useState<string | null>(null);

  const contentRef      = useRef<string>("");
  const selectedPathRef = useRef<string | null>(null);
  // saveTargetRef tracks which path the *current content* belongs to.
  // It is only advanced after a note's content is successfully read, so the
  // flush-on-switch logic always saves to the correct (old) path even though
  // selectedPathRef is updated to the new path during the same render.
  const saveTargetRef   = useRef<string | null>(null);
  const saveTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

  contentRef.current      = content;
  selectedPathRef.current = selectedPath;

  const loadNotes = useCallback(async () => {
    setListLoading(true);
    const res = await dms.scanDir(notesDir);
    setListLoading(false);

    if (!res.ok || !res.data) {
      setRootNotes([]);
      setCollections([]);
      return;
    }

    const entries = res.data.entries;
    const mdFiles = entries
      .filter((e) => e.kind === "file" && e.name.endsWith(".md"))
      .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0));

    const subdirs = entries.filter((e) => e.kind === "dir");
    const groups: CollectionGroup[] = [];
    for (const dir of subdirs) {
      const subRes = await dms.scanDir(dir.path);
      if (!subRes.ok || !subRes.data) continue;
      const subNotes = subRes.data.entries
        .filter((e) => e.kind === "file" && e.name.endsWith(".md"))
        .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0));
      groups.push({ name: dir.name, dirPath: dir.path, notes: subNotes });
    }

    setRootNotes(mdFiles);
    setCollections(groups);
  }, [notesDir]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  useEffect(() => {
    const vp = storeState.viewerPath;
    if (vp && vp !== selectedPath && vp.startsWith(notesDir + "/")) {
      setPendingAutoSelect(vp);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeState.viewerPath]);

  // Once the note list is populated, resolve any pending auto-select.
  useEffect(() => {
    if (!pendingAutoSelect) return;
    const allNotes = [
      ...rootNotes,
      ...collections.flatMap((g) => g.notes),
    ];
    if (allNotes.find((n) => n.path === pendingAutoSelect)) {
      setSelectedPath(pendingAutoSelect);
      setPendingAutoSelect(null);
    }
  }, [pendingAutoSelect, rootNotes, collections]);

  useEffect(() => {
    storeDispatch({ type: "SELECT_FILE", path: selectedPath });
  }, [selectedPath, storeDispatch]);

  useEffect(() => {
    // Capture any search-navigation intent (viewerPath set by SearchResults)
    // before the SELECT_FILE(null) clears it.  storeState is captured from
    // the outer scope at mount-render time, so this always reflects the
    // value that was current when NotesView first painted.
    const vp = storeState.viewerPath;
    if (vp && vp.startsWith(notesDir + "/")) {
      setPendingAutoSelect(vp);
    }
    storeDispatch({ type: "SELECT_FILE", path: null });
    return () => { storeDispatch({ type: "SELECT_FILE", path: null }); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedPath) {
      saveTargetRef.current = null;
      setContent("");
      setSaveStatus("idle");
      return;
    }

    // Flush any unsaved content for the *previous* note.
    // Use saveTargetRef (the path the current content belongs to) — NOT
    // selectedPathRef, which has already been updated to the new path by the
    // time this effect runs.
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      const prevPath = saveTargetRef.current;
      const c = contentRef.current;
      if (prevPath && prevPath !== selectedPath) void dms.writeFile(prevPath, c);
    }

    setSaveStatus("idle");

    let cancelled = false;
    dms.readFile(selectedPath).then((res) => {
      if (cancelled) return;
      // Advance saveTargetRef only after we know content for this path is loaded.
      saveTargetRef.current = selectedPath;
      setContent(res.ok && res.data?.content != null ? res.data.content : "");
    });
    return () => { cancelled = true; };
  }, [selectedPath]);

  // Auto-save: debounced 600 ms after last keystroke; refs keep the closure stable.
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus("saving");
    saveTimerRef.current = setTimeout(async () => {
      const path = selectedPathRef.current;
      if (!path) return;
      const res = await dms.writeFile(path, contentRef.current);
      setSaveStatus(res.ok ? "saved" : "error");
      if (res.ok) setTimeout(() => setSaveStatus((s) => (s === "saved" ? "idle" : s)), 2000);
    }, 600);
  }, []);

  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => { setContent(e.target.value); scheduleSave(); },
    [scheduleSave]
  );

  const createNote = useCallback(
    async (title: string, collection: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      const baseSlug = slugify(trimmed) || "note";
      const targetDir = collection ? `${notesDir}/${collection}` : notesDir;
      const existingNotes = collection
        ? (collections.find((c) => c.name === collection)?.notes ?? [])
        : rootNotes;
      const existingPaths = new Set(existingNotes.map((n) => n.path));
      let filePath = `${targetDir}/${baseSlug}.md`;
      if (existingPaths.has(filePath)) {
        let n = 2;
        while (existingPaths.has(`${targetDir}/${baseSlug}-${n}.md`)) n++;
        filePath = `${targetDir}/${baseSlug}-${n}.md`;
      }
      await dms.createDir(targetDir);
      const res = await dms.writeFile(filePath, `# ${trimmed}\n\n`);
      if (!res.ok) { console.error("[NotesView] Failed to create note:", res.error); return; }
      await loadNotes();
      setSelectedPath(filePath);
    },
    [notesDir, collections, rootNotes, loadNotes]
  );

  const commitNewNote = useCallback(async () => {
    const title = newNoteTitle.trim();
    setCreatingNote(false);
    setNewNoteTitle("");
    if (title) await createNote(title, newNoteCollection);
  }, [newNoteTitle, newNoteCollection, createNote]);

  const createCollection = useCallback(async () => {
    const name = newCollectionName.trim();
    setCreatingCollection(false);
    setNewCollectionName("");
    if (!name) return;
    await dms.createDir(`${notesDir}/${name}`);
    await loadNotes();
  }, [newCollectionName, notesDir, loadNotes]);

  const deleteNote = useCallback(
    async (path: string) => {
      setConfirmDeleteNote(null);
      const res = await dms.deleteFiles([path]);
      if (res.ok) {
        if (selectedPath === path) { setSelectedPath(null); setContent(""); }
        await loadNotes();
      } else {
        console.error("[NotesView] Delete note failed:", res.error);
      }
    },
    [selectedPath, loadNotes]
  );

  const deleteCollection = useCallback(
    async (group: CollectionGroup) => {
      setConfirmDeleteCol(null);
      const notePaths = group.notes.map((n) => n.path);
      if (notePaths.length > 0) await dms.deleteFiles(notePaths);
      await dms.deleteFiles([group.dirPath]).catch(() => {});
      if (selectedPath && group.notes.some((n) => n.path === selectedPath)) {
        setSelectedPath(null);
        setContent("");
      }
      await loadNotes();
    },
    [selectedPath, loadNotes]
  );

  const toggleCollapse = useCallback((name: string) => {
    setCollapsedCols((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  const preview = useMemo(() => renderMarkdown(content), [content]);
  const allCollectionNames = collections.map((c) => c.name);

  const renderNoteRow = (note: FsEntry, indent: boolean) => {
    const isSelected = note.path === selectedPath;
    const label = note.name.replace(/\.md$/, "");
    const isDeleting = confirmDeleteNote === note.path;

    if (isDeleting) {
      return (
        <div
          key={note.path}
          className={`flex items-center gap-1.5 py-2 bg-red-500/8 border-b border-red-500/15 ${indent ? "pl-6 pr-2" : "px-2"}`}
        >
          <span className="flex-1 text-[10px] text-red-600 dark:text-red-400 truncate">
            Delete &ldquo;{label}&rdquo;?
          </span>
          <button
            onClick={() => void deleteNote(note.path)}
            className="px-2 py-0.5 text-[10px] font-bold rounded bg-red-500 text-white hover:bg-red-600 transition-colors shrink-0"
          >{_("Yes")}</button>
          <button
            onClick={() => setConfirmDeleteNote(null)}
            className="px-2 py-0.5 text-[10px] rounded border border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] transition-colors shrink-0"
          >{_("No")}</button>
        </div>
      );
    }

    return (
      <div
        key={note.path}
        onClick={() => { setConfirmDeleteNote(null); setConfirmDeleteCol(null); setSelectedPath(note.path); }}
        className={[
          "group relative flex items-center gap-2 py-2 cursor-pointer transition-colors select-none",
          indent ? "pl-6 pr-3" : "px-3",
          isSelected
            ? "bg-[var(--theme-primary)] text-[var(--theme-primary-fg)]"
            : "hover:bg-[var(--theme-bg)] text-[var(--theme-text)]",
        ].join(" ")}
      >
        <div className="flex-1 min-w-0">
          <div className={`text-xs font-medium truncate ${isSelected ? "text-[var(--theme-primary-fg)]" : "text-[var(--theme-text)]"}`}>
            {label}
          </div>
          {note.modified != null && (
            <div className={`text-[10px] mt-0.5 ${isSelected ? "text-[var(--theme-primary-fg)]/70" : "text-[var(--theme-text-muted)]"}`}>
              {fmtDate(note.modified)}
            </div>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setConfirmDeleteNote(note.path); }}
          title={_("Delete note")}
          className={[
            "shrink-0 w-5 h-5 flex items-center justify-center rounded transition-all",
            isSelected
              ? "text-[var(--theme-primary-fg)]/60 hover:text-[var(--theme-primary-fg)] hover:bg-[var(--theme-primary-fg)]/20"
              : "text-[var(--theme-text-muted)] hover:text-red-500 hover:bg-red-500/10",
            isSelected
              ? "opacity-100"
              : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto",
          ].join(" ")}
        >
          <Icon name="trash" size="xs" />
        </button>
      </div>
    );
  };

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden bg-[var(--theme-bg)]">

      <div
        className="flex flex-col shrink-0 border-r border-[var(--theme-border)] bg-[var(--theme-surface)]"
        style={{ width: 240 }}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--theme-border)] shrink-0">
          <span className="text-[10px] font-black uppercase tracking-wider text-[var(--theme-text-muted)]">
            {_("Notes")}
          </span>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => { setConfirmDeleteNote(null); setConfirmDeleteCol(null); setCreatingCollection(true); setNewCollectionName(""); }}
              title={_("New collection")}
              className="w-6 h-6 flex items-center justify-center rounded transition-colors text-[var(--theme-text-muted)] hover:text-[var(--theme-primary)] hover:bg-[var(--theme-primary)]/10 active:scale-95"
            >
              <Icon name="folder" size="xs" />
            </button>
            <button
              onClick={() => { setConfirmDeleteNote(null); setConfirmDeleteCol(null); setCreatingNote(true); setNewNoteTitle(""); setNewNoteCollection(""); }}
              title={_("New note")}
              className="w-6 h-6 flex items-center justify-center rounded transition-colors text-[var(--theme-primary)] hover:bg-[var(--theme-primary)]/10 active:scale-95"
            >
              <Icon name="plus" size="xs" />
            </button>
          </div>
        </div>

        {creatingCollection && (
          <div className="px-2 pt-2 pb-1.5 border-b border-[var(--theme-border)] bg-[var(--theme-bg)] shrink-0">
            <div className="flex items-center gap-1 mb-1">
              <Icon name="folder" size="xs" className="text-[var(--theme-text-muted)] shrink-0" />
              <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">{_("New Collection")}</span>
            </div>
            <input
              autoFocus type="text" value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter")  void createCollection();
                if (e.key === "Escape") { setCreatingCollection(false); setNewCollectionName(""); }
              }}
              placeholder={_("Collection name…")}
              className="w-full bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-md px-2 py-1 text-xs text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]"
            />
            <div className="flex gap-1 mt-1.5">
              <button onClick={() => void createCollection()} disabled={!newCollectionName.trim()}
                className="flex-1 py-1 text-[10px] font-bold uppercase tracking-wider rounded bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] hover:opacity-90 disabled:opacity-40 transition-opacity">
                {_("Create")}
              </button>
              <button onClick={() => { setCreatingCollection(false); setNewCollectionName(""); }}
                className="flex-1 py-1 text-[10px] font-bold uppercase tracking-wider rounded bg-[var(--theme-border)] text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] transition-colors">
                {_("Cancel")}
              </button>
            </div>
          </div>
        )}

        {creatingNote && (
          <div className="px-2 pt-2 pb-1.5 border-b border-[var(--theme-border)] bg-[var(--theme-bg)] shrink-0">
            <input
              autoFocus type="text" value={newNoteTitle}
              onChange={(e) => setNewNoteTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter")  void commitNewNote();
                if (e.key === "Escape") { setCreatingNote(false); setNewNoteTitle(""); }
              }}
              placeholder={_("Note title…")}
              className="w-full bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-md px-2 py-1 text-xs text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)] mb-1.5"
            />
            {allCollectionNames.length > 0 && (
              <select
                value={newNoteCollection}
                onChange={(e) => setNewNoteCollection(e.target.value)}
                className="w-full bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-md px-2 py-1 text-xs text-[var(--theme-text)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)] mb-1.5"
              >
                <option value="">{_("(root — no collection)")}</option>
                {allCollectionNames.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            )}
            <div className="flex gap-1">
              <button onClick={() => void commitNewNote()} disabled={!newNoteTitle.trim()}
                className="flex-1 py-1 text-[10px] font-bold uppercase tracking-wider rounded bg-[var(--theme-primary)] text-[var(--theme-primary-fg)] hover:opacity-90 disabled:opacity-40 transition-opacity">
                {_("Create")}
              </button>
              <button onClick={() => { setCreatingNote(false); setNewNoteTitle(""); }}
                className="flex-1 py-1 text-[10px] font-bold uppercase tracking-wider rounded bg-[var(--theme-border)] text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] transition-colors">
                {_("Cancel")}
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {listLoading ? (
            <div className="flex items-center justify-center py-10">
              <span className="w-4 h-4 rounded-full border-2 animate-spin border-[var(--theme-primary)]/20 border-t-[var(--theme-primary)]" />
            </div>

          ) : (rootNotes.length === 0 && collections.length === 0) ? (
            <div className="flex flex-col items-center justify-center py-10 px-4 gap-2 text-center">
              <Icon name="file" size="md" className="opacity-20 text-[var(--theme-text)]" />
              <p className="text-[10px] leading-relaxed text-[var(--theme-text-muted)]">
                {_("No notes yet.")}<br />{_("Press ＋ to create one.")}
              </p>
            </div>

          ) : (
            <>
                {rootNotes.map((note) => renderNoteRow(note, false))}

                {collections.map((group) => {
                const isCollapsed  = collapsedCols.has(group.name);
                const isDeletingCol = confirmDeleteCol === group.name;
                return (
                  <div key={group.dirPath}>
                    {isDeletingCol ? (
                      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-red-500/8 border-y border-red-500/15">
                        <span className="flex-1 text-[10px] text-red-600 dark:text-red-400 truncate">
                          Delete &ldquo;{group.name}&rdquo; ({group.notes.length})?
                        </span>
                        <button onClick={() => void deleteCollection(group)}
                          className="px-2 py-0.5 text-[10px] font-bold rounded bg-red-500 text-white hover:bg-red-600 transition-colors shrink-0">{_("Yes")}</button>
                        <button onClick={() => setConfirmDeleteCol(null)}
                          className="px-2 py-0.5 text-[10px] rounded border border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] transition-colors shrink-0">{_("No")}</button>
                      </div>
                    ) : (
                      <div
                        className="group flex items-center gap-1.5 px-3 py-1.5 border-t border-[var(--theme-border)] bg-[var(--theme-surface)] cursor-pointer select-none hover:bg-[var(--theme-bg)] transition-colors"
                        onClick={() => toggleCollapse(group.name)}
                      >
                        <Icon name={isCollapsed ? "chevron-right" : "chevron-down"} size="xs" className="shrink-0 text-[var(--theme-text-muted)]" />
                        <Icon name="folder" size="xs" className="shrink-0 text-[var(--theme-text-muted)]" />
                        <span className="flex-1 text-[10px] font-bold uppercase tracking-wide text-[var(--theme-text-muted)] truncate">
                          {group.name}
                        </span>
                        <span className="text-[10px] text-[var(--theme-text-muted)] tabular-nums shrink-0">
                          {group.notes.length}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteCol(group.name); }}
                          title={_("Delete collection")}
                          className="shrink-0 w-4 h-4 flex items-center justify-center rounded transition-all text-[var(--theme-text-muted)] hover:text-red-500 hover:bg-red-500/10 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
                        >
                          <Icon name="trash" size="xs" />
                        </button>
                      </div>
                    )}
                    {!isCollapsed && (
                      group.notes.length === 0
                        ? <div className="pl-6 pr-3 py-2 text-[10px] text-[var(--theme-text-muted)] italic">{_("Empty collection")}</div>
                        : group.notes.map((note) => renderNoteRow(note, true))
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        {selectedPath == null ? (
          <div
            onClick={() => {
              setConfirmDeleteNote(null);
              setConfirmDeleteCol(null);
              setCreatingNote(true);
              setNewNoteTitle("");
              setNewNoteCollection("");
            }}
            className="flex flex-col items-center justify-center flex-1 gap-3 text-center p-8 cursor-pointer select-none group hover:bg-[var(--theme-primary)]/[0.03] transition-colors"
            title={_("Click to create a new note")}
          >
            <Icon
              name="edit"
              size="xl"
              className="opacity-20 group-hover:opacity-40 transition-opacity text-[var(--theme-text)]"
            />
            <p className="text-sm text-[var(--theme-text-muted)] group-hover:text-[var(--theme-primary)] transition-colors">
              {_("Click anywhere to create a new note")}
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-1 min-h-0 overflow-hidden">
              <div className="flex flex-col flex-1 min-w-0 border-r border-[var(--theme-border)]">
                <div className="shrink-0 px-3 py-1.5 border-b border-[var(--theme-border)] bg-[var(--theme-surface)] flex items-center gap-2">
                  <span className="flex-1 text-xs font-semibold truncate text-[var(--theme-text)]">
                    {selectedPath.split("/").pop()?.replace(/\.md$/, "") ?? ""}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] shrink-0">md</span>
                </div>
                <textarea
                  value={content}
                  onChange={handleContentChange}
                  spellCheck={false}
                  placeholder={_("Start writing…\n\nSupports **markdown**, `inline code`,\n```ascii\n┌─────┐\n│ art │\n└─────┘\n```\nand ![image](path)")}
                  className="flex-1 w-full resize-none outline-none font-mono text-sm leading-relaxed p-4 bg-[var(--theme-bg)] text-[var(--theme-text)] placeholder:text-[var(--theme-text-muted)]"
                />
              </div>

              <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
                <div className="shrink-0 px-3 py-1.5 border-b border-[var(--theme-border)] bg-[var(--theme-surface)]">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">{_("Preview")}</span>
                </div>
                <div
                  className="flex-1 overflow-y-auto p-4 text-sm text-[var(--theme-text)] leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: preview }}
                />
              </div>
            </div>

            <div
              className="shrink-0 flex items-center justify-end gap-2 px-4 py-1 border-t border-[var(--theme-border)] bg-[var(--theme-surface)]"
              style={{ minHeight: 28 }}
            >
              {saveStatus === "saving" && (
                <span className="flex items-center gap-1.5 text-[10px] text-[var(--theme-text-muted)]">
                    <span className="w-2.5 h-2.5 rounded-full border border-[var(--theme-primary)]/40 border-t-[var(--theme-primary)] animate-spin" />
                    {_("Saving…")}
                  </span>
              )}
              {saveStatus === "saved" && (
                <span className="flex items-center gap-1 text-[10px] text-green-500 font-medium">
                    <Icon name="check" size="xs" />{_("Saved")}
                  </span>
              )}
              {saveStatus === "error" && (
                <span className="text-[10px] font-medium text-red-500">{_("Save failed")}</span>
              )}
              {saveStatus === "idle" && (
                <span className="text-[10px] opacity-0 select-none" aria-hidden>&nbsp;</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default NotesView;
