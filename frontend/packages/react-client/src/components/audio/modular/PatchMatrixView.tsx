import { useState, useCallback } from "react";
import type { Patch, PatchCable, SignalTransform } from "@syngrafo/audio";
import { BLOCK_REGISTRY, DEFAULT_TRANSFORM } from "@syngrafo/audio";

interface PatchMatrixViewProps {
  patch:             Patch;
  onAddCable:        (src: string, srcPort: string, tgt: string, tgtParam: string, t?: SignalTransform) => void;
  onRemoveCable:     (cableId: string) => void;
  onSetTransform:    (cableId: string, t: SignalTransform) => void;
}

interface MatrixRow {
  blockId:    string;
  blockLabel: string;
  portId:     string;
  portLabel:  string;
  color:      string;
}

interface MatrixCol {
  blockId:    string;
  blockLabel: string;
  paramId:    string;
  paramLabel: string;
  color:      string;
}

export function PatchMatrixView({
  patch,
  onAddCable,
  onRemoveCable,
  onSetTransform,
}: PatchMatrixViewProps) {
  const [editing, setEditing] = useState<{
    cableId:   string;
    transform: SignalTransform;
  } | null>(null);

  // ── Rows: one per output port of each block (skip audio ports) ─────────
  const rows: MatrixRow[] = patch.blocks.flatMap(block => {
    const def = BLOCK_REGISTRY[block.kind];
    return Object.values(def.outputs)
      .filter(p => p.dataType !== "audio")
      .map(port => ({
        blockId:    block.id,
        blockLabel: block.label,
        portId:     port.id,
        portLabel:  port.label,
        color:      def.color,
      }));
  });

  // ── Cols: one per modulatable param of each block ──────────────────────
  const cols: MatrixCol[] = patch.blocks.flatMap(block => {
    const def = BLOCK_REGISTRY[block.kind];
    return Object.values(def.params)
      .filter(p => p.modulatable)
      .map(param => ({
        blockId:    block.id,
        blockLabel: block.label,
        paramId:    param.id,
        paramLabel: param.label,
        color:      def.color,
      }));
  });

  const cableAt = useCallback(
    (row: MatrixRow, col: MatrixCol): PatchCable | undefined =>
      patch.cables.find(
        c =>
          c.sourceBlockId === row.blockId &&
          c.sourcePortId  === row.portId  &&
          c.targetBlockId === col.blockId &&
          c.targetParamId === col.paramId,
      ),
    [patch.cables],
  );

  const handleCell = useCallback(
    (row: MatrixRow, col: MatrixCol) => {
      const existing = cableAt(row, col);
      if (existing) {
        // First click on a connected cell: open transform editor.
        // Second click on the same cell (editor already open): remove cable.
        if (editing?.cableId === existing.id) {
          onRemoveCable(existing.id);
          setEditing(null);
        } else {
          setEditing({ cableId: existing.id, transform: existing.transform });
        }
      } else {
        onAddCable(row.blockId, row.portId, col.blockId, col.paramId, DEFAULT_TRANSFORM);
      }
    },
    [cableAt, editing, onAddCable, onRemoveCable],
  );

  if (rows.length === 0 || cols.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-[var(--theme-text-muted)] text-xs">
        Add blocks to see the patch matrix
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">

      {/* ── Matrix table ──────────────────────────────────────────────────── */}
      <div className="overflow-auto">
        <table className="border-collapse text-[10px] w-full">
          <thead>
            <tr>
              {/* Top-left corner cell */}
              <th className="sticky left-0 z-20 bg-[var(--theme-surface)] border border-[var(--theme-border)] px-2 py-1 text-left min-w-[130px] text-[var(--theme-text-muted)] font-normal">
                source ╲ dest
              </th>

              {cols.map(col => (
                <th
                  key={`${col.blockId}-${col.paramId}`}
                  className="border border-[var(--theme-border)] px-1 py-1 min-w-[52px] max-w-[52px] text-center align-bottom"
                  title={`${col.blockLabel} › ${col.paramLabel}`}
                >
                  <div className="flex flex-col items-center gap-0.5">
                    <div
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: col.color }}
                    />
                    <span
                      className="text-[var(--theme-text-muted)] block overflow-hidden"
                      style={{
                        writingMode: "vertical-rl" as const,
                        transform:   "rotate(180deg)",
                        maxHeight:   64,
                        maxWidth:    44,
                        overflow:    "hidden",
                        textOverflow:"ellipsis",
                        whiteSpace:  "nowrap",
                      }}
                    >
                      {col.blockLabel
                        .replace("Block", "")
                        .replace("Pad", "")
                        .slice(0, 8)}{" "}
                      {col.paramLabel}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map(row => (
              <tr
                key={`${row.blockId}-${row.portId}`}
                className="hover:bg-[var(--theme-surface)] transition-colors"
              >
                {/* Row header */}
                <td className="sticky left-0 z-10 bg-[var(--theme-surface)] border border-[var(--theme-border)] px-2 py-1 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <div
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: row.color }}
                    />
                    <span
                      className="text-[var(--theme-text-muted)] truncate max-w-[110px]"
                      title={`${row.blockLabel} › ${row.portLabel}`}
                    >
                      {row.blockLabel.replace("Block", "").slice(0, 8)}{" "}
                      <span className="text-[var(--theme-text)]">
                        {row.portLabel}
                      </span>
                    </span>
                  </div>
                </td>

                {/* Matrix cells */}
                {cols.map(col => {
                  const cable     = cableAt(row, col);
                  const isEditing = cable && editing?.cableId === cable.id;
                  const isSelf    = row.blockId === col.blockId;

                  return (
                    <td
                      key={`${col.blockId}-${col.paramId}`}
                      className={[
                        "border border-[var(--theme-border)] text-center align-middle",
                        isSelf
                          ? "bg-[var(--theme-bg)] opacity-20"
                          : "cursor-pointer hover:bg-[var(--theme-surface)]",
                        isEditing ? "ring-1 ring-inset" : "",
                      ].join(" ")}
                      style={
                        isEditing ? { outlineColor: row.color } : undefined
                      }
                      title={
                        cable
                          ? "Connected — click to edit transform, click again to remove"
                          : `Connect ${row.portLabel} → ${col.paramLabel}`
                      }
                      onClick={() => !isSelf && handleCell(row, col)}
                    >
                      {cable ? (
                        <span
                          className="text-base leading-none select-none"
                          style={{
                            color:      row.color,
                            textShadow: `0 0 6px ${row.color}`,
                          }}
                        >
                          ●
                        </span>
                      ) : (
                        <span className="text-[var(--theme-border)] text-xs select-none">
                          ·
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Transform editor ──────────────────────────────────────────────── */}
      {editing &&
        (() => {
          const cable = patch.cables.find(c => c.id === editing.cableId);
          if (!cable) return null;
          const t = editing.transform;

          const update = (partial: Partial<SignalTransform>) => {
            const next = { ...t, ...partial };
            setEditing({ cableId: editing.cableId, transform: next });
            onSetTransform(editing.cableId, next);
          };

          return (
            <div className="rounded border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3 flex flex-wrap gap-3 items-end text-[10px]">
              <span className="text-[var(--theme-text-muted)] font-semibold uppercase tracking-wider w-full">
                Cable transform
              </span>

              {(["inMin", "inMax", "outMin", "outMax"] as const).map(k => (
                <label key={k} className="flex flex-col gap-0.5 text-[var(--theme-text-muted)]">
                  {k}
                  <input
                    type="number"
                    step="0.01"
                    min="-2"
                    max="2"
                    value={t[k]}
                    className="w-16 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded px-1 py-0.5 text-[var(--theme-text)] text-[10px]"
                    onChange={e =>
                      update({ [k]: parseFloat(e.target.value) } as Partial<SignalTransform>)
                    }
                  />
                </label>
              ))}

              <label className="flex flex-col gap-0.5 text-[var(--theme-text-muted)]">
                curve
                <select
                  value={t.mode}
                  className="bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded px-1 py-0.5 text-[var(--theme-text)] text-[10px]"
                  onChange={e =>
                    update({ mode: e.target.value as SignalTransform["mode"] })
                  }
                >
                  <option value="linear">linear</option>
                  <option value="exponential">exp²</option>
                  <option value="log">log√</option>
                </select>
              </label>

              <label className="flex items-center gap-1 text-[var(--theme-text-muted)]">
                <input
                  type="checkbox"
                  checked={t.clamp}
                  onChange={e => update({ clamp: e.target.checked })}
                />
                clamp
              </label>

              <button
                className="ml-auto text-red-400 hover:text-red-300 px-2 py-0.5 rounded border border-red-400/30 hover:border-red-400"
                onClick={() => {
                  onRemoveCable(editing.cableId);
                  setEditing(null);
                }}
              >
                Remove pin
              </button>

              <button
                className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] px-2 py-0.5 rounded border border-[var(--theme-border)]"
                onClick={() => setEditing(null)}
              >
                Close
              </button>
            </div>
          );
        })()}
    </div>
  );
}
