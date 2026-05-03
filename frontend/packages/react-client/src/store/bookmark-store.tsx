/**
 * bookmark-store.tsx — Zone bookmark state management.
 *
 * Bookmarks are quick-jump targets that live inside a Zone.  They are stored
 * per-zone in the global SQLite DB (zone_bookmarks table) and surfaced here
 * as a lightweight React context so any component in the tree can read and
 * mutate them.
 *
 * Target format (zone-relative materialized path):
 *   path/to/file.py           → whole file
 *   path/to/file.py?10:12     → line range 10–12 (inclusive)
 *   path/to/file.py?10:       → from line 10 to EOF
 *   path/to/folder/           → directory (trailing slash)
 *   path/to/image.png         → image (kind inferred from extension)
 *
 * Canonical URI:  /#<zoneName>/<target>
 *
 * Usage:
 *   const { bookmarks, loading, addBookmark, deleteBookmark } = useBookmarks();
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from "react";

import { dms, type Bookmark, type BookmarkResolveResult } from "../services/dms-service";


interface BookmarkState {
  /** Zone whose bookmarks are currently loaded (empty string = none). */
  zoneName: string;
  /** Ordered list of bookmarks for the active zone. */
  bookmarks: Bookmark[];
  /** True while the initial list is being fetched from the DB. */
  loading: boolean;
  /** Last error message, or null. */
  error: string | null;
}

const initialState: BookmarkState = {
  zoneName:  "",
  bookmarks: [],
  loading:   false,
  error:     null,
};


type BookmarkAction =
  | { type: "SET_ZONE";     zoneName: string }
  | { type: "SET_LOADING";  loading: boolean }
  | { type: "SET_ERROR";    error: string }
  | { type: "CLEAR_ERROR" }
  | { type: "SET_BOOKMARKS"; bookmarks: Bookmark[] }
  | { type: "ADD_BOOKMARK";  bookmark: Bookmark }
  | { type: "DELETE_BOOKMARK"; id: number }
  | { type: "UPDATE_BOOKMARK"; bookmark: Bookmark };


function reducer(state: BookmarkState, action: BookmarkAction): BookmarkState {
  switch (action.type) {
    case "SET_ZONE":
      return { ...initialState, zoneName: action.zoneName };
    case "SET_LOADING":
      return { ...state, loading: action.loading };
    case "SET_ERROR":
      return { ...state, error: action.error, loading: false };
    case "CLEAR_ERROR":
      return { ...state, error: null };
    case "SET_BOOKMARKS":
      return { ...state, bookmarks: action.bookmarks, loading: false, error: null };
    case "ADD_BOOKMARK":
      return {
        ...state,
        // Append and keep sort_order order
        bookmarks: [...state.bookmarks, action.bookmark].sort(
          (a, b) => a.sort_order - b.sort_order || a.id - b.id,
        ),
      };
    case "DELETE_BOOKMARK":
      return {
        ...state,
        bookmarks: state.bookmarks.filter((b) => b.id !== action.id),
      };
    case "UPDATE_BOOKMARK":
      return {
        ...state,
        bookmarks: state.bookmarks
          .map((b) => (b.id === action.bookmark.id ? action.bookmark : b))
          .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
      };
    default:
      return state;
  }
}


interface BookmarkCtx {
  /** Ordered bookmark list for the active zone. */
  bookmarks: Bookmark[];
  /** True while a DB fetch is in progress. */
  loading: boolean;
  /** Last error, or null. */
  error: string | null;
  /** Zone whose bookmarks are currently loaded. */
  zoneName: string;

  /**
   * Load bookmarks for a zone.  Call whenever the active zone changes.
   * No-ops if `zone` is the same as the currently loaded zone.
   */
  loadZone: (zoneName: string) => Promise<void>;

  /**
   * Add a new bookmark to the current zone.
   * `target` is a zone-relative path (e.g. `"src/main.py?10:20"`).
   * Returns the created Bookmark or throws.
   */
  addBookmark: (label: string, target: string) => Promise<Bookmark>;

  /**
   * Remove a bookmark by id.
   */
  deleteBookmark: (id: number) => Promise<void>;

  /**
   * Update a bookmark's label, target, and/or position.
   */
  updateBookmark: (
    id: number,
    label: string,
    target: string,
    sortOrder: number,
  ) => Promise<Bookmark>;

  /**
   * Resolve a zone-relative target to an absolute path + line info.
   * Uses the zone from the bookmarks context (must be loaded first).
   */
  resolveTarget: (target: string) => Promise<BookmarkResolveResult | null>;

  /** Clear the last error. */
  clearError: () => void;
}

const BookmarkContext = createContext<BookmarkCtx | null>(null);


export function BookmarkProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const loadZone = useCallback(async (zoneName: string) => {
    if (!zoneName) return;
    dispatch({ type: "SET_ZONE", zoneName });
    dispatch({ type: "SET_LOADING", loading: true });
    const res = await dms.bookmark.list(zoneName);
    if (res.ok && res.data) {
      dispatch({ type: "SET_BOOKMARKS", bookmarks: res.data });
    } else {
      dispatch({ type: "SET_ERROR", error: res.error ?? "Failed to load bookmarks" });
    }
  }, []);

  const addBookmark = useCallback(
    async (label: string, target: string): Promise<Bookmark> => {
      if (!state.zoneName) throw new Error("No zone loaded");
      const res = await dms.bookmark.add(state.zoneName, label, target);
      if (!res.ok || !res.data) throw new Error(res.error ?? "Failed to add bookmark");
      dispatch({ type: "ADD_BOOKMARK", bookmark: res.data });
      return res.data;
    },
    [state.zoneName],
  );

  const deleteBookmark = useCallback(async (id: number): Promise<void> => {
    const res = await dms.bookmark.delete(id);
    if (!res.ok) throw new Error(res.error ?? "Failed to delete bookmark");
    dispatch({ type: "DELETE_BOOKMARK", id });
  }, []);

  const updateBookmark = useCallback(
    async (
      id: number,
      label: string,
      target: string,
      sortOrder: number,
    ): Promise<Bookmark> => {
      const res = await dms.bookmark.update(id, label, target, sortOrder);
      if (!res.ok || !res.data) throw new Error(res.error ?? "Failed to update bookmark");
      dispatch({ type: "UPDATE_BOOKMARK", bookmark: res.data });
      return res.data;
    },
    [],
  );

  const resolveTarget = useCallback(
    async (target: string): Promise<BookmarkResolveResult | null> => {
      if (!state.zoneName) return null;
      const res = await dms.bookmark.resolve(state.zoneName, target);
      return res.ok && res.data ? res.data : null;
    },
    [state.zoneName],
  );

  const clearError = useCallback(() => dispatch({ type: "CLEAR_ERROR" }), []);

  const ctx = useMemo<BookmarkCtx>(
    () => ({
      bookmarks:    state.bookmarks,
      loading:      state.loading,
      error:        state.error,
      zoneName:     state.zoneName,
      loadZone,
      addBookmark,
      deleteBookmark,
      updateBookmark,
      resolveTarget,
      clearError,
    }),
    [
      state.bookmarks, state.loading, state.error, state.zoneName,
      loadZone, addBookmark, deleteBookmark, updateBookmark, resolveTarget, clearError,
    ],
  );

  return (
    <BookmarkContext.Provider value={ctx}>{children}</BookmarkContext.Provider>
  );
}


export function useBookmarks(): BookmarkCtx {
  const ctx = useContext(BookmarkContext);
  if (!ctx) throw new Error("useBookmarks must be used inside <BookmarkProvider>");
  return ctx;
}

/**
 * Convenience hook: automatically loads bookmarks when `zoneName` changes.
 * Pass the active zone name.  Internally calls `loadZone` on the context.
 *
 * @example
 *   const { bookmarks, addBookmark } = useZoneBookmarks(zone?.name ?? "");
 */
export function useZoneBookmarks(zoneName: string) {
  const ctx = useBookmarks();

  useEffect(() => {
    if (zoneName && zoneName !== ctx.zoneName) {
      void ctx.loadZone(zoneName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneName]);

  return ctx;
}

