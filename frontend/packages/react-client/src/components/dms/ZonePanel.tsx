import React, { useState, useEffect, useCallback } from "react";
import { useDms } from "../../store/dms-store";
import { dms } from "../../services/dms-service";
import type { ZoneHistoryItem } from "../../services/dms-service";

interface Props { onClose: () => void; }

// Network-path helpers

/** Schemes that require special resolution before use as a filesystem path. */
const NETWORK_SCHEMES = ["smb://", "afp://", "cifs://", "nfs://", "ftp://", "ftps://", "ssh://", "sftp://"];

function isNetworkPath(p: string): boolean {
  return NETWORK_SCHEMES.some(s => p.toLowerCase().startsWith(s));
}

/** Auto-suggest workspace path from source + name */
function suggestWorkspace(sourcePath: string, name: string): string {
  if (!sourcePath) return "";
  const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || "zone";
  return `${sourcePath.replace(/\/$/, "")}/.papiere/${slug}`;
}

const ZonePanel: React.FC<Props> = ({ onClose }) => {
  const { state, dispatch } = useDms();
  const [inPath,  setInPath]  = useState(state.zone?.in_path  ?? "");
  const [outPath, setOutPath] = useState(state.zone?.out_path ?? "");
  const [name,    setName]    = useState(state.zone?.name     ?? "");
  const [description,    setDescription]    = useState(state.zone?.description ?? "");
  const [taxonomyDomain, setTaxonomyDomain] = useState(state.zone?.taxonomy_domain ?? "General");
  const [autoWorkspace, setAutoWorkspace]   = useState(!state.zone);
  const [error,   setError]   = useState("");
  const [history, setHistory] = useState<ZoneHistoryItem[]>([]);

  // ── SMB / network-path state ───────────────────────────────────────────────
  const [inPathResolved,  setInPathResolved]  = useState<string>(""); // local path after resolving
  const [inNetworkStatus, setInNetworkStatus] = useState<"idle"|"resolving"|"mounted"|"unmounted">("idle");
  const [inMountHint,     setInMountHint]     = useState<string>("");
  const [inOpenUrl,       setInOpenUrl]       = useState<string>("");

  // ── Encryption state ───────────────────────────────────────────────────────
  const [existingIsEncrypted, setExistingIsEncrypted] = useState(false);
  const [keychainMissing,     setKeychainMissing]     = useState(false);
  const [encryptZone,     setEncryptZone]     = useState(false);
  const [password,        setPassword]        = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword,    setShowPassword]    = useState(false);

  useEffect(() => {
    dms.getZones().then((res) => {
      if (res.ok && res.data) setHistory(res.data);
    });
  }, []);

  // Auto-update workspace path as name / source changes (only when in auto mode)
  useEffect(() => {
    // Use resolved local path for workspace suggestion when available
    const base = inPathResolved || inPath;
    if (autoWorkspace && base && name) {
      setOutPath(suggestWorkspace(base, name));
    }
  }, [inPath, inPathResolved, name, autoWorkspace]);

  // Resolve network path when inPath changes to a URL
  const resolveInPath = useCallback(async (raw: string) => {
    if (!isNetworkPath(raw)) {
      setInPathResolved("");
      setInNetworkStatus("idle");
      return;
    }
    setInNetworkStatus("resolving");
    setInPathResolved("");
    const res = await dms.resolveNetworkPath(raw);
    if (!res.ok || !res.data) {
      setInNetworkStatus("unmounted");
      return;
    }
    if (res.data.mounted && res.data.resolved) {
      setInPathResolved(res.data.resolved);
      setInNetworkStatus("mounted");
    } else {
      setInNetworkStatus("unmounted");
      setInMountHint(res.data.mount_hint ?? "");
      setInOpenUrl(res.data.open_url ?? raw);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => resolveInPath(inPath), 400);
    return () => clearTimeout(t);
  }, [inPath, resolveInPath]);

  const apply = async () => {
    setError("");
    setKeychainMissing(false);
    const trimName = name.trim();
    // Use the local resolved path when the user typed/pasted a network URL
    const effectiveIn = (inPathResolved || inPath).trim();
    const trimOut  = outPath.trim();

    if (!effectiveIn) { setError("Source folder is required."); return; }
    if (!trimOut)     { setError("Workspace path is required."); return; }
    if (!trimName)    { setError("Zone name is required."); return; }

    if (isNetworkPath(inPath) && inNetworkStatus === "unmounted") {
      setError(
        `Network share is not mounted. ` +
        (inMountHint ? `Expected at ${inMountHint}. ` : "") +
        `Open Finder and connect to the server first.`
      );
      return;
    }

    // Validate encryption fields when the user opted in.
    if (encryptZone && !existingIsEncrypted) {
      if (!password)           { setError("Please enter a password for the encrypted zone."); return; }
      if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
      if (password !== confirmPassword) { setError("Passwords do not match."); return; }
    }

    const zone = {
      in_path:         effectiveIn,
      out_path:        trimOut,
      name:            trimName,
      description:     description.trim(),
      taxonomy_domain: taxonomyDomain.trim(),
    };

    // Auto-create workspace if missing
    const existsRes = await dms.pathExists(zone.out_path);
    if (existsRes.ok && existsRes.data && !existsRes.data.exists) {
      const mkRes = await dms.createDir(zone.out_path);
      if (!mkRes.ok) {
        setError(mkRes.error ?? `Could not create workspace: ${zone.out_path}`);
        return;
      }
    }

    const zonePassword =
      (encryptZone && !existingIsEncrypted && password) || (keychainMissing && password)
        ? password
        : undefined;

    await dms.upsertZone(
      zone.name, zone.in_path, zone.out_path,
      zone.description, zone.taxonomy_domain,
      zonePassword,
    );

    const openRes = await dms.openZoneDb(zone.name, zonePassword);
    if (!openRes.ok) {
      if (openRes.error === "__keychain_missing__") {
        setKeychainMissing(true);
        setError(
          "This zone\u2019s encryption key is not in your macOS Keychain. " +
          "Enter the zone password to unlock it and restore the key."
        );
        return;
      }
      setError(openRes.error ?? "Could not open zone database.");
      return;
    }

    dispatch({ type: "SET_ZONE", zone });
    onClose();
  };

  const pickSource = async () => {
    const res = await dms.selectDirectory();
    if (res.ok && res.data) {
      setInPath(res.data);
      setInPathResolved("");
      setInNetworkStatus("idle");
      if (autoWorkspace && name) setOutPath(suggestWorkspace(res.data, name));
    }
  };

  const pickWorkspace = async () => {
    const res = await dms.selectDirectory();
    if (res.ok && res.data) {
      setOutPath(res.data);
      setAutoWorkspace(false);
    }
  };

  /** Load a recent zone into the form fields. */
  const loadHistoryZone = (z: ZoneHistoryItem) => {
    setName(z.name);
    setInPath(z.in_path);
    setOutPath(z.out_path);
    setDescription(z.description || "");
    setTaxonomyDomain(z.taxonomy_domain || "General");
    setAutoWorkspace(false);
    // Reflect the encryption status of the loaded zone.
    const wasEncrypted = !!z.is_encrypted;
    setExistingIsEncrypted(wasEncrypted);
    setEncryptZone(wasEncrypted);   // show the badge if it was encrypted
    setPassword("");
    setConfirmPassword("");
  };

  const isEditing = !!state.zone;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded-2xl p-6 shadow-2xl">

        <h2 className="text-lg font-black text-[var(--theme-text)] mb-1">
          {isEditing ? "Edit Zone" : "New Zone"}
        </h2>
        <p className="text-[var(--theme-text-muted)] text-xs mb-5">
          A Zone is a project workspace. Choose a <strong>source folder</strong> to browse &amp;
          index, and a <strong>workspace</strong> where Syngrafo stores its index and processed files.
        </p>

        {/* Recent zones */}
        {history.length > 0 && (
          <div className="mb-5">
            <span className="text-[10px] font-semibold text-[var(--theme-text-muted)] uppercase tracking-wider block mb-2">
              Recent zones
            </span>
            <div className="flex flex-wrap gap-1.5">
              {history.map((z) => (
                  <button
                    key={z.name}
                    onClick={() => loadHistoryZone(z)}
                  className="text-xs px-2 py-1 rounded-md bg-[var(--theme-bg)] hover:bg-[var(--theme-surface)] text-[var(--theme-text)] border border-[var(--theme-border)] transition-colors flex items-center gap-1"
                >
                  {z.is_encrypted && (
                    <svg className="w-2.5 h-2.5 opacity-60" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                  )}
                  {z.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Zone name */}
        <label className="block mb-4">
          <span className="text-xs font-semibold text-[var(--theme-text-muted)] uppercase tracking-wider">
            Zone name
          </span>
          <input
            className="mt-1 w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg px-3 py-2 text-sm text-[var(--theme-text)] placeholder-[var(--theme-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]"
            placeholder="e.g. Tax 2024, Work Projects, Photography…"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </label>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <label className="block">
            <span className="text-xs font-semibold text-[var(--theme-text-muted)] uppercase tracking-wider">Category</span>
            <select
              className="mt-1 w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg px-3 py-2 text-sm text-[var(--theme-text)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]"
              value={taxonomyDomain}
              onChange={e => setTaxonomyDomain(e.target.value)}
            >
              <option value="General">General</option>
              <option value="Finance">Finance</option>
              <option value="Legal">Legal</option>
              <option value="Medical">Medical</option>
              <option value="Personal">Personal</option>
              <option value="Work">Work</option>
              <option value="Botany">Botany</option>
              <option value="Computer Science">Computer Science</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-[var(--theme-text-muted)] uppercase tracking-wider">Description</span>
            <input
              className="mt-1 w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg px-3 py-2 text-sm text-[var(--theme-text)] placeholder-[var(--theme-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]"
              placeholder="Optional short description"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </label>
        </div>

        {/* Source folder */}
        <label className="block mb-4">
          <span className="text-xs font-semibold text-[var(--theme-text-muted)] uppercase tracking-wider">
            Source folder
            <span className="normal-case font-normal text-[var(--theme-text-muted)] ml-1">— your original documents</span>
          </span>
          <div className="flex gap-2 mt-1">
            <input
              className="flex-1 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--theme-text)] placeholder-[var(--theme-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]"
              placeholder="/Users/you/Documents  or  smb://nas/share/folder"
              value={inPath}
              onChange={e => setInPath(e.target.value)}
            />
            <button
              onClick={pickSource}
              className="px-3 py-2 bg-[var(--theme-border)] hover:bg-[var(--theme-bg)] text-[var(--theme-text)] rounded-lg text-xs shrink-0 transition-colors"
            >
              Browse
            </button>
          </div>
          {/* Network-path status strip */}
          {inNetworkStatus === "resolving" && (
            <p className="mt-1 text-[10px] text-[var(--theme-text-muted)] flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-yellow-400/80 animate-pulse" />
              Checking mount…
            </p>
          )}
          {inNetworkStatus === "mounted" && (
            <p className="mt-1 text-[10px] text-emerald-400 flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
              Mounted → <span className="font-mono truncate max-w-xs">{inPathResolved}</span>
            </p>
          )}
          {inNetworkStatus === "unmounted" && (
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <p className="text-[10px] text-amber-400 flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
                Share not mounted
                {inMountHint && <span className="text-[var(--theme-text-muted)]"> — expected at <span className="font-mono">{inMountHint}</span></span>}
              </p>
              {inOpenUrl && (
                <button
                  type="button"
                  onClick={() => window.open(inOpenUrl)}
                  className="text-[10px] px-2 py-0.5 rounded bg-[var(--theme-border)] hover:bg-[var(--theme-surface)] text-[var(--theme-text)] transition-colors"
                >
                  Mount in Finder…
                </button>
              )}
            </div>
          )}
        </label>

        {/* Workspace */}
        <label className="block mb-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--theme-text-muted)] uppercase tracking-wider">
              Workspace
              <span className="normal-case font-normal text-[var(--theme-text-muted)] ml-1">— Syngrafo index &amp; processed files</span>
            </span>
            {autoWorkspace && (
              <span className="text-[9px] text-[var(--theme-primary)] font-bold uppercase tracking-wider">auto</span>
            )}
          </div>
          <div className="flex gap-2 mt-1">
            <input
              className="flex-1 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--theme-text)] placeholder-[var(--theme-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]"
              placeholder="/Users/you/Documents/Projects/.papiere/my-zone"
              value={outPath}
              onChange={e => { setOutPath(e.target.value); setAutoWorkspace(false); }}
            />
            <button
              onClick={pickWorkspace}
              className="px-3 py-2 bg-[var(--theme-border)] hover:bg-[var(--theme-bg)] text-[var(--theme-text)] rounded-lg text-xs shrink-0 transition-colors"
            >
              Browse
            </button>
          </div>
          <p className="mt-1 text-[10px] text-[var(--theme-text-muted)]">
            Syngrafo creates this folder if it doesn't exist. Leave auto-generated or choose your own.
          </p>
        </label>

        {/* ── Encryption ────────────────────────────────────────────────────── */}
        <div className="mb-5">
          {existingIsEncrypted ? (
            // Already-encrypted zone — show a read-only badge.
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
              <svg className="w-3.5 h-3.5 text-emerald-400 shrink-0" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <p className="text-[11px] text-emerald-400 font-semibold">
                Zone is encrypted (AES-256)
              </p>
              <p className="text-[10px] text-[var(--theme-text-muted)] ml-auto">
                Key in macOS Keychain
              </p>
            </div>
          ) : (
            // New or plain zone — show the encryption toggle.
            <>
              <label className="flex items-center gap-3 cursor-pointer select-none">
                {/* Toggle switch */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={encryptZone}
                  onClick={() => { setEncryptZone(v => !v); setPassword(""); setConfirmPassword(""); }}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                    encryptZone ? "bg-emerald-500" : "bg-[var(--theme-border)]"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                      encryptZone ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
                <span className="text-xs font-semibold text-[var(--theme-text-muted)] uppercase tracking-wider">
                  Encrypt zone database
                </span>
                {encryptZone && (
                  <svg className="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                )}
              </label>

              {(encryptZone || keychainMissing) && (
                <div className="mt-3 space-y-3 pl-12">
                  {keychainMissing && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                      <svg className="w-3 h-3 text-amber-400 shrink-0" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                        <line x1="12" y1="9" x2="12" y2="13"/>
                        <line x1="12" y1="17" x2="12.01" y2="17"/>
                      </svg>
                      <p className="text-[10px] text-amber-400">
                        Key not found in Keychain — enter password to restore access.
                      </p>
                    </div>
                  )}

                  {/* Password */}
                  <label className="block">
                    <span className="text-[10px] font-semibold text-[var(--theme-text-muted)] uppercase tracking-wider">
                      {keychainMissing ? "Zone password" : "Password"}
                    </span>
                    <div className="flex gap-1.5 mt-1">
                      <input
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        className="flex-1 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg px-3 py-2 text-sm text-[var(--theme-text)] placeholder-[var(--theme-text-muted)] focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        placeholder={keychainMissing ? "Enter zone password" : "Min. 8 characters"}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(v => !v)}
                        className="px-2.5 py-2 rounded-lg bg-[var(--theme-border)] hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)] transition-colors text-[10px]"
                        title={showPassword ? "Hide" : "Show"}
                      >
                        {showPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                  </label>

                  {!keychainMissing && (
                    /* Confirm password — only for new zone creation */
                    <label className="block">
                      <span className="text-[10px] font-semibold text-[var(--theme-text-muted)] uppercase tracking-wider">
                        Confirm password
                      </span>
                      <input
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        className={`mt-1 w-full bg-[var(--theme-bg)] border rounded-lg px-3 py-2 text-sm text-[var(--theme-text)] placeholder-[var(--theme-text-muted)] focus:outline-none focus:ring-1 ${
                          confirmPassword && confirmPassword !== password
                            ? "border-red-500/60 focus:ring-red-500"
                            : confirmPassword && confirmPassword === password
                            ? "border-emerald-500/60 focus:ring-emerald-500"
                            : "border-[var(--theme-border)] focus:ring-emerald-500"
                        }`}
                        placeholder="Re-enter password"
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                      />
                      {confirmPassword && confirmPassword !== password && (
                        <p className="mt-1 text-[10px] text-red-400">Passwords do not match.</p>
                      )}
                    </label>
                  )}

                  <p className="text-[10px] text-[var(--theme-text-muted)] leading-relaxed">
                    {keychainMissing
                      ? "The key will be re-derived and stored back in your macOS Keychain."
                      : "AES-256 via SQLCipher. The derived key is stored in your macOS Keychain, not in the database."}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {error && (
          <p className="text-[var(--theme-danger)] text-xs mb-4">{error}</p>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[var(--theme-bg)] hover:bg-[var(--theme-surface)] text-[var(--theme-text)] border border-[var(--theme-border)] rounded-lg text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={apply}
            className="px-4 py-2 bg-[var(--theme-primary)] hover:opacity-90 text-[var(--theme-primary-fg)] rounded-lg text-sm font-bold transition-colors"
          >
            {isEditing ? "Save Changes" : "Create Zone"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ZonePanel;
