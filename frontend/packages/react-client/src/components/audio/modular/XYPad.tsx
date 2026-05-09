import { useRef, useCallback, useState } from "react";

interface XYPadProps {
  x:         number;        // 0..1
  y:         number;        // 0..1
  onChange:  (x: number, y: number) => void;
  labelX?:   string;
  labelY?:   string;
  color?:    string;        // accent hex
  size?:     number;        // px, default 160
  disabled?: boolean;
}

export function XYPad({
  x,
  y,
  onChange,
  labelX   = "X",
  labelY   = "Y",
  color    = "#9333ea",
  size     = 160,
  disabled = false,
}: XYPadProps) {
  const padRef              = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const toXY = useCallback(
    (clientX: number, clientY: number) => {
      const el = padRef.current;
      if (!el) return;
      const r  = el.getBoundingClientRect();
      const nx = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      const ny = Math.max(0, Math.min(1, (clientY - r.top)  / r.height));
      onChange(nx, ny);
    },
    [onChange],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
      toXY(e.clientX, e.clientY);
    },
    [disabled, toXY],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      toXY(e.clientX, e.clientY);
    },
    [dragging, toXY],
  );

  const onPointerUp = useCallback(() => setDragging(false), []);

  const cx = `${x * 100}%`;
  const cy = `${y * 100}%`;

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      {/* Pad surface */}
      <div
        ref={padRef}
        className={[
          "relative rounded border overflow-hidden touch-none",
          disabled ? "opacity-40 cursor-not-allowed" : "cursor-crosshair",
          dragging  ? "ring-1" : "",
        ].join(" ")}
        style={{
          width:           size,
          height:          size,
          backgroundColor: "color-mix(in srgb, var(--theme-bg) 80%, transparent)",
          borderColor:     dragging ? color : "var(--theme-border)",
          boxShadow:       dragging ? `0 0 12px ${color}40` : undefined,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Grid lines */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(var(--theme-border) 1px, transparent 1px),
                              linear-gradient(90deg, var(--theme-border) 1px, transparent 1px)`,
            backgroundSize:  "25% 25%",
            opacity:         0.3,
          }}
        />

        {/* Crosshair lines */}
        <div className="absolute inset-0 pointer-events-none">
          <div
            className="absolute top-0 bottom-0 w-px opacity-40"
            style={{ left: cx, backgroundColor: color }}
          />
          <div
            className="absolute left-0 right-0 h-px opacity-40"
            style={{ top: cy, backgroundColor: color }}
          />
        </div>

        {/* Dot */}
        <div
          className="absolute w-3 h-3 rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{
            left:            cx,
            top:             cy,
            backgroundColor: color,
            boxShadow:       `0 0 6px ${color}, 0 0 12px ${color}80`,
          }}
        />

        {/* Corner label */}
        <span
          className="absolute bottom-1 right-1 text-[9px] font-mono pointer-events-none opacity-40"
          style={{ color }}
        >
          {labelX}:{x.toFixed(2)}{"  "}{labelY}:{y.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
