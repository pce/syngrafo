/**
 * locale-store.tsx — locale selection context.
 *
 * Persists the chosen language to localStorage and loads the corresponding
 * LinguiJS message catalog.  Wrap the app with <LocaleProvider> to activate.
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

const STORAGE_KEY = "syngrafo_locale";

interface LocaleCtx {
  /** Active locale code, e.g. "de" */
  locale: SupportedLocale;
  /** Whether the catalog is still loading */
  loading: boolean;
  /** Switch to a different language (loads catalog + persists choice) */
  setLocale: (locale: SupportedLocale) => void;
  /** All supported locales with their display names */
  availableLocales: typeof LOCALES;
}

const LocaleContext = createContext<LocaleCtx | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as SupportedLocale | null;
    return saved && saved in LOCALES ? saved : detectLocale();
  });
  const [loading, setLoading] = useState(true);

  // Load catalog whenever locale changes.
  useEffect(() => {
    setLoading(true);
    loadCatalog(locale).finally(() => setLoading(false));
  }, [locale]);

  const setLocale = useCallback((next: SupportedLocale) => {
    localStorage.setItem(STORAGE_KEY, next);
    setLocaleState(next);
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

