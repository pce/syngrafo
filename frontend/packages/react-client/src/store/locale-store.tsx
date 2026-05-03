/**
 * locale-store.tsx — locale selection context.
 *
 * Persists the chosen language to the global SQLite DB via dms.savePreference
 * (key: "syngrafo_locale").  No localStorage / IndexedDB is used.
 * All catalogs are pre-loaded at startup so switching is instant.
 *
 * Usage:
 *   const { locale, setLocale, availableLocales } = useLocale();
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { loadCatalog, detectLocale, LOCALES, type SupportedLocale } from "../i18n";
import { dms } from "../services/dms-service";

const PREF_KEY = "syngrafo_locale";

interface LocaleCtx {
  /** Active locale code, e.g. "de" */
  locale: SupportedLocale;
  /** Whether the initial DB load is still in progress */
  loading: boolean;
  /** Switch to a different language — activates catalog + persists to DB */
  setLocale: (locale: SupportedLocale) => void;
  /** All supported locales with their display names */
  availableLocales: typeof LOCALES;
}

const LocaleContext = createContext<LocaleCtx | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // Start with the browser's detected locale — will be replaced by DB value on mount.
  const [locale, setLocaleState] = useState<SupportedLocale>(detectLocale);
  const [loading, setLoading] = useState(true);

  // On first mount: load persisted locale from the DB.
  useEffect(() => {
    setLoading(true);
    dms.loadPreference(PREF_KEY)
      .then((val) => {
        const stored = val as SupportedLocale | null;
        const next = stored && stored in LOCALES ? stored : detectLocale();
        setLocaleState(next);
        loadCatalog(next);
      })
      .catch(() => {
        // DB not yet ready (dev mode / first launch) — keep detected locale.
        loadCatalog(locale);
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLocale = useCallback((next: SupportedLocale) => {
    setLocaleState(next);
    loadCatalog(next);
    // Persist to DB — fire-and-forget (no await needed, locale is cheap to re-read)
    dms.savePreference(PREF_KEY, next).catch((e) => {
      console.warn("[locale] savePreference failed:", e);
    });
  }, []);

  const ctx = useMemo<LocaleCtx>(
    () => ({ locale, loading, setLocale, availableLocales: LOCALES }),
    [locale, loading, setLocale],
  );

  return <LocaleContext.Provider value={ctx}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleCtx {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used inside <LocaleProvider>");
  return ctx;
}
