import React, {
  useState, useRef, useCallback,
  type ReactNode, type CSSProperties,
} from 'react';
import { Icon } from './Icon.tsx';

export interface ResizablePanelProps {
  label: string;
  side?: 'left' | 'right';
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  headerExtra?: ReactNode;
  className?: string;
  children: ReactNode;
}

const STRIP_W  = 22;
const HANDLE_W = 8;   // wide enough to grab comfortably
const HEADER_H = 28;

export const ResizablePanel: React.FC<ResizablePanelProps> = ({
  label,
  side         = 'left',
  defaultWidth = 220,
  minWidth     = 120,
  maxWidth     = 600,
  defaultOpen  = true,
  open: openProp,
  onOpenChange,
  headerExtra,
  className = '',
  children,
}) => {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = openProp !== undefined;
  const isOpen       = isControlled ? openProp : internalOpen;

  const setOpen = useCallback((next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }, [isControlled, onOpenChange]);

  const toggle = useCallback(() => setOpen(!isOpen), [isOpen, setOpen]);

  const [width, setWidth] = useState(defaultWidth);
  const dragging = useRef(false);
  const startX   = useRef(0);
  const startW   = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current   = e.clientX;
    startW.current   = width;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [width]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const delta = side === 'left'
      ? e.clientX - startX.current
      : startX.current - e.clientX;
    setWidth(Math.min(maxWidth, Math.max(minWidth, startW.current + delta)));
  }, [side, minWidth, maxWidth]);

  const onPointerUp = useCallback(() => { dragging.current = false; }, []);

  // chevron points in the direction that indicates "this panel lives here"
  // left-open → left, left-closed strip → right; right-open → right, right-closed strip → left
  const chevronWhenOpen:   'left' | 'right' = side === 'left' ? 'left'  : 'right';
  const chevronWhenClosed: 'left' | 'right' = side === 'left' ? 'right' : 'left';

  if (!isOpen) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={`Expand ${label}`}
        onClick={toggle}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggle()}
        className={[
          'flex flex-col items-center justify-center gap-1 shrink-0',
          'cursor-pointer select-none transition-colors',
          'border-[var(--theme-border)] bg-[var(--theme-surface)] hover:bg-[var(--theme-bg)]',
          side === 'left' ? 'border-r' : 'border-l',
          className,
        ].join(' ')}
        style={{ width: STRIP_W }}
        title={`Expand ${label}`}
      >
        <Icon name={chevronWhenClosed === 'left' ? 'chevron-left' : 'chevron-right'}
              size={11} className="text-[var(--theme-text-muted)]" />
        <span
          className="text-[9px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] whitespace-nowrap"
          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
        >
          {label}
        </span>
      </div>
    );
  }

  const resizeHandle = (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="group shrink-0 flex items-center justify-center
                 hover:bg-[var(--theme-primary)]/15 transition-colors z-10"
      style={{ width: HANDLE_W, cursor: 'col-resize', alignSelf: 'stretch' }}
      title="Drag to resize"
    >
      {/* Three-dot grip indicator — pointer-events-none so the parent captures all events */}
      <div className="pointer-events-none flex flex-col gap-[3px] opacity-25 group-hover:opacity-60 transition-opacity">
        <div className="w-1 h-1 rounded-full bg-[var(--theme-text)]" />
        <div className="w-1 h-1 rounded-full bg-[var(--theme-text)]" />
        <div className="w-1 h-1 rounded-full bg-[var(--theme-text)]" />
      </div>
    </div>
  );

  const containerStyle: CSSProperties = { width, minWidth, maxWidth };

  return (
    <div
      className={[
        'flex shrink-0 overflow-hidden',
        side === 'left' ? 'flex-row' : 'flex-row-reverse',
        className,
      ].join(' ')}
      style={containerStyle}
    >
      <div
        className={[
          'flex flex-col flex-1 min-w-0 overflow-hidden bg-[var(--theme-surface)]',
          side === 'left'
            ? 'border-r border-[var(--theme-border)]'
            : 'border-l border-[var(--theme-border)]',
        ].join(' ')}
      >
        {/* Clicking anywhere on the header row toggles the panel */}
        <div
          role="button"
          tabIndex={0}
          aria-label={`Collapse ${label}`}
          onClick={toggle}
          onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggle()}
          className="flex items-center gap-1 px-2 shrink-0 border-b border-[var(--theme-border)]
                     bg-[var(--theme-surface)] cursor-pointer select-none
                     hover:bg-[var(--theme-bg)] transition-colors"
          style={{ height: HEADER_H }}
        >
          <Icon name={chevronWhenOpen === 'left' ? 'chevron-left' : 'chevron-right'}
               size={11} className="text-[var(--theme-text-muted)]" />

          <span className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] flex-1 truncate">
            {label}
          </span>

          {headerExtra && (
            <div
              className="flex items-center gap-0.5 shrink-0"
              onClick={e => e.stopPropagation()}
            >
              {headerExtra}
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          {children}
        </div>
      </div>

      {resizeHandle}
    </div>
  );
};
