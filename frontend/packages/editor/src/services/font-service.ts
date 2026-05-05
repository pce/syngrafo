// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FontStyle = "normal" | "italic" | "oblique";
export type FontWeight = "100" | "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900" | "normal" | "bold";

/** A single font face (one file = one weight + style combination). */
export interface BundledFace {
  /** CSS font-weight value */
  weight: FontWeight;
  /** CSS font-style value */
  style: FontStyle;
  /** Filename inside the fonts/ directory, e.g. "Inter-Regular.ttf" */
  file: string;
}

/** A logical font family that may have multiple faces. */
export interface BundledFont {
  /** The exact CSS font-family name to use in stylesheets */
  family: string;
  /** Human-readable label shown in the UI */
  label: string;
  /** Broad category for grouping in the picker */
  category: "sans-serif" | "serif" | "monospace" | "display";
  /** Short description / intended use */
  description: string;
  /** Available faces */
  faces: BundledFace[];
}

/** One entry in a grouped font picker. */
export interface FontOption {
  /** Value written into the CSS font-family property */
  value: string;
  /** Label shown to the user */
  label: string;
  /** Whether this is a bundled (embedded) font */
  bundled: boolean;
  category: BundledFont["category"] | "system" | "generic";
}

export interface FontGroup {
  label: string;
  options: FontOption[];
}

// ---------------------------------------------------------------------------
// Bundled font catalog
// ---------------------------------------------------------------------------

/**
 * All fonts listed here are SIL OFL 1.1 licensed.
 * TTF files live in frontend/fonts/ and are copied to src/content/fonts/
 * by the CMake build so saucer::embed serves them at /fonts/<file>.
 */
export const BUNDLED_FONTS: BundledFont[] = [
  {
    family: "Inter",
    label: "Inter",
    category: "sans-serif",
    description: "Clean, highly legible UI and document sans-serif",
    faces: [
      // Variable font: one file covers weights 100-900
      { weight: "400", style: "normal", file: "InterVariable.ttf" },
      { weight: "600", style: "normal", file: "InterVariable.ttf" },
      { weight: "700", style: "normal", file: "InterVariable.ttf" },
    ],
  },

  {
    family: "Lora",
    label: "Lora",
    category: "serif",
    description: "Elegant serif for body text and formal documents",
    faces: [
      { weight: "400", style: "normal", file: "Lora-Regular.ttf" },
      { weight: "400", style: "italic", file: "Lora-Italic.ttf" },
      { weight: "700", style: "normal", file: "Lora-Bold.ttf" },
    ],
  },
  {
    family: "Merriweather",
    label: "Merriweather",
    category: "serif",
    description: "Screen-optimised serif with generous x-height",
    faces: [
      { weight: "400", style: "normal", file: "Merriweather-Regular.ttf" },
      { weight: "700", style: "normal", file: "Merriweather-Bold.ttf" },
    ],
  },

  {
    family: "Playfair Display",
    label: "Playfair Display",
    category: "display",
    description: "High-contrast display serif for headings and titles",
    faces: [
      { weight: "400", style: "normal", file: "PlayfairDisplay-Regular.ttf" },
      { weight: "700", style: "normal", file: "PlayfairDisplay-Bold.ttf" },
    ],
  },

  {
    family: "JetBrains Mono",
    label: "JetBrains Mono",
    category: "monospace",
    description: "Highly legible monospace for code and technical content",
    faces: [
      { weight: "400", style: "normal", file: "JetBrainsMono-Regular.ttf" },
      { weight: "700", style: "normal", file: "JetBrainsMono-Bold.ttf" },
    ],
  },
];

// ---------------------------------------------------------------------------
// System / generic font options (no file needed)
// ---------------------------------------------------------------------------

const SYSTEM_FONT_OPTIONS: FontOption[] = [
  { value: "inherit", label: "Inherit", bundled: false, category: "generic" },
  { value: "sans-serif", label: "Sans-serif (system)", bundled: false, category: "system" },
  { value: "serif", label: "Serif (system)", bundled: false, category: "system" },
  { value: "monospace", label: "Monospace (system)", bundled: false, category: "system" },
  { value: "Arial, sans-serif", label: "Arial", bundled: false, category: "system" },
  { value: "Helvetica Neue, Helvetica, sans-serif", label: "Helvetica", bundled: false, category: "system" },
  { value: "Georgia, serif", label: "Georgia", bundled: false, category: "system" },
  { value: "Times New Roman, serif", label: "Times New Roman", bundled: false, category: "system" },
  { value: "Courier New, monospace", label: "Courier New", bundled: false, category: "system" },
  { value: "Trebuchet MS, sans-serif", label: "Trebuchet MS", bundled: false, category: "system" },
  { value: "Verdana, sans-serif", label: "Verdana", bundled: false, category: "system" },
];

// ---------------------------------------------------------------------------
// FontService
// ---------------------------------------------------------------------------

const FONT_FACE_STYLE_ID = "app-font-faces";

/** Base path where the embedded font files are served from. */
const FONTS_BASE_PATH = "/fonts/";

export class FontService {
  /**
   * Generate a complete `@font-face` CSS block for all bundled fonts.
   * Each face gets its own rule so the browser (and the Chromium PDF
   * engine) can load exactly the weights that are actually used.
   */
  static generateFontFaceCSS(): string {
    const rules: string[] = [];

    for (const font of BUNDLED_FONTS) {
      for (const face of font.faces) {
        const url = `${FONTS_BASE_PATH}${face.file}`;
        rules.push(
          `@font-face {\n` +
            `  font-family: '${font.family}';\n` +
            `  font-weight: ${face.weight};\n` +
            `  font-style:  ${face.style};\n` +
            `  font-display: block;\n` +
            `  src: url('${url}') format('truetype');\n` +
            `}`,
        );
      }
    }

    return rules.join("\n\n");
  }

  /**
   * Inject (or refresh) a `<style id="app-font-faces">` element in
   * `<head>` containing all `@font-face` rules.
   * Safe to call multiple times — subsequent calls replace the content.
   */
  static injectFontFaceCSS(): void {
    let el = document.getElementById(FONT_FACE_STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = FONT_FACE_STYLE_ID;
      el.type = "text/css";
      // Prepend so it appears before the app-styles sheet and can be
      // overridden by more-specific rules if needed.
      document.head.prepend(el);
    }
    el.textContent = this.generateFontFaceCSS();
  }

  /**
   * Returns a promise that resolves when all `@font-face` fonts have
   * either loaded or permanently failed.
   *
   * Must be awaited before triggering `window.print()` / `pdf.save()`,
   * otherwise Chromium's PDF renderer may fall back to a system font and
   * the chosen typeface won't be embedded in the exported PDF.
   */
  static async fontsReady(): Promise<void> {
    if (typeof document === "undefined") return;
    await document.fonts.ready;
  }

  /**
   * Load a specific font family explicitly so the browser fetches the
   * file even if no DOM element currently uses that font.
   * Useful for font preview in the style editor.
   */
  static async loadFont(family: string, weight: FontWeight = "400", style: FontStyle = "normal"): Promise<boolean> {
    if (typeof document === "undefined") return false;
    try {
      await document.fonts.load(`${style === "italic" ? "italic " : ""}${weight} 16px '${family}'`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns all font families as grouped options suitable for rendering
   * an `<optgroup>`-style picker in the StyleEditor.
   *
   * Group order:
   *   1. Bundled Sans-serif
   *   2. Bundled Serif
   *   3. Bundled Display
   *   4. Bundled Monospace
   *   5. System / Generic
   */
  static getFontFamilyGroups(): FontGroup[] {
    const categoryLabels: Record<BundledFont["category"], string> = {
      "sans-serif": "Sans-serif  (bundled, OFL)",
      serif: "Serif  (bundled, OFL)",
      display: "Display  (bundled, OFL)",
      monospace: "Monospace  (bundled, OFL)",
    };

    // Build one group per category, only for categories that have fonts
    const categoryOrder: BundledFont["category"][] = ["sans-serif", "serif", "display", "monospace"];
    const bundledGroups: FontGroup[] = categoryOrder
      .map((cat) => {
        const fonts = BUNDLED_FONTS.filter((f) => f.category === cat);
        if (fonts.length === 0) return null;
        return {
          label: categoryLabels[cat],
          options: fonts.map((f) => ({
            value: `'${f.family}', ${f.category}`,
            label: f.label,
            bundled: true,
            category: f.category,
          })),
        } as FontGroup;
      })
      .filter((g): g is FontGroup => g !== null);

    return [
      ...bundledGroups,
      {
        label: "System fonts",
        options: SYSTEM_FONT_OPTIONS,
      },
    ];
  }

  /**
   * Flat list of all font-family values (bundled + system).
   * Used anywhere only a simple string[] is needed.
   */
  static getAllFontFamilyValues(): string[] {
    return this.getFontFamilyGroups().flatMap((g) => g.options.map((o) => o.value));
  }

  /**
   * Look up the display label for a CSS font-family value.
   * Returns the raw value if not found.
   */
  static getFontLabel(value: string): string {
    for (const group of this.getFontFamilyGroups()) {
      const match = group.options.find((o) => o.value === value);
      if (match) return match.label;
    }
    return value;
  }

  /**
   * Check whether a given font-family value refers to a bundled font
   * (i.e. one that will definitely be embedded in PDF output).
   */
  static isBundled(fontFamily: string): boolean {
    return BUNDLED_FONTS.some((f) => fontFamily.includes(f.family));
  }
}
