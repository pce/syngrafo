/**
 * locale-store.tsx — DEPRECATED shim.
 *
 * Locale is now part of settings-store.  Import from there directly:
 *   import { useLocale, useSettings } from "./settings-store";
 *
 * This file re-exports the compatibility hook for any existing consumers.
 */

export {
  useLocale,
  SettingsProvider as LocaleProvider,
} from "./settings-store";

export type { SupportedLocale } from "../i18n";
export { LOCALES } from "../i18n";
