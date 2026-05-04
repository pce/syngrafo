import React, { createContext, useContext, useReducer, type ReactNode } from "react";
import type { DocumentModel } from "../models/document";
import type { Block } from "../models/block";
import type { WorkspaceContext, DocumentIntent, NLPVisibilityFlags } from "../models/editor-context";
import { DEFAULT_NLP_FLAGS } from "../models/editor-context";
import type { DocumentNLPSummary } from "../models/nlp";

export interface EditorState {
  document: DocumentModel | null;
  context: WorkspaceContext;
  intent: DocumentIntent;
  selectedBlockId: string | null;
  nlpFlags: NLPVisibilityFlags;
  nlpSummary: DocumentNLPSummary | null;
  isAnalyzing: boolean;
  isDirty: boolean;
  isExporting: boolean;
  statusMessage: { text: string; type: "info" | "success" | "warning" | "error" } | null;
}

export type EditorAction =
  | { type: "SET_DOCUMENT"; document: DocumentModel }
  | { type: "SET_CONTEXT"; context: WorkspaceContext }
  | { type: "SET_INTENT"; intent: DocumentIntent }
  | { type: "SELECT_BLOCK"; blockId: string | null }
  | { type: "SET_NLP_FLAGS"; flags: Partial<NLPVisibilityFlags> }
  | { type: "SET_NLP_SUMMARY"; summary: DocumentNLPSummary | null }
  | { type: "SET_ANALYZING"; isAnalyzing: boolean }
  | { type: "SET_DIRTY"; isDirty: boolean }
  | { type: "SET_EXPORTING"; isExporting: boolean }
  | { type: "SET_STATUS"; text: string; statusType: "info" | "success" | "warning" | "error" }
  | { type: "CLEAR_STATUS" };

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "SET_DOCUMENT":
      return { ...state, document: action.document, isDirty: false };
    case "SET_CONTEXT":
      return { ...state, context: action.context };
    case "SET_INTENT":
      return { ...state, intent: action.intent };
    case "SELECT_BLOCK":
      return { ...state, selectedBlockId: action.blockId };
    case "SET_NLP_FLAGS":
      return { ...state, nlpFlags: { ...state.nlpFlags, ...action.flags } };
    case "SET_NLP_SUMMARY":
      return { ...state, nlpSummary: action.summary };
    case "SET_ANALYZING":
      return { ...state, isAnalyzing: action.isAnalyzing };
    case "SET_DIRTY":
      return { ...state, isDirty: action.isDirty };
    case "SET_EXPORTING":
      return { ...state, isExporting: action.isExporting };
    case "SET_STATUS":
      return { ...state, statusMessage: { text: action.text, type: action.statusType } };
    case "CLEAR_STATUS":
      return { ...state, statusMessage: null };
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
  initialDocument?: DocumentModel;
  initialContext?: WorkspaceContext;
  initialIntent?: DocumentIntent;
}

export function EditorProvider({ children, initialDocument, initialContext = "layout", initialIntent = "freeform" }: EditorProviderProps) {
  const [state, dispatch] = useReducer(editorReducer, {
    document: initialDocument ?? null,
    context: initialContext,
    intent: initialIntent,
    selectedBlockId: null,
    nlpFlags: DEFAULT_NLP_FLAGS,
    nlpSummary: null,
    isAnalyzing: false,
    isDirty: false,
    isExporting: false,
    statusMessage: null,
  } satisfies EditorState);

  return <EditorContext.Provider value={{ state, dispatch }}>{children}</EditorContext.Provider>;
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor must be used inside <EditorProvider>");
  return ctx;
}

export function useEditorDoc(): DocumentModel {
  const { state } = useEditor();
  if (!state.document) throw new Error("No document loaded in editor store");
  return state.document;
}

export function useSelectedBlock(): Block | null {
  const { state } = useEditor();
  if (!state.document || !state.selectedBlockId) return null;
  return state.document.getBlock(state.selectedBlockId);
}
