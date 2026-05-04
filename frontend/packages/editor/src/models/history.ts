import { signal, type Signal } from "@preact/signals-core";

export type DocumentSnapshot = Record<string, unknown>;

export interface HistoryEntry {
  snapshot: DocumentSnapshot;
  label: string;
  timestamp: number;
}

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  pointer: number;
  size: number;
  undoLabel: string | null;
  redoLabel: string | null;
}

export const DEFAULT_MAX_SNAPSHOTS = 20;

export class History<T extends DocumentSnapshot = DocumentSnapshot> {
  private stack: HistoryEntry[] = [];
  private pointer = -1; // -1 = empty
  private readonly maxSize: number;

  readonly stateSignal: Signal<HistoryState> = signal<HistoryState>(this.buildState());

  constructor(maxSize: number = DEFAULT_MAX_SNAPSHOTS) {
    if (maxSize < 1) {
      throw new RangeError(`[History] maxSize must be ≥ 1, got ${maxSize}`);
    }
    this.maxSize = maxSize;
  }

  push(snapshot: T, label: string = "Edit"): void {
    // Discard the redo branch
    if (this.pointer < this.stack.length - 1) {
      this.stack.splice(this.pointer + 1);
    }

    this.stack.push({
      snapshot: snapshot as DocumentSnapshot,
      label,
      timestamp: Date.now(),
    });

    // Trim the oldest entry if we exceed the cap
    if (this.stack.length > this.maxSize) {
      this.stack.shift();
    }

    this.pointer = this.stack.length - 1;
    this.emitState();
  }

  undo(): T | null {
    if (!this.canUndo()) return null;
    this.pointer--;
    this.emitState();
    return (this.stack[this.pointer]?.snapshot ?? null) as T | null;
  }

  redo(): T | null {
    if (!this.canRedo()) return null;
    this.pointer++;
    this.emitState();
    return (this.stack[this.pointer]?.snapshot ?? null) as T | null;
  }

  current(): T | null {
    if (this.pointer < 0) return null;
    return (this.stack[this.pointer]?.snapshot ?? null) as T | null;
  }

  canUndo(): boolean {
    return this.pointer > 0;
  }

  canRedo(): boolean {
    return this.pointer < this.stack.length - 1;
  }

  clear(): void {
    this.stack = [];
    this.pointer = -1;
    this.emitState();
  }

  amendCurrent(snapshot: T, label?: string): void {
    if (this.pointer < 0) {
      // Nothing pushed yet — treat as a fresh push
      this.push(snapshot, label);
      return;
    }
    const entry = this.stack[this.pointer];
    if (!entry) return;
    entry.snapshot = snapshot as DocumentSnapshot;
    entry.timestamp = Date.now();
    if (label !== undefined) entry.label = label;
    this.emitState();
  }

  getEntries(): ReadonlyArray<HistoryEntry> {
    return [...this.stack];
  }

  get size(): number {
    return this.stack.length;
  }

  get capacity(): number {
    return this.maxSize;
  }

  private buildState(): HistoryState {
    const undoEntry = this.pointer > 0 ? (this.stack[this.pointer - 1] ?? null) : null;
    const redoEntry = this.pointer < this.stack.length - 1 ? (this.stack[this.pointer + 1] ?? null) : null;
    return {
      canUndo: this.pointer > 0,
      canRedo: this.pointer < this.stack.length - 1,
      pointer: this.pointer,
      size: this.stack.length,
      undoLabel: undoEntry?.label ?? null,
      redoLabel: redoEntry?.label ?? null,
    };
  }

  private emitState(): void {
    this.stateSignal.value = this.buildState();
  }
}
