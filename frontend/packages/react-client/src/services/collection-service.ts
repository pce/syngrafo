/**
 * collection-service.ts — Data-driven CRUD table contract.
 *
 * A CollectionConfig<T> is pure data: column definitions + service functions.
 * Inject it into <CollectionListView> and you get a fully working table — no
 * per-collection store, no context, no side-effects outside the component tree.
 *
 * Components own their local state; the host component decides where the data
 * comes from (which C++ binding / transform / filter).
 */

import type React from "react";
import type { IconName } from "../components/Icon";



export type CellType = "text" | "number" | "readonly";

export interface ColumnAction<T> {
  /** Icon name — must be a valid IconName. */
  icon:    IconName;
  title:   string;
  handler: (row: T) => void;
  /** Only render when predicate is true (default: always). */
  when?:   (row: T) => boolean;
}

export interface ColumnDef<T> {
  key:      keyof T & string;
  header:   string;
  /** CSS width (e.g. "8rem", "1fr").  Defaults to "1fr". */
  width?:   string;
  /** Whether clicking the cell opens inline edit (default: true). */
  editable?: boolean;
  type?:    CellType;
  /**
   * Custom read-mode renderer.  Return undefined to use the default
   * text renderer so callers can still fall back gracefully.
   */
  render?:  (value: T[keyof T & string], row: T) => React.ReactNode | undefined;
  /** Extra icon-button actions rendered inside the cell on hover. */
  actions?: ColumnAction<T>[];
}



export interface CollectionConfig<T extends { id: number }> {
  /** Column definitions in display order. */
  columns:        ColumnDef<T>[];
  /** Fetch the full list. */
  fetch:          () => Promise<T[]>;
  /**
   * Create a new row.  Called with the draft produced by `newRowFactory`.
   * If omitted the "Add row" button is hidden.
   */
  create?:        (draft: Omit<T, "id">) => Promise<T>;
  /** Persist a cell edit. */
  update:         (id: number, patch: Partial<T>) => Promise<T>;
  /** Delete a row. */
  remove:         (id: number) => Promise<void>;
  /** Text shown when the collection is empty. */
  emptyMessage?:  string;
  /**
   * Factory for the default new-row draft.
   * Required when `create` is provided.
   */
  newRowFactory?: () => Omit<T, "id">;
}
