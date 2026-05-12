// store/dms-store.ts ──────────────────────────────────────────────────────────
// Global state for the Papierkram DMS UI.
// Uses React context + useReducer — no external dependencies.


import React, {
  createContext,
  useContext,
  useReducer,
  type ReactNode,
} from "react";

import type {
  FsEntry,
  Zone,
  DocMetadata,
  SearchResult,
  FileStats,
} from "../services/dms-service";



export interface IndexStatus {
  total:   number;
  indexed: number;
  errors:  number;
}

export interface DmsState {
  /** The active sandboxed workspace (in_path + out_path). If null, we are in Global/Input mode. */
  zone:             Zone | null;

  /** Absolute path of the directory currently shown in the file browser. */
  currentPath:      string;

  /** Explicit folder context used by folder-centric dashboards and widgets. */
  selectedDirectory:string | null;

  /** Absolute path of the file the user has clicked/selected. */
  selectedPath:     string | null;

  /** Flat list of entries returned by the last scanDir call. */
  entries:          FsEntry[];

  /** Path of the file whose content is shown in the DocumentViewer. */
  viewerPath:       string | null;

  /** Raw text content of the file shown in the DocumentViewer. */
  viewerContent:    string | null;

  /** NLP metadata stored in the SQLite index, if the file is indexed. */
  metadata:         DocMetadata | null;

  /** True while a bulk-index operation is in progress. */
  indexing:         boolean;

  /** True while NLP analysis is in progress (right panel spinner). */
  analysisLoading:  boolean;

  /** Counters for the bulk-index progress bar. */
  indexStatus:      IndexStatus;

  /** Last error message (shown in UI; cleared on next successful action). */
  error:            string | null;

  /** True while a search request is in flight. */
  searching:        boolean;

  /** The current search query string. */
  searchQuery:      string;

  /** Results from the last dms.search() / nlp.semanticSearch() call. */
  searchResults:    SearchResult[];

  /** All known zones in history. */
  zones:            Zone[];

  /** True if we are in "Global Input" mode vs "Zone" mode. */
  isGlobalMode:     boolean;

  /** Always-available stats for the currently selected file (kind, size, mtime, etc.).
   *  Populated by dms_file_stats — works for any file, indexed or not. */
  fileStats:        FileStats | null;
}

const initialState: DmsState = {
  zone:            null,
  currentPath:     "",
  selectedDirectory: null,
  selectedPath:    null,
  entries:         [],
  viewerPath:      null,
  viewerContent:   null,
  metadata:        null,
  indexing:        false,
  analysisLoading: false,
  indexStatus:     { total: 0, indexed: 0, errors: 0 },
  error:           null,
  searching:       false,
  searchQuery:     "",
  searchResults:   [],
  zones:           [],
  isGlobalMode:    true,
  fileStats:       null,
};



export type DmsAction =
  | { type: "SET_ZONE";            zone:     Zone | null         }
  | { type: "SET_ZONES";           zones:    Zone[]              }
  | { type: "SET_PATH";            path:     string              }
  | { type: "SET_SELECTED_DIRECTORY"; path:  string | null       }
  | { type: "SET_ENTRIES";         entries:  FsEntry[]           }
  | { type: "SELECT_FILE";         path:     string | null       }
  | { type: "SET_VIEWER";          path:     string; content: string }
  | { type: "SET_VIEWER_PATH";     path:     string              }
  | { type: "SET_VIEWER_CONTENT";  content:  string | null       }
  | { type: "SET_METADATA";        metadata: DocMetadata | null  }
  | { type: "SET_ANALYSIS_LOADING";loading:  boolean             }
  | { type: "SET_ERROR";           error:    string              }
  | { type: "CLEAR_ERROR"                                        }
  | { type: "SET_INDEXING";        indexing: boolean             }
  | { type: "SET_INDEX_STATUS";    status:   Partial<IndexStatus>}
  | { type: "SET_SEARCHING";       searching: boolean            }
  | { type: "SET_SEARCH_QUERY";    query:    string              }
  | { type: "SET_SEARCH_RESULTS";  results:  SearchResult[]      }
  | { type: "SET_GLOBAL_MODE";     isGlobal: boolean             }
  | { type: "SET_FILE_STATS";      stats: FileStats | null       };



function reducer(state: DmsState, action: DmsAction): DmsState {
  switch (action.type) {
    case "SET_ZONE":
      return {
        ...state,
        zone:         action.zone,
        // Default to browsing in_path (source files) when a zone is opened,
        // so the user sees their documents immediately.
        // Clear path when leaving a zone — user picks a folder via "Select Inbox".
        currentPath:  action.zone ? action.zone.in_path : "",
        selectedDirectory: action.zone ? action.zone.in_path : null,
        selectedPath: null,
        viewerPath: null,
        viewerContent: null,
        metadata: null,
        fileStats: null,
        isGlobalMode: action.zone === null,
        entries:      [],
        error:        null,
      };

    case "SET_FILE_STATS":
      return { ...state, fileStats: action.stats };

    case "SET_GLOBAL_MODE":
      return {
        ...state,
        isGlobalMode: action.isGlobal,
        zone: action.isGlobal ? null : state.zone,
        // When switching back to global input mode, clear path so user picks their inbox.
        currentPath: action.isGlobal ? "" : (state.zone ? state.zone.out_path : state.currentPath),
        selectedDirectory: action.isGlobal ? null : (state.zone ? state.zone.out_path : state.currentPath),
      };

    case "SET_ZONES":
      return { ...state, zones: action.zones };

    case "SET_PATH":
      return {
        ...state,
        currentPath: action.path,
        selectedDirectory: action.path,
        selectedPath: null,
        viewerPath: null,
        viewerContent: null,
        metadata: null,
        fileStats: null,
        error: null,
      };

    case "SET_SELECTED_DIRECTORY":
      return {
        ...state,
        selectedDirectory: action.path,
      };

    case "SET_ENTRIES":
      return { ...state, entries: action.entries };

    case "SELECT_FILE":
      return {
        ...state,
        selectedPath:   action.path,
        viewerPath:     action.path,
        viewerContent:  null,
        metadata:       null,
        fileStats:      null,
        error:          null,
      };

    case "SET_VIEWER_CONTENT":
      return {
        ...state,
        viewerContent: action.content,
      };

    case "SET_VIEWER_PATH":
      return {
        ...state,
        viewerPath:    action.path,
        viewerContent: null,
        error:         null,
      };

    case "SET_VIEWER":
      return {
        ...state,
        viewerPath:    action.path,
        viewerContent: action.content,
      };

    case "SET_METADATA":
      return { ...state, metadata: action.metadata };

    case "SET_ANALYSIS_LOADING":
      return { ...state, analysisLoading: action.loading };

    case "SET_ERROR":
      return { ...state, error: action.error };

    case "CLEAR_ERROR":
      return { ...state, error: null };

    case "SET_INDEXING":
      return { ...state, indexing: action.indexing };

    case "SET_INDEX_STATUS":
      return {
        ...state,
        indexStatus: { ...state.indexStatus, ...action.status },
      };

    case "SET_SEARCHING":
      return { ...state, searching: action.searching };

    case "SET_SEARCH_QUERY":
      return { ...state, searchQuery: action.query };

    case "SET_SEARCH_RESULTS":
      return { ...state, searchResults: action.results, searching: false };

    default:
      return state;
  }
}



interface DmsContextValue {
  state:    DmsState;
  dispatch: React.Dispatch<DmsAction>;
}

const DmsContext = createContext<DmsContextValue | null>(null);



export function DmsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <DmsContext.Provider value={{ state, dispatch }}>
      {children}
    </DmsContext.Provider>
  );
}



export function useDms(): DmsContextValue {
  const ctx = useContext(DmsContext);
  if (!ctx) {
    throw new Error("useDms must be used inside <DmsProvider>");
  }
  return ctx;
}
