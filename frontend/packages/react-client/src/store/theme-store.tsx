/**
 * theme-store.tsx — Lightweight theme context.
 *
 * Applies theme by toggling CSS classes on <html>. All colour values live
 * in index.css as .theme-* rules; radius/density as .radius-* / .density-*.
 *
 * Persists to the global SQLite DB via dms.savePreference (key: "syngrafo_theme").
 * No localStorage / IndexedDB is used — the DB is the single source of truth.
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

export interface ThemeTokens {
  /** CSS class name without the "theme-" prefix, e.g. "dark" | "light" | "nord" */
  colorPreset: string;
  /** Custom overrides — e.g. { "--theme-primary": "#ff0080" } */
  customColors: Record<string, string>;
  /** "none" | "small" | "medium" | "large" | "pill" */
  radius: string;
  /** "compact" | "normal" | "roomy" */
  density: string;
  /** Font pair preset id — e.g. "system" | "inter" | "ibm-plex" | "comic" */
  fontPair: string;
}

export interface ThemePreset {
  id: string;
  name: string;
  /** Maps to .theme-<id> CSS class */
  cssClass: string;
  /** Representative swatch colours for the thumbnail */
  bg: string;
  surface: string;
  text: string;
  primary: string;
  danger: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: "dark",                 name: "Dark",                 cssClass: "theme-dark",                bg: "#121212", surface: "#1e1e1e", text: "#e0e0e0", primary: "#f5f5f5",  danger: "#cf6679" },
  { id: "light",                name: "Light",                cssClass: "theme-light",               bg: "#f5f5f5", surface: "#ffffff", text: "#212121", primary: "#424242",  danger: "#d32f2f" },
  { id: "solarized-dark",       name: "Solarized Dark",       cssClass: "theme-solarized-dark",      bg: "#002b36", surface: "#073642", text: "#93a1a1", primary: "#268bd2",  danger: "#dc322f" },
  { id: "solarized-light",      name: "Solarized Light",      cssClass: "theme-solarized-light",     bg: "#fdf6e3", surface: "#eee8d5", text: "#657b83", primary: "#268bd2",  danger: "#dc322f" },
  { id: "nord",                 name: "Nord",                 cssClass: "theme-nord",                bg: "#2e3440", surface: "#3b4252", text: "#eceff4", primary: "#88c0d0",  danger: "#bf616a" },
  { id: "dracula",              name: "Dracula",              cssClass: "theme-dracula",             bg: "#282a36", surface: "#44475a", text: "#f8f8f2", primary: "#bd93f9",  danger: "#ff5555" },
  { id: "monokai",              name: "Monokai",              cssClass: "theme-monokai",             bg: "#272822", surface: "#3e3d32", text: "#f8f8f2", primary: "#ae81ff",  danger: "#f92672" },
  { id: "gruvbox-dark",         name: "Gruvbox Dark",         cssClass: "theme-gruvbox-dark",        bg: "#282828", surface: "#3c3836", text: "#ebdbb2", primary: "#fabd2f",  danger: "#fb4934" },
  { id: "tokyo-night",          name: "Tokyo Night",          cssClass: "theme-tokyo-night",         bg: "#1a1b26", surface: "#24283b", text: "#c0caf5", primary: "#7aa2f7",  danger: "#f7768e" },
  { id: "rose-pine",            name: "Rosé Pine",            cssClass: "theme-rose-pine",           bg: "#191724", surface: "#1f1d2e", text: "#e0def4", primary: "#c4a7e7",  danger: "#eb6f92" },
  { id: "material-palenight",   name: "Material Palenight",   cssClass: "theme-material-palenight",  bg: "#292d3e", surface: "#32374d", text: "#bfc7d5", primary: "#82aaff",  danger: "#ff5370" },
  { id: "catppuccin",           name: "Catppuccin",           cssClass: "theme-catppuccin",          bg: "#1e2030", surface: "#24273a", text: "#cad3f5", primary: "#8aadf4",  danger: "#ed8796" },
];

export const DEFAULT_THEME: ThemeTokens = {
  colorPreset:  "dark",
  customColors: {},
  radius:       "medium",
  density:      "normal",
  fontPair:     "inter",
};

export interface FontPair {
  id: string;
  label: string;
  /** CSS font-family stack for --theme-font-sans */
  sans: string;
  /** CSS font-family stack for --theme-font-mono */
  mono: string;
  /** Short description / category label */
  description: string;
  experimental?: boolean;
}

export const FONT_PAIRS: FontPair[] = [
  {
    id: "system",
    label: "System",
    sans: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    description: "OS default",
  },
  {
    id: "inter",
    label: "Inter",
    sans: "'Inter', ui-sans-serif, system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
    description: "Inter + JetBrains Mono",
  },
  {
    id: "ibm-plex",
    label: "IBM Plex",
    sans: "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, monospace",
    description: "IBM Plex Sans + Plex Mono",
  },
  {
    id: "lora",
    label: "Lora",
    sans: "'Lora', Georgia, serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
    description: "Lora serif + JetBrains Mono",
  },
  {
    id: "comic",
    label: "Comic Neue",
    sans: "'Comic Neue', cursive, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
    description: "Handwritten-style",
    experimental: true,
  },
];

const PREF_KEY = "syngrafo_theme";

// ── Context ───────────────────────────────────────────────────────────────────

interface ThemeCtx {
  theme: ThemeTokens;
  setTheme: (t: Partial<ThemeTokens>) => void;
  presets: ThemePreset[];
  saveTheme: () => Promise<void>;
  isSaving: boolean;
}

const ThemeContext = createContext<ThemeCtx | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

function applyTheme(theme: ThemeTokens): void {
  const html = document.documentElement;

  // Remove all known theme classes then add new one
  const classesToRemove = Array.from(html.classList).filter(
    (c) => c.startsWith("theme-") || c.startsWith("radius-") || c.startsWith("density-")
  );
  html.classList.remove(...classesToRemove);

  html.classList.add(`theme-${theme.colorPreset}`);
  html.classList.add(`radius-${theme.radius}`);
  html.classList.add(`density-${theme.density}`);

  // Apply custom colour overrides as inline CSS vars
  const root = html.style;
  // First clear any previously set custom vars
  for (const varName of [
    "--theme-bg", "--theme-surface", "--theme-border",
    "--theme-text", "--theme-text-muted", "--theme-primary", "--theme-danger",
    "--theme-font-sans", "--theme-font-mono",
  ]) {
    root.removeProperty(varName);
  }
  for (const [varName, value] of Object.entries(theme.customColors)) {
    root.setProperty(varName, value);
  }

  // Apply font pair
  const pair = FONT_PAIRS.find((p) => p.id === theme.fontPair) ?? FONT_PAIRS[1]!;
  root.setProperty("--theme-font-sans", pair.sans);
  root.setProperty("--theme-font-mono", pair.mono);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Start with the built-in default — will be replaced by DB value on mount.
  const [theme, setThemeState] = useState<ThemeTokens>(DEFAULT_THEME);
  const [isSaving, setIsSaving] = useState(false);

  // Apply on mount and every change
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // On first mount: load persisted theme from the DB.
  useEffect(() => {
    dms.loadPreference(PREF_KEY).then((val) => {
      if (!val) return;
      try {
        const stored = JSON.parse(val) as Partial<ThemeTokens>;
        setThemeState((prev) => ({ ...prev, ...stored }));
      } catch {/* ignore malformed JSON */}
    });
  }, []);

  const setTheme = useCallback((partial: Partial<ThemeTokens>) => {
    setThemeState((prev) => ({ ...prev, ...partial }));
  }, []);

  const saveTheme = useCallback(async () => {
    setIsSaving(true);
    try {
      await dms.savePreference(PREF_KEY, JSON.stringify(theme));
    } finally {
      setIsSaving(false);
    }
  }, [theme]);

  const ctx = useMemo<ThemeCtx>(
    () => ({ theme, setTheme, presets: THEME_PRESETS, saveTheme, isSaving }),
    [theme, setTheme, saveTheme, isSaving]
  );

  return <ThemeContext.Provider value={ctx}>{children}</ThemeContext.Provider>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useTheme(): ThemeCtx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
