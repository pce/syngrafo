import React, { useState } from 'react';
import type { ShaderNode as ShaderNodeType } from '../types/shader.ts';
import { FocusPicker } from './FocusPicker.tsx';

interface ShaderNodeProps {
  node: ShaderNodeType;
  index: number;
  total: number;
  isFirst: boolean;
  isLast: boolean;
  onChange: (id: string, updates: Partial<ShaderNodeType>) => void;
  onRemove: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
}

const KIND_LABELS: Record<string, string> = {
  dof: 'Depth of Field',
  'tilt-blur': 'Tilt Blur',
  cinema: 'Cinema',
  lut: 'LUT',
  custom: 'Custom',
};

const KIND_COLORS: Record<string, string> = {
  dof: '#6366f1',
  'tilt-blur': '#8b5cf6',
  cinema: '#ec4899',
  lut: '#14b8a6',
  custom: '#f59e0b',
};

export const ShaderNode: React.FC<ShaderNodeProps> = ({
  node, index, total, isFirst, isLast,
  onChange, onRemove, onMoveUp, onMoveDown,
}) => {
  const [expanded, setExpanded] = useState(false);
  const color = KIND_COLORS[node.kind] ?? '#6b7280';

  return (
    <div
      className={[
        'rounded-lg border transition-all duration-200',
        node.enabled ? 'bg-gray-800 border-gray-600' : 'bg-gray-900 border-gray-700 opacity-50',
      ].join(' ')}
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        {/* Enable toggle */}
        <button
          onClick={() => onChange(node.id, { enabled: !node.enabled })}
          className={`w-4 h-4 rounded-sm border-2 flex-shrink-0 transition-colors ${
            node.enabled ? 'bg-current border-current' : 'bg-transparent border-gray-500'
          }`}
          style={{ color }}
          title={node.enabled ? 'Disable' : 'Enable'}
        />

        <span className="text-xs font-semibold text-white flex-1 truncate">
          {node.label || KIND_LABELS[node.kind] || node.kind}
        </span>

        <span className="text-xs text-gray-500 font-mono">{index + 1}/{total}</span>

        <button
          onClick={() => onMoveUp(node.id)}
          disabled={isFirst}
          className="text-gray-500 hover:text-gray-200 disabled:opacity-20 text-xs px-1"
          title="Move up in chain"
        >
          &#8593;
        </button>
        <button
          onClick={() => onMoveDown(node.id)}
          disabled={isLast}
          className="text-gray-500 hover:text-gray-200 disabled:opacity-20 text-xs px-1"
          title="Move down in chain"
        >
          &#8595;
        </button>

        <button
          onClick={() => setExpanded(v => !v)}
          className="text-gray-500 hover:text-gray-200 text-xs px-1"
        >
          {expanded ? '\u25B2' : '\u25BC'}
        </button>
        <button
          onClick={() => onRemove(node.id)}
          className="text-gray-600 hover:text-red-400 text-xs px-1"
        >
          &#x2715;
        </button>
      </div>

      {/* Expanded settings */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-gray-700">
          {/* Focus point picker (DoF & tilt-blur) */}
          {(node.kind === 'dof' || node.kind === 'tilt-blur') && (
            <div>
              <label className="text-xs text-gray-400 block mb-1">Focus point</label>
              <FocusPicker
                value={node.focusPoint}
                onChange={fp => onChange(node.id, { focusPoint: fp })}
              />
            </div>
          )}

          {/* Param sliders */}
          {Object.entries(node.params).map(([key, val]) => val !== undefined && (
            <div key={key}>
              <div className="flex justify-between mb-0.5">
                <label className="text-xs text-gray-400 capitalize">
                  {key.replace(/([A-Z])/g, ' $1')}
                </label>
                <span className="text-xs text-gray-500 font-mono">
                  {(val as number).toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={key === 'contrast' || key === 'saturation' ? 2 : 1}
                step={0.01}
                value={val as number}
                onChange={e => onChange(node.id, {
                  params: { ...node.params, [key]: Number(e.target.value) },
                })}
                className="w-full accent-indigo-500"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
