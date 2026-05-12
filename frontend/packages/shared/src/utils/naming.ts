function r<T>(arr: readonly T[]): T {
  const value = arr[Math.floor(Math.random() * arr.length)];
  if (value === undefined) {
    throw new Error("generateName word list cannot be empty");
  }
  return value;
}

/**
 * Returns a random evocative name suitable as a default filename.
 * Drop-in replacement for "Untitled" or "Document 1".
 */
export function generateName(): string {
  const n = Math.floor(Math.random() * 6);
  if (n === 0) return `${r(A)} ${r(N)}`;
  if (n === 1) return `${r(A)} ${r(V)} ${r(N)}`;
  if (n === 2) return `${r(A)}-${r(N)}`;
  if (n === 3) return `${r(N)}.${r(N)}`;
  if (n === 4) return `${r(A)}_${r(N)}`;
  return `${r(A)} ${r(N)} ${Math.floor(Math.random() * 999)}`;
}

export const A = [
  // cinematic / moody
  "abyssal",
  "affine",
  "afterglow",
  "algorithmic",
  "alien",
  "amber",
  "analog",
  "ancient",
  "arcadian",
  "astral",
  "atmospheric",
  "aurora",
  "axiomatic",

  // dreamy / epic
  "balearic",
  "binary",
  "bitcrushed",
  "blackhole",
  "blissful",
  "blooming",
  "bluevoid",
  "braindance",
  "burning",

  // synth / buchla / modular
  "buchla",
  "buffered",
  "cascading",
  "chaotic",
  "chromatic",
  "circuit",
  "clocked",
  "clouded",
  "clustered",
  "coherent",
  "cosmic",
  "crystalline",
  "cybernetic",

  // nerdy / mathy
  "dataflow",
  "dephased",
  "diffused",
  "digital",
  "dimensional",
  "discrete",
  "dissonant",
  "doppler",
  "drifted",
  "duality",
  "logical",


  // retro-computer
  "eigen",
  "elastic",
  "electric",
  "electrostatic",
  "emulated",
  "encrypted",
  "entropic",
  "ephemeral",
  "euclidean",

  // dreamy
  "faded",
  "feral",
  "fibonacci",
  "filtered",
  "floating",
  "fluorescent",
  "fm",
  "fractal",
  "frozen",

  // spacy
  "galactic",
  "glacial",
  "glimmering",
  "granular",
  "gravitybound",

  // modular / techno
  "harmonic",
  "haunted",
  "helical",
  "holographic",
  "hyper",
  "hyperspatial",

  // weird
  "imaginary",
  "immersive",
  "infinite",
  "infrared",
  "intrinsic",
  "ionized",
  "irrational",

  // rhythmic
  "jittered",
  "kinetic",
  "laser",
  "latent",
  "liminal",
  "liquid",
  "lunar",

  // drone
  "magnetic",
  "mechanized",
  "melodic",
  "meta",
  "microtonal",
  "midnight",
  "modular",
  "monolithic",
  "mutated",

  // retro futuristic
  "nebulous",
  "neon",
  "neural",
  "nocturnal",
  "nonlinear",
  "nova",
  "numeric",

  // cinematic
  "obsidian",
  "orbital",
  "oscillating",

  // buchla / west coast
  "parabolic",
  "phasebound",
  "phasemodulated",
  "plasma",
  "polyphonic",
  "prismatic",
  "procedural",
  "psychoacoustic",

  // nerd
  "quantized",
  "quantum",
  "radiant",
  "recursive",
  "resonant",
  "retrofuture",
  "rhizomatic",

  // epic
  "saturated",
  "scattered",
  "sequential",
  "shuffled",
  "signalborne",
  "singular",
  "solar",
  "sonic",
  "spectral",
  "static",
  "stochastic",
  "subliminal",
  "superdooper",
  "surreal",
  "suspended",
  "symmetric",
  "synthetic",

  // tape / analog
  "tape",
  "temporal",
  "terminal",
  "textural",
  "transient",
  "turbulent",

  // deep electronic
  "ultraviolet",
  "undulating",
  "unstable",

  // ambient
  "vapor",
  "vectorized",
  "velvet",
  "virtual",
  "visceral",
  "void",
  "voltage",
  "wavefolded",

  // epic endings
  "xeno",
  "zeroed",
  "zonal",
];

export const V = [
  // motion
  "accelerating",
  "ascending",
  "bleeding",
  "blooming",
  "breathing",
  "buffering",
  "burning",
  "cascading",
  "circulating",
  "collapsing",
  "compressing",
  "crackling",
  "cycling",
  "scheduling",
  "reactive",

  // modular
  "dephasing",
  "detuning",
  "diffusing",
  "disintegrating",
  "distorting",
  "drifting",
  "droning",

  // synth
  "echoing",
  "emerging",
  "eroding",
  "expanding",
  "filtering",
  "flanging",
  "floating",
  "folding",

  // FM / granular
  "fracturing",
  "gliding",
  "granulizing",
  "saturated",
  "limited",
  "operator",
  "algorithm",

  // rhythmic
  "interleaving",
  "jittering",
  "looping",
  "melting",
  "modulating",
  "morphing",

  // spacey
  "oscillating",
  "panning",
  "phasewalking",
  "pulsating",
  "quantizing",
  "scattered",
  "triangulated",
  "oktating",
  "mirrored",
  "inversed",
  "reversed",
  "rebooting",
  "boot",


  // techno
  "resonating",
  "emphasizing",
  "retriggering",
  "reverberating",
  "rotating",


  // groove
  "sequencing",
  "substep",
  "shifting",
  "shimmering",
  "sidechaining",
  "sliding",
  "stretching",
  "submerging",
  "swinging",
  "syncopating",
  "humanizing",

  // ambient
  "texturizing",
  "timewarping",
  "undulating",
  "unfolding",
  "vibrating",
  "warping",
  "wavefolding",
  "finetuned",
  "kilohertz",
  "kilohertz",

];

export const N = [
  // cinematic
  "abyss",
  "affinity",
  "afterimage",
  "arc",
  "aurora",
  "superset",
  "collection",
  "gain",
  "tune",
  "deserts",
  "sands",


  // synth
  "bassline",
  "bitstream",
  "bloom",
  "buffer",
  "bus",
  "bytewave",

  // modular
  "cascade",
  "cathedral",
  "circuit",
  "cloud",
  "continuum",
  "current",

  // dreamy
  "glitch",
  "daydream",
  "delay",
  "descent",
  "diffusion",
  "dimension",
  "drift",
  "drone",

  // nerdy
  "eigenvector",
  "emphasis",
  "entropy",
  "equation",

  // FM / electronic
  "feedback",
  "field",
  "filter",
  "flux",
  "fold",
  "formant",
  "frequency",
  "function",

  // ambient
  "glide",
  "glimmer",
  "gravity",
  "groove",

  // retro
  "halation",
  "harmonic",
  "horizon",
  "joystick",
  "keyboard",
  "palm",
  "beeper",
  "keycode",
  "instinct",
  "intuition",
  "command",
  "typewriter",
  "typo",
  "zero",
  "random",
  "lights",
  "dark",
  "park",
  "ghost",
  "myth",
  "under",
  "under",
  "over",
  "state",
  "machine",

  // rhythmic
  "impulse",
  "infinity",
  "interface",
  "jitter",
  "jungle",
  "trigger",
  "event",
  "offbeat",
  "onbeat",
  "on1",
  "quantum",
  "sequence",
  "nonlinear",
  "subcarrier",


  // sci fi
  "kernel",
  "lag",
  "lattice",
  "loop",
  "machine",
  "matrix",

  // modular
  "memory",
  "mesh",
  "modulation",
  "monolith",

  // cosmic
  "nebula",
  "network",
  "noise",
  "nova",

  // west coast
  "operator",
  "orbit",
  "oscillator",
  "overdrive",

  // moody
  "parallax",
  "phantom",
  "phase",
  "pipeline",
  "plateau",
  "pulse",
  "plankton",
  "photosynthesis",

  // math
  "quantum",
  "recursion",
  "resonance",
  "rhythm",

  // techno
  "sequence",
  "shadow",
  "signal",
  "singularity",
  "space",
  "spectrum",
  "static",
  "storm",
  "subcarrier",
  "synapse",
  "syncope",
  "synthesis",

  // dreamy
  "texture",
  "threshold",
  "timbre",
  "transmission",

  // cinematic
  "vacuum",
  "vector",
  "velocity",
  "vertex",
  "vision",
  "void",
  "voltage",
  "wave",
  "waveguide",

  // epic
  "xenon",
  "zenith",
  "zone",
  "zombie",
  "daemon",
  "alchemy",
];



// =========================
// OPTICAL / PSYCHOACOUSTIC / PERCEPTION
// =========================

export const psychoA = [
  "shepard",
  "shepardtoned",
  "karplusstrong",
  "psychoacoustic",
  "binaural",
  "monophonic",
  "stereophonic",
  "acousmatic",
  "pareidolic",
  "hallucinatory",
  "phantom",
  "doppler",
  "beating",
  "combfiltered",
  "phasecancelled",
  "masking",
  "subharmonic",
  "inharmonic",
  "difference",
  "sumtone",
  "heterodyned",
  "recursive",
  "perceptual",
  "spectromorphic",
  "granulated",
  "diffractional",
  "moire",
  "lenticular",
  "anamorphic",
  "impossible",
  "penrosian",
  "escherian",
  "refracted",
  "diffracted",
  "stroboscopic",
  "flickering",
  "afterimaged",
  "retinal",
  "prismatic",
  "holographic",
  "chromatic",
  "colorfield",
  "waveguided",
  "interferometric",
  "synesthetic",
  "gestalt",
  "liminal",
  "thresholded",
  "transient",
  "illusory",
];

export const psychoN = [
  "shepardtone",
  "combfilter",
  "afterimage",
  "moire",
  "phantomtone",
  "binauralbeat",
  "standingwave",
  "beating",
  "residue",
  "difference",
  "undertone",
  "overtone",
  "mask",
  "threshold",
  "interference",
  "reflection",
  "refraction",
  "diffraction",
  "dispersion",
  "hallucination",
  "mirage",
  "persistence",
  "spectrogram",
  "wavefront",
  "wavefield",
  "fieldrecording",
  "reverbtail",
  "echofield",
  "soundmass",
  "gesture",
  "texture",
  "graincloud",
  "timesmear",
  "blur",
  "smear",
  "flicker",
  "glare",
  "ghostimage",
  "illusion",
  "resonator",
  "waveguide",
  "feedbacknetwork",
  "harmonicfield",
];

// =========================
// ALLEN STRANGE / BUCHLA / EARLY ELECTRONIC
// =========================

export const strangeA = [
  "westcoast",
  "buchla",
  "serge",
  "subotnick",
  "tape",
  "voltagecontrolled",
  "ringmodulated",
  "wavefolded",
  "lowpassgated",
  "quadraphonic",
  "aleatoric",
  "indeterminate",
  "patchprogrammable",
  "modular",
  "electroacoustic",
  "musiqueconcrete",
  "cyclic",
  "dronebased",
  "feedbackpatched",
  "selfoscillating",
  "crossmodulated",
  "slewed",
  "clockdivided",
  "probabilistic",
  "generative",
  "stochastic",
  "microtonal",
  "justintoned",
  "controlvoltage",
  "sourcepatched",
  "matrixmixed",
  "variabledensity",
  "intermodulated",
  "chaosdriven",
];

export const strangeN = [
  "source",
  "patch",
  "matrixmixer",
  "waveshaper",
  "wavefolder",
  "lowpassgate",
  "sequencer",
  "functiongenerator",
  "slope",
  "attenuator",
  "multiplier",
  "comparator",
  "clockdivider",
  "shiftregister",
  "randomvoltage",
  "controlvoltage",
  "feedbackloop",
  "ringmodulator",
  "springreverb",
  "tapeloop",
  "phonogene",
  "soundonSound",
  "oscillatorbank",
  "dronebank",
  "resonantfilter",
  "envelope",
  "slewlimiter",
  "crossfade",
  "modmatrix",
  "waveset",
  "pulsetrain",
  "grainstream",
  "eventstream",
  "chaosgenerator",
  "timbrenetwork",
];

// =========================
// SUPERCOLLIDER / DSP / LIVE CODING
// =========================

export const supercolliderA = [
  "ugen",
  "nodebased",
  "serverlocal",
  "sampleaccurate",
  "multichannel",
  "demandrate",
  "controlrate",
  "audiorate",
  "patternbased",
  "proxyspace",
  "jitlib",
  "nrt",
  "realtime",
  "buffered",
  "granulated",
  "wavetabled",
  "phasorbased",
  "chaotic",
  "feedbackoriented",
  "eventdriven",
  "streambased",
  "prototype",
  "metaprogrammed",
  "lazy",
  "functional",
  "patternmatched",
  "recursive",
  "multiband",
  "spectral",
  "fftbased",
  "pvprocessed",
  "nodeproxied",
  "busrouted",
  "dirtified",
  "tidalized",
];

export const supercolliderN = [
  "ugen",
  "synthdef",
  "nodeproxy",
  "proxyspace",
  "pattern",
  "pbind",
  "pmono",
  "eventstream",
  "bus",
  "buffer",
  "phasor",
  "impulse",
  "dust",
  "lfnoise",
  "syncsaw",
  "blip",
  "grainbuf",
  "warp1",
  "localin",
  "localout",
  "feedback",
  "fft",
  "ifft",
  "pvchain",
  "specfreeze",
  "server",
  "routine",
  "task",
  "tempoclock",
  "supernova",
  "nrt",
  "node",
  "group",
  "envelope",
  "doneaction",
  "prototype",
  "quark",
  "event",
  "stream",
  "dictionary",
  "identityset",
  "environment",
  "patternproxy",
];

// =========================
// EXTRA SCIENTIFIC / ABSTRACT
// =========================

export const abstractA = [
  "topological",
  "manifold",
  "noncommutative",
  "recursive",
  "entangled",
  "adjacent",
  "spectromorphic",
  "autopoietic",
  "rhizomatic",
  "cybernetic",
  "transductive",
  "metastable",
  "affective",
  "postdigital",
  "metabolic",
  "hyperreal",
  "quasiperiodic",
  "emergent",
  "liminoid",
  "transversal",
];

export const abstractN = [
  "assemblage",
  "continuum",
  "phasefield",
  "vectorfield",
  "topology",
  "manifold",
  "adjacency",
  "recursion",
  "entanglement",
  "transduction",
  "metabolism",
  "hyperobject",
  "artifact",
  "residue",
  "apparatus",
  "network",
  "becoming",
  "threshold",
  "gradient",
  "perception",
];
