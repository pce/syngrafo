import type { BlockTypeDef, BlockKind } from './types.ts';

// ────────────────────────────────────────────────────────────────────────────
// GRAINADE — Granular sampler
// ────────────────────────────────────────────────────────────────────────────

const GRAINADE_ORC = `
instr Grainade_{{id}}
  ; ── Modulatable inputs (written by PatchEngine from cable connections) ───
  kPitch    chnget "{{id}}.pitch"      ; semitone offset  -24..+24
  kGrainSz  chnget "{{id}}.grainSize"  ; grain size ms     1..500
  kDensity  chnget "{{id}}.density"    ; grains/sec        1..200
  kPos      chnget "{{id}}.position"   ; table position    0..1
  kAmp      chnget "{{id}}.amplitude"  ; amplitude         0..1
  ; ── Static params ────────────────────────────────────────────────────────
  kBitCrush chnget "{{id}}.bitCrush"   ; 0=32-bit clean  1=8-bit retro
  kBitRate  chnget "{{id}}.bitRate"    ; 0=full SR       1=11025 Hz
  kDrone    chnget "{{id}}.drone"      ; 0=normal        1=infinite (no note-off)
  kGlide    chnget "{{id}}.glide"      ; pitch glide ms  0..2000
  Sfile     chnget "{{id}}.sampleFile"
  ; ── Defaults ─────────────────────────────────────────────────────────────
  kGrainSz = (kGrainSz <= 0 ? 50  : kGrainSz)
  kDensity = (kDensity <= 0 ? 40  : kDensity)
  kAmp     = (kAmp     <= 0 ? 0.7 : kAmp)
  ; ── Pitch: semitone → ratio → glide ──────────────────────────────────────
  kRatio       = pow(2, kPitch / 12)
  kGlideSec    = (kGlide < 1 ? 0.001 : kGlide / 1000)
  kRatioSmooth portk kRatio, kGlideSec
  ; ── Amplitude envelope (drone bypasses note-off release) ─────────────────
  kenv linsegr 0, 0.01, kAmp, p3 - 0.02, kAmp, 0.05, 0
  if kDrone == 1 then
    kenv = kAmp
  endif
  ; ── Granular synthesis ──────────────────────────────────────────────────
  if strlen(Sfile) > 0 then
    ift ftgenonce 0, 0, 0, 1, Sfile, 0, 0, 0
    ; syncgrain: kamp, kfreq(density), kpitch(ratio), kgrsize, iovrlp, ifn, iphase, imaxgr
    a1 syncgrain kenv, kDensity, kRatioSmooth, kGrainSz/1000, 64, ift, kPos, 64
  else
    ; Oscillator grain cloud (no sample loaded)
    a1 grain kenv, kDensity, 0.01, kPos, kGrainSz/1000, 0, 1, -7, 0
  endif
  aR = a1
  ; ── Bit-depth crush: 1→8-bit (Atari/NES), 0.5→12-bit (SP-12), 0→clean ──
  if kBitCrush > 0.001 then
    kBits  = 32 - (kBitCrush * 24)        ; 0→32 bit, 1→8 bit
    kScale = pow(2, int(kBits) - 1)
    a1     = int(a1 * kScale + 0.5) / kScale
    aR     = a1
  endif
  ; ── Sample-rate crush: 0→full SR, 1→11025 Hz ────────────────────────────
  if kBitRate > 0.001 then
    kTargetHz = sr - (kBitRate * (sr - 11025))
    aTrig     metro kTargetHz
    a1        samphold a1, aTrig
    aR        = a1
  endif
  ; ── Write output channels (read by PatchEngine) ──────────────────────────
  kFollow follow a1, 0.05
  chnset kFollow,              "{{id}}.out.envelope"
  chnset kRatioSmooth * 440.0, "{{id}}.out.pitch"
  chnset kenv,                 "{{id}}.out.amplitude"
  outs a1, aR
endin`.trim();

export const GRAINADE_DEF: BlockTypeDef = {
  kind: 'grainade',
  label: 'GrainadeBlock',
  description: 'Granular sampler — grain cloud from sample or oscillator, onboard bit-crush and drone mode',
  color: '#7c3aed',
  inputs: {
    pitch:     { id: 'pitch',     label: 'Pitch',     dataType: 'pitch',   min: -24, max: 24,  unit: 'st',  default: 0    },
    grainSize: { id: 'grainSize', label: 'Grain Sz',  dataType: 'control', min: 1,   max: 500, unit: 'ms',  default: 50   },
    density:   { id: 'density',   label: 'Density',   dataType: 'control', min: 1,   max: 200, unit: 'g/s', default: 40   },
    position:  { id: 'position',  label: 'Position',  dataType: 'control', min: 0,   max: 1,                default: 0    },
    amplitude: { id: 'amplitude', label: 'Amplitude', dataType: 'control', min: 0,   max: 1,                default: 0.7  },
  },
  outputs: {
    envelope:  { id: 'envelope',  label: 'Envelope',  dataType: 'control', min: 0, max: 1,   description: 'Amplitude follower 0..1' },
    pitch:     { id: 'pitch',     label: 'Pitch Hz',  dataType: 'pitch',                     description: 'Current pitch in Hz'     },
    amplitude: { id: 'amplitude', label: 'Amplitude', dataType: 'control', min: 0, max: 1                                           },
  },
  params: {
    sampleFile: { id: 'sampleFile', label: 'Sample',    type: 'file',    default: ''   },
    pitch:      { id: 'pitch',      label: 'Pitch',      type: 'number',  min: -24,  max: 24,   step: 0.5,  default: 0,   modulatable: true,  unit: 'st'  },
    grainSize:  { id: 'grainSize',  label: 'Grain Sz',   type: 'number',  min: 1,    max: 500,  step: 1,    default: 50,  modulatable: true,  unit: 'ms'  },
    density:    { id: 'density',    label: 'Density',    type: 'number',  min: 1,    max: 200,  step: 1,    default: 40,  modulatable: true,  unit: 'g/s' },
    position:   { id: 'position',   label: 'Position',   type: 'number',  min: 0,    max: 1,    step: 0.01, default: 0,   modulatable: true                },
    amplitude:  { id: 'amplitude',  label: 'Amplitude',  type: 'number',  min: 0,    max: 1,    step: 0.01, default: 0.7, modulatable: true                },
    drone:      { id: 'drone',      label: 'Drone',      type: 'boolean',                        default: false,                     description: 'Infinite loop, ignores note-off' },
    glide:      { id: 'glide',      label: 'Glide',      type: 'number',  min: 0,    max: 2000, step: 10,   default: 0,                         unit: 'ms' },
    bitCrush:   { id: 'bitCrush',   label: 'BitCrush',   type: 'number',  min: 0,    max: 1,    step: 0.01, default: 0,   modulatable: true,  description: '0=32-bit → 1=8-bit Atari' },
    bitRate:    { id: 'bitRate',    label: 'SrCrush',    type: 'number',  min: 0,    max: 1,    step: 0.01, default: 0,   modulatable: true,  description: '0=full SR → 1=11025 Hz' },
  },
  orcTemplate: GRAINADE_ORC,
};

// ────────────────────────────────────────────────────────────────────────────
// SIGNAL FOLLOWER — smooth + scale a control signal
// ────────────────────────────────────────────────────────────────────────────

const SIGNAL_FOLLOWER_ORC = `
instr SignalFollower_{{id}}
  kIn     chnget "{{id}}.signal"
  kSmooth chnget "{{id}}.smooth"
  kScale  chnget "{{id}}.scale"
  kOffset chnget "{{id}}.offset"
  kThresh chnget "{{id}}.threshold"

  kSmooth = (kSmooth <= 0 ? 0.05 : kSmooth / 1000)
  kOut    portk kIn, kSmooth
  kOut    = kOut * kScale + kOffset
  kInv    = 1.0 - kOut

  chnset kOut,                          "{{id}}.out.level"
  chnset kInv,                          "{{id}}.out.inverted"
  chnset (kOut > kThresh ? 1.0 : 0.0),  "{{id}}.out.gate"
endin`.trim();

export const SIGNAL_FOLLOWER_DEF: BlockTypeDef = {
  kind: 'signalFollower',
  label: 'SignalFollower',
  description: 'Smooth, scale and offset a control signal — the glue between blocks in the matrix',
  color: '#0891b2',
  inputs: {
    signal: { id: 'signal', label: 'Signal', dataType: 'control', min: 0, max: 1, default: 0 },
  },
  outputs: {
    level:    { id: 'level',    label: 'Level',    dataType: 'control', min: 0, max: 1 },
    inverted: { id: 'inverted', label: 'Inverted', dataType: 'control', min: 0, max: 1 },
    gate:     { id: 'gate',     label: 'Gate',     dataType: 'trigger'                 },
  },
  params: {
    signal:    { id: 'signal',    label: 'Signal',      type: 'number',  min: 0,  max: 1,    step: 0.01, default: 0,    modulatable: true  },
    smooth:    { id: 'smooth',    label: 'Smooth',      type: 'number',  min: 0,  max: 1000, step: 1,    default: 50,   unit: 'ms'         },
    scale:     { id: 'scale',     label: 'Scale',       type: 'number',  min: -4, max: 4,    step: 0.01, default: 1                        },
    offset:    { id: 'offset',    label: 'Offset',      type: 'number',  min: -1, max: 1,    step: 0.01, default: 0                        },
    threshold: { id: 'threshold', label: 'Gate Thresh', type: 'number',  min: 0,  max: 1,    step: 0.01, default: 0.5                      },
  },
  orcTemplate: SIGNAL_FOLLOWER_ORC,
};

// ────────────────────────────────────────────────────────────────────────────
// DATA TRANSFORM — math on two control signals
// ────────────────────────────────────────────────────────────────────────────

const DATA_TRANSFORM_ORC = `
instr DataTransform_{{id}}
  kA   chnget "{{id}}.a"
  kB   chnget "{{id}}.b"
  kOp  chnget "{{id}}.operation"   ; 0=A+B 1=A*B 2=A-B 3=min 4=max 5=A mod B
  kScl chnget "{{id}}.scale"
  kOff chnget "{{id}}.offset"

  kRes = kA
  if kOp == 0 then
    kRes = kA + kB
  elseif kOp == 1 then
    kRes = kA * kB
  elseif kOp == 2 then
    kRes = kA - kB
  elseif kOp == 3 then
    kRes = (kA < kB ? kA : kB)
  elseif kOp == 4 then
    kRes = (kA > kB ? kA : kB)
  elseif kOp == 5 then
    kRes = kA - (int(kA / (kB == 0 ? 1 : kB)) * kB)
  endif
  kOut   = kRes * kScl + kOff
  kClamp = (kOut < 0 ? 0 : (kOut > 1 ? 1 : kOut))

  chnset kOut,   "{{id}}.out.result"
  chnset kClamp, "{{id}}.out.clamped"
endin`.trim();

export const DATA_TRANSFORM_DEF: BlockTypeDef = {
  kind: 'dataTransform',
  label: 'DataTransform',
  description: 'Math on two control signals: add, mul, subtract, min, max, mod — then scale+offset',
  color: '#059669',
  inputs: {
    a: { id: 'a', label: 'A', dataType: 'control', min: 0, max: 1, default: 0 },
    b: { id: 'b', label: 'B', dataType: 'control', min: 0, max: 1, default: 0 },
  },
  outputs: {
    result:  { id: 'result',  label: 'Result',  dataType: 'control' },
    clamped: { id: 'clamped', label: 'Clamped', dataType: 'control', min: 0, max: 1 },
  },
  params: {
    a:         { id: 'a',         label: 'A',         type: 'number',  min: 0,  max: 1,   step: 0.01, default: 0,  modulatable: true },
    b:         { id: 'b',         label: 'B',         type: 'number',  min: 0,  max: 1,   step: 0.01, default: 0,  modulatable: true },
    operation: { id: 'operation', label: 'Operation', type: 'select',                     default: 0,
      options: [
        { value: 0, label: 'A + B' }, { value: 1, label: 'A \u00d7 B' },
        { value: 2, label: 'A \u2212 B' }, { value: 3, label: 'min(A,B)' },
        { value: 4, label: 'max(A,B)' }, { value: 5, label: 'A mod B' },
      ]},
    scale:  { id: 'scale',  label: 'Scale',  type: 'number', min: -4, max: 4,  step: 0.01, default: 1 },
    offset: { id: 'offset', label: 'Offset', type: 'number', min: -1, max: 1,  step: 0.01, default: 0 },
  },
  orcTemplate: DATA_TRANSFORM_ORC,
};

// ────────────────────────────────────────────────────────────────────────────
// SCALE QUANTIZER — pitch quantization (JS-side, no Csound instrument)
// ────────────────────────────────────────────────────────────────────────────

export const SCALE_QUANTIZER_DEF: BlockTypeDef = {
  kind: 'scaleQuantizer',
  label: 'ScaleQuantizer',
  description: 'Quantize pitch to tonal/microtonal scale — generates arpeggios and chords',
  color: '#d97706',
  inputs: {
    pitch:   { id: 'pitch',   label: 'Pitch In', dataType: 'pitch',   min: 0, max: 127, default: 60 },
    trigger: { id: 'trigger', label: 'Trigger',  dataType: 'trigger',                  default: 0  },
  },
  outputs: {
    quantized: { id: 'quantized', label: 'Pitch Out', dataType: 'pitch',   min: 0, max: 127 },
    trigger:   { id: 'trigger',   label: 'Trigger',   dataType: 'trigger'                   },
  },
  params: {
    pitch:       { id: 'pitch',       label: 'Pitch In',   type: 'number', min: 0,   max: 127, step: 0.01, default: 60,    modulatable: true },
    rootNote:    { id: 'rootNote',    label: 'Root',       type: 'select',                     default: 'C',
      options: ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].map(n => ({ value: n, label: n })) },
    scaleName:   { id: 'scaleName',   label: 'Scale',      type: 'select',                     default: 'major',
      options: [
        { value: 'major',           label: 'Major'             },
        { value: 'minor',           label: 'Natural Minor'     },
        { value: 'harmonicMinor',   label: 'Harmonic Minor'    },
        { value: 'pentatonicMajor', label: 'Pentatonic Major'  },
        { value: 'pentatonicMinor', label: 'Pentatonic Minor'  },
        { value: 'blues',           label: 'Blues'             },
        { value: 'dorian',          label: 'Dorian'            },
        { value: 'phrygian',        label: 'Phrygian'          },
        { value: 'lydian',          label: 'Lydian'            },
        { value: 'mixolydian',      label: 'Mixolydian'        },
        { value: 'chromatic',       label: 'Chromatic'         },
        { value: 'wholeTone',       label: 'Whole Tone'        },
        { value: 'diminished',      label: 'Diminished'        },
        { value: 'microTonal24',    label: 'MicroTonal 24-EDO' },
        { value: 'microTonal31',    label: 'MicroTonal 31-EDO' },
      ] },
    mode:        { id: 'mode',        label: 'Mode',       type: 'select',                     default: 'quantize',
      options: [
        { value: 'quantize',    label: 'Quantize'  },
        { value: 'arpUp',       label: 'Arp \u2191'     },
        { value: 'arpDown',     label: 'Arp \u2193'     },
        { value: 'arpPingPong', label: 'Arp \u2191\u2193'   },
        { value: 'chord',       label: 'Chord'     },
      ] },
    arpSpeed:    { id: 'arpSpeed',    label: 'Arp Speed',  type: 'number', min: 0.1, max: 32,  step: 0.1,  default: 4,     unit: 'steps/bar' },
    octaveRange: { id: 'octaveRange', label: 'Oct Range',  type: 'number', min: 1,   max: 4,   step: 1,    default: 1      },
  },
  orcTemplate: '', // JS-side only
};

// ────────────────────────────────────────────────────────────────────────────
// GRISP CHIPS — bit-depth + sample-rate crusher
// ────────────────────────────────────────────────────────────────────────────

const GRISP_CHIPS_ORC = `
instr GrispChips_{{id}}
  kBitDepth chnget "{{id}}.bitDepth"   ; 0=32-bit clean  1=8-bit Atari/NES
  kSrCrush  chnget "{{id}}.srCrush"    ; 0=full SR       1=11025 Hz SP-12 era
  kMix      chnget "{{id}}.mix"
  kAmp      chnget "{{id}}.amplitude"
  kTestHz   chnget "{{id}}.testPitch"

  kAmp    = (kAmp    <= 0 ? 0.7 : kAmp)
  kTestHz = (kTestHz <= 0 ? 220 : kTestHz)

  ; In standalone mode: sawtooth oscillator as test source
  ain  vco2 kAmp, kTestHz, 0
  adry = ain

  ; ── Bit-depth reduction ───────────────────────────────────────────────────
  if kBitDepth > 0.001 then
    kBits  = 32 - (kBitDepth * 24)   ; 0→32-bit, 0.333→24-bit, 0.667→16-bit, 1→8-bit
    kScale = pow(2, int(kBits) - 1)
    ain    = int(ain * kScale + 0.5) / kScale
  endif

  ; ── Sample-rate reduction ─────────────────────────────────────────────────
  if kSrCrush > 0.001 then
    kTargetHz = sr - (kSrCrush * (sr - 11025))
    aTrig     metro kTargetHz
    ain       samphold ain, aTrig
  endif

  aout = adry * (1 - kMix) + ain * kMix

  kFollow follow aout, 0.05
  chnset kFollow, "{{id}}.out.envelope"
  outs aout, aout
endin`.trim();

export const GRISP_CHIPS_DEF: BlockTypeDef = {
  kind: 'grispChips',
  label: 'GrispChips',
  description: 'Bit-depth + sample-rate crusher: 32-bit/96kHz → 8-bit/11025 Hz, smoothly interpolated',
  color: '#dc2626',
  inputs: {
    bitDepth: { id: 'bitDepth', label: 'Bit Depth', dataType: 'control', min: 0, max: 1, default: 0 },
    srCrush:  { id: 'srCrush',  label: 'SR Crush',  dataType: 'control', min: 0, max: 1, default: 0 },
  },
  outputs: {
    envelope: { id: 'envelope', label: 'Envelope', dataType: 'control', min: 0, max: 1 },
  },
  params: {
    bitDepth:  { id: 'bitDepth',  label: 'Bit Depth', type: 'number', min: 0, max: 1, step: 0.01, default: 0,   modulatable: true, description: '0=32-bit → 0.33=24-bit → 0.66=16-bit → 1=8-bit' },
    srCrush:   { id: 'srCrush',   label: 'SR Crush',  type: 'number', min: 0, max: 1, step: 0.01, default: 0,   modulatable: true, description: '0=full SR → 0.5=~22kHz (Mirage/SP-12) → 1=11025 Hz' },
    mix:       { id: 'mix',       label: 'Wet',       type: 'number', min: 0, max: 1, step: 0.01, default: 1     },
    amplitude: { id: 'amplitude', label: 'Amplitude', type: 'number', min: 0, max: 1, step: 0.01, default: 0.7, modulatable: true },
    testPitch: { id: 'testPitch', label: 'Test Pitch',type: 'number', min: 55, max: 1760, step: 1, default: 220, unit: 'Hz' },
  },
  orcTemplate: GRISP_CHIPS_ORC,
};

// ────────────────────────────────────────────────────────────────────────────
// SAMPLE PLAYER — linear sample playback
// ────────────────────────────────────────────────────────────────────────────

const SAMPLE_PLAYER_ORC = `
instr SamplePlayer_{{id}}
  kAmp   chnget "{{id}}.amplitude"
  kPitch chnget "{{id}}.pitch"
  kLoop  chnget "{{id}}.loop"
  kStart chnget "{{id}}.start"
  Sfile  chnget "{{id}}.sampleFile"

  kAmp   = (kAmp <= 0 ? 0.8 : kAmp)
  kSpeed = pow(2, kPitch / 12)
  kenv   linsegr 0, 0.005, kAmp, p3 - 0.015, kAmp, 0.01, 0

  if strlen(Sfile) == 0 goto skip
    a1, a2  diskin2 Sfile, kSpeed, kStart, (kLoop > 0.5 ? 1 : 0)
    kFollow follow a1, 0.05
    chnset kFollow,       "{{id}}.out.envelope"
    chnset kSpeed * 440,  "{{id}}.out.pitch"
    outs a1 * kenv, a2 * kenv
  skip:
endin`.trim();

export const SAMPLE_PLAYER_DEF: BlockTypeDef = {
  kind: 'samplePlayer',
  label: 'SamplePlayer',
  description: 'Linear sample playback with pitch transposition, loop point and start marker',
  color: '#2563eb',
  inputs: {
    pitch:     { id: 'pitch',     label: 'Pitch',     dataType: 'pitch',   min: -24, max: 24, default: 0   },
    amplitude: { id: 'amplitude', label: 'Amplitude', dataType: 'control', min: 0,   max: 1,  default: 0.8 },
  },
  outputs: {
    envelope: { id: 'envelope', label: 'Envelope', dataType: 'control', min: 0, max: 1 },
    pitch:    { id: 'pitch',    label: 'Pitch Hz',  dataType: 'pitch'                   },
  },
  params: {
    sampleFile: { id: 'sampleFile', label: 'Sample',    type: 'file',    default: ''                                                        },
    pitch:      { id: 'pitch',      label: 'Pitch',      type: 'number',  min: -24, max: 24,  step: 0.5, default: 0,   modulatable: true, unit: 'st' },
    amplitude:  { id: 'amplitude',  label: 'Amplitude',  type: 'number',  min: 0,   max: 1,   step: 0.01, default: 0.8, modulatable: true },
    loop:       { id: 'loop',       label: 'Loop',       type: 'boolean',                                 default: false                             },
    start:      { id: 'start',      label: 'Start',      type: 'number',  min: 0,   max: 1,   step: 0.01, default: 0                                 },
  },
  orcTemplate: SAMPLE_PLAYER_ORC,
};

// ────────────────────────────────────────────────────────────────────────────
// EQ3 — 3-band equalizer
// ────────────────────────────────────────────────────────────────────────────

const EQ3_ORC = `
instr EQ3_{{id}}
  kLowGain  chnget "{{id}}.lowGain"
  kMidGain  chnget "{{id}}.midGain"
  kHighGain chnget "{{id}}.highGain"
  kLowHz    chnget "{{id}}.lowHz"
  kHighHz   chnget "{{id}}.highHz"
  kAmp      chnget "{{id}}.amplitude"

  kLowGain  = (kLowGain  == 0 ? 0.001 : kLowGain)
  kMidGain  = (kMidGain  == 0 ? 0.001 : kMidGain)
  kHighGain = (kHighGain == 0 ? 0.001 : kHighGain)
  kLowHz    = (kLowHz  <= 0 ? 250  : kLowHz)
  kHighHz   = (kHighHz <= 0 ? 4000 : kHighHz)

  ain   in
  aLow  tone  ain, kLowHz
  aHigh atone ain, kHighHz
  aMid  = ain - aLow - aHigh
  aout  = aLow * kLowGain + aMid * kMidGain + aHigh * kHighGain
  aout  = aout * (kAmp <= 0 ? 1 : kAmp)

  kFollow follow aout, 0.05
  chnset kFollow, "{{id}}.out.envelope"
  outs aout, aout
endin`.trim();

export const EQ3_DEF: BlockTypeDef = {
  kind: 'eq3',
  label: 'EQ3',
  description: '3-band equalizer — low shelf, parametric mid, high shelf',
  color: '#475569',
  inputs: {
    lowGain:  { id: 'lowGain',  label: 'Low Gain',  dataType: 'control', min: 0, max: 4, default: 1 },
    midGain:  { id: 'midGain',  label: 'Mid Gain',  dataType: 'control', min: 0, max: 4, default: 1 },
    highGain: { id: 'highGain', label: 'High Gain', dataType: 'control', min: 0, max: 4, default: 1 },
  },
  outputs: {
    envelope: { id: 'envelope', label: 'Envelope', dataType: 'control', min: 0, max: 1 },
  },
  params: {
    lowGain:  { id: 'lowGain',  label: 'Low Gain',  type: 'number', min: 0, max: 4,     step: 0.01, default: 1,    modulatable: true },
    midGain:  { id: 'midGain',  label: 'Mid Gain',  type: 'number', min: 0, max: 4,     step: 0.01, default: 1,    modulatable: true },
    highGain: { id: 'highGain', label: 'High Gain', type: 'number', min: 0, max: 4,     step: 0.01, default: 1,    modulatable: true },
    lowHz:    { id: 'lowHz',    label: 'Low Hz',    type: 'number', min: 20,  max: 2000, step: 10,   default: 250,  unit: 'Hz'        },
    highHz:   { id: 'highHz',   label: 'High Hz',   type: 'number', min: 500, max: 20000,step: 100,  default: 4000, unit: 'Hz'        },
    amplitude:{ id: 'amplitude',label: 'Output',    type: 'number', min: 0,  max: 2,    step: 0.01, default: 1,    modulatable: true },
  },
  orcTemplate: EQ3_ORC,
};

// ────────────────────────────────────────────────────────────────────────────
// DELAY — feedback delay
// ────────────────────────────────────────────────────────────────────────────

const DELAY_ORC = `
instr Delay_{{id}}
  kTime     chnget "{{id}}.time"
  kFeedback chnget "{{id}}.feedback"
  kMix      chnget "{{id}}.mix"
  kAmp      chnget "{{id}}.amplitude"

  kTime     = (kTime     <= 0    ? 0.25 : kTime)
  kFeedback = (kFeedback > 0.95  ? 0.95 : (kFeedback < 0 ? 0 : kFeedback))

  ain  in
  aFbk init 0
  adel vdelay3 ain + aFbk, kTime * 1000, 2000
  aFbk = adel * kFeedback
  aout = ain * (1 - kMix) + adel * kMix
  aout = aout * (kAmp <= 0 ? 1 : kAmp)

  kFollow follow aout, 0.05
  chnset kFollow,   "{{id}}.out.envelope"
  chnset kTime,     "{{id}}.out.time"
  chnset kFeedback, "{{id}}.out.feedback"
  outs aout, aout
endin`.trim();

export const DELAY_DEF: BlockTypeDef = {
  kind: 'delay',
  label: 'Delay',
  description: 'Feedback delay — time and feedback can be driven from GrainadeBlock envelope',
  color: '#1d4ed8',
  inputs: {
    time:     { id: 'time',     label: 'Time',     dataType: 'control', min: 0.01, max: 2,    unit: 's',  default: 0.25 },
    feedback: { id: 'feedback', label: 'Feedback', dataType: 'control', min: 0,    max: 0.95,              default: 0.4  },
  },
  outputs: {
    envelope: { id: 'envelope', label: 'Envelope', dataType: 'control', min: 0, max: 1    },
    time:     { id: 'time',     label: 'Time',     dataType: 'control', min: 0, max: 2    },
    feedback: { id: 'feedback', label: 'Feedback', dataType: 'control', min: 0, max: 0.95 },
  },
  params: {
    time:      { id: 'time',      label: 'Time',     type: 'number', min: 0.01, max: 2,    step: 0.01, default: 0.25, modulatable: true, unit: 's'  },
    feedback:  { id: 'feedback',  label: 'Feedback', type: 'number', min: 0,    max: 0.95, step: 0.01, default: 0.4,  modulatable: true             },
    mix:       { id: 'mix',       label: 'Wet',      type: 'number', min: 0,    max: 1,    step: 0.01, default: 0.5                                  },
    amplitude: { id: 'amplitude', label: 'Output',   type: 'number', min: 0,    max: 2,    step: 0.01, default: 1,    modulatable: true             },
  },
  orcTemplate: DELAY_ORC,
};

// ────────────────────────────────────────────────────────────────────────────
// BEAT DETECTOR — amplitude / onset follower
// ────────────────────────────────────────────────────────────────────────────

const BEAT_DETECTOR_ORC = `
instr BeatDetector_{{id}}
  kThresh chnget "{{id}}.threshold"
  kSmooth chnget "{{id}}.smooth"

  kThresh = (kThresh <= 0 ? 0.15 : kThresh)
  kSmooth = (kSmooth <= 0 ? 50   : kSmooth / 1000)

  ain    in
  kRms   rms ain
  kLevel portk kRms, kSmooth
  kBeat  = (kLevel > kThresh ? 1.0 : 0.0)

  chnset kLevel, "{{id}}.out.amplitude"
  chnset kBeat,  "{{id}}.out.beat"
endin`.trim();

export const BEAT_DETECTOR_DEF: BlockTypeDef = {
  kind: 'beatDetector',
  label: 'BeatDetector',
  description: 'Track audio amplitude and output a gate trigger on beats — feeds control signals into the patch matrix',
  color: '#b45309',
  inputs: {},
  outputs: {
    amplitude: { id: 'amplitude', label: 'Amplitude', dataType: 'control', min: 0, max: 1 },
    beat:      { id: 'beat',      label: 'Beat',       dataType: 'trigger'                 },
  },
  params: {
    threshold: { id: 'threshold', label: 'Threshold', type: 'number', min: 0, max: 1,   step: 0.01, default: 0.15 },
    smooth:    { id: 'smooth',    label: 'Smooth',    type: 'number', min: 0, max: 500, step: 5,    default: 50, unit: 'ms' },
  },
  orcTemplate: BEAT_DETECTOR_ORC,
};

// ────────────────────────────────────────────────────────────────────────────
// XY PAD — performance controller, JS-only (no Csound instrument)
// ────────────────────────────────────────────────────────────────────────────

export const XY_PAD_DEF: BlockTypeDef = {
  kind: 'xyPad',
  label: 'XY Pad',
  description: 'VCS3-style joystick — maps X/Y drag to two independent control signals, patch anywhere',
  color: '#9333ea',
  inputs: {},
  outputs: {
    x: { id: 'x', label: 'X', dataType: 'control', min: 0, max: 1, description: 'Horizontal axis 0..1' },
    y: { id: 'y', label: 'Y', dataType: 'control', min: 0, max: 1, description: 'Vertical axis 0..1'   },
  },
  params: {
    x:      { id: 'x',      label: 'X',       type: 'number', min: 0, max: 1, step: 0.001, default: 0.5 },
    y:      { id: 'y',      label: 'Y',       type: 'number', min: 0, max: 1, step: 0.001, default: 0.5 },
    labelX: { id: 'labelX', label: 'Label X', type: 'string',                               default: 'X' },
    labelY: { id: 'labelY', label: 'Label Y', type: 'string',                               default: 'Y' },
  },
  orcTemplate: '', // JS-only — outputs set directly by UI via PatchEngine.setXYOutput()
};

// ────────────────────────────────────────────────────────────────────────────
// REGISTRY
// ────────────────────────────────────────────────────────────────────────────

export const BLOCK_REGISTRY: Record<BlockKind, BlockTypeDef> = {
  grainade:       GRAINADE_DEF,
  signalFollower: SIGNAL_FOLLOWER_DEF,
  dataTransform:  DATA_TRANSFORM_DEF,
  scaleQuantizer: SCALE_QUANTIZER_DEF,
  samplePlayer:   SAMPLE_PLAYER_DEF,
  grispChips:     GRISP_CHIPS_DEF,
  eq3:            EQ3_DEF,
  delay:          DELAY_DEF,
  beatDetector:   BEAT_DETECTOR_DEF,
  xyPad:          XY_PAD_DEF,
};

/** All block kinds as an ordered array for "Add Block" menus */
export const BLOCK_KINDS: BlockKind[] = [
  'grainade', 'samplePlayer', 'grispChips',
  'signalFollower', 'dataTransform', 'scaleQuantizer',
  'eq3', 'delay', 'beatDetector', 'xyPad',
];
