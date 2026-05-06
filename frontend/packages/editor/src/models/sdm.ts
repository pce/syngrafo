/**
 * @file models/sdm.ts
 * @brief Syngrafo Document Model — canonical in-memory and on-disk representation.
 *
 * Pure TypeScript interfaces and discriminated unions. No signals, no class
 * instances, no framework dependency. The store layer owns reactivity.
 *
 * Rendering pipeline resolves typed tokens to CSS/PDF primitives — authors
 * never write raw CSS values.
 */

import type { NLPBlockAnnotation } from "./nlp";
import type { DocumentIntent } from "./editor-context";

/**
 * Maps to a fixed scale: none=0, xs=4px, sm=8px, md=16px, lg=24px, xl=32px, 2xl=48px.
 * Used for padding, margin, gap, and page margins.
 */
export type SpacingToken = "none" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl";

export type SizeToken    = "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl";
export type FontToken    = "serif" | "sans" | "mono";
export type WeightToken  = "normal" | "medium" | "semibold" | "bold";
export type LeadingToken = "tight" | "snug" | "normal" | "relaxed" | "loose";
export type AlignH       = "start" | "center" | "end" | "fill";
export type AlignV       = "top" | "middle" | "bottom" | "fill";

/**
 * Typed style properties — token-based, no raw CSS.
 * The renderer resolves these to CSS/PDF at export time.
 */
export interface SStyleProps {
  font?:       FontToken;
  size?:       SizeToken;
  weight?:     WeightToken;
  style?:      "normal" | "italic";
  color?:      string;
  background?: string;
  leading?:    LeadingToken;
  tracking?:   "tight" | "normal" | "wide" | "wider";
  align?:      "left" | "center" | "right" | "justify";
  decoration?: "none" | "underline" | "line-through";
  border?: {
    color?:  string;
    width?:  string;
    side?:   "all" | "top" | "bottom" | "left" | "right";
    radius?: "none" | "sm" | "md" | "lg" | "full";
  };
  spacing?: { inner?: SpacingToken; outer?: SpacingToken };
}

export interface SStyleClass {
  props: SStyleProps;
}

export type SpanMark = "bold" | "italic" | "underline" | "strike" | "code" | "link" | "sup" | "sub";

export interface Span {
  text:   string;
  marks?: SpanMark[];
  /** Only present when marks includes "link". */
  href?:  string;
  /** Style class id override for this run only. */
  style?: string;
}

export interface SBlockBase {
  id:       string;
  /** Style class id from SDocument.styles. */
  style?:   string;
  /**
   * Per-block style property overrides — merged on top of the named style
   * class at render time.  Highest specificity; stored in the document.
   */
  styleOverrides?: Partial<SStyleProps>;
  spacing?: { inner?: SpacingToken; outer?: SpacingToken };
  align?:   { h?: AlignH; v?: AlignV };
}

export type TextBlockType = "p" | "h1" | "h2" | "h3" | "h4" | "quote" | "li" | "td" | "th" | "figcaption";

export interface STextBlock extends SBlockBase {
  type:  TextBlockType;
  spans: Span[];
  /**
   * Runtime NLP annotation — populated by the indexing pipeline.
   * Not part of the persisted schema; stripped on serialise.
   */
  nlp?:  NLPBlockAnnotation;
}

export interface SListBlock extends SBlockBase {
  type:     "ul" | "ol";
  children: STextBlock[];
}

export interface SCodeBlock extends SBlockBase {
  type:      "code";
  text:      string;
  language?: string;
}

export type ImgFit = "contain" | "cover" | "fill";

export interface SImgBlock extends SBlockBase {
  type:     "img";
  /** asset://uuid | local://abs-path | https:// URL */
  src:      string;
  alt?:     string;
  fit?:     ImgFit;
  /** Single-line caption rendered below the image. */
  caption?: string;
}

export interface SHrBlock         extends SBlockBase { type: "hr"; }
export interface SPageBreakBlock  extends SBlockBase { type: "pagebreak"; }

/** Horizontal flex container. Direct children must be col blocks. */
export interface SHBoxBlock extends SBlockBase {
  type:     "hbox";
  gap?:     SpacingToken;
  children: SColBlock[];
}

/** Vertical flex container. Children can be any block. */
export interface SVBoxBlock extends SBlockBase {
  type:     "vbox";
  gap?:     SpacingToken;
  children: SBlock[];
}

/** Flex/grid column — direct child of hbox or grid. */
export interface SColBlock extends SBlockBase {
  type:     "col";
  /** Width fraction or percentage: "33%" | "1fr" | "auto". */
  width?:   string;
  /** Grid column span when inside a grid container. */
  span?:    number;
  children: SBlock[];
}

/** CSS grid container — defines explicit column tracks. */
export interface SGridBlock extends SBlockBase {
  type:     "grid";
  /** CSS grid-template-columns tokens: ["1fr", "2fr", "1fr"]. */
  columns:  string[];
  gap?:     SpacingToken;
  children: SColBlock[];
}

export interface STableBlock extends SBlockBase {
  type:          "table";
  data_source?:  SDataSource;
  children:      STrBlock[];
}

export interface STrBlock extends SBlockBase {
  type:     "tr";
  children: (STextBlock & { type: "td" | "th" })[];
}

export type CalloutVariant = "info" | "tip" | "warning" | "danger" | "success" | "note";

export interface SCalloutBlock extends SBlockBase {
  type:     "callout";
  variant:  CalloutVariant;
  icon?:    string;
  /** Short title rendered above the body. */
  title?:   string;
  children: SBlock[];
}

export type SBlock =
  | STextBlock
  | SListBlock
  | SCodeBlock
  | SImgBlock
  | SHrBlock
  | SPageBreakBlock
  | SHBoxBlock
  | SVBoxBlock
  | SColBlock
  | SGridBlock
  | STableBlock
  | STrBlock
  | SCalloutBlock;

export type SBlockType = SBlock["type"];

export type SDataSource =
  | { type: "csv";   path: string }
  | { type: "xml";   path: string; xpath: string }
  | { type: "query"; zone: string; sql: string };

export type PageSize        = "a0" | "a1" | "a2" | "a3" | "a4" | "a5" | "a6" | "letter" | "legal";
export type PageOrientation = "portrait" | "landscape";

export const PAGE_SIZE_MM: Record<PageSize, { w: number; h: number }> = {
  a0:     { w: 841,  h: 1189 },
  a1:     { w: 594,  h: 841  },
  a2:     { w: 420,  h: 594  },
  a3:     { w: 297,  h: 420  },
  a4:     { w: 210,  h: 297  },
  a5:     { w: 148,  h: 210  },
  a6:     { w: 105,  h: 148  },
  letter: { w: 216,  h: 279  },
  legal:  { w: 216,  h: 356  },
};

export interface SPageConfig {
  size:        PageSize;
  orientation: PageOrientation;
  /** Page margin — resolved from the shared spacing scale. */
  margin:      SpacingToken;
}

export interface SDocMeta {
  title:      string;
  /** Unix seconds. */
  created_at: number;
  /** Unix seconds. */
  updated_at: number;
  filename?:  string;
  zone?:      string;
  author?:    string;
  tags?:      string[];
  intent?:    DocumentIntent;
}

export interface SDocument {
  /** Schema version tag — increment for breaking changes. */
  $schema: "syngrafo/1";
  id:      string;
  meta:    SDocMeta;
  page:    SPageConfig;
  /** Named style classes. Key = class id used in block.style and Span.style. */
  styles:  Record<string, SStyleClass>;
  blocks:  SBlock[];
}

export const TEXT_BLOCK_TYPES = new Set<SBlockType>([
  "p", "h1", "h2", "h3", "h4", "quote", "li", "td", "th", "figcaption",
]);

export function isTextBlock(b: SBlock): b is STextBlock {
  return TEXT_BLOCK_TYPES.has(b.type);
}

export function isLayoutBlock(b: SBlock): b is SHBoxBlock | SVBoxBlock | SColBlock | SGridBlock {
  return b.type === "hbox" || b.type === "vbox" || b.type === "col" || b.type === "grid";
}

export function hasChildren(b: SBlock): b is Extract<SBlock, { children: SBlock[] }> {
  return "children" in b && Array.isArray((b as { children?: unknown }).children);
}
