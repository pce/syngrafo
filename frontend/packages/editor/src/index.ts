// SDM types and type guards
export * from "./models/sdm";

// Factory and immutable tree operations
export * from "./models/sdm-factory";

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
export { EditorProvider, useEditor, useEditorDoc, useSelectedBlock } from "./store/editor-store";
export type { EditorState, EditorAction } from "./store/editor-store";

// Shell component
export { EditorShell } from "./EditorShell";
export type { EditorShellProps } from "./EditorShell";
