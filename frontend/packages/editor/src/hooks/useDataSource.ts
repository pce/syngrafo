/**
 * @file hooks/useDataSource.ts
 *
 * Loads structured data from a SDataSource descriptor (CSV only for now;
 * XML and query types are stubs that will be wired to backend bindings later).
 *
 * CSV format: first row = column headers, subsequent rows = data.
 * Commas inside quoted fields are handled; CRLF line endings are stripped.
 *
 * Usage in a table block renderer:
 *   const { data, loading, error } = useDataSource(block.data_source);
 *   // data.headers = ["description", "qty", "amount", ...]
 *   // data.rows    = [{ description: "Item A", qty: "2", amount: "100.00" }, ...]
 */

import { useEffect, useState } from "react";
import type { SDataSource } from "../models/sdm";
import { ipcRawCall } from "../services/ipc";

export interface DataSourceResult {
  headers: string[];
  rows:     Record<string, string>[];
}

// ---------------------------------------------------------------------------
// CSV parser (no dependency — simple but handles quoted fields)
// ---------------------------------------------------------------------------
export function parseCSV(text: string): DataSourceResult {
  const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };

  const splitLine = (line: string): string[] => {
    const fields: string[] = [];
    let inQuote = false;
    let cur = "";
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuote = !inQuote; }
      } else if (ch === "," && !inQuote) {
        fields.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    fields.push(cur.trim());
    return fields;
  };

  const headers = splitLine(lines[0]!).map(h => h.toLowerCase().replace(/\s+/g, "_"));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitLine(lines[i]!);
    const row: Record<string, string> = {};
    headers.forEach((h, j) => { row[h] = values[j] ?? ""; });
    rows.push(row);
  }

  return { headers, rows };
}

// ---------------------------------------------------------------------------
// Aggregate helpers — no formula engine, just array reductions
// ---------------------------------------------------------------------------
export type AggFunction = "sum" | "count" | "avg" | "min" | "max";

/**
 * Parses a numeric string that may include currency symbols, spaces and
 * thousands separators (e.g. "€ 1,200.00" → 1200).
 */
export function parseNumeric(raw: string): number {
  const clean = raw.replace(/[^0-9.\-]/g, "");
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
}

export function aggregate(
  rows:   Record<string, string>[],
  colKey: string,
  fn:     AggFunction,
): number {
  if (rows.length === 0) return 0;
  const nums = rows.map(r => parseNumeric(r[colKey] ?? ""));
  switch (fn) {
    case "sum":   return nums.reduce((a, b) => a + b, 0);
    case "count": return rows.length;
    case "avg":   return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "min":   return Math.min(...nums);
    case "max":   return Math.max(...nums);
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Key used to deduplicate in-flight IPC calls across React renders. */
const _inflight = new Map<string, Promise<DataSourceResult>>();

export function useDataSource(
  dataSource: SDataSource | undefined | null,
): { data: DataSourceResult | null; loading: boolean; error: string | null } {
  const [data,    setData]    = useState<DataSourceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // Stable cache key so the effect only re-runs when the source changes
  const cacheKey =
    !dataSource                   ? null
    : dataSource.type === "csv"   ? `csv:${dataSource.path}`
    : dataSource.type === "xml"   ? `xml:${dataSource.path}:${dataSource.xpath}`
    : dataSource.type === "query" ? `q:${dataSource.zone}:${dataSource.sql}`
    : null;

  useEffect(() => {
    if (!cacheKey || !dataSource) return;
    const key = cacheKey!; // non-null: guarded by the early return above

    let cancelled = false;

    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);

      try {
        if (dataSource.type === "csv") {
          if (!_inflight.has(key)) {
            _inflight.set(
              key,
              (async () => {
                const raw = await ipcRawCall("dms_read_file", dataSource.path);
                if (!raw) throw new Error(`No IPC response for: ${dataSource.path}`);
                const envelope = JSON.parse(raw) as {
                  ok: boolean;
                  data?: { content: string | null };
                };
                if (!envelope.ok || !envelope.data?.content) {
                  throw new Error(`Could not read data source: ${dataSource.path}`);
                }
                return parseCSV(envelope.data.content);
              })().finally(() => _inflight.delete(key)),
            );
          }
          const result = await _inflight.get(key)!;
          if (!cancelled) setData(result);
        } else if (dataSource.type === "xml" || dataSource.type === "query") {
          // Future: wire to backend bindings
          if (!cancelled) setError(`Data source type "${dataSource.type}" is not yet supported in the renderer`);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message ?? "Failed to load data source");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  return { data, loading, error };
}
