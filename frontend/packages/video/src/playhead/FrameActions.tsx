import React, { useEffect, useRef } from 'react';
import { videoBus } from '@syngrafo/shared';

interface FrameActionsProps {
  frame: number;
  fps: number;
  clipId: string | null;
  onAdd: (kind: string) => void;
  onClose: () => void;
}

interface ActionDef {
  kind: string;
  label: string;
  icon: string;
  description: string;
  requiresClip: boolean;
  defaultDuration: number;  // frames
}

const ACTIONS: ActionDef[] = [
  { kind: 'fadeIn',     label: 'Fade In',      icon: '\u25B6', description: 'Opacity 0->1 over N frames',         requiresClip: true,  defaultDuration: 15 },
  { kind: 'fadeOut',    label: 'Fade Out',     icon: '\u25C0', description: 'Opacity 1->0 over N frames',         requiresClip: true,  defaultDuration: 15 },
  { kind: 'transition', label: 'Transition',   icon: '\u21C4', description: 'Dissolve/wipe between two clips',    requiresClip: false, defaultDuration: 30 },
  { kind: 'speedRamp',  label: 'Speed Ramp',   icon: '\u26A1', description: 'Ramp playback speed over a range',  requiresClip: true,  defaultDuration: 30 },
  { kind: 'freeze',     label: 'Freeze Frame', icon: '\u23F8', description: 'Hold this frame for N frames',      requiresClip: true,  defaultDuration: 15 },
  { kind: 'shader',     label: 'Add Shader',   icon: '\u2726', description: 'Attach a shader to the clip chain', requiresClip: true,  defaultDuration: 0  },
  { kind: 'marker',     label: 'Marker',       icon: '\u25C6', description: 'Named marker at this frame',        requiresClip: false, defaultDuration: 0  },
];

export const FrameActions: React.FC<FrameActionsProps> = ({
  frame, fps, clipId, onAdd, onClose,
}) => {
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleAction = (action: ActionDef) => {
    if (action.requiresClip && !clipId) return;  // greyed out if no clip selected

    // Emit to videoBus so anything listening reacts
    if (action.kind === 'fadeIn') {
      videoBus.emit('fadeIn', {
        clipId: clipId!, frame, durationFrames: action.defaultDuration, easing: 'easeOut',
      });
    } else if (action.kind === 'fadeOut') {
      videoBus.emit('fadeOut', {
        clipId: clipId!, frame, durationFrames: action.defaultDuration, easing: 'easeIn',
      });
    }

    onAdd(action.kind);
  };

  // fps is available for future use (e.g. showing duration in seconds)
  void fps;

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 mt-2 z-50 w-72
        bg-gray-900 border border-gray-600 rounded-xl shadow-2xl shadow-black/60
        overflow-hidden"
      role="menu"
    >
      <div className="px-3 py-2 border-b border-gray-700 text-xs text-gray-400 font-mono">
        Actions at <span className="text-indigo-400">F{frame}</span>
        {clipId && <span className="ml-2 text-green-400">clip selected</span>}
      </div>

      <div className="py-1">
        {ACTIONS.map(action => {
          const disabled = action.requiresClip && !clipId;
          return (
            <button
              key={action.kind}
              role="menuitem"
              disabled={disabled}
              onClick={() => handleAction(action)}
              className={[
                'w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors',
                disabled
                  ? 'opacity-30 cursor-not-allowed'
                  : 'hover:bg-gray-800 cursor-pointer',
              ].join(' ')}
            >
              <span className="text-lg w-6 text-center leading-tight mt-0.5">{action.icon}</span>
              <div>
                <div className="text-sm font-medium text-white">{action.label}</div>
                <div className="text-xs text-gray-400 mt-0.5">{action.description}</div>
                {action.requiresClip && !clipId && (
                  <div className="text-xs text-yellow-600 mt-0.5">Select a clip first</div>
                )}
              </div>
              {action.defaultDuration > 0 && (
                <span className="ml-auto text-xs text-gray-600 font-mono whitespace-nowrap">
                  {action.defaultDuration}f
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
