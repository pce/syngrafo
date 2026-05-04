/**
 * @syngrafo/editor — public API
 *
 * Import pattern from react-client:
 *   import { EditorProvider, EditorShell, createEmptyDocument } from "@syngrafo/editor";
 */

import { DocumentModel } from "./models/document";

// ── Components ──────────────────────────────────────────────────────────────
export { EditorProvider, useEditor, useEditorDoc, useSelectedBlock } from "./store/editor-store";
export type { EditorState, EditorAction } from "./store/editor-store";
export { EditorShell } from "./EditorShell";
export type { EditorShellProps } from "./EditorShell";

// ── Models ───────────────────────────────────────────────────────────────────
export {
  DocumentModel,
  PAGE_SIZE_MM,
  type PageSize,
  type PageCount,
  type PageScaleMode,
  type DocumentMetadata,
} from "./models/document";

export {
  Block,
  type BlockType,
  type BlockMetadata,
} from "./models/block";

export {
  WORKSPACE_CONTEXTS,
  WORKSPACE_CONTEXT_META,
  DOCUMENT_INTENT_META,
  DEFAULT_NLP_FLAGS,
  type WorkspaceContext,
  type DocumentIntent,
  type NLPVisibilityFlags,
} from "./models/editor-context";

// ── Services / serialisation ─────────────────────────────────────────────────
export { encodePdfProj, decodePdfProj } from "./models/project";

// ── Factory helpers ───────────────────────────────────────────────────────────

/**
 * Create a blank DocumentModel ready to be passed to <EditorShell>.
 * Every call returns a fresh instance — intentionally NOT memoised so
 * callers control the document lifetime (typically via useState).
 */
export function createEmptyDocument(title = "Untitled Document"): DocumentModel {
  return new DocumentModel(title);
}
