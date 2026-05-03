/**
 * settings-store.tsx — App-level preference context.
 *
 * Persists to the global SQLite DB via dms.savePreference / dms.loadPreference.
 * No localStorage / IndexedDB is used — the DB is the single source of truth.
 *
 * Locale is a setting: changing it activates the Lingui catalog immediately
 * (all catalogs are pre-loaded at startup so switching is instant) and
 * persists alongside the other settings.
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
import {
  loadCatalog,
  detectLocale,
  LOCALES,
  type SupportedLocale,
} from "../i18n";


export interface AppSettings {
  /**
   * Maximum SVG file size (in bytes) to render inline in the DocumentViewer.
   * SVGs larger than this threshold show a placeholder instead of inline markup.
   * Default: 10 485 760 (10 MB).
   */
  svgPreviewMaxBytes: number;

  /**
   * When true, closing the main window hides it to the system tray instead of
   * quitting the app. Use the tray icon or "Quit" menu item to exit fully.
   * Default: true.
   */
  closeToSystray: boolean;

  /**
   * When true, the app checks for updates on startup and offers to install them.
   * Default: true.
   */
  autoUpdate: boolean;

  /**
   * Active UI locale. All Lingui catalogs are pre-loaded; switching is instant.
   * Default: detected from navigator.languages, falls back to "en".
   */
  locale: SupportedLocale;
}

export const DEFAULT_SETTINGS: AppSettings = {
  svgPreviewMaxBytes: 10 * 1024 * 1024, // 10 MB
  closeToSystray:     true,
  autoUpdate:         true,
  locale:             detectLocale(),
};

const SETTINGS_KEY = "syngrafo_settings";


interface SettingsCtx {
  settings:        AppSettings;
  /** True until the initial DB load has completed (prevents flash of default locale). */
  settingsLoaded:  boolean;
  setSetting:      (partial: Partial<AppSettings>) => void;
  saveSettings:    () => Promise<void>;
  isSaving:        boolean;
  /** Convenience: switch locale and persist immediately (no need to call saveSettings). */
  setLocale:       (locale: SupportedLocale) => void;
  /** All supported locales with their display names (e.g. { en: "English", … }). */
  availableLocales: typeof LOCALES;
}

const SettingsContext = createContext<SettingsCtx | null>(null);


export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // On first mount, load from DB and activate the stored locale.
  useEffect(() => {
    dms.loadPreference(SETTINGS_KEY).then((val) => {
      let next = settings;
      if (val) {
        try {
          const stored = JSON.parse(val) as Partial<AppSettings>;
          next = { ...DEFAULT_SETTINGS, ...stored };
          setSettingsState(next);
        } catch { /* ignore */ }
      }
      // Activate catalog for the resolved locale (synchronous).
      loadCatalog(next.locale);
      setSettingsLoaded(true);
    }).catch(() => {
      // DB not yet ready — activate default locale and continue.
      loadCatalog(DEFAULT_SETTINGS.locale);
      setSettingsLoaded(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-activate catalog whenever the locale setting changes after initial load.
  useEffect(() => {
    if (settingsLoaded) {
      loadCatalog(settings.locale);
    }
  }, [settings.locale, settingsLoaded]);

  const setSetting = useCallback((partial: Partial<AppSettings>) => {
    setSettingsState((prev) => ({ ...prev, ...partial }));
  }, []);

  const saveSettings = useCallback(async () => {
    setIsSaving(true);
    try {
      await dms.savePreference(SETTINGS_KEY, JSON.stringify(settings));
    } finally {
      setIsSaving(false);
    }
  }, [settings]);

  /** Switch locale and persist immediately — no extra saveSettings call needed. */
  const setLocale = useCallback((locale: SupportedLocale) => {
    setSettingsState((prev) => {
      const next = { ...prev, locale };
      // Fire-and-forget persist
      dms.savePreference(SETTINGS_KEY, JSON.stringify(next)).catch((e) =>
        console.warn("[settings] savePreference failed:", e)
      );
      return next;
    });
  }, []);

  const ctx = useMemo<SettingsCtx>(
    () => ({
      settings,
      settingsLoaded,
      setSetting,
      saveSettings,
      isSaving,
      setLocale,
      availableLocales: LOCALES,
    }),
    [settings, settingsLoaded, setSetting, saveSettings, isSaving, setLocale],
  );

  return (
    <SettingsContext.Provider value={ctx}>{children}</SettingsContext.Provider>
  );
}


export function useSettings(): SettingsCtx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside <SettingsProvider>");
  return ctx;
}

/**
 * Convenience hook for locale-only consumers — mirrors the old useLocale() API
 * so components need no migration.
 */
export function useLocale() {
  const { settings, settingsLoaded, setLocale, availableLocales } = useSettings();
  return {
    locale:           settings.locale,
    loading:          !settingsLoaded,
    setLocale,
    availableLocales,
  };
}
