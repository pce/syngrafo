/**
 * settings-store.tsx — App-level preference context.
 *
 * Persists to localStorage immediately; optionally syncs to the app DB via
 * dms.savePreference / dms.loadPreference (same pattern as theme-store).
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { dms } from "../services/dms-service";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AppSettings {
  /**
   * Maximum SVG file size (in bytes) to render inline in the DocumentViewer.
   * SVGs larger than this threshold show a placeholder instead of inline markup.
   * Default: 10 485 760 (10 MB).
   */
  svgPreviewMaxBytes: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  svgPreviewMaxBytes: 10 * 1024 * 1024, // 10 MB
};

const SETTINGS_KEY = "syngrafo_settings";

// ── Context ───────────────────────────────────────────────────────────────────

interface SettingsCtx {
  settings:     AppSettings;
  setSetting:   (partial: Partial<AppSettings>) => void;
  saveSettings: () => Promise<void>;
  isSaving:     boolean;
}

const SettingsContext = createContext<SettingsCtx | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettingsState] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return DEFAULT_SETTINGS;
  });
  const [isSaving, setIsSaving] = useState(false);

  // On first mount, load from DB (may override localStorage value).
  useEffect(() => {
    dms.loadPreference(SETTINGS_KEY).then((val) => {
      if (!val) return;
      try {
        const stored = JSON.parse(val) as Partial<AppSettings>;
        setSettingsState((prev) => ({ ...prev, ...stored }));
      } catch { /* ignore */ }
    });
  }, []);

  const setSetting = useCallback((partial: Partial<AppSettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...partial };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const saveSettings = useCallback(async () => {
    setIsSaving(true);
    try {
      await dms.savePreference(SETTINGS_KEY, JSON.stringify(settings));
    } finally {
      setIsSaving(false);
    }
  }, [settings]);

  const ctx = useMemo<SettingsCtx>(
    () => ({ settings, setSetting, saveSettings, isSaving }),
    [settings, setSetting, saveSettings, isSaving],
  );

  return (
    <SettingsContext.Provider value={ctx}>{children}</SettingsContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSettings(): SettingsCtx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside <SettingsProvider>");
  return ctx;
}
