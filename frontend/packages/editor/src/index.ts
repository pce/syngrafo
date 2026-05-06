// SDM types and type guards
export * from "./models/sdm";

// Factory and immutable tree operations
export * from "./models/sdm-factory";

// Default style classes and document factory
export * from "./models/default-styles";

// Functional history
export * from "./models/history";

// Serialisation
export { encodeDocument, decodeDocument } from "./models/project";

// NLP types and helpers
export * from "./models/nlp";

// Editor context and workspace modes
export * from "./models/editor-context";

// Skill system types
export * from "./models/skill";

// React store
export { EditorProvider, useEditor, useEditorDoc, useSelectedBlock, useCanUndo, useCanRedo } from "./store/editor-store";
export type { EditorState, EditorAction } from "./store/editor-store";

// Shell component
export { EditorShell } from "./EditorShell";
export type { EditorShellProps } from "./EditorShell";

// LM service (local GGUF + remote OpenAI/Ollama)
export {
  isLMAvailable,
  lmStatus,
  lmLoad,
  lmUnload,
  lmChat,
  lmCancel,
  lmCancelAll,
  setLMProviderConfig,
  getLMProviderConfig,
} from "./services/lm-service";
export type {
  LMRole,
  LMMessage,
  LMRequest,
  LMResponse,
  LMUsage,
  LMStatus,
  LMProvider,
  LMProviderConfig,
} from "./services/lm-service";

// LM prompt builder (SDM + HTML paths) + SDM block parser
export {
  LMPromptBuilder,
  lmPromptBuilder,
  parseSdmBlocks,
  buildSdmDocumentContext,
} from "./services/lm-prompt-builder";
export type { ILMPromptBuilder, StyleEntry } from "./services/lm-prompt-builder";

// HTML parser utilities
export { htmlToBlocks, blocksToHtml, htmlToSpans, spansToHtml } from "./services/html-parser";
