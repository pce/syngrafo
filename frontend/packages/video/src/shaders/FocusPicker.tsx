import React, { useRef, useCallback } from 'react';
import type { FocusPoint } from '../types/shader.ts';

interface FocusPickerProps {
  value: FocusPoint;
  onChange: (fp: FocusPoint) => void;
  width?: number;
  height?: number;
}

export const FocusPicker: React.FC<FocusPickerProps> = ({
  value, onChange, width = 160, height = 90,
}) => {
  const divRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!divRef.current) return;
    const rect = divRef.current.getBoundingClientRect();
    onChange({
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    });
  }, [onChange]);

  return (
    <div
      ref={divRef}
      className="relative rounded border border-gray-600 bg-gray-900 cursor-crosshair overflow-hidden"
      style={{ width, height }}
      onClick={handleClick}
      title="Click to set focus point"
    >
      {/* Grid guide */}
      <div className="absolute inset-0 opacity-20" style={{
        backgroundImage: 'linear-gradient(#4b5563 1px, transparent 1px), linear-gradient(90deg, #4b5563 1px, transparent 1px)',
        backgroundSize: `${width / 3}px ${height / 3}px`,
      }} />

      {/* Focus crosshair */}
      <div
        className="absolute w-5 h-5 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        style={{ left: `${value.x * 100}%`, top: `${value.y * 100}%` }}
      >
        <div className="absolute top-1/2 left-0 w-full h-px bg-indigo-400" />
        <div className="absolute left-1/2 top-0 h-full w-px bg-indigo-400" />
        <div className="absolute top-1/2 left-1/2 w-2 h-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-indigo-400" />
      </div>

      <span className="absolute bottom-1 right-1 text-[9px] text-gray-600 font-mono">
        {value.x.toFixed(2)},{value.y.toFixed(2)}
      </span>
    </div>
  );
};
