import { signal, type Signal } from "@preact/signals-core";
import { Block } from "./block";
import { StyleLibrary } from "./style";
import type { DocumentIntent } from "./editor-context";

export type PageSize = "a0" | "a1" | "a2" | "a3" | "a4" | "a5" | "a6" | "letter" | "legal";

export const PAGE_SIZE_MM: Record<PageSize, { w: number; h: number }> = {
  a0: { w: 841, h: 1189 },
  a1: { w: 594, h: 841 },
  a2: { w: 420, h: 594 },
  a3: { w: 297, h: 420 },
  a4: { w: 210, h: 297 },
  a5: { w: 148, h: 210 },
  a6: { w: 105, h: 148 },
  letter: { w: 216, h: 279 },
  legal: { w: 216, h: 356 },
};

export type PageCount = 0 | 1 | 2 | 3 | 4 | 5 | number; // 0 = auto; 1+ = fixed count

export type PageScaleMode = "none" | "auto" | "fit";

export interface DocumentMetadata {
  createdAt: number;
  modifiedAt: number;
  author?: string;
  description?: string;
}

export class DocumentModel {
  private titleSignal: Signal<string> = signal("Untitled Document");
  private pageSizeSignal: Signal<PageSize> = signal<PageSize>("a4");
  private pageCountSignal: Signal<PageCount> = signal<PageCount>(0);
  private pageMarginMmSignal: Signal<number> = signal(20);
  private pageScaleModeSignal: Signal<PageScaleMode> = signal<PageScaleMode>("auto");
  private filenameSignal: Signal<string> = signal("document.pdf");
  private blocksSignal: Signal<Block[]> = signal<Block[]>([]);
  private styleLibrarySignal: Signal<StyleLibrary> = signal(new StyleLibrary());
  private metadataSignal: Signal<DocumentMetadata> = signal<DocumentMetadata>({
    createdAt: Date.now(),
    modifiedAt: Date.now(),
  });
  private intentSignal: Signal<DocumentIntent> = signal<DocumentIntent>("freeform");

  constructor(title: string = "Untitled Document", styleLibrary?: StyleLibrary) {
    this.titleSignal.value = title;
    if (styleLibrary) this.styleLibrarySignal.value = styleLibrary;
  }

  getTitle(): string {
    return this.titleSignal.value;
  }
  setTitle(t: string): void {
    this.titleSignal.value = t;
    this.touch();
  }
  get title() {
    return this.titleSignal;
  }

  getPageSize(): PageSize {
    return this.pageSizeSignal.value;
  }
  setPageSize(s: PageSize): void {
    this.pageSizeSignal.value = s;
    this.touch();
  }
  get pageSize() {
    return this.pageSizeSignal;
  }

  getPageCount(): PageCount {
    return this.pageCountSignal.value;
  }
  setPageCount(n: PageCount): void {
    this.pageCountSignal.value = n;
    this.touch();
  }
  get pageCount() {
    return this.pageCountSignal;
  }

  getPageMarginMm(): number {
    return this.pageMarginMmSignal.value;
  }
  setPageMarginMm(mm: number): void {
    this.pageMarginMmSignal.value = Math.max(0, Math.min(50, mm));
    this.touch();
  }
  get pageMarginMm() {
    return this.pageMarginMmSignal;
  }

  getPageScaleMode(): PageScaleMode {
    return this.pageScaleModeSignal.value;
  }
  setPageScaleMode(m: PageScaleMode): void {
    this.pageScaleModeSignal.value = m;
    this.touch();
  }
  get pageScaleMode() {
    return this.pageScaleModeSignal;
  }

  getFilename(): string {
    return this.filenameSignal.value;
  }
  setFilename(f: string): void {
    this.filenameSignal.value = f;
    this.touch();
  }
  get filename() {
    return this.filenameSignal;
  }

  getBlocks(): Block[] {
    return this.blocksSignal.value;
  }

  getBlock(id: string): Block | null {
    return this.blocksSignal.value.find((b) => b.getId() === id) ?? null;
  }

  addBlock(block: Block): void {
    this.blocksSignal.value = [...this.blocksSignal.value, block];
    this.touch();
  }

  setBlocks(blocks: Block[]): void {
    this.blocksSignal.value = [...blocks];
    this.touch();
  }

  removeBlock(id: string): void {
    this.blocksSignal.value = this.blocksSignal.value.filter((b) => b.getId() !== id);
    this.touch();
  }

  get blocks() {
    return this.blocksSignal;
  }

  getStyleLibrary(): StyleLibrary {
    return this.styleLibrarySignal.value;
  }
  setStyleLibrary(lib: StyleLibrary): void {
    this.styleLibrarySignal.value = lib;
    this.touch();
  }
  get styleLibrary() {
    return this.styleLibrarySignal;
  }

  getMetadata(): DocumentMetadata {
    return { ...this.metadataSignal.value };
  }
  get metadata() {
    return this.metadataSignal;
  }

  getIntent(): DocumentIntent {
    return this.intentSignal.value;
  }
  setIntent(intent: DocumentIntent): void {
    this.intentSignal.value = intent;
    this.touch();
  }
  get intent() {
    return this.intentSignal;
  }

  private touch(): void {
    this.metadataSignal.value = { ...this.metadataSignal.value, modifiedAt: Date.now() };
  }

  getBlockCount(): number {
    return this.blocksSignal.value.length;
  }

  getWordCount(): number {
    return this.blocksSignal.value.reduce((n, b) => {
      const c = b.getContent().trim();
      return n + (c ? c.split(/\s+/).filter(Boolean).length : 0);
    }, 0);
  }

  getCharCount(): number {
    return this.blocksSignal.value.reduce((n, b) => n + b.getContent().length, 0);
  }

  toJSON() {
    return {
      title: this.titleSignal.value,
      pageSize: this.pageSizeSignal.value,
      pageCount: this.pageCountSignal.value,
      pageMarginMm: this.pageMarginMmSignal.value,
      pageScaleMode: this.pageScaleModeSignal.value,
      filename: this.filenameSignal.value,
      blocks: this.blocksSignal.value.map((b) => b.toJSON()),
      styles: this.styleLibrarySignal.value.toJSON(),
      metadata: this.metadataSignal.value,
    };
  }

  static fromJSON(data: Record<string, unknown>): DocumentModel {
    const doc = new DocumentModel((data["title"] as string) ?? "Untitled Document", StyleLibrary.fromJSON((data["styles"] as unknown[]) ?? []));
    if (data["pageSize"]) doc.setPageSize(data["pageSize"] as PageSize);
    if (data["pageCount"] !== undefined) doc.setPageCount(data["pageCount"] as PageCount);
    if (data["pageMarginMm"] !== undefined) doc.setPageMarginMm(data["pageMarginMm"] as number);
    if (data["pageScaleMode"]) doc.setPageScaleMode(data["pageScaleMode"] as PageScaleMode);
    if (data["filename"]) doc.setFilename(data["filename"] as string);
    const blocks = data["blocks"];
    if (Array.isArray(blocks)) {
      blocks.forEach((bd: unknown) => doc.addBlock(Block.fromJSON(bd as Parameters<typeof Block.fromJSON>[0])));
    }
    return doc;
  }
}
