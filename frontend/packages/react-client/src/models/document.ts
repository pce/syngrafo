/**
 * Document Model for linguistic analysis.
 * Refactored to use standard TypeScript interfaces and helper functions
 * compatible with React state management.
 */

export interface TextRange {
  start: number;
  end: number;
  label?: string; // e.g., "entity", "error", "pos-tag"
  metadata?: Record<string, any>;
}

export interface DocumentMetadata {
  createdAt: number;
  modifiedAt: number;
  author?: string;
  language?: string;
  lastAnalysis?: number;
}

export interface DocumentStats {
  wordCount: number;
  charCount: number;
  selectionCount: number;
}

/**
 * State interface for the Document.
 * In React, we use this plain object to drive the UI.
 */
export interface DocumentState {
  title: string;
  content: string;
  selections: TextRange[];
  metadata: DocumentMetadata;
}

/**
 * Utility class for creating and manipulating DocumentState.
 * Instead of class-based signals, we use static helpers and a functional approach
 * that works perfectly with React's useState/useReducer.
 */
export class DocumentModel {
  /**
   * Creates a default initial state for a document.
   */
  public static createInitialState(
    initialTitle: string = "Untitled Analysis",
    initialContent: string = "",
  ): DocumentState {
    return {
      title: initialTitle,
      content: initialContent,
      selections: [],
      metadata: {
        createdAt: Date.now(),
        modifiedAt: Date.now(),
        language: "en",
      },
    };
  }

  /**
   * Calculates statistics for a given document state.
   */
  public static getStats(state: DocumentState): DocumentStats {
    const text = state.content || "";
    const words = text
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0).length;

    return {
      wordCount: words,
      charCount: text.length,
      selectionCount: state.selections.length,
    };
  }

  /**
   * Returns a new state with updated content and modified timestamp.
   */
  public static updateContent(
    state: DocumentState,
    text: string,
  ): DocumentState {
    return {
      ...state,
      content: text,
      metadata: {
        ...state.metadata,
        modifiedAt: Date.now(),
      },
    };
  }

  /**
   * Returns a new state with an added highlight.
   */
  public static addHighlight(
    state: DocumentState,
    range: TextRange,
  ): DocumentState {
    return {
      ...state,
      selections: [...state.selections, range],
    };
  }

  /**
   * Returns a new state with highlights cleared.
   */
  public static clearHighlights(state: DocumentState): DocumentState {
    return {
      ...state,
      selections: [],
    };
  }

  /**
   * Extracts text based on a range.
   */
  public static getTextInRange(state: DocumentState, range: TextRange): string {
    return state.content.substring(range.start, range.end);
  }

  /**
   * Serializes the state to JSON.
   */
  public static toJSON(state: DocumentState) {
    return { ...state };
  }

  /**
   * Hydrates state from a JSON object.
   */
  public static fromJSON(data: any): DocumentState {
    const defaultState = this.createInitialState();
    return {
      title: data.title || defaultState.title,
      content: data.content || defaultState.content,
      selections: data.selections || defaultState.selections,
      metadata: data.metadata || defaultState.metadata,
    };
  }
}
