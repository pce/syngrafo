import { useState, useEffect, useCallback, useRef } from 'react';
import { CsoundEngine, type EngineState } from './CsoundEngine.ts';

export interface UseCsoundReturn {
  state:        EngineState;
  isReady:      boolean;
  isPlaying:    boolean;
  log:          string[];
  performCsd:   (csd: string)   => Promise<void>;
  compileOrc:   (orc: string)   => Promise<void>;
  readScore:    (score: string) => Promise<void>;
  inputMsg:     (event: string) => void;
  setChannel:   (name: string, value: number) => void;
  getChannel:   (name: string) => Promise<number>;
  getScoreTime: () => Promise<number>;
  writeFile:    (path: string, data: Uint8Array) => void;
  stop:         () => Promise<void>;
  error:        string | null;
}

export function useCsound(): UseCsoundReturn {
  const [state, setState] = useState<EngineState>('idle');
  const [log,   setLog]   = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const engineRef = useRef<CsoundEngine | null>(null);

  useEffect(() => {
    let cancelled = false;
    CsoundEngine.get({
      useWorker: true,
      useSAB: true,
      onMessage: (msg) => {
        if (!cancelled) setLog(prev => [...prev.slice(-200), msg]);
      },
      onStateChange: (s) => {
        if (!cancelled) setState(s);
      },
    })
      .then(eng => { if (!cancelled) engineRef.current = eng; })
      .catch(e  => { if (!cancelled) setError(String(e)); });

    return () => { cancelled = true; };
  }, []);

  const performCsd   = useCallback((csd:   string) => engineRef.current!.performCsd(csd),   []);
  const compileOrc   = useCallback((orc:   string) => engineRef.current!.compileOrc(orc),   []);
  const readScore    = useCallback((score: string) => engineRef.current!.readScore(score),   []);
  const inputMsg     = useCallback((ev:    string) => engineRef.current!.inputMessage(ev),   []);
  const setChannel   = useCallback((n: string, v: number) => engineRef.current!.setChannel(n, v), []);
  const getChannel   = useCallback((n: string) => engineRef.current!.getChannel(n),          []);
  const getScoreTime = useCallback(() => engineRef.current!.getScoreTime(),                  []);
  const writeFile    = useCallback((p: string, d: Uint8Array) => engineRef.current!.writeFile(p, d), []);
  const stop         = useCallback(() => engineRef.current!.stop(),                          []);

  return {
    state,
    isReady:  state === 'ready' || state === 'playing',
    isPlaying: state === 'playing',
    log, error,
    performCsd, compileOrc, readScore, inputMsg,
    setChannel, getChannel, getScoreTime, writeFile, stop,
  };
}
