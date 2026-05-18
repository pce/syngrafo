/**
 * useCsoundSequencer
 *
 * Bridges the Web-Audio look-ahead scheduler in AudioTimeline to the
 * Csound WASM engine (@csound/browser) so real-time playback uses the
 * same Csound instruments as the offline WAV render.
 *
 * Usage (inside AudioTimeline or AudioTimelinePage):
 *
 *   const seq = useCsoundSequencer();
 *
 *   // Arm once when playback starts:
 *   await seq.arm();
 *
 *   // Inside the look-ahead tick, instead of playNote():
 *   seq.fireNote("SeqSine", targetAudioCtxTime - audioCtx.currentTime, dur, freq, vel);
 *
 *   // When stopping:
 *   await seq.disarm();
 */

import { useRef, useState, useCallback } from 'react';
import { CsoundEngine } from './CsoundEngine.ts';
import { SEQ_ALL_INSTRS, SEQ_SINE_TABLE } from './csd/sequencerInstruments.ts';

// ─────────────────────────────────────────────────────────────────────────────

export interface CsoundSequencerHandle {
  /** Compile orchestra + start Csound WASM DAC. Safe to call multiple times (no-op if already armed). */
  arm(): Promise<void>;
  /** Stop Csound WASM. */
  disarm(): Promise<void>;
  /**
   * Schedule a single note event.
   * @param instrName  Csound instrument name, e.g. "SeqSine"
   * @param relTimeSec Seconds from now (AudioContext lookahead offset)
   * @param dur        Note duration in seconds
   * @param freq       Frequency in Hz
   * @param vel        Velocity 0..1
   */
  fireNote(instrName: string, relTimeSec: number, dur: number, freq: number, vel: number): void;
  /** Whether the engine is armed and ready. React state — safe to read in render. */
  isArmed: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────

export function useCsoundSequencer(): CsoundSequencerHandle {
  const engineRef = useRef<CsoundEngine | null>(null);
  const [isArmed, setIsArmed] = useState(false);

  // ── arm ────────────────────────────────────────────────────────────────────
  const arm = useCallback(async () => {
    if (isArmed) return; // no-op if already armed

    try {
      const engine = await CsoundEngine.get();

      // compileOrc also calls start() + perform() (non-blocking) internally.
      await engine.compileOrc(SEQ_ALL_INSTRS);

      // Load the GEN10 sine-wave function table required by SeqSine (table #1).
      engine.inputMessage(SEQ_SINE_TABLE);

      engineRef.current = engine;
      setIsArmed(true);
    } catch (e) {
      console.error('[useCsoundSequencer] arm() failed:', e);
      // Leave isArmed = false so callers can detect the failure.
    }
  }, [isArmed]);

  // ── disarm ─────────────────────────────────────────────────────────────────
  const disarm = useCallback(async () => {
    if (engineRef.current) {
      await engineRef.current.stop();
    }
    setIsArmed(false);
  }, []);

  // ── fireNote ───────────────────────────────────────────────────────────────
  const fireNote = useCallback((
    instrName: string,
    relTimeSec: number,
    dur: number,
    freq: number,
    vel: number,
  ): void => {
    if (!isArmed || !engineRef.current) return;

    // The '+' prefix tells Csound the time is relative to the current score time.
    // relTimeSec == 0 means "as soon as possible" — clamp negatives to 0.
    const rel = Math.max(0, relTimeSec).toFixed(5);
    engineRef.current.inputMessage(
      `i "${instrName}" +${rel} ${dur.toFixed(5)} ${freq.toFixed(3)} ${vel.toFixed(3)}`,
    );
  }, [isArmed]);

  // ── return handle ──────────────────────────────────────────────────────────
  return { arm, disarm, fireNote, isArmed };
}
