/**
 * CsoundEngine — singleton wrapper around @csound/browser.
 *
 * Usage:
 *   const engine = await CsoundEngine.get();
 *   await engine.performCsd(myCsdText);
 *   engine.setChannel('cutoff', 0.8);
 *   const t = await engine.getScoreTime();
 *   await engine.stop();
 */
import type { CsoundObj } from '@csound/browser';

export type EngineState = 'idle' | 'loading' | 'ready' | 'playing' | 'error';

export interface CsoundEngineOptions {
  /** Run Csound in a Web Worker thread (default: true — never blocks UI) */
  useWorker?: boolean;
  /** Use SharedArrayBuffer comms if available (default: true, auto-degrades) */
  useSAB?: boolean;
  /** Called with each Csound log message */
  onMessage?: (msg: string) => void;
  /** Called when state changes */
  onStateChange?: (state: EngineState) => void;
}

class CsoundEngine {
  private static instance: CsoundEngine | null = null;
  private cs: CsoundObj | undefined = undefined;
  private state: EngineState = 'idle';
  private opts: CsoundEngineOptions;
  private messages: string[] = [];

  private constructor(opts: CsoundEngineOptions) {
    this.opts = opts;
  }

  /** Get or create the singleton engine. Calling get() multiple times is safe. */
  static async get(opts: CsoundEngineOptions = {}): Promise<CsoundEngine> {
    if (!CsoundEngine.instance) {
      CsoundEngine.instance = new CsoundEngine(opts);
    }
    if (CsoundEngine.instance.state === 'idle') {
      await CsoundEngine.instance.init();
    }
    return CsoundEngine.instance;
  }

  /** Destroy singleton (e.g. for testing or full reset). */
  static reset(): void {
    void CsoundEngine.instance?.cs?.destroy();
    CsoundEngine.instance = null;
  }

  private setState(s: EngineState) {
    this.state = s;
    this.opts.onStateChange?.(s);
  }

  private async init(): Promise<void> {
    this.setState('loading');
    try {
      const { Csound } = await import('@csound/browser');
      this.cs = await Csound({
        useWorker: this.opts.useWorker ?? true,
        useSAB:    this.opts.useSAB    ?? true,
        autoConnect: true,
      });
      if (!this.cs) throw new Error('Csound() returned undefined — WASM may not have loaded');

      // Wire log messages
      this.cs.on('message', (msg: string) => {
        this.messages.push(msg);
        if (this.messages.length > 500) this.messages.shift();
        this.opts.onMessage?.(msg);
      });

      this.cs.on('realtimePerformanceEnded', () => this.setState('ready'));
      this.cs.on('renderEnded',              () => this.setState('ready'));

      this.setState('ready');
    } catch (e) {
      this.setState('error');
      throw e;
    }
  }

  get currentState(): EngineState { return this.state; }
  get isReady():   boolean { return this.state === 'ready' || this.state === 'playing'; }
  get isPlaying(): boolean { return this.state === 'playing'; }
  get log(): readonly string[] { return this.messages; }

  private get csound(): CsoundObj {
    if (!this.cs) throw new Error('CsoundEngine not initialised — call CsoundEngine.get() first');
    return this.cs;
  }

  /** Compile and perform a full CSD string. */
  async performCsd(csd: string): Promise<void> {
    // compileCSD with mode=1 treats first arg as CSD text (not a file path)
    await this.csound.compileCSD(csd, 1);
    await this.csound.start();
    this.setState('playing');
    void this.csound.perform(); // non-blocking fire-and-forget
  }

  /** Compile just the orchestra part; inject score events later with readScore(). */
  async compileOrc(orc: string): Promise<void> {
    await this.csound.compileOrc(orc);
    await this.csound.start();
    this.setState('playing');
    void this.csound.perform();
  }

  /** Inject score events into a running performance (live coding style). */
  async readScore(score: string): Promise<void> {
    await this.csound.readScore(score);
  }

  /** Send an immediate score event (e.g. "i 1 0 2 440 0.5"). */
  inputMessage(event: string): void {
    this.csound.inputMessage(event);
  }

  async stop(): Promise<void> {
    await this.csound.stop();
    await this.csound.cleanup();
    await this.csound.reset();
    this.setState('ready');
  }

  async destroy(): Promise<void> {
    await this.csound.destroy();
    this.setState('idle');
    CsoundEngine.instance = null;
  }

  /** Set a k-rate control channel (e.g. for a live knob). */
  setChannel(name: string, value: number): void {
    this.csound.setControlChannel(name, value);
  }

  /** Get the current value of a k-rate control channel. */
  async getChannel(name: string): Promise<number> {
    // The beta typings declare Promise<undefined> but runtime returns Promise<number>
    return ((await this.csound.getControlChannel(name)) as unknown as number) ?? 0;
  }

  setStringChannel(name: string, value: string): void {
    this.csound.setStringChannel(name, value);
  }

  async getScoreTime(): Promise<number> {
    return this.csound.getScoreTime();
  }

  async setScoreOffset(seconds: number): Promise<void> {
    await this.csound.setScoreOffsetSeconds(seconds);
  }

  /**
   * Write a file into Csound's in-memory filesystem.
   * Use before performing if your CSD references external files.
   *
   * @param path  virtual path (e.g. "/samples/kick.wav")
   * @param data  raw bytes
   */
  writeFile(path: string, data: Uint8Array | ArrayBuffer): void {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.csound as any).fs.writeFileSync(path, bytes);
  }

  readFile(path: string): Uint8Array {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.csound as any).fs.readFileSync(path) as Uint8Array;
  }

  midiMessage(status: number, data1: number, data2: number): void {
    this.csound.midiMessage(status, data1, data2);
  }

  async tableGet(tableNum: number, index: number): Promise<number> {
    return this.csound.tableGet(String(tableNum), String(index));
  }

  async tableCopyOut(tableNum: number): Promise<Float64Array | undefined> {
    return this.csound.tableCopyOut(String(tableNum));
  }

  /**
   * Copy an array into a Csound table.
   * Note: @csound/browser 7.x tableCopyIn takes (tableNum, array) only.
   */
  async tableCopyIn(tableNum: number, arr: number[]): Promise<void> {
    await this.csound.tableCopyIn(String(tableNum), arr);
  }
}

export { CsoundEngine };
