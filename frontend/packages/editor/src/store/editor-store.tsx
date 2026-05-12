import React, {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type { SBlock, SDocument, SDocMeta, SPageConfig, SStyleClass, SStyleProps, Span, TextBlockType } from "../models/sdm";
import { isTextBlock } from "../models/sdm";
import type { DocumentIntent, NLPVisibilityFlags, WorkspaceContext } from "../models/editor-context";
import { DEFAULT_NLP_FLAGS } from "../models/editor-context";
import type { DocumentNLPSummary, NLPToken } from "../models/nlp";
import { focusBlockEditable, focusBlockNavigationTarget } from "../utils/block-focus";
import { normalizeDocumentMetadata } from "../models/document-meta";
import {
  applyDocMutations,
  deleteBlock,
  duplicateBlock,
  flattenBlocks,
  insertBlock,
  moveBlock,
  setChildren,
  updateBlock,
} from "../models/sdm-factory";
import { type HistoryState, createHistory, pushHistory, undoHistory, redoHistory } from "../models/history";




function nowSecs(): number { return Math.floor(Date.now() / 1000); }

export interface SelectedTokenRef {
  blockId: string;
  tokenIndex: number;
}

export interface EditorState {
  doc: SDocument | null;
  docHistory: HistoryState<SDocument | null>;
  selectedBlockId: string | null;
  editingBlockId: string | null;
  selectedToken: SelectedTokenRef | null;
  context: WorkspaceContext;
  intent: DocumentIntent;
  nlpFlags: NLPVisibilityFlags;
  nlpSummary: DocumentNLPSummary | null;
  isAnalyzing: boolean;
  isDirty: boolean;
  isExporting: boolean;
  statusMessage: { text: string; kind: "info" | "success" | "warning" | "error" } | null;
  documentPath: string | null;
}




export type EditorAction =
  | { type: "SET_DOCUMENT"; doc: SDocument | null }
  | { type: "LOAD_DOCUMENT"; doc: SDocument; path: string | null; context?: WorkspaceContext }
  | { type: "UPDATE_BLOCK"; id: string; patch: Partial<Omit<SBlock, "type" | "id">> }
  | { type: "SET_BLOCK_SPANS"; id: string; spans: Span[] }
  | { type: "SET_BLOCK_TEXT"; id: string; text: string }
  | { type: "ADD_BLOCK"; block: SBlock; afterId?: string }
  | { type: "DELETE_BLOCK"; id: string }
  | { type: "MERGE_BLOCK_UP"; id: string }
  | { type: "SELECT_NEIGHBOR"; direction: "up" | "down" }
  | { type: "MOVE_BLOCK"; id: string; direction: "up" | "down" }
  | { type: "DUPLICATE_BLOCK"; id: string }
  | { type: "SET_CHILDREN"; id: string; children: SBlock[] }
  | { type: "SELECT_BLOCK"; id: string | null }
  | { type: "SELECT_TOKEN"; blockId: string; tokenIndex: number }
  | { type: "CLEAR_SELECTED_TOKEN" }
  | { type: "START_EDITING_BLOCK"; id: string; moveCaretToEnd?: boolean }
  | { type: "STOP_EDITING_BLOCK"; id?: string }
  | { type: "SET_CONTEXT"; context: WorkspaceContext }
  | { type: "SET_INTENT"; intent: DocumentIntent }
  | { type: "SET_NLP_FLAGS"; flags: Partial<NLPVisibilityFlags> }
  | { type: "SET_NLP_SUMMARY"; summary: DocumentNLPSummary | null }
  | { type: "SET_ANALYZING"; value: boolean }
  | { type: "SET_DIRTY"; value: boolean }
  | { type: "SET_EXPORTING"; value: boolean }
  | { type: "SET_STATUS"; text: string; kind: "info" | "success" | "warning" | "error" }
  | { type: "CLEAR_STATUS" }
  | { type: "UPDATE_META"; meta: Partial<SDocMeta> }
  | { type: "UPDATE_PAGE"; page: Partial<SPageConfig> }
  | { type: "CHANGE_BLOCK_TYPE"; id: string; newType: TextBlockType }
  | { type: "ADD_STYLE_CLASS"; id: string; cls: SStyleClass }
  | { type: "REMOVE_STYLE_CLASS"; id: string }
  | { type: "UPDATE_STYLE_CLASS"; id: string; patch: Partial<SStyleProps> }
  | { type: "IMPORT_BLOCKS"; blocks: SBlock[]; afterId?: string }
  | { type: "SET_DOCUMENT_PATH"; path: string | null }
  | { type: "UNDO" }
  | { type: "REDO" };




function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {


    /**
     * Soft update — used for NLP annotation writes and other non-user-driven
     * doc replacements.  Does NOT push a history entry or clear selection/path.
     */
    case "SET_DOCUMENT":
      return { ...state, doc: action.doc };

    /**
     * Full load — resets history, path, context, dirty flag and selection.
     * This is the canonical action for opening / creating a document.
     */
    case "LOAD_DOCUMENT":
      {
        const normalizedDoc = normalizeDocumentMetadata(action.doc, action.path);
      return {
        ...state,
        doc: normalizedDoc,
        docHistory: createHistory(normalizedDoc),
        documentPath: action.path ?? null,
        context: action.context ?? "layout",
        isDirty: false,
        editingBlockId: null,
        selectedBlockId: null,
        selectedToken: null,
      };
      }

    /**
     * Block mutations
     * each pushes a history entry
     */
    case "UPDATE_BLOCK": {
      if (!state.doc) return state;
      const newBlocks = updateBlock(
        state.doc.blocks,
        action.id,
        b => ({ ...b, ...action.patch } as SBlock),
      );
      const newDoc = applyDocMutations(state.doc, () => newBlocks);
      return {
        ...state,
        doc: newDoc,
        docHistory: pushHistory(state.docHistory, newDoc),
        isDirty: true,
      };
    }

    case "SET_BLOCK_SPANS": {
      if (!state.doc) return state;
      const { id, spans } = action;
      const newBlocks = updateBlock(
        state.doc.blocks,
        id,
        b => isTextBlock(b) ? { ...b, spans } : b,
      );
      const newDoc = applyDocMutations(state.doc, () => newBlocks);
      return {
        ...state,
        doc: newDoc,
        docHistory: pushHistory(state.docHistory, newDoc),
        isDirty: true,
      };
    }

    case "SET_BLOCK_TEXT": {
      if (!state.doc) return state;
      const { id, text } = action;
      const newBlocks = updateBlock(
        state.doc.blocks,
        id,
        b => b.type === "code" ? { ...b, text } : b,
      );
      const newDoc = applyDocMutations(state.doc, () => newBlocks);
      return {
        ...state,
        doc: newDoc,
        docHistory: pushHistory(state.docHistory, newDoc),
        isDirty: true,
      };
    }

    case "ADD_BLOCK": {
      if (!state.doc) return state;
      const newBlocks = insertBlock(state.doc.blocks, action.block, action.afterId);
      const newDoc = applyDocMutations(state.doc, () => newBlocks);
      return {
        ...state,
        doc: newDoc,
        docHistory: pushHistory(state.docHistory, newDoc),
        isDirty: true,
      };
    }

    case "DELETE_BLOCK": {
      if (!state.doc) return state;
      const newBlocks = deleteBlock(state.doc.blocks, action.id);
      const newDoc = applyDocMutations(state.doc, () => newBlocks);
      return {
        ...state,
        doc: newDoc,
        docHistory: pushHistory(state.docHistory, newDoc),
        selectedBlockId: state.selectedBlockId === action.id ? null : state.selectedBlockId,
        editingBlockId: state.editingBlockId === action.id ? null : state.editingBlockId,
        selectedToken: state.selectedToken?.blockId === action.id ? null : state.selectedToken,
        isDirty: true,
      };
    }

    case "MERGE_BLOCK_UP": {
      if (!state.doc) return state;
      const flat = flattenBlocks(state.doc.blocks);
      const idx = flat.findIndex((b) => b.id === action.id);
      if (idx <= 0) return state; // Can't merge the very first block up

      const current = flat[idx];
      const previous = flat[idx - 1];

      // Ensure both are text blocks
      if (!current || !previous || !("spans" in current) || !("spans" in previous)) return state;

      // Combine spans
      const mergedSpans = [...(previous.spans || []), ...(current.spans || [])];

      // Update previous block
      let newBlocks = updateBlock(state.doc.blocks, previous.id, (b) => ({
        ...b,
        spans: mergedSpans,
      }));

      // Delete current block
      newBlocks = deleteBlock(newBlocks, current.id);

      const newDoc = applyDocMutations(state.doc, () => newBlocks);

      // Focus the end of the previous block
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-block-id="${previous.id}"] [contenteditable]`) as HTMLElement | null;
        if (el) {
          el.focus();
          // Move caret to the end of the previous text
          const range = document.createRange();
          const sel = window.getSelection();
          range.selectNodeContents(el);
          range.collapse(false);
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      });

      return {
        ...state,
        doc: newDoc,
        docHistory: pushHistory(state.docHistory, newDoc),
        selectedBlockId: previous.id,
        isDirty: true,
      };
    }

    case "SELECT_NEIGHBOR": {
      if (!state.doc || !state.selectedBlockId) return state;
      const flat = flattenBlocks(state.doc.blocks);
      const idx = flat.findIndex((b) => b.id === state.selectedBlockId);
      if (idx === -1) return state;

      let nextIdx = idx;
      if (action.direction === "up" && idx > 0) nextIdx = idx - 1;
      if (action.direction === "down" && idx < flat.length - 1) nextIdx = idx + 1;
      const nextBlock = flat[nextIdx];
      if (!nextBlock) return state;
      const nextId = nextBlock.id;
      requestAnimationFrame(() => focusBlockNavigationTarget(nextId));
      return { ...state, selectedBlockId: nextId, editingBlockId: null };
    }

    case "MOVE_BLOCK": {
      if (!state.doc) return state;
      const newBlocks = moveBlock(state.doc.blocks, action.id, action.direction);
      const newDoc = applyDocMutations(state.doc, () => newBlocks);
      return {
        ...state,
        doc: newDoc,
        docHistory: pushHistory(state.docHistory, newDoc),
        isDirty: true,
      };
    }

    case "DUPLICATE_BLOCK": {
      if (!state.doc) return state;
      const newBlocks = duplicateBlock(state.doc.blocks, action.id);
      const newDoc = applyDocMutations(state.doc, () => newBlocks);
      return {
        ...state,
        doc: newDoc,
        docHistory: pushHistory(state.docHistory, newDoc),
        isDirty: true,
      };
    }

    case "SET_CHILDREN": {
      if (!state.doc) return state;
      const newBlocks = setChildren(state.doc.blocks, action.id, action.children);
      const newDoc = applyDocMutations(state.doc, () => newBlocks);
      return {
        ...state,
        doc: newDoc,
        docHistory: pushHistory(state.docHistory, newDoc),
        isDirty: true,
      };
    }

    case "CHANGE_BLOCK_TYPE": {
      if (!state.doc) return state;
      const newBlocks = updateBlock(
        state.doc.blocks,
        action.id,
        (b) => {
          // Only switch among text block types — structural types are not changeable here.
          if (!("spans" in b)) return b;
          return { ...b, type: action.newType } as SBlock;
        },
      );
      const newDoc = applyDocMutations(state.doc, () => newBlocks);
      return {
        ...state,
        doc: newDoc,
        docHistory: pushHistory(state.docHistory, newDoc),
        isDirty: true,
      };
    }

    case "IMPORT_BLOCKS": {
      if (!state.doc) return state;
      let newBlocks: SBlock[];
      if (action.afterId != null) {
        const idx = state.doc.blocks.findIndex((b) => b.id === action.afterId);
        newBlocks = idx === -1
          ? [...state.doc.blocks, ...action.blocks]
          : [
              ...state.doc.blocks.slice(0, idx + 1),
              ...action.blocks,
              ...state.doc.blocks.slice(idx + 1),
            ];
      } else {
        newBlocks = [...state.doc.blocks, ...action.blocks];
      }
      const newDoc = applyDocMutations(state.doc, () => newBlocks);
      return {
        ...state,
        doc: newDoc,
        docHistory: pushHistory(state.docHistory, newDoc),
        isDirty: true,
      };
    }

    case "ADD_STYLE_CLASS": {
      if (!state.doc) return state;
      const newDoc = {
        ...state.doc,
        styles: { ...state.doc.styles, [action.id]: action.cls },
        meta: { ...state.doc.meta, updated_at: nowSecs() },
      };
      return {
        ...state,
        doc: newDoc,
        docHistory: pushHistory(state.docHistory, newDoc),
        isDirty: true,
      };
    }

    case "UPDATE_STYLE_CLASS": {
      if (!state.doc) return state;
      const existing = state.doc.styles[action.id];
      if (!existing) return state;
      // Merge patch, deleting keys whose value is undefined.
      const newProps = { ...existing.props } as Record<string, unknown>;
      for (const [k, v] of Object.entries(action.patch as Record<string, unknown>)) {
        if (v === undefined) delete newProps[k];
        else newProps[k] = v;
      }
      const newDoc = {
        ...state.doc,
        styles: {
          ...state.doc.styles,
          [action.id]: { ...existing, props: newProps as SStyleProps },
        },
        meta: { ...state.doc.meta, updated_at: nowSecs() },
      };
      return {
        ...state,
        doc: newDoc,
        docHistory: pushHistory(state.docHistory, newDoc),
        isDirty: true,
      };
    }

    case "REMOVE_STYLE_CLASS": {
      if (!state.doc) return state;
      const styles = { ...state.doc.styles };
      // Capture before closure — TypeScript cannot narrow `action` inside a nested function.
      const removedId = action.id;
      delete styles[removedId];
      // Recursively strip the class reference from every block that held it.
      function stripStyle(blocks: SBlock[]): SBlock[] {
        return blocks.map((b) => {
          // Remove the style reference by omitting the key (not setting to undefined)
          // because exactOptionalPropertyTypes forbids `style: undefined`.
          let next: SBlock;
          if (b.style === removedId) {
            const { style: _removed, ...rest } = b;
            next = rest as SBlock;
          } else {
            next = b;
          }
          if ("children" in next && Array.isArray((next as { children?: unknown }).children)) {
            const ch = stripStyle((next as { children: SBlock[] }).children);
            return { ...next, children: ch } as SBlock;
          }
          return next;
        });
      }
      const newDoc = {
        ...state.doc,
        styles,
        blocks: stripStyle(state.doc.blocks),
        meta: { ...state.doc.meta, updated_at: nowSecs() },
      };
      return {
        ...state,
        doc: newDoc,
        docHistory: pushHistory(state.docHistory, newDoc),
        isDirty: true,
      };
    }

    case "UPDATE_META": {
      if (!state.doc) return state;
      const newDoc = {
        ...state.doc,
        meta: { ...state.doc.meta, ...action.meta, updated_at: nowSecs() },
      };
      return {
        ...state,
        doc: newDoc,
        docHistory: pushHistory(state.docHistory, newDoc),
        isDirty: true,
      };
    }

    case "UPDATE_PAGE": {
      if (!state.doc) return state;
      const newDoc = {
        ...state.doc,
        page: { ...state.doc.page, ...action.page },
        meta: { ...state.doc.meta, updated_at: nowSecs() },
      };
      return {
        ...state,
        doc: newDoc,
        docHistory: pushHistory(state.docHistory, newDoc),
        isDirty: true,
      };
    }

    /**
     * history
     * Undo / Redo
     */
    case "UNDO": {
      const newHistory = undoHistory(state.docHistory);
      if (newHistory === state.docHistory) return state;
      return { ...state, doc: newHistory.present, docHistory: newHistory, isDirty: true };
    }

    case "REDO": {
      const newHistory = redoHistory(state.docHistory);
      if (newHistory === state.docHistory) return state;
      return { ...state, doc: newHistory.present, docHistory: newHistory, isDirty: true };
    }

    /**
     * UI / selection state
     * (no history)
     */
    case "SELECT_BLOCK":
      if (state.context === "layout" && action.id) {
        const nextId = action.id;
        requestAnimationFrame(() => focusBlockNavigationTarget(nextId));
      }
      return {
        ...state,
        selectedBlockId: action.id,
        editingBlockId: null,
        selectedToken: action.id && state.selectedToken?.blockId === action.id ? state.selectedToken : null,
      };

    case "SELECT_TOKEN":
      return {
        ...state,
        selectedBlockId: action.blockId,
        selectedToken: { blockId: action.blockId, tokenIndex: action.tokenIndex },
      };

    case "CLEAR_SELECTED_TOKEN":
      return { ...state, selectedToken: null };

    case "START_EDITING_BLOCK":
      if (state.context !== "layout") return state;
      requestAnimationFrame(() => focusBlockEditable(action.id, action.moveCaretToEnd ?? false));
      return {
        ...state,
        selectedBlockId: action.id,
        editingBlockId: action.id,
      };

    case "STOP_EDITING_BLOCK":
      if (!action.id || state.editingBlockId === action.id) {
        return { ...state, editingBlockId: null };
      }
      return state;

    case "SET_CONTEXT":
      return {
        ...state,
        context: action.context,
        editingBlockId: action.context === "layout" ? state.editingBlockId : null,
        selectedToken: action.context === "nlp" ? state.selectedToken : null,
      };

    case "SET_INTENT":
      return { ...state, intent: action.intent };

    case "SET_NLP_FLAGS":
      return { ...state, nlpFlags: { ...state.nlpFlags, ...action.flags } };

    case "SET_NLP_SUMMARY":
      return { ...state, nlpSummary: action.summary };

    case "SET_ANALYZING":
      return { ...state, isAnalyzing: action.value };

    case "SET_DIRTY":
      return { ...state, isDirty: action.value };

    case "SET_EXPORTING":
      return { ...state, isExporting: action.value };

    case "SET_STATUS":
      return { ...state, statusMessage: { text: action.text, kind: action.kind } };

    case "CLEAR_STATUS":
      return { ...state, statusMessage: null };

    case "SET_DOCUMENT_PATH":
      return { ...state, documentPath: action.path };

    default:
      return state;
  }
}


interface EditorContextValue {
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
}

const EditorContext = createContext<EditorContextValue | null>(null);


interface EditorProviderProps {
  children: ReactNode;
  initialDoc?: SDocument;
  initialContext?: WorkspaceContext;
  initialIntent?: DocumentIntent;
  initialPath?: string | null;
}

export function EditorProvider({
  children,
  initialDoc,
  initialContext = "layout",
  initialIntent = "freeform",
  initialPath,
}: EditorProviderProps): React.ReactElement {
  const normalizedInitialDoc = initialDoc
    ? normalizeDocumentMetadata(initialDoc, initialPath ?? null)
    : null;
  const [state, dispatch] = useReducer(editorReducer, {
    doc: normalizedInitialDoc,
    docHistory: createHistory(normalizedInitialDoc),
    selectedBlockId: null,
    editingBlockId: null,
    selectedToken: null,
    context: initialContext,
    intent: initialIntent,
    nlpFlags: DEFAULT_NLP_FLAGS,
    nlpSummary: null,
    isAnalyzing: false,
    isDirty: false,
    isExporting: false,
    statusMessage: null,
    documentPath: initialPath ?? null,
  } satisfies EditorState);

  const value = useMemo<EditorContextValue>(() => ({ state, dispatch }), [state]);

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}



/** Returns `{ state, dispatch }` from the nearest `EditorProvider`. */
export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor must be used inside <EditorProvider>");
  return ctx;
}

/** Returns the current document. Throws if no document is loaded. */
export function useEditorDoc(): SDocument {
  const { state } = useEditor();
  if (!state.doc) throw new Error("useEditorDoc: no document is loaded in the editor store");
  return state.doc;
}

/**
 * Returns the `SBlock` matching `selectedBlockId` by searching the full block
 * tree, or `null` when nothing is selected or the block can't be found.
 */
export function useSelectedBlock(): SBlock | null {
  const { state } = useEditor();
  return useMemo(() => {
    if (!state.doc || !state.selectedBlockId) return null;
    const flat = flattenBlocks(state.doc.blocks);
    return flat.find(b => b.id === state.selectedBlockId) ?? null;
  }, [state.doc, state.selectedBlockId]);
}

export function useSelectedToken():
  | { block: SBlock; token: NLPToken; tokenIndex: number }
  | null {
  const { state } = useEditor();
  return useMemo(() => {
    if (!state.doc || !state.selectedToken) return null;
    const flat = flattenBlocks(state.doc.blocks);
    const block = flat.find((candidate) => candidate.id === state.selectedToken?.blockId);
    if (!block || !isTextBlock(block) || !block.nlp) return null;
    const token = block.nlp.tokens[state.selectedToken.tokenIndex];
    if (!token) return null;
    return { block, token, tokenIndex: state.selectedToken.tokenIndex };
  }, [state.doc, state.selectedToken]);
}

/** Returns true when there are undo steps available. */
export function useCanUndo(): boolean {
  const { state } = useEditor();
  return state.docHistory.past.length > 0;
}

/** Returns true when there are redo steps available. */
export function useCanRedo(): boolean {
  const { state } = useEditor();
  return state.docHistory.future.length > 0;
}
