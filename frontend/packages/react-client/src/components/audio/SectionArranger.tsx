/**
 * SectionArranger — Pattern Arranger sidebar for the StepSequencer.
 *
 * Displays named patterns (PTN_01, PTN_02, …) in order. Each pattern shows:
 *   - Name (editable inline on double-click)
 *   - Repeat count (spinner)
 *   - Track slot mute toggles (one pill per track)
 *   - Move up/down + remove buttons
 * The currently active pattern is highlighted.
 */

import React, { useState, useCallback, useRef } from 'react';
import type { ArrangementSection } from '../../types/arrangement';
import type { AudioTrack } from '../../types/audio';

interface SectionArrangerProps {
  sections:        ArrangementSection[];
  activeSectionIdx: number;
  globalTracks:    AudioTrack[];
  loopArrangement: boolean;
  isPlaying:       boolean;
  onAddSection:    (name?: string) => void;
  onRemoveSection: (id: string) => void;
  onMoveSection:   (id: string, dir: 'up' | 'down') => void;
  onRenameSection: (id: string, name: string) => void;
  onRepeatCount:   (id: string, count: number) => void;
  onToggleSlotMute:(sectionId: string, trackId: string) => void;
  onGoToSection:   (idx: number) => void;
  onToggleLoop:    (loop: boolean) => void;
}

export const SectionArranger: React.FC<SectionArrangerProps> = ({
  sections,
  activeSectionIdx,
  globalTracks,
  loopArrangement,
  isPlaying,
  onAddSection,
  onRemoveSection,
  onMoveSection,
  onRenameSection,
  onRepeatCount,
  onToggleSlotMute,
  onGoToSection,
  onToggleLoop,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = useCallback((section: ArrangementSection) => {
    setEditingId(section.id);
    setEditName(section.name);
    setTimeout(() => inputRef.current?.select(), 0);
  }, []);

  const commitEdit = useCallback(() => {
    if (editingId && editName.trim()) {
      onRenameSection(editingId, editName.trim());
    }
    setEditingId(null);
  }, [editingId, editName, onRenameSection]);

  return (
    <div className="flex flex-col h-full bg-[var(--theme-surface)] border-r border-[var(--theme-border)] overflow-hidden select-none" style={{ minWidth: 180, maxWidth: 220 }}>
      {/* Header */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--theme-border)] shrink-0">
        <span className="text-[10px] font-black uppercase tracking-widest text-[var(--theme-text-muted)] flex-1">
          Patterns
        </span>
        <button
          onClick={() => onToggleLoop(!loopArrangement)}
          title={loopArrangement ? 'Loop: ON' : 'Loop: OFF'}
          className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold transition-colors ${
            loopArrangement
              ? 'border-[var(--theme-primary)] bg-[var(--theme-primary)]/20 text-[var(--theme-primary)]'
              : 'border-[var(--theme-border)] text-[var(--theme-text-muted)]'
          }`}
        >
          ↺
        </button>
        <button
          onClick={() => onAddSection()}
          title="Add section"
          className="text-[9px] px-1.5 py-0.5 rounded border border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:border-[var(--theme-primary)] transition-colors"
        >
          +
        </button>
      </div>

      {/* Section list */}
      <div className="flex-1 overflow-y-auto">
        {sections.length === 0 && (
          <p className="text-[10px] text-[var(--theme-text-muted)] text-center mt-6 px-2">
            No patterns yet.<br />Click <strong>+</strong> to add one.
          </p>
        )}
        {sections.map((section, idx) => {
          const isActive = idx === activeSectionIdx;
          return (
            <div
              key={section.id}
              className={`border-b border-[var(--theme-border)] transition-colors ${
                isActive
                  ? 'bg-[var(--theme-primary)]/10 border-l-2 border-l-[var(--theme-primary)]'
                  : 'hover:bg-[var(--theme-bg)]/50'
              }`}
            >
              {/* Section row */}
              <div className="flex items-center gap-1 px-2 py-1">
                {/* Active indicator / jump button */}
                <button
                  onClick={() => !isPlaying && onGoToSection(idx)}
                  title={isPlaying ? 'Cannot jump while playing' : `Jump to ${section.name}`}
                  disabled={isPlaying}
                  className={`w-4 h-4 rounded-full shrink-0 border transition-colors ${
                    isActive
                      ? 'bg-[var(--theme-primary)] border-[var(--theme-primary)]'
                      : 'border-[var(--theme-border)] hover:border-[var(--theme-primary)] disabled:hover:border-[var(--theme-border)]'
                  }`}
                />

                {/* Name (editable) */}
                {editingId === section.id ? (
                  <input
                    ref={inputRef}
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingId(null); }}
                    className="flex-1 text-[10px] bg-[var(--theme-bg)] border border-[var(--theme-primary)] rounded px-1 py-0.5 text-[var(--theme-text)] outline-none min-w-0"
                    style={{ maxWidth: 80 }}
                    autoFocus
                  />
                ) : (
                  <span
                    onDoubleClick={() => startEdit(section)}
                    title="Double-click to rename"
                    className={`flex-1 text-[10px] font-semibold truncate cursor-default ${
                      isActive ? 'text-[var(--theme-primary)]' : 'text-[var(--theme-text)]'
                    }`}
                    style={{ maxWidth: 80 }}
                  >
                    {section.name}
                  </span>
                )}

                {/* Repeat count */}
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => onRepeatCount(section.id, section.repeatCount - 1)}
                    className="w-4 h-4 flex items-center justify-center text-[10px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] leading-none"
                    title="Fewer repeats"
                  >−</button>
                  <span className="text-[9px] tabular-nums text-[var(--theme-text-muted)] w-4 text-center">
                    {section.repeatCount}×
                  </span>
                  <button
                    onClick={() => onRepeatCount(section.id, section.repeatCount + 1)}
                    className="w-4 h-4 flex items-center justify-center text-[10px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] leading-none"
                    title="More repeats"
                  >+</button>
                </div>

                {/* Move / remove */}
                <div className="flex flex-col shrink-0">
                  <button
                    onClick={() => onMoveSection(section.id, 'up')}
                    disabled={idx === 0}
                    className="text-[8px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] disabled:opacity-30 leading-none"
                    title="Move up"
                  >▲</button>
                  <button
                    onClick={() => onMoveSection(section.id, 'down')}
                    disabled={idx === sections.length - 1}
                    className="text-[8px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] disabled:opacity-30 leading-none"
                    title="Move down"
                  >▼</button>
                </div>

                <button
                  onClick={() => onRemoveSection(section.id)}
                  disabled={sections.length <= 1}
                  className="text-[10px] text-[var(--theme-text-muted)] hover:text-red-400 disabled:opacity-30 shrink-0"
                  title="Remove section"
                >×</button>
              </div>

              {/* Track slot mutes */}
              {globalTracks.length > 0 && (
                <div className="flex flex-wrap gap-1 px-2 pb-1.5">
                  {globalTracks.map(track => {
                    const slot = section.trackSlots.find(s => s.trackId === track.id);
                    const muted = slot?.mute ?? false;
                    const hasCopy = !!slot?.localCopy;
                    return (
                      <button
                        key={track.id}
                        onClick={() => onToggleSlotMute(section.id, track.id)}
                        title={`${muted ? 'Unmute' : 'Mute'} "${track.name}"${hasCopy ? ' (local copy)' : ''}`}
                        className={`text-[8px] px-1 py-0.5 rounded transition-colors leading-none ${
                          muted
                            ? 'bg-[var(--theme-text-muted)]/20 text-[var(--theme-text-muted)] line-through'
                            : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]'
                        }`}
                        style={{ borderLeft: `2px solid ${track.color}` }}
                      >
                        {hasCopy ? '✎' : ''}{track.name.slice(0, 5)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer: loop toggle info */}
      <div className="px-2 py-1 border-t border-[var(--theme-border)] shrink-0">
        <span className="text-[9px] text-[var(--theme-text-muted)]">
          {loopArrangement ? 'Loops from start after last block' : 'Stops after last block'}
        </span>
      </div>
    </div>
  );
};
