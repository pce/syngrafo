/**
 * i18n/index.ts — LinguiJS singleton + locale loader.
 *
 * All compiled catalogs are statically imported so Bun's bundler can
 * resolve them at build time (dynamic template-literal imports are not
 * supported by most bundlers).
 *
 * Workflow:
 *   1. bun run i18n:extract  — scan src/ and update .po files
 *   2. Open src/locales/de/messages.po in POEdit, translate
 *   3. bun run i18n:compile  — compile .po → .ts catalogs
 *   4. bun run build        — regular production build
 *
 * In components:
 *   import { useLingui } from "@lingui/react";
 *   const { _ } = useLingui();
 *   return <p>{_("Hello World")}</p>;
 */

import { setupI18n } from "@lingui/core";
import type { Messages } from "@lingui/core";

// Static imports, bundler can tree-shake unused locales at build time.
import { messages as messagesEn } from "../locales/en/messages";
import { messages as messagesDe } from "../locales/de/messages";
import { messages as messagesEl } from "../locales/el/messages";

export type SupportedLocale = "en" | "de" | "el";

/** Human-readable locale labels shown in the language picker. */
export const LOCALES: Record<SupportedLocale, string> = {
  en: "English",
  de: "Deutsch",
  el: "Ελληνικά",
};

const CATALOGS: Record<SupportedLocale, Messages> = {
  en: messagesEn,
  de: messagesDe,
  el: messagesEl,
};

/** LinguiJS i18n singleton — thread-safe (pure immutable state). */
export const i18n = setupI18n();

// Pre-load all catalogs into the i18n instance so switching is instant.
for (const [locale, messages] of Object.entries(CATALOGS)) {
  i18n.load(locale as SupportedLocale, messages);
}

/** Activate a locale (all catalogs are already loaded). */
export function loadCatalog(locale: SupportedLocale): Promise<void> {
  i18n.activate(locale);
  return Promise.resolve();
}

/** Detect the user's preferred locale from the browser, falling back to "en". */
export function detectLocale(): SupportedLocale {
  const candidates = navigator.languages ?? [navigator.language];
  for (const lang of candidates) {
    const prefix = lang.split("-")[0] as SupportedLocale;
    if (prefix in LOCALES) return prefix;
  }
  return "en";
}

