/**
 * FileOpDialogs.tsx — suite of file-operation dialogs.
 *
 * Exports
 * ───────
 * CopyMoveDialog  — dual-panel copy/move with conflict options
 * DeleteDialog    — confirm deletion
 * ShareDialog     — native share or clipboard fallback
 * CompressDialog  — single-file compression (gz / bz2 / zst)
 * ArchiveDialog   — multi-file archive (zip / tar.gz / tar.bz2 / tar.zst)
 *
 * All dialogs accept an `onClose` and `onSuccess` callback.
 * Operations call C++ bindings through dms-service; when the binding is absent
 * (running in a browser) a friendly "not connected" message is shown.
 */

import React, { useState, useEffect } from "react";
import { useLingui } from "@lingui/react";
import { dms }  from "../../services/dms-service";
import { Icon }   from "../Icon";



const ModalShell: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
}> = ({ title, onClose, children, width = "max-w-lg" }) => {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className={`w-full ${width} mx-4 bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-2xl shadow-2xl overflow-hidden`}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--theme-border)]">
          <h2 className="flex-1 text-sm font-black text-[var(--theme-text)]">{title}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)] transition-colors"
          >
            <Icon name="close" size="xs" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

const PathInput: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBrowse?: () => void;
  readOnly?: boolean;
}> = ({ label, value, onChange, onBrowse, readOnly }) => {
  const { _ } = useLingui();
  return (
  <div className="flex flex-col gap-1">
    <label className="text-[9px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)]">
      {label}
    </label>
    <div className="flex gap-1">
      <input
        type="text"
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 text-xs font-mono bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg px-2 py-1.5 text-[var(--theme-text)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]"
        spellCheck={false}
      />
      {onBrowse && (
        <button
          type="button"
          onClick={onBrowse}
          title={_("Browse")}
          className="px-2 py-1 rounded-lg border border-[var(--theme-border)] hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)] transition-colors"
        >
          <Icon name="folder-open" size="xs" />
        </button>
      )}
    </div>
  </div>
  );
};

interface StatusMsg {
  kind: "error" | "success" | "info";
  text: string;
}

function StatusBar({ msg }: { msg: StatusMsg | null }) {
  if (!msg) return null;
  const colors = {
    error:   "bg-rose-500/10 text-rose-500 border-rose-500/20",
    success: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    info:    "bg-blue-500/10 text-blue-500 border-blue-500/20",
  };
  return (
    <div className={`mx-4 mb-2 px-3 py-2 rounded-lg border text-xs ${colors[msg.kind]}`}>
      {msg.text}
    </div>
  );
}

function FileList({ paths }: { paths: string[] }) {
  return (
    <ul className="max-h-40 overflow-y-auto space-y-0.5">
      {paths.map((p) => {
        const name = p.split("/").pop() ?? p;
        return (
          <li key={p} className="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-[var(--theme-bg)]">
            <Icon name="file" size="xs" className="text-[var(--theme-text-muted)] shrink-0" />
            <span className="text-[10px] font-mono text-[var(--theme-text)] truncate" title={p}>{name}</span>
          </li>
        );
      })}
    </ul>
  );
}

export interface CopyMoveDialogProps {
  op: "copy" | "move";
  sources: string[];
  defaultDest?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export const CopyMoveDialog: React.FC<CopyMoveDialogProps> = ({
  op,
  sources,
  defaultDest = "",
  onClose,
  onSuccess,
}) => {
  const [dest, setDest]             = useState(defaultDest);
  const [conflict, setConflict]     = useState<"keep" | "replace" | "skip">("keep");
  const [busy, setBusy]             = useState(false);
  const [status, setStatus]         = useState<StatusMsg | null>(null);
  const { _ } = useLingui();

  const browse = async () => {
    const res = await dms.selectDirectory();
    if (res.ok && res.data) setDest(res.data);
  };

  const execute = async () => {
    if (!dest.trim()) { setStatus({ kind: "error", text: _("Destination path is required.") }); return; }
    setBusy(true);
    setStatus(null);

    const res = op === "copy"
      ? await dms.copyFiles(sources, dest, conflict)
      : await dms.moveFiles(sources, dest, conflict);

    setBusy(false);

    if (!res.ok) {
      setStatus({ kind: "error", text: res.error ?? `${op} failed` });
      return;
    }

    const d = res.data as { copied?: number; moved?: number; skipped: number; errors: string[] };
    const done = d.copied ?? d.moved ?? 0;
    if (d.errors?.length) {
      setStatus({ kind: "error", text: `Completed with errors: ${d.errors.join(", ")}` });
    } else {
      setStatus({ kind: "success", text: `${op === "copy" ? "Copied" : "Moved"} ${done} item${done !== 1 ? "s" : ""} successfully.` });
      setTimeout(() => { onSuccess(); onClose(); }, 900);
    }
  };

    const title = op === "copy" ? _("Copy Files") : _("Move Files");
    const accentColor = op === "copy" ? "bg-blue-500 hover:bg-blue-600" : "bg-amber-500 hover:bg-amber-600";

  return (
    <ModalShell title={title} onClose={onClose}>
      <div className="px-4 py-3 space-y-3">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)] mb-1">
            {sources.length} item{sources.length !== 1 ? "s" : ""} to {op}
          </p>
          <div className="bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-2">
            <FileList paths={sources} />
          </div>
        </div>

        <div className="flex items-center gap-2 text-[var(--theme-text-muted)]">
          <div className="flex-1 h-px bg-[var(--theme-border)]" />
          <Icon name="arrow-right" size="xs" />
          <div className="flex-1 h-px bg-[var(--theme-border)]" />
        </div>

        <PathInput
          label={_("Destination directory")}
          value={dest}
          onChange={setDest}
          onBrowse={browse}
        />

        <div className="mt-2">
          <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)] mb-1.5">
            {_("If file exists")}
          </p>
          <div className="flex gap-2">
            {(["keep", "replace", "skip"] as const).map((opt) => (
              <label key={opt} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="conflict"
                  value={opt}
                  checked={conflict === opt}
                  onChange={() => setConflict(opt)}
                  className="accent-[var(--theme-primary)]"
                />
                <span className="text-xs capitalize text-[var(--theme-text)]">
                  {opt === "keep" ? _("Keep both") : opt === "replace" ? _("Replace") : _("Skip")}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <StatusBar msg={status} />

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--theme-border)]">
        <button
          onClick={onClose}
          disabled={busy}
          className="px-4 py-1.5 text-xs font-bold rounded-lg border border-[var(--theme-border)] text-[var(--theme-text)] hover:bg-[var(--theme-bg)] transition-colors"
        >
          {_("Cancel")}
        </button>
        <button
          onClick={execute}
          disabled={busy || !dest.trim()}
          className={`px-4 py-1.5 text-xs font-bold rounded-lg ${accentColor} text-white disabled:opacity-40 transition-colors flex items-center gap-1.5`}
        >
          {busy && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {op === "copy" ? _("Copy") : _("Move")} {sources.length}{" "}{sources.length !== 1 ? _("items") : _("item")}
        </button>
      </div>
    </ModalShell>
  );
};

export interface DeleteDialogProps {
  paths: string[];
  onClose: () => void;
  onSuccess: () => void;
}

export const DeleteDialog: React.FC<DeleteDialogProps> = ({ paths, onClose, onSuccess }) => {
  const [busy, setBusy]     = useState(false);
  const [status, setStatus] = useState<StatusMsg | null>(null);
  const { _ } = useLingui();

  const execute = async () => {
    setBusy(true);
    setStatus(null);
    const res = await dms.deleteFiles(paths);
    setBusy(false);

    if (!res.ok) {
      setStatus({ kind: "error", text: res.error ?? "Delete failed" });
      return;
    }

    const d = res.data as { deleted: number; errors: string[] };
    if (d.errors?.length) {
      setStatus({ kind: "error", text: `Errors: ${d.errors.join(", ")}` });
    } else {
      setStatus({ kind: "success", text: `Deleted ${d.deleted} item${d.deleted !== 1 ? "s" : ""}.` });
      setTimeout(() => { onSuccess(); onClose(); }, 700);
    }
  };

  return (
    <ModalShell title={_("Delete Files")} onClose={onClose} width="max-w-md">
      <div className="px-4 py-3 space-y-3">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20">
          <Icon name="warning" size="sm" className="text-rose-500 shrink-0 mt-0.5" />
          <p className="text-xs text-rose-600 dark:text-rose-400">
            This will permanently delete <strong>{paths.length}</strong> item{paths.length !== 1 ? "s" : ""}.
            This action cannot be undone.
          </p>
        </div>

        <div className="bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-2">
          <FileList paths={paths} />
        </div>
      </div>

      <StatusBar msg={status} />

      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--theme-border)]">
        <button
          onClick={onClose}
          disabled={busy}
          className="px-4 py-1.5 text-xs font-bold rounded-lg border border-[var(--theme-border)] text-[var(--theme-text)] hover:bg-[var(--theme-bg)] transition-colors"
        >
          {_("Cancel")}
        </button>
        <button
          onClick={execute}
          disabled={busy}
          className="px-4 py-1.5 text-xs font-bold rounded-lg bg-rose-500 hover:bg-rose-600 text-white disabled:opacity-40 transition-colors flex items-center gap-1.5"
        >
          {busy && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {_("Delete")} {paths.length}{" "}{paths.length !== 1 ? _("items") : _("item")}
        </button>
      </div>
    </ModalShell>
  );
};

export interface ShareDialogProps {
  path: string;
  onClose: () => void;
}

export const ShareDialog: React.FC<ShareDialogProps> = ({ path, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<StatusMsg | null>(null);
  const { _ } = useLingui();

  const filename = path.split("/").pop() ?? path;

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      setStatus({ kind: "success", text: _("Path copied to clipboard.") });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setStatus({ kind: "error", text: _("Clipboard not available.") });
    }
  };

  const nativeShare = async () => {
    // Try C++ native share first
    const res = await dms.shareFile(path);
    if (res.ok) return;
    // Fallback: Web Share API (may not be available in webview)
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: filename, text: path });
      } catch {
        await copyPath();
      }
    } else {
      await copyPath();
    }
  };

  return (
    <ModalShell title={_("Share File")} onClose={onClose} width="max-w-sm">
      <div className="px-4 py-3 space-y-3">
        <div className="flex items-center gap-2 px-2 py-1.5 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg">
          <Icon name="file" size="xs" className="text-[var(--theme-text-muted)] shrink-0" />
          <span className="text-xs font-mono text-[var(--theme-text)] truncate flex-1" title={path}>
            {filename}
          </span>
        </div>

        <p className="text-[10px] text-[var(--theme-text-muted)] font-mono break-all">{path}</p>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={nativeShare}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--theme-primary)] hover:opacity-90 text-[var(--theme-primary-fg)] text-xs font-bold transition-colors"
          >
            <Icon name="share" size="xs" />
            {_("Share")}
          </button>
          <button
            onClick={copyPath}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--theme-border)] text-xs font-bold transition-colors ${
              copied ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-500" : "hover:bg-[var(--theme-bg)] text-[var(--theme-text)]"
            }`}
          >
            <Icon name={copied ? "check" : "copy"} size="xs" />
            {copied ? _("Copied!") : _("Copy path")}
          </button>
        </div>
      </div>

      <StatusBar msg={status} />

      <div className="flex justify-end px-4 py-3 border-t border-[var(--theme-border)]">
        <button
          onClick={onClose}
          className="px-4 py-1.5 text-xs font-bold rounded-lg border border-[var(--theme-border)] text-[var(--theme-text)] hover:bg-[var(--theme-bg)] transition-colors"
        >
          {_("Close")}
        </button>
      </div>
    </ModalShell>
  );
};

export interface CompressDialogProps {
  paths: string[];
  onClose: () => void;
  onSuccess: () => void;
}

type CompressFormat = "gz" | "bz2" | "zst";

export const CompressDialog: React.FC<CompressDialogProps> = ({ paths, onClose, onSuccess }) => {
  const [format, setFormat]           = useState<CompressFormat>("gz");
  const [level, setLevel]             = useState(6);
  const [deleteOriginals, setDelete]  = useState(false);
  const [busy, setBusy]               = useState(false);
  const [status, setStatus]           = useState<StatusMsg | null>(null);
  const { _ } = useLingui();

  const execute = async () => {
    setBusy(true);
    setStatus(null);

    let errCount = 0;
    for (const src of paths) {
      const dest = `${src}.${format}`;
      const res = await dms.compressFile(src, dest, format, level);
      if (!res.ok) { errCount++; setStatus({ kind: "error", text: res.error ?? "Compression failed" }); }
    }

    setBusy(false);
    if (errCount === 0) {
      setStatus({ kind: "success", text: `Compressed ${paths.length} file${paths.length !== 1 ? "s" : ""}.` });
      setTimeout(() => { onSuccess(); onClose(); }, 800);
    }
  };

  const formatInfo: Record<CompressFormat, string> = {
    gz:  "GZIP — fast, wide support",
    bz2: "BZIP2 — slower, better ratio",
    zst: "ZSTD — fastest + best ratio (modern)",
  };

  return (
    <ModalShell title={_("Compress Files")} onClose={onClose} width="max-w-md">
      <div className="px-4 py-3 space-y-3">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)] mb-1.5">
            {_("Format")}
          </p>
          <div className="space-y-1">
            {(["gz", "bz2", "zst"] as CompressFormat[]).map((f) => (
              <label key={f} className="flex items-center gap-2.5 p-2 rounded-lg cursor-pointer hover:bg-[var(--theme-bg)] transition-colors">
                <input
                  type="radio"
                  name="fmt"
                  value={f}
                  checked={format === f}
                  onChange={() => setFormat(f)}
                  className="accent-[var(--theme-primary)]"
                />
                <div>
                  <span className="text-xs font-bold text-[var(--theme-text)] uppercase mr-2">.{f}</span>
                  <span className="text-[10px] text-[var(--theme-text-muted)]">{formatInfo[f]}</span>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="flex justify-between mb-1">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)]">
              {_("Level")}
            </p>
            <span className="text-[9px] font-mono text-[var(--theme-text-muted)]">{level}</span>
          </div>
          <input
            type="range" min={1} max={9} value={level}
            onChange={(e) => setLevel(Number(e.target.value))}
            className="w-full accent-[var(--theme-primary)]"
          />
          <div className="flex justify-between text-[9px] text-[var(--theme-text-muted)]">
            <span>{_("1 — fastest")}</span>
            <span>{_("9 — smallest")}</span>
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={deleteOriginals}
            onChange={(e) => setDelete(e.target.checked)}
            className="accent-[var(--theme-primary)]"
          />
          <span className="text-xs text-[var(--theme-text)]">{_("Delete originals after compression")}</span>
        </label>

        <div className="bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-2">
          <FileList paths={paths} />
        </div>
      </div>

      <StatusBar msg={status} />

      <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--theme-border)]">
        <button onClick={onClose} disabled={busy} className="px-4 py-1.5 text-xs font-bold rounded-lg border border-[var(--theme-border)] text-[var(--theme-text)] hover:bg-[var(--theme-bg)] transition-colors">
          {_("Cancel")}
        </button>
        <button
          onClick={execute}
          disabled={busy}
          className="px-4 py-1.5 text-xs font-bold rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-40 transition-colors flex items-center gap-1.5"
        >
          {busy && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {_("Compress")}
        </button>
      </div>
    </ModalShell>
  );
};

export interface ArchiveDialogProps {
  paths: string[];
  defaultDestDir?: string;
  onClose: () => void;
  onSuccess: () => void;
}

type ArchiveFormat = "zip" | "tar.gz" | "tar.bz2" | "tar.zst";

function suggestArchiveName(paths: string[]): string {
  if (paths.length === 1) {
    const first = paths[0];
    const name = first ? (first.split("/").pop() ?? "archive") : "archive";
    return name.replace(/\.\w{1,6}$/, "");
  }
  const first = paths[0];
  const parent = first ? first.split("/").slice(0, -1).join("/") : "";
  return (parent.split("/").pop() ?? "archive");
}

export const ArchiveDialog: React.FC<ArchiveDialogProps> = ({
  paths,
  defaultDestDir = "",
  onClose,
  onSuccess,
}) => {
  const [format, setFormat]   = useState<ArchiveFormat>("zip");
  const [name, setName]       = useState(suggestArchiveName(paths));
  const [destDir, setDestDir] = useState(
    defaultDestDir || (paths[0]?.split("/").slice(0, -1).join("/") ?? ""),
  );
  const [busy, setBusy]       = useState(false);
  const [status, setStatus]   = useState<StatusMsg | null>(null);
  const { _ } = useLingui();

  const browse = async () => {
    const res = await dms.selectDirectory();
    if (res.ok && res.data) setDestDir(res.data);
  };

  const execute = async () => {
    if (!name.trim()) { setStatus({ kind: "error", text: _("Archive name is required.") }); return; }
    if (!destDir.trim()) { setStatus({ kind: "error", text: _("Destination directory is required.") }); return; }

    setBusy(true);
    setStatus(null);

    const ext = format === "zip" ? ".zip" : format === "tar.gz" ? ".tar.gz" : format === "tar.bz2" ? ".tar.bz2" : ".tar.zst";
    const destPath = `${destDir.replace(/\/$/, "")}/${name}${ext}`;
    const res = await dms.createArchive(paths, destPath, format);
    setBusy(false);

    if (!res.ok) {
      setStatus({ kind: "error", text: res.error ?? "Archive creation failed" });
      return;
    }

    const sz = res.data?.sizeBytes ?? 0;
    const szStr = sz < 1_048_576 ? `${(sz / 1024).toFixed(1)} KB` : `${(sz / 1_048_576).toFixed(1)} MB`;
    setStatus({ kind: "success", text: `Archive created (${szStr}).` });
    setTimeout(() => { onSuccess(); onClose(); }, 900);
  };

  const formatInfo: Record<ArchiveFormat, string> = {
    "zip":     "ZIP — universal, random access",
    "tar.gz":  "TAR+GZIP — Unix standard",
    "tar.bz2": "TAR+BZIP2 — better compression",
    "tar.zst": "TAR+ZSTD — fastest + best ratio",
  };

  return (
    <ModalShell title={_("Create Archive")} onClose={onClose} width="max-w-lg">
      <div className="px-4 py-3 space-y-3">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)] mb-1.5">
            {_("Format")}
          </p>
          <div className="grid grid-cols-2 gap-1">
            {(["zip", "tar.gz", "tar.bz2", "tar.zst"] as ArchiveFormat[]).map((f) => (
              <label
                key={f}
                className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer border transition-colors ${
                  format === f
                    ? "border-[var(--theme-primary)] bg-[var(--theme-primary)]/10"
                    : "border-[var(--theme-border)] hover:bg-[var(--theme-bg)]"
                }`}
              >
                <input
                  type="radio" name="archfmt" value={f}
                  checked={format === f} onChange={() => setFormat(f)}
                  className="accent-[var(--theme-primary)]"
                />
                <div>
                  <span className="text-[10px] font-bold text-[var(--theme-text)]">.{f}</span>
                  <p className="text-[9px] text-[var(--theme-text-muted)] leading-tight">{formatInfo[f]}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        <PathInput label={_("Archive name (no extension)")} value={name} onChange={setName} />

        <PathInput label={_("Save to directory")} value={destDir} onChange={setDestDir} onBrowse={browse} />

        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)] mb-1">
            {paths.length}{" "}{paths.length !== 1 ? _("items") : _("item")}{" "}{_("to archive")}
          </p>
          <div className="bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg p-2">
            <FileList paths={paths} />
          </div>
        </div>
      </div>

      <StatusBar msg={status} />

      <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--theme-border)]">
        <button onClick={onClose} disabled={busy} className="px-4 py-1.5 text-xs font-bold rounded-lg border border-[var(--theme-border)] text-[var(--theme-text)] hover:bg-[var(--theme-bg)] transition-colors">
          {_("Cancel")}
        </button>
        <button
          onClick={execute}
          disabled={busy || !name.trim() || !destDir.trim()}
          className="px-4 py-1.5 text-xs font-bold rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white disabled:opacity-40 transition-colors flex items-center gap-1.5"
        >
          {busy && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          <Icon name="archive" size="xs" />
          {_("Create Archive")}
        </button>
      </div>
    </ModalShell>
  );
};
