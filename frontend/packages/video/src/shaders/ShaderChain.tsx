import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { ShaderNode as ShaderNodeType, ShaderChainConfig } from '../types/shader.ts';
import { ShaderNode } from './ShaderNode.tsx';
import { stepSpring, isSettled, SPRING_PRESETS, uid } from '@syngrafo/shared';
import type { SpringConfig } from '@syngrafo/shared';

interface ShaderChainProps {
  chain: ShaderChainConfig;
  onChange: (chain: ShaderChainConfig) => void;
}

// Pre-built node defaults per kind
const NODE_DEFAULTS: Record<string, Partial<ShaderNodeType>> = {
  dof: {
    label: 'Depth of Field',
    params: { focalDistance: 0.5, focalRange: 0.3, blurStrength: 0.6 },
  },
  'tilt-blur': {
    label: 'Tilt Blur',
    params: { tiltAngle: 0, tiltWidth: 0.3, tiltSoftness: 0.5, blurStrength: 0.5 },
  },
  cinema: {
    label: 'Cinema',
    params: { vignetteStr: 0.4, grainAmount: 0.05, chromaShift: 0.02, contrast: 1.1, saturation: 0.9 },
  },
  lut:    { label: 'LUT',    params: { intensity: 1.0 } },
  custom: { label: 'Custom', params: { intensity: 1.0 } },
};

/** Animate the y-positions of nodes using spring physics */
function useSpringPositions(
  count: number,
  itemHeight: number,
  spacing: number,
  springConfig: SpringConfig = SPRING_PRESETS.default,
) {
  const targets  = Array.from({ length: count }, (_, i) => i * (itemHeight + spacing));
  const posRef   = useRef<number[]>(targets.slice());
  const velRef   = useRef<number[]>(new Array(count).fill(0));
  const [positions, setPositions] = useState<number[]>(targets.slice());
  const rafRef   = useRef<number | null>(null);

  useEffect(() => {
    // Extend / trim arrays when count changes
    while (posRef.current.length < count) {
      const idx = posRef.current.length;
      posRef.current.push(targets[idx] ?? 0);
      velRef.current.push(0);
    }
    posRef.current.length = count;
    velRef.current.length = count;
  }, [count]); // eslint-disable-line react-hooks/exhaustive-deps

  // Serialise targets for effect dep comparison
  const targetsKey = targets.join(',');

  useEffect(() => {
    const tick = () => {
      const dt = 1 / 60;
      let allSettled = true;
      const currentTargets = Array.from(
        { length: count },
        (_, i) => i * (itemHeight + spacing),
      );
      const next = posRef.current.map((p, i) => {
        const target = currentTargets[i] ?? 0;
        const vel    = velRef.current[i] ?? 0;
        const [np, nv] = stepSpring(p, vel, target, springConfig, dt);
        velRef.current[i] = nv;
        if (!isSettled(np, nv, target, springConfig)) allSettled = false;
        return np;
      });
      posRef.current = next;
      setPositions([...next]);
      if (!allSettled) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [count, itemHeight, spacing, targetsKey, springConfig]);

  return positions;
}

export const ShaderChain: React.FC<ShaderChainProps> = ({ chain, onChange }) => {
  const ITEM_H   = 48;
  const SPACING  = 6;
  const positions = useSpringPositions(
    chain.nodes.length, ITEM_H, SPACING, chain.springConfig,
  );

  const addNode = useCallback((kind: string) => {
    const defaults = NODE_DEFAULTS[kind] ?? {};
    const node: ShaderNodeType = {
      id:         uid(),
      kind:       kind as ShaderNodeType['kind'],
      label:      defaults.label ?? kind,
      enabled:    true,
      focusPoint: { x: 0.5, y: 0.5 },
      params:     defaults.params ?? { intensity: 1.0 },
    };
    onChange({ ...chain, nodes: [...chain.nodes, node] });
  }, [chain, onChange]);

  const updateNode = useCallback((id: string, updates: Partial<ShaderNodeType>) => {
    onChange({
      ...chain,
      nodes: chain.nodes.map(n => n.id === id ? { ...n, ...updates } : n),
    });
  }, [chain, onChange]);

  const removeNode = useCallback((id: string) => {
    onChange({ ...chain, nodes: chain.nodes.filter(n => n.id !== id) });
  }, [chain, onChange]);

  const moveNode = useCallback((id: string, direction: 'up' | 'down') => {
    const idx = chain.nodes.findIndex(n => n.id === id);
    if (idx < 0) return;
    const nodes  = [...chain.nodes];
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= nodes.length) return;
    [nodes[idx], nodes[target]] = [nodes[target]!, nodes[idx]!];
    onChange({ ...chain, nodes });
  }, [chain, onChange]);

  const totalHeight = chain.nodes.length * (ITEM_H + SPACING) + 48;

  return (
    <div className="flex flex-col gap-3 p-3 bg-[var(--theme-surface)] rounded-xl border border-[var(--theme-border)]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--theme-text)]">Shader Chain</h3>
        <span className="text-xs text-[var(--theme-text-muted)]">
          {chain.nodes.length} node{chain.nodes.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Spring-animated node list */}
      <div className="relative" style={{ height: totalHeight }}>
        {chain.nodes.map((node, i) => (
          <div
            key={node.id}
            className="absolute w-full transition-none"
            style={{ transform: `translateY(${positions[i] ?? i * (ITEM_H + SPACING)}px)` }}
          >
            <ShaderNode
              node={node}
              index={i}
              total={chain.nodes.length}
              isFirst={i === 0}
              isLast={i === chain.nodes.length - 1}
              onChange={updateNode}
              onRemove={removeNode}
              onMoveUp={id => moveNode(id, 'up')}
              onMoveDown={id => moveNode(id, 'down')}
            />
          </div>
        ))}

        {chain.nodes.length === 0 && (
          <div className="flex items-center justify-center h-16 text-sm text-[var(--theme-text-muted)] border border-dashed border-[var(--theme-border)] rounded-lg">
            No shaders — add one below
          </div>
        )}
      </div>

      {/* Add shader buttons */}
      <div className="flex flex-wrap gap-1.5 pt-1 border-t border-[var(--theme-border)]">
        {Object.keys(NODE_DEFAULTS).map(kind => (
          <button
            key={kind}
            onClick={() => addNode(kind)}
            className="text-xs px-2.5 py-1 rounded-full bg-[var(--theme-surface)] hover:bg-[var(--theme-bg)]
              text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] border border-[var(--theme-border)] hover:border-[var(--theme-text-muted)]
              transition-colors"
          >
            + {NODE_DEFAULTS[kind]?.label ?? kind}
          </button>
        ))}
      </div>
    </div>
  );
};
