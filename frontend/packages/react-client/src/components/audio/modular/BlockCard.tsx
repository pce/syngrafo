import { useCallback } from "react";
import { useLingui } from "@lingui/react";
import type { BlockInstance, BlockTypeDef, PatchCable, ParamValue } from "@syngrafo/audio";
import { XYPad } from "./XYPad";

interface BlockCardProps {
  block:      BlockInstance;
  typeDef:    BlockTypeDef;
  cables:     PatchCable[];          // all cables in the patch (for "driven by" lookup)
  selected:   boolean;
  onSelect:   (id: string) => void;
  onRemove:   (id: string) => void;
  onParam:    (blockId: string, paramId: string, value: ParamValue) => void;
  onXY?:      (blockId: string, x: number, y: number) => void;
  onTrigger?: (blockId: string) => void;
}

export function BlockCard({
  block,
  typeDef,
  cables,
  selected,
  onSelect,
  onRemove,
  onParam,
  onXY,
  onTrigger,
}: BlockCardProps) {
  const { _ } = useLingui();
  const driverOf = useCallback(
    (paramId: string): PatchCable | undefined =>
      cables.find(
        c => c.targetBlockId === block.id && c.targetParamId === paramId,
      ),
    [cables, block.id],
  );

  const isXY = block.kind === "xyPad";

  return (
    <div
      className={[
        "rounded border flex flex-col overflow-hidden transition-all duration-100",
        selected
          ? "ring-1 shadow-lg"
          : "opacity-90 hover:opacity-100",
      ].join(" ")}
      style={{
        borderColor: selected ? typeDef.color : "var(--theme-border)",
      }}
      onClick={() => onSelect(block.id)}
    >
      <div
        className="flex items-center gap-2 px-2 py-1.5 shrink-0"
        style={{ backgroundColor: `${typeDef.color}22` }}
      >
        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: typeDef.color }}
        />
        <span className="text-[11px] font-semibold tracking-wide flex-1 truncate text-[var(--theme-text)]">
          {block.label}
        </span>

        {typeDef.orcTemplate && onTrigger && (
          <button
            title={_("Trigger")}
            onClick={e => {
              e.stopPropagation();
              onTrigger(block.id);
            }}
            className="text-[10px] px-1.5 py-0.5 rounded hover:bg-white/10 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
          >
            ▶
          </button>
        )}

        <button
          title={_("Remove block")}
          onClick={e => {
            e.stopPropagation();
            onRemove(block.id);
          }}
          className="text-[10px] w-4 h-4 rounded flex items-center justify-center hover:bg-red-500/20 text-[var(--theme-text-muted)] hover:text-red-400"
        >
          ×
        </button>
      </div>

      {isXY && onXY && (
        <div className="p-2 flex justify-center bg-[var(--theme-bg)]">
          <XYPad
            x={typeof block.params["x"] === "number" ? (block.params["x"] as number) : 0.5}
            y={typeof block.params["y"] === "number" ? (block.params["y"] as number) : 0.5}
            labelX={String(block.params["labelX"] ?? "X")}
            labelY={String(block.params["labelY"] ?? "Y")}
            color={typeDef.color}
            size={120}
            onChange={(nx, ny) => {
              onXY(block.id, nx, ny);
              onParam(block.id, "x", nx);
              onParam(block.id, "y", ny);
            }}
          />
        </div>
      )}

      {!isXY && (
        <div className="flex flex-col gap-0.5 p-2 bg-[var(--theme-bg)]">
          {Object.entries(typeDef.params).map(([paramId, def]) => {
            const value    = block.params[paramId] ?? def.default;
            const driver   = def.modulatable ? driverOf(paramId) : undefined;
            const isDriven = driver !== undefined;

            return (
              <div key={paramId} className="flex items-center gap-1.5 min-h-[22px]">
                <span
                  className="text-[9px] text-[var(--theme-text-muted)] w-16 shrink-0 truncate"
                  title={def.description ?? def.label}
                >
                  {def.label}
                </span>

                {isDriven && (
                  <span
                    className="text-[8px] px-1 rounded shrink-0 truncate max-w-[60px]"
                    style={{
                      backgroundColor: `${typeDef.color}30`,
                      color:           typeDef.color,
                    }}
                    title={`Driven by cable ${driver.id}`}
                  >
                    ⇢ cv
                  </span>
                )}

                {!isDriven && def.type === "number" && (
                  <div className="flex items-center gap-1 flex-1 min-w-0">
                    <input
                      type="range"
                      min={def.min ?? 0}
                      max={def.max ?? 1}
                      step={def.step ?? 0.01}
                      value={Number(value)}
                      className="flex-1 h-1 min-w-0"
                      style={{ accentColor: typeDef.color }}
                      onChange={e =>
                        onParam(block.id, paramId, parseFloat(e.target.value))
                      }
                      onClick={e => e.stopPropagation()}
                    />
                    <span className="text-[9px] text-[var(--theme-text-muted)] w-8 text-right shrink-0 font-mono">
                      {Number(value).toFixed(
                        def.step && def.step < 0.1
                          ? 2
                          : def.step && def.step < 1
                          ? 1
                          : 0,
                      )}
                      {def.unit ? ` ${def.unit}` : ""}
                    </span>
                  </div>
                )}

                {!isDriven && def.type === "boolean" && (
                  <button
                    className={[
                      "text-[9px] px-1.5 py-0.5 rounded border font-mono transition-colors",
                      value
                        ? "text-white border-transparent"
                        : "text-[var(--theme-text-muted)] border-[var(--theme-border)]",
                    ].join(" ")}
                    style={value ? { backgroundColor: typeDef.color } : {}}
                    onClick={e => {
                      e.stopPropagation();
                      onParam(block.id, paramId, !value);
                    }}
                  >
                    {value ? _("ON") : _("OFF")}
                  </button>
                )}

                {!isDriven && def.type === "select" && def.options && (
                  <select
                    value={String(value)}
                    className="text-[9px] flex-1 bg-[var(--theme-surface)] border border-[var(--theme-border)] rounded px-1 py-0.5 text-[var(--theme-text)] min-w-0"
                    onChange={e => {
                      const v      = e.target.value;
                      const parsed = isNaN(Number(v)) ? v : Number(v);
                      onParam(block.id, paramId, parsed);
                    }}
                    onClick={e => e.stopPropagation()}
                  >
                    {def.options.map(o => (
                      <option key={String(o.value)} value={String(o.value)}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}

                {!isDriven && (def.type === "string" || def.type === "file") && (
                  <span className="text-[9px] text-[var(--theme-text-muted)] truncate flex-1 font-mono">
                    {String(value) || "—"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {block.outputs && Object.keys(block.outputs).length > 0 && (
        <div className="flex flex-wrap gap-1 px-2 pb-1.5 bg-[var(--theme-bg)]">
          {Object.entries(block.outputs).map(([portId, val]) => (
            <span
              key={portId}
              className="text-[8px] font-mono px-1 rounded"
              style={{
                backgroundColor: `${typeDef.color}18`,
                color:           typeDef.color,
              }}
            >
              {portId} {typeof val === "number" ? val.toFixed(2) : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
