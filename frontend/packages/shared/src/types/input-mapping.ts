/**
 * Input mapping / keyboard scheme types.
 *
 * A KeyboardScheme is a named preset that controls:
 *  - Which modifier key is used for multi-select (⌘ vs Ctrl)
 *  - Whether hjkl navigation is active
 *  - Whether `/` and typeahead jump are the primary search triggers
 *
 * The active scheme is stored in DMS preferences under KEYBOARD_SCHEME_PREF_KEY
 * and loaded/saved by the consumer (DMS FileBrowser wrapper, ThemePanel, etc.).
 * The FileBrowser component itself is purely prop-driven — no hidden global state.
 */

export type KeyboardScheme = "macos" | "windows" | "linux" | "vi";

export interface InputMappingPreset {
  scheme:           KeyboardScheme;
  label:            string;
  /** One-line summary shown in compact UI. */
  shortDescription: string;
  /** Full description shown in the Settings panel. */
  description:      string;
  multiSelectModifier: "meta" | "ctrl";
  touchDescription?: string;
}

export const INPUT_MAPPING_PRESETS: readonly InputMappingPreset[] = [
  {
    scheme:           "macos",
    label:            "macOS",
    shortDescription: "Click selects & previews · ⌘ multi-select · Double-click opens",
    description:
      "Standard macOS conventions. Single click selects the entry and shows a preview " +
      "in the main panel. ⌘+Click adds to the selection. Shift+Click extends the range. " +
      "Double-click (or Enter) opens the file in the viewer.",
    multiSelectModifier: "meta",
    touchDescription: "Tap selects, double-tap opens, long-press is reserved for future multi-select gestures.",
  },
  {
    scheme:           "windows",
    label:            "Windows",
    shortDescription: "Click selects & previews · Ctrl multi-select · Double-click opens",
    description:
      "Standard Windows conventions. Single click selects and previews. " +
      "Ctrl+Click adds to the selection. Shift+Click extends the range. " +
      "Double-click (or Enter) opens the file in the viewer.",
    multiSelectModifier: "ctrl",
    touchDescription: "Tap selects, double-tap opens, long-press is reserved for future multi-select gestures.",
  },
  {
    scheme:           "linux",
    label:            "Linux",
    shortDescription: "Click selects & previews · Ctrl multi-select · Double-click opens",
    description:
      "Standard desktop Linux conventions. Single click selects and previews. " +
      "Ctrl+Click adds to the selection. Shift+Click extends the range. " +
      "Double-click (or Enter) opens the file in the viewer.",
    multiSelectModifier: "ctrl",
    touchDescription: "Tap selects, double-tap opens, long-press is reserved for future multi-select gestures.",
  },
  {
    scheme:           "vi",
    label:            "VI / Vim",
    shortDescription: "j/k · h parent · l/Enter open · / search · gg first · G last",
    description:
      "Keyboard-first navigation inspired by Vim file browsers (netrw/NERDTree). " +
      "j/k move the cursor, h navigates to the parent directory, l or Enter opens the focused entry. " +
      "/ opens an inline search filter. gg jumps to the first entry, G to the last. " +
      "Mouse single-click still selects and previews.",
    multiSelectModifier: "meta",
    touchDescription: "Touch behaves like pointer selection; Vim keys stay keyboard-only.",
  },
] as const;

/** DMS preference key used to persist the active keyboard scheme. */
export const KEYBOARD_SCHEME_PREF_KEY = "keyboard_scheme";

export function normalizeKeyboardScheme(value: string | null | undefined): KeyboardScheme {
  if (value === "macos" || value === "windows" || value === "linux" || value === "vi") {
    return value;
  }
  return detectPreferredKeyboardScheme();
}

export function detectPreferredKeyboardScheme(): KeyboardScheme {
  if (typeof navigator === "undefined") return "macos";
  const platform = `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`.toLowerCase();
  if (platform.includes("mac") || platform.includes("iphone") || platform.includes("ipad")) {
    return "macos";
  }
  if (platform.includes("win")) return "windows";
  if (platform.includes("linux") || platform.includes("x11")) return "linux";
  return "macos";
}

export function getInputMappingPreset(scheme: KeyboardScheme): InputMappingPreset {
  return INPUT_MAPPING_PRESETS.find((preset) => preset.scheme === scheme) ?? INPUT_MAPPING_PRESETS[0]!;
}

export function usesCtrlMultiSelect(scheme: KeyboardScheme): boolean {
  return getInputMappingPreset(scheme).multiSelectModifier === "ctrl";
}

export function usesMetaMultiSelect(scheme: KeyboardScheme): boolean {
  return getInputMappingPreset(scheme).multiSelectModifier === "meta";
}
