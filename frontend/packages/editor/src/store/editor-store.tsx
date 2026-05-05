import React, {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type { SBlock, SDocument, SDocMeta, SPageConfig, Span } from "../models/sdm";
import { isTextBlock } from "../models/sdm";
import type { DocumentIntent, NLPVisibilityFlags, WorkspaceContext } from "../models/editor-context";
import { DEFAULT_NLP_FLAGS } from "../models/editor-context";
import type { DocumentNLPSummary } from "../models/nlp";
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



export interface EditorState {
  doc: SDocument | null;
  selectedBlockId: string | null;
  context: WorkspaceContext;
  intent: DocumentIntent;
  nlpFlags: NLPVisibilityFlags;
  nlpSummary: DocumentNLPSummary | null;
  isAnalyzing: boolean;
  isDirty: boolean;
  isExporting: boolean;
  statusMessage: { text: string; kind: "info" | "success" | "warning" | "error" } | null;
}



export type EditorAction =
  | { type: "SET_DOCUMENT"; doc: SDocument | null }
  | { type: "UPDATE_BLOCK"; id: string; patch: Partial<Omit<SBlock, "type" | "id">> }
  | { type: "SET_BLOCK_SPANS"; id: string; spans: Span[] }
  | { type: "SET_BLOCK_TEXT"; id: string; text: string }
  | { type: "ADD_BLOCK"; block: SBlock; afterId?: string }
  | { type: "DELETE_BLOCK"; id: string }
  | { type: "MOVE_BLOCK"; id: string; direction: "up" | "down" }
  | { type: "DUPLICATE_BLOCK"; id: string }
  | { type: "SET_CHILDREN"; id: string; children: SBlock[] }
  | { type: "SELECT_BLOCK"; id: string | null }
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
  | { type: "UPDATE_PAGE"; page: Partial<SPageConfig> };



function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "SET_DOCUMENT":
      return { ...state, doc: action.doc, isDirty: false, selectedBlockId: null };

    case "UPDATE_BLOCK": {
      if (!state.doc) return state;
      const newBlocks = updateBlock(
        state.doc.blocks,
        action.id,
        b => ({ ...b, ...action.patch } as SBlock),
      );
      return { ...state, doc: applyDocMutations(state.doc, () => newBlocks), isDirty: true };
    }

    case "SET_BLOCK_SPANS": {
      if (!state.doc) return state;
      const { id, spans } = action;
      const newBlocks = updateBlock(
        state.doc.blocks,
        id,
        b => isTextBlock(b) ? { ...b, spans } : b,
      );
      return { ...state, doc: applyDocMutations(state.doc, () => newBlocks), isDirty: true };
    }

    case "SET_BLOCK_TEXT": {
      if (!state.doc) return state;
      const { id, text } = action;
      const newBlocks = updateBlock(
        state.doc.blocks,
        id,
        b => b.type === "code" ? { ...b, text } : b,
      );
      return { ...state, doc: applyDocMutations(state.doc, () => newBlocks), isDirty: true };
    }

    case "ADD_BLOCK": {
      if (!state.doc) return state;
      const newBlocks = insertBlock(state.doc.blocks, action.block, action.afterId);
      return { ...state, doc: applyDocMutations(state.doc, () => newBlocks), isDirty: true };
    }

    case "DELETE_BLOCK": {
      if (!state.doc) return state;
      const newBlocks = deleteBlock(state.doc.blocks, action.id);
      return { ...state, doc: applyDocMutations(state.doc, () => newBlocks), isDirty: true };
    }

    case "MOVE_BLOCK": {
      if (!state.doc) return state;
      const newBlocks = moveBlock(state.doc.blocks, action.id, action.direction);
      return { ...state, doc: applyDocMutations(state.doc, () => newBlocks), isDirty: true };
    }

    case "DUPLICATE_BLOCK": {
      if (!state.doc) return state;
      const newBlocks = duplicateBlock(state.doc.blocks, action.id);
      return { ...state, doc: applyDocMutations(state.doc, () => newBlocks), isDirty: true };
    }

    case "SET_CHILDREN": {
      if (!state.doc) return state;
      const newBlocks = setChildren(state.doc.blocks, action.id, action.children);
      return { ...state, doc: applyDocMutations(state.doc, () => newBlocks), isDirty: true };
    }

    case "SELECT_BLOCK":
      return { ...state, selectedBlockId: action.id };

    case "SET_CONTEXT":
      return { ...state, context: action.context };

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

    case "UPDATE_META": {
      if (!state.doc) return state;
      return {
        ...state,
        doc: { ...state.doc, meta: { ...state.doc.meta, ...action.meta } },
        isDirty: true,
      };
    }

    case "UPDATE_PAGE": {
      if (!state.doc) return state;
      return {
        ...state,
        doc: { ...state.doc, page: { ...state.doc.page, ...action.page } },
        isDirty: true,
      };
    }

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
}

export function EditorProvider({
  children,
  initialDoc,
  initialContext = "layout",
  initialIntent = "freeform",
}: EditorProviderProps): React.ReactElement {
  const [state, dispatch] = useReducer(editorReducer, {
    doc: initialDoc ?? null,
    selectedBlockId: null,
    context: initialContext,
    intent: initialIntent,
    nlpFlags: DEFAULT_NLP_FLAGS,
    nlpSummary: null,
    isAnalyzing: false,
    isDirty: false,
    isExporting: false,
    statusMessage: null,
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
