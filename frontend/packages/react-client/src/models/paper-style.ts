import type { SPageBackground } from "@syngrafo/editor";
import { resolvePageBackgroundCss } from "@syngrafo/editor";

export interface PaperStylePreset {
  id: string;
  label: string;
  background: SPageBackground;
}

export const DEFAULT_PAPER_STYLES: PaperStylePreset[] = [
  { id: "paper-classic", label: "Classic White", background: { color: "#ffffff" } },
  { id: "paper-warm", label: "Warm Paper", background: { color: "#faf7f2" } },
  { id: "paper-cream", label: "Cream", background: { color: "#fffef0" } },
  { id: "paper-cool", label: "Cool Slate", background: { color: "#f0f4f8" } },
  { id: "paper-solarized-light", label: "Solarized Light", background: { color: "#fdf6e3" } },
  { id: "paper-earth-light", label: "Earth Light", background: { color: "#efe4d2" } },
  { id: "paper-earth-dark", label: "Earth Dark", background: { color: "#2f241f" } },
  { id: "paper-solarized-dark", label: "Solarized Dark", background: { color: "#002b36" } },
  {
    id: "paper-ivory-wash",
    label: "Ivory Wash",
    background: {
      gradient: {
        type: "linear",
        angle: 180,
        stops: [
          { color: "#fffdf8", position: 0 },
          { color: "#f5efe3", position: 100 },
        ],
      },
    },
  },
  {
    id: "paper-studio-dusk",
    label: "Studio Dusk",
    background: {
      gradient: {
        type: "linear",
        angle: 145,
        stops: [
          { color: "#f7f1e8", position: 0 },
          { color: "#e7ddff", position: 100 },
        ],
      },
    },
  },
  {
    id: "paper-unicorn-haze",
    label: "Unicorn Haze",
    background: {
      gradient: {
        type: "linear",
        angle: 135,
        stops: [
          { color: "#fff1ff", position: 0 },
          { color: "#e8f3ff", position: 38 },
          { color: "#efe3ff", position: 72 },
          { color: "#ffe6f3", position: 100 },
        ],
      },
    },
  },
  {
    id: "paper-rainbow-prism",
    label: "Rainbow Prism",
    background: {
      gradient: {
        type: "linear",
        angle: 118,
        stops: [
          { color: "#fff5d6", position: 0 },
          { color: "#ffd8ef", position: 24 },
          { color: "#dbcfff", position: 48 },
          { color: "#cde9ff", position: 72 },
          { color: "#ddffd7", position: 100 },
        ],
      },
    },
  },
  {
    id: "paper-canyon-dawn",
    label: "Canyon Dawn",
    background: {
      gradient: {
        type: "linear",
        angle: 160,
        stops: [
          { color: "#fff6ed", position: 0 },
          { color: "#f4d6c2", position: 52 },
          { color: "#d2b49c", position: 100 },
        ],
      },
    },
  },
  {
    id: "paper-basalt-night",
    label: "Basalt Night",
    background: {
      gradient: {
        type: "linear",
        angle: 150,
        stops: [
          { color: "#1b1f24", position: 0 },
          { color: "#21333a", position: 55 },
          { color: "#3a2f2a", position: 100 },
        ],
      },
    },
  },
];

export function getPaperStyleById(styles: PaperStylePreset[], id: string): PaperStylePreset | undefined {
  return styles.find((style) => style.id === id);
}

export function getResolvedPaperStyle(styles: PaperStylePreset[], id: string): PaperStylePreset {
  return getPaperStyleById(styles, id) ?? styles[0] ?? DEFAULT_PAPER_STYLES[0]!;
}

export function ensurePaperStyles(styles: PaperStylePreset[] | undefined, activeId: string | undefined) {
  const nextStyles = Array.isArray(styles) && styles.length > 0 ? styles : DEFAULT_PAPER_STYLES;
  const nextActiveId = getPaperStyleById(nextStyles, activeId ?? "")?.id ?? nextStyles[0]?.id ?? DEFAULT_PAPER_STYLES[0]!.id;
  return {
    styles: nextStyles,
    activeId: nextActiveId,
  };
}

export function paperStyleBackgroundCss(style: PaperStylePreset | undefined): string {
  return resolvePageBackgroundCss(style?.background);
}
