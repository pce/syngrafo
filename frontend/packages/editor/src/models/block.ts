import { signal, type Signal } from "@preact/signals-core";
import { type BlockStyleReference, defaultBlockStyles, type CSSProperties } from "./style";
import type { NLPBlockAnnotation } from "./nlp";

export type BlockType =
  | "h1"
  | "h2"
  | "h3"
  | "p"
  | "ul"
  | "ol"
  | "li"
  | "hr"
  | "code"
  | "pagebreak"
  | "img"
  | "figure"
  | "figcaption"
  | "table"
  | "hbox"
  | "vbox"
  | "columns"
  | "callout"
  | "raw-html"
  | "embed"
  | "reveal"
  | "stream"
  | "nlp-block"
  | "nlp-tree";

export interface ColumnsBlockMeta {
  splitAxis: "v" | "h"; // "v" = side-by-side, "h" = stacked
  ratios: number[];
  children: string[];
  gap?: string;
}

export interface BoxBlockMeta {
  parentId?: string;
  children?: string[];
  gap?: string;
  alignItems?: string;
  justifyContent?: string;
  columnWidths?: number[];
  childSizes?: string[];
}

export type CalloutVariant = "info" | "tip" | "warning" | "danger" | "success" | "note";

export interface CalloutBlockMeta {
  variant: CalloutVariant;
  icon?: string;
  title?: string;
}

export interface EmbedBlockMeta {
  src: string;
  aspectRatio?: "video" | "square" | "portrait" | string;
  allow?: string;
  caption?: string;
}

export interface RevealBlockMeta {
  beforeSrc: string;
  afterSrc: string;
  splitAxis: "v" | "h"; // "v" = left|right, "h" = top|bottom
  splitRatio: number; // 0..1
  interactive: boolean;
  height?: string;
  labelBefore?: string;
  labelAfter?: string;
  altBefore?: string;
  altAfter?: string;
}

export type StreamState = "idle" | "streaming" | "done" | "error";

export interface StreamBlockMeta {
  streamUrl?: string;
  state: StreamState;
  bufferStrategy: "append" | "replace";
  errorMessage?: string;
}

export interface ImageBlockMeta {
  width?: string;
  height?: string;
  maxWidth?: string;
  maxHeight?: string;
}

export interface TableBlockMeta {
  columnWidths?: number[];
}

export interface BlockMetadata {
  [key: string]: unknown;
  nlp?: NLPBlockAnnotation;
  parentId?: string;
  children?: string[];
  splitAxis?: "v" | "h";
  splitRatio?: number;
  ratios?: number[];
  interactive?: boolean;
  beforeSrc?: string;
  afterSrc?: string;
  height?: string;
  labelBefore?: string;
  labelAfter?: string;
  altBefore?: string;
  altAfter?: string;
  variant?: CalloutVariant;
  icon?: string;
  title?: string;
  src?: string;
  aspectRatio?: string;
  caption?: string;
  allow?: string;
  streamUrl?: string;
  state?: StreamState;
  bufferStrategy?: "append" | "replace";
  errorMessage?: string;
  gap?: string;
  alignItems?: string;
  justifyContent?: string;
  columnWidths?: number[];
  childSizes?: string[];
  width?: string;
  maxWidth?: string;
  maxHeight?: string;
}

export class Block {
  private id: string;
  private type: BlockType;
  private contentSignal: Signal<string>;
  private styleRefSignal: Signal<BlockStyleReference>;
  private metadataSignal: Signal<BlockMetadata>;

  constructor(id: string, type: BlockType, content = "", styleId?: string, metadata?: BlockMetadata) {
    this.id = id;
    this.type = type;
    this.contentSignal = signal(content);
    this.metadataSignal = signal(metadata ?? {});
    const defaultStyle = defaultBlockStyles[type] ?? "body";
    this.styleRefSignal = signal<BlockStyleReference>({ styleId: styleId ?? defaultStyle });
  }

  getId(): string {
    return this.id;
  }
  getType(): BlockType {
    return this.type;
  }
  getContent(): string {
    return this.contentSignal.value;
  }
  getContentSignal(): Signal<string> {
    return this.contentSignal;
  }

  getStyleId(): string {
    return this.styleRefSignal.value.styleId;
  }
  getStyleRef(): BlockStyleReference {
    return { ...this.styleRefSignal.value };
  }
  getStyleRefSignal(): Signal<BlockStyleReference> {
    return this.styleRefSignal;
  }
  getStyleOverrides(): CSSProperties {
    return { ...this.styleRefSignal.value.overrides };
  }

  getMetadata(): BlockMetadata {
    return { ...this.metadataSignal.value };
  }
  getMetadataSignal(): Signal<BlockMetadata> {
    return this.metadataSignal;
  }
  getMetadataField(key: string): unknown {
    return this.metadataSignal.value[key];
  }

  setContent(content: string): void {
    this.contentSignal.value = content;
  }

  setStyleId(styleId: string): void {
    this.styleRefSignal.value = { ...this.styleRefSignal.value, styleId };
  }

  setStyleOverrides(overrides: CSSProperties): void {
    this.styleRefSignal.value = {
      styleId: this.styleRefSignal.value.styleId,
      overrides,
    };
  }

  setMetadata(metadata: BlockMetadata): void {
    this.metadataSignal.value = { ...metadata };
  }

  updateMetadata(key: string, value: unknown): void {
    this.metadataSignal.value = { ...this.metadataSignal.value, [key]: value };
  }

  getNLPAnnotation(): NLPBlockAnnotation | undefined {
    return this.metadataSignal.value.nlp;
  }

  setNLPAnnotation(annotation: NLPBlockAnnotation): void {
    this.updateMetadata("nlp", annotation);
  }

  clearNLPAnnotation(): void {
    const { nlp: _removed, ...rest } = this.metadataSignal.value;
    this.metadataSignal.value = rest;
  }

  isLayoutContainer(): boolean {
    return this.type === "hbox" || this.type === "vbox" || this.type === "columns";
  }

  isInteractiveBlock(): boolean {
    return this.type === "reveal" || this.type === "stream";
  }

  isNLPBlock(): boolean {
    return this.type === "nlp-block" || this.type === "nlp-tree";
  }

  isImage(): boolean {
    return this.type === "img" || this.type === "figure";
  }

  isTextBlock(): boolean {
    return this.type === "p" || this.type === "h1" || this.type === "h2" || this.type === "h3" || this.type === "nlp-block";
  }

  getChildIds(): string[] {
    const meta = this.metadataSignal.value;
    if (this.type === "columns") {
      return (meta.ratios ? (meta.children as string[] | undefined) : undefined) ?? [];
    }
    return (meta.children as string[] | undefined) ?? [];
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      content: this.contentSignal.value,
      styleRef: this.styleRefSignal.value,
      metadata: this.metadataSignal.value,
    };
  }

  static fromJSON(data: {
    id: string;
    type: BlockType;
    content?: string;
    styleRef?: { styleId?: string; overrides?: CSSProperties };
    metadata?: BlockMetadata;
  }): Block {
    const block = new Block(data.id, data.type, data.content ?? "", data.styleRef?.styleId, data.metadata ?? {});
    if (data.styleRef?.overrides) {
      block.setStyleOverrides(data.styleRef.overrides);
    }
    return block;
  }
}
