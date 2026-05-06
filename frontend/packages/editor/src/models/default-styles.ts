/**
 * @file models/default-styles.ts
 * Built-in named style classes that are seeded into every new document.
 * Authors can override, rename, or delete them — they are just starting points.
 * All values use SDM tokens (no raw CSS strings except colors).
 */

import type { SDocument, SDocMeta, SStyleClass } from "./sdm";
import { createDocument } from "./sdm-factory";

export const DEFAULT_STYLE_CLASSES: Record<string, SStyleClass> = {
  // ── Headings ──────────────────────────────────────────────────────────────
  "display": {
    props: {
      font: "serif", size: "4xl", weight: "bold", leading: "tight",
      tracking: "tight",
    },
  },
  "heading-1": {
    props: {
      font: "sans", size: "3xl", weight: "bold", leading: "tight",
    },
  },
  "heading-2": {
    props: {
      font: "sans", size: "2xl", weight: "semibold", leading: "snug",
    },
  },
  "heading-3": {
    props: {
      font: "sans", size: "xl", weight: "semibold", leading: "snug",
    },
  },
  "heading-4": {
    props: {
      font: "sans", size: "lg", weight: "medium", leading: "normal",
    },
  },

  // ── Body copy ─────────────────────────────────────────────────────────────
  "body": {
    props: {
      font: "sans", size: "md", weight: "normal", leading: "relaxed",
    },
  },
  "body-serif": {
    props: {
      font: "serif", size: "md", weight: "normal", leading: "relaxed",
    },
  },
  "lead": {
    props: {
      font: "serif", size: "lg", weight: "normal", leading: "relaxed",
    },
  },
  "small": {
    props: {
      font: "sans", size: "sm", weight: "normal", leading: "normal",
    },
  },
  "caption": {
    props: {
      font: "sans", size: "sm", weight: "normal", leading: "normal",
      style: "italic", color: "#6b7280",
    },
  },
  "muted": {
    props: {
      color: "#9ca3af",
    },
  },

  // ── Code ──────────────────────────────────────────────────────────────────
  "code-block": {
    props: {
      font: "mono", size: "sm", weight: "normal", leading: "relaxed",
      background: "#1e1e2e", color: "#cdd6f4",
      spacing: { inner: "md" },
      border: { radius: "sm" },
    },
  },

  // ── Quotes ────────────────────────────────────────────────────────────────
  "blockquote": {
    props: {
      font: "serif", size: "lg", weight: "normal", style: "italic",
      color: "#4b5563",
      border: { color: "#d1d5db", width: "4px", side: "left" },
      spacing: { inner: "md" },
    },
  },
  "pullquote": {
    props: {
      font: "serif", size: "2xl", weight: "normal", style: "italic",
      align: "center", leading: "relaxed", color: "#374151",
      spacing: { inner: "lg", outer: "lg" },
    },
  },

  // ── Emphasis & colour ─────────────────────────────────────────────────────
  "accent": {
    props: { color: "#3b82f6", weight: "semibold" },
  },
  "highlight": {
    props: { background: "#fef9c3", color: "#713f12" },
  },
  "success-text": {
    props: { color: "#16a34a", weight: "semibold" },
  },
  "danger-text": {
    props: { color: "#dc2626", weight: "semibold" },
  },

  // ── Layout helpers ────────────────────────────────────────────────────────
  "card": {
    props: {
      background: "#ffffff",
      border: { color: "#e5e7eb", width: "1px", side: "all", radius: "md" },
      spacing: { inner: "md" },
    },
  },
  "card-muted": {
    props: {
      background: "#f9fafb",
      border: { color: "#e5e7eb", width: "1px", side: "all", radius: "md" },
      spacing: { inner: "md" },
    },
  },
  "banner": {
    props: {
      background: "#f8fafc", align: "center",
      spacing: { inner: "xl", outer: "none" },
    },
  },

  // ── Formal / print ────────────────────────────────────────────────────────
  "legal": {
    props: {
      font: "serif", size: "sm", weight: "normal",
      align: "justify", leading: "relaxed",
    },
  },
  "letter-header": {
    props: {
      font: "sans", size: "xl", weight: "bold", leading: "tight",
      spacing: { outer: "lg" },
    },
  },
};

/**
 * Merges the default style classes into a document, skipping any
 * classes whose id is already defined (user styles take precedence).
 */
export function seedDefaultStyles(doc: SDocument): SDocument {
  const merged: SDocument["styles"] = { ...DEFAULT_STYLE_CLASSES };
  // User-defined classes win over defaults.
  for (const [id, cls] of Object.entries(doc.styles)) {
    merged[id] = cls;
  }
  return { ...doc, styles: merged };
}

/**
 * Creates a new blank document pre-seeded with all default style classes.
 * This is the preferred factory for new documents — the plain `createDocument`
 * remains available for import/reconstruction paths.
 */
export function createDefaultDocument(meta?: Partial<SDocMeta>): SDocument {
  return seedDefaultStyles(createDocument(meta));
}
