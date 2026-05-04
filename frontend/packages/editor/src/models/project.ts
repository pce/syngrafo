import { DocumentModel } from "./document";
import { Block, BlockType } from "./block";
import { StyleClass, StyleLibrary } from "./style";
import { DocumentIntent } from "./editor-context";

export const PDFPROJ_VERSION = 3;

/** Minimal serialised form of a single Block (kept flat for LM readability). */
export interface BlockJSON {
  id: string;
  type: BlockType;
  content: string;
  styleId: string;
  /** Inline CSS overrides — omitted when empty to keep the file small. */
  overrides?: Record<string, string>;
  /** Layout / image metadata — omitted when empty. */
  metadata?: Record<string, unknown>;
}

/** Document-level settings (everything except blocks & styles). */
export interface DocumentMeta {
  title: string;
  filename: string;
  pageSize: string;
  pageCount: number;
  pageMarginMm: number;
  pageScaleMode: string;
  createdAt: number;
  modifiedAt: number;
  author?: string;
  description?: string;
  intent?: DocumentIntent;
  editorContext?: string; // last active WorkspaceContext
}

/** Lightweight asset manifest entry (no base-64 blob). */
export interface AssetMeta {
  id: string;
  filename: string;
  uploadedAt: number;
}

/** Top-level .pdfproj file schema. */
export interface PdfProjFile {
  version: typeof PDFPROJ_VERSION;
  savedAt: number;
  document: DocumentMeta;
  styles: ReturnType<StyleClass["toJSON"]>[];
  /** Ordered list of block IDs — defines render order. */
  blockOrder: string[];
  /** Map of id → block data for O(1) lookup. */
  blockIndex: Record<string, BlockJSON>;
  assets: AssetMeta[];
}

export function encodePdfProj(doc: DocumentModel, assets: AssetMeta[] = []): string {
  const meta = doc.getMetadata();
  const documentMeta: DocumentMeta = {
    title: doc.getTitle(),
    filename: doc.getFilename(),
    pageSize: doc.getPageSize(),
    pageCount: doc.getPageCount(),
    pageMarginMm: doc.getPageMarginMm(),
    pageScaleMode: doc.getPageScaleMode(),
    createdAt: meta.createdAt,
    modifiedAt: meta.modifiedAt,
    ...(meta.author ? { author: meta.author } : {}),
    ...(meta.description ? { description: meta.description } : {}),
    intent: doc.getIntent(),
  };

  const blockOrder: string[] = [];
  const blockIndex: Record<string, BlockJSON> = {};

  for (const block of doc.getBlocks()) {
    const id = block.getId();
    blockOrder.push(id);

    const overrides = block.getStyleOverrides();
    const metadata = block.getMetadata();

    const entry: BlockJSON = {
      id,
      type: block.getType(),
      content: block.getContent(),
      styleId: block.getStyleId(),
    };
    if (overrides && Object.keys(overrides).length > 0) {
      entry.overrides = overrides as Record<string, string>;
    }
    if (metadata && Object.keys(metadata).length > 0) {
      entry.metadata = metadata as Record<string, unknown>;
    }

    blockIndex[id] = entry;
  }

  const file: PdfProjFile = {
    version: PDFPROJ_VERSION,
    savedAt: Date.now(),
    document: documentMeta,
    styles: doc.getStyleLibrary().toJSON(),
    blockOrder,
    blockIndex,
    assets,
  };

  return JSON.stringify(file, null, 2);
}

export interface DecodedPdfProj {
  document: DocumentModel;
  assets: AssetMeta[];
  /** Original version tag from the file. */
  version: number;
}

export function decodePdfProj(json: string): DecodedPdfProj {
  let raw: any;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("Invalid .pdfproj file: not valid JSON.");
  }

  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid .pdfproj file: expected a JSON object.");
  }

  // v1 fallback: flat blocks array (no blockOrder/blockIndex)
  if (!raw.blockOrder && Array.isArray(raw.blocks)) {
    // treat raw.blocks as BlockJSON[] with id/type/content/styleRef/metadata
    // build blockOrder and blockIndex from it
    const tempOrder: string[] = [];
    const tempIndex: Record<string, BlockJSON> = {};

    for (const b of raw.blocks as any[]) {
      const id: string = b.id ?? `block-${tempOrder.length}`;
      tempOrder.push(id);
      tempIndex[id] = {
        id,
        type: (b.type ?? "p") as BlockType,
        content: b.content ?? "",
        styleId: b.styleRef?.styleId ?? b.styleId ?? "body",
        overrides: b.styleRef?.overrides ?? b.overrides,
        metadata: b.metadata ?? {},
      };
    }

    raw.blockOrder = tempOrder;
    raw.blockIndex = tempIndex;

    // If v1 has no document object, synthesise one from top-level fields
    if (!raw.document) {
      raw.document = {
        title: raw.title ?? "Untitled Document",
        filename: raw.filename ?? "document.pdf",
        pageSize: raw.pageSize ?? "a4",
        pageCount: raw.pageCount ?? 0,
        pageMarginMm: raw.pageMarginMm ?? 20,
        pageScaleMode: raw.pageScaleMode ?? "auto",
        createdAt: raw.createdAt ?? Date.now(),
        modifiedAt: raw.modifiedAt ?? Date.now(),
        author: raw.author,
        description: raw.description,
      };
    }
  }

  if (!raw.blockOrder || !raw.blockIndex || !raw.document) {
    throw new Error("Invalid .pdfproj file: missing required fields (document / blockOrder / blockIndex).");
  }

  const version: number = raw.version ?? 1;
  const docMeta: DocumentMeta = raw.document;

  const styleLibrary = StyleLibrary.fromJSON(raw.styles ?? []);
  const docModel = new DocumentModel(docMeta.title, styleLibrary);

  docModel.setFilename(docMeta.filename ?? "document.pdf");
  docModel.setPageSize((docMeta.pageSize ?? "a4") as any);
  docModel.setPageCount((docMeta.pageCount ?? 0) as any);
  docModel.setPageMarginMm(docMeta.pageMarginMm ?? 20);
  docModel.setPageScaleMode((docMeta.pageScaleMode ?? "auto") as any);
  docModel.setIntent((docMeta.intent ?? "freeform") as DocumentIntent);

  const blockOrder: string[] = raw.blockOrder;
  const blockIndex: Record<string, BlockJSON> = raw.blockIndex;

  for (const id of blockOrder) {
    const bj = blockIndex[id];
    if (!bj) continue;
    const block = Block.fromJSON({
      id: bj.id,
      type: bj.type,
      content: bj.content,
      styleRef: {
        styleId: bj.styleId,
        ...(bj.overrides ? { overrides: bj.overrides as import("./style").CSSProperties } : {}),
      },
      metadata: bj.metadata ?? {},
    });
    docModel.addBlock(block);
  }

  return {
    document: docModel,
    assets: (raw.assets as AssetMeta[]) ?? [],
    version,
  };
}
