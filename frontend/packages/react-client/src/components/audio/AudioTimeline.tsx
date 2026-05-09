/**
 * AudioTimeline — multi-track step sequencer using the Web Audio API.
 *
 * Architecture
 *
 * Playback uses a look-ahead scheduler (setInterval @ 25 ms, lookahead 100 ms)
 * so audio timing is rock-solid even when the JS thread is busy. Each track
 * can have a different step-length, giving natural polyrhythm. OscillatorNode
 * is used directly — no Csound dependency here; CSD live-coding lives in the
 * separate CsdEditor panel.
 *
 * Interaction
 * - Click a step button → add note (track's root pitch + octave offset)
 * - Click again → remove note
 * - Header controls: mute M, solo S, instrument, root note, octave, step count, clear
 * - Transport: Play / Stop, BPM slider + number box
 * - Drag handle on step buttons for future drag-to-resize
 *
 */

import React, {
  useState, useCallback, useEffect, useRef, memo,
} from "react";
import type { AudioTrack, Note } from "@/types/audio";
import { InstrumentType } from "@/types/audio";
import { usePatchStore } from "@/store/patch-store";


const NOTE_NAMES = [
  "C","C#","D","D#","E","F","F#","G","G#","A","A#","B",
] as const;

const INSTRUMENTS = Object.values(InstrumentType);
const STEP_LENGTHS = [8, 16, 32] as const;

const LOOKAHEAD_S = 0.1;  // schedule up to 100 ms ahead
const TICK_MS     = 25;   // scheduler tick interval


function noteToMidi(name: string, octave: number): number {
  const i = (NOTE_NAMES as readonly string[]).indexOf(name);
  return i >= 0 ? (octave + 1) * 12 + i : 60;
}

function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function toOscType(instr: InstrumentType): OscillatorType {
  if (instr === InstrumentType.Square)   return "square";
  if (instr === InstrumentType.Sawtooth) return "sawtooth";
  if (instr === InstrumentType.Triangle) return "triangle";
  return "sine";
}

function playNote(
  ctx:     AudioContext,
  freq:    number,
  type:    OscillatorType,
  startAt: number,
  durSec:  number,
  gain = 0.35,
): void {
  const osc  = ctx.createOscillator();
  const env  = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startAt);
  env.gain.setValueAtTime(gain, startAt);
  env.gain.exponentialRampToValueAtTime(0.0001, startAt + durSec);
  osc.connect(env);
  env.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + durSec + 0.01);
}


interface AudioTimelineProps {
  tracks:              AudioTrack[];
  onAddTrack:          () => void;
  onTrackModeToggle:   (trackId: string) => void;
  onTrackLengthChange: (trackId: string, length: number) => void;
  onTrackMute:         (trackId: string) => void;
  onTrackSolo:         (trackId: string) => void;
  onOctaveChange:      (trackId: string, delta: number) => void;
  onAddNote:           (trackId: string, note: Note) => void;
  onScaleChange:       (trackId: string, rootNote: string, scaleName: string) => void;
  onNoteRemove:        (trackId: string, noteId: string) => void;
  onClearPattern:      (trackId: string) => void;
  onInstrumentChange:  (trackId: string, instr: InstrumentType) => void;
  /** Called each time the sequencer wraps back to step 0 */
  onCycleComplete?:    () => void;
  /** Per-track mute overrides from the section arranger (key = track id) */
  sectionMutes?:       Map<string, boolean>;
  /** Called when a PatchBlock step fires; receives the patchId and note duration */
  onTriggerPatch?:     (patchId: string, duration: number) => void;
  /** Called when a PatchBlock track's patch selection changes */
  onPatchIdChange?:    (trackId: string, patchId: string) => void;
}

const AudioTimeline: React.FC<AudioTimelineProps> = ({
  tracks,
  onAddTrack,
  onTrackLengthChange,
  onTrackMute,
  onTrackSolo,
  onOctaveChange,
  onAddNote,
  onScaleChange,
  onNoteRemove,
  onClearPattern,
  onInstrumentChange,
  onCycleComplete,
  sectionMutes,
  onTriggerPatch,
  onPatchIdChange,
}) => {
  const patchStore = usePatchStore();
  const [isPlaying,   setIsPlaying]   = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [bpm,         setBpm]         = useState(120);

  // Refs that the scheduler closure reads without re-creating the interval
  const ctxRef      = useRef<AudioContext | null>(null);
  const timerRef    = useRef<number | null>(null);
  const nextBeatRef = useRef(0);
  const stepRef     = useRef(0);
  const tracksRef   = useRef(tracks);
  const bpmRef      = useRef(bpm);
  // Callback refs — keep scheduler closure up-to-date without re-creating the interval
  const onCycleCompleteRef = useRef(onCycleComplete);
  const sectionMutesRef    = useRef(sectionMutes);
  const onTriggerPatchRef  = useRef(onTriggerPatch);
  useEffect(() => { tracksRef.current          = tracks;          }, [tracks]);
  useEffect(() => { bpmRef.current             = bpm;             }, [bpm]);
  useEffect(() => { onCycleCompleteRef.current = onCycleComplete; }, [onCycleComplete]);
  useEffect(() => { sectionMutesRef.current    = sectionMutes;    }, [sectionMutes]);
  useEffect(() => { onTriggerPatchRef.current  = onTriggerPatch;  }, [onTriggerPatch]);


  const tick = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;

    // 16th note duration
    const secPerStep = 60 / bpmRef.current / 4;

    while (nextBeatRef.current < ctx.currentTime + LOOKAHEAD_S) {
      const step      = stepRef.current;
      const t         = nextBeatRef.current;
      const tracksNow = tracksRef.current;

      tracksNow.forEach(track => {
        const slotMuted = sectionMutesRef.current?.get(track.id) ?? false;
        if (track.schedulerMuted || slotMuted) return;
        const trackStep = step % track.length;
        const note      = track.notes.find(n => n.time === trackStep);
        if (!note) return;
        // PatchBlock: delegate to the external patch engine instead of Web Audio
        if (track.instrument === InstrumentType.PatchBlock && track.patchId) {
          onTriggerPatchRef.current?.(track.patchId, secPerStep * 0.75);
        } else {
          const octave = 4 + (track.octaveOffset ?? 0);
          const freq   = midiToHz(noteToMidi(track.rootNote ?? "C", octave));
          playNote(ctx, freq, toOscType(track.instrument), t, secPerStep * 0.75);
        }
      });

      nextBeatRef.current += secPerStep;
      const maxLen = Math.max(...tracksNow.map(t => t.length), 1);
      stepRef.current = (step + 1) % maxLen;
      if (stepRef.current === 0) onCycleCompleteRef.current?.();
      setCurrentStep(stepRef.current);
    }
  }, []);

  const start = useCallback(async () => {
    let ctx = ctxRef.current;
    if (!ctx) { ctx = new AudioContext(); ctxRef.current = ctx; }
    if (ctx.state === "suspended") await ctx.resume();
    nextBeatRef.current = ctx.currentTime + 0.02;
    stepRef.current     = 0;
    setCurrentStep(0);
    timerRef.current = window.setInterval(tick, TICK_MS);
    setIsPlaying(true);
  }, [tick]);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setCurrentStep(-1);
    setIsPlaying(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => () => {
    if (timerRef.current !== null) clearInterval(timerRef.current);
  }, []);


  const toggleStep = useCallback((track: AudioTrack, step: number) => {
    const existing = track.notes.find(n => n.time === step);
    if (existing) {
      onNoteRemove(track.id, existing.id);
    } else {
      const octave = 4 + (track.octaveOffset ?? 0);
      onAddNote(track.id, {
        id:       crypto.randomUUID(),
        pitch:    noteToMidi(track.rootNote ?? "C", octave),
        time:     step,
        duration: 0.5,
        velocity: 100,
      });
    }
  }, [onAddNote, onNoteRemove]);


  const maxSteps = Math.max(...tracks.map(t => t.length), 16);


  return (
    <div className="flex flex-col h-full bg-[var(--theme-bg)] text-[var(--theme-text)] select-none overflow-hidden">

      {/*  Transport  */}
      <div className="flex items-center gap-3 px-3 py-2 bg-[var(--theme-surface)] border-b border-[var(--theme-border)] flex-shrink-0 flex-wrap gap-y-1.5">

        <button
          onClick={isPlaying ? stop : start}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-semibold transition-colors ${
            isPlaying
              ? "bg-[var(--theme-danger)]/15 hover:bg-[var(--theme-danger)]/25 text-[var(--theme-danger)]"
              : "bg-[var(--theme-primary)] hover:opacity-90 text-[var(--theme-primary-fg)]"
          }`}
        >
          {isPlaying ? "⏹ Stop" : "▶ Play"}
        </button>

        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--theme-text-muted)]">BPM</span>
          <input
            type="range" min={40} max={220} step={1} value={bpm}
            onChange={e => setBpm(Number(e.target.value))}
            className="w-24 accent-[var(--theme-primary)]"
          />
          <input
            type="number" min={40} max={220} value={bpm}
            onChange={e => { const v = Number(e.target.value); if (v >= 40 && v <= 220) setBpm(v); }}
            className="w-12 text-xs bg-[var(--theme-bg)] border border-[var(--theme-border)]
                       rounded px-1 py-0.5 text-center text-[var(--theme-text)] tabular-nums"
          />
        </div>

        {isPlaying && (
          <>
            <div className="w-px h-4 bg-[var(--theme-border)]" />
            <span className="text-[10px] font-mono text-[var(--theme-text-muted)] tabular-nums">
              {currentStep + 1} / {maxSteps}
            </span>
          </>
        )}

        <div className="flex-1" />

        <button
          onClick={onAddTrack}
          className="text-xs px-3 py-1 rounded border border-[var(--theme-border)]
                     bg-[var(--theme-surface)] hover:bg-[var(--theme-bg)]
                     text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors"
        >
          + Track
        </button>
      </div>

      {/*  Track list  */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {tracks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3
                          text-[var(--theme-text-muted)] p-8">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                 className="w-10 h-10 opacity-25">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
            <p className="text-sm">No tracks yet.</p>
            <button
              onClick={onAddTrack}
              className="px-4 py-1.5 bg-[var(--theme-primary)] hover:opacity-90
                         text-[var(--theme-primary-fg)] text-xs font-semibold rounded-lg"
            >
              Add Track
            </button>
          </div>
        ) : (
          tracks.map(track => (
            <StepTrack
              key={track.id}
              track={track}
              currentStep={currentStep}
              isPlaying={isPlaying}
              patchEntries={patchStore.patches}
              onMute={()        => onTrackMute(track.id)}
              onSolo={()        => onTrackSolo(track.id)}
              onOctaveUp={()    => onOctaveChange(track.id,  1)}
              onOctaveDown={()  => onOctaveChange(track.id, -1)}
              onLength={l       => onTrackLengthChange(track.id, l)}
              onClear={()       => onClearPattern(track.id)}
              onInstrument={i   => onInstrumentChange(track.id, i)}
              onRoot={root      => onScaleChange(track.id, root, track.scaleName ?? "major")}
              onToggle={step    => toggleStep(track, step)}
              onPatchChange={pid => onPatchIdChange?.(track.id, pid)}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default AudioTimeline;


interface StepTrackProps {
  track:        AudioTrack;
  currentStep:  number;
  isPlaying:    boolean;
  patchEntries: { id: string; name: string }[];
  onMute:       () => void;
  onSolo:       () => void;
  onOctaveUp:   () => void;
  onOctaveDown: () => void;
  onLength:     (n: number) => void;
  onClear:      () => void;
  onInstrument: (i: InstrumentType) => void;
  onRoot:       (root: string) => void;
  onToggle:     (step: number) => void;
  onPatchChange:(patchId: string) => void;
}

const StepTrack = memo(function StepTrack({
  track, currentStep, isPlaying,
  patchEntries,
  onMute, onSolo, onOctaveUp, onOctaveDown,
  onLength, onClear, onInstrument, onRoot, onToggle, onPatchChange,
}: StepTrackProps) {
  const octave      = 4 + (track.octaveOffset ?? 0);
  const isMuted     = track.schedulerMuted && !track.solo;
  const isPatchBlock = track.instrument === InstrumentType.PatchBlock;

  return (
    <div className={`flex border-b border-[var(--theme-border)] transition-opacity duration-150 ${
      isMuted ? "opacity-35" : "opacity-100"
    }`}>

      {/*  Track header  */}
      <div className="flex flex-col gap-1 px-2 py-2 bg-[var(--theme-surface)] border-r border-[var(--theme-border)] w-44 shrink-0">

        {/* Name row */}
        <div className="flex items-center gap-1.5">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-white/10"
            style={{ backgroundColor: track.color }}
          />
          <span className="text-xs font-medium text-[var(--theme-text)] truncate flex-1 min-w-0">
            {track.name}
          </span>
          <button
            onClick={onMute}
            title={track.mute ? "Unmute" : "Mute"}
            className={`w-5 h-5 rounded text-[10px] font-bold transition-colors ${
              track.mute
                ? "bg-yellow-500/20 text-yellow-400"
                : "bg-[var(--theme-bg)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
            }`}
          >M</button>
          <button
            onClick={onSolo}
            title={track.solo ? "Unsolo" : "Solo"}
            className={`w-5 h-5 rounded text-[10px] font-bold transition-colors ${
              track.solo
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-[var(--theme-bg)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
            }`}
          >S</button>
        </div>

        {/* Instrument select */}
        <select
          value={track.instrument}
          onChange={e => onInstrument(e.target.value as InstrumentType)}
          className="text-[10px] bg-[var(--theme-bg)] border border-[var(--theme-border)]
                     rounded px-1 py-0.5 text-[var(--theme-text)] w-full"
        >
          {INSTRUMENTS.map(i => (
            <option key={i} value={i}>{i.charAt(0).toUpperCase() + i.slice(1)}</option>
          ))}
        </select>

        {/* Patch picker — only when PatchBlock is selected */}
        {isPatchBlock && (
          <select
            value={track.patchId ?? ""}
            onChange={e => onPatchChange(e.target.value)}
            className="text-[10px] bg-[var(--theme-bg)] border border-[var(--theme-primary)]/60
                       rounded px-1 py-0.5 text-[var(--theme-primary)] w-full"
            title="Select which patch this track triggers"
          >
            <option value="" disabled>— pick patch —</option>
            {patchEntries.map(e => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        )}

        {/* Root note + octave — hidden for PatchBlock */}
        {!isPatchBlock && (
          <div className="flex items-center gap-1">
            <select
              value={track.rootNote ?? "C"}
              onChange={e => onRoot(e.target.value)}
              className="text-[10px] bg-[var(--theme-bg)] border border-[var(--theme-border)]
                         rounded px-1 py-0.5 text-[var(--theme-text)] flex-1 min-w-0"
            >
              {NOTE_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <button onClick={onOctaveDown}
              className="w-5 h-5 rounded text-[10px] bg-[var(--theme-bg)]
                         border border-[var(--theme-border)]
                         text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]">−</button>
            <span className="text-[10px] text-[var(--theme-text-muted)] tabular-nums w-3 text-center">
              {octave}
            </span>
            <button onClick={onOctaveUp}
              className="w-5 h-5 rounded text-[10px] bg-[var(--theme-bg)]
                         border border-[var(--theme-border)]
                         text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]">+</button>
          </div>
        )}

        {/* Length + clear */}
        <div className="flex items-center gap-1">
          <select
            value={track.length}
            onChange={e => onLength(Number(e.target.value))}
            className="text-[10px] bg-[var(--theme-bg)] border border-[var(--theme-border)]
                       rounded px-1 py-0.5 text-[var(--theme-text)] flex-1"
          >
            {STEP_LENGTHS.map(n => (
              <option key={n} value={n}>{n} steps</option>
            ))}
          </select>
          <button
            onClick={onClear}
            title="Clear all steps"
            className="w-5 h-5 rounded text-[10px] bg-[var(--theme-bg)]
                       border border-[var(--theme-border)]
                       text-[var(--theme-text-muted)] hover:text-red-400 transition-colors"
          >×</button>
        </div>
      </div>

      {/*  Step grid  */}
      <div className="flex-1 min-w-0 px-2 py-2 overflow-x-auto">
        <div
          className="grid gap-[3px]"
          style={{
            gridTemplateColumns: `repeat(${track.length}, minmax(18px, 1fr))`,
            minHeight: "42px",
          }}
        >
          {Array.from({ length: track.length }, (_, step) => {
            const active   = track.notes.some(n => n.time === step);
            // Highlight the current playhead step, wrapping at this track's length
            const isCur    = isPlaying && currentStep >= 0 && step === (currentStep % track.length);
            const isBeat   = step % 4 === 0;

            return (
              <button
                key={step}
                onClick={() => onToggle(step)}
                aria-pressed={active}
                aria-label={`Step ${step + 1}`}
                style={active ? { backgroundColor: track.color } : undefined}
                className={[
                  "h-full min-h-[36px] rounded-[3px] border transition-all duration-75",
                  active
                    ? "opacity-90 hover:opacity-100 border-white/15 shadow-sm"
                    : isBeat
                    ? "bg-[var(--theme-surface)] hover:bg-[var(--theme-border)] border-[var(--theme-border)]"
                    : "bg-[var(--theme-bg)] hover:bg-[var(--theme-surface)] border-[var(--theme-border)]",
                  isCur ? "ring-2 ring-white/75 scale-95 brightness-125" : "",
                ].join(" ")}
              />
            );
          })}
        </div>

        {/* Beat markers */}
        <div
          className="grid mt-0.5"
          style={{ gridTemplateColumns: `repeat(${track.length}, minmax(18px, 1fr))` }}
        >
          {Array.from({ length: track.length }, (_, step) => (
            <div key={step} className="flex justify-center">
              {step % 4 === 0 && (
                <span className="text-[8px] text-[var(--theme-text-muted)] opacity-50 tabular-nums">
                  {step + 1}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
