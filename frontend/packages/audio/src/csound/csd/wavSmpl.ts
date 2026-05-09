/**
 * wavSmpl.ts — Append an SMPL chunk with loop markers to a WAV Uint8Array.
 *
 * The SMPL chunk is the standard way to embed loop start/end points
 * in WAV files (used by samplers, DAWs like Logic, Ableton, etc.).
 *
 * References: Microsoft RIFF spec §7, SMPL chunk; iXML / BEXT ignored here.
 */

/**
 * Write a 32-bit little-endian uint into a DataView at offset.
 */
function writeU32LE(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

/**
 * Append an SMPL chunk (one sustain loop: startSample..endSample) to
 * an existing WAV file in a Uint8Array.
 *
 * @param wav         Raw WAV bytes (RIFF/WAVE format).
 * @param loopStartS  Loop start in seconds.
 * @param loopEndS    Loop end in seconds.
 * @param sr          Sample rate of the file (e.g. 48000).
 * @returns           New Uint8Array with the SMPL chunk appended and RIFF
 *                    size field updated.
 */
export function appendSmplChunk(
  wav:        Uint8Array,
  loopStartS: number,
  loopEndS:   number,
  sr:         number,
): Uint8Array {
  const loopStartSample = Math.round(loopStartS * sr);
  const loopEndSample   = Math.max(Math.round(loopEndS * sr) - 1, loopStartSample);

  // SMPL chunk layout:
  //   4  'smpl'
  //   4  chunkSize = 60  (header=36 + 1 loop×24 = 60)
  //   4  manufacturer     = 0
  //   4  product          = 0
  //   4  samplePeriod     = 1e9/sr  (nanoseconds)
  //   4  MIDIUnityNote    = 60 (middle C)
  //   4  MIDIPitchFraction= 0
  //   4  SMPTEFormat      = 0
  //   4  SMPTEOffset      = 0
  //   4  numSampleLoops   = 1
  //   4  samplerData      = 0
  // loop (24 bytes):
  //   4  cuePointID       = 0
  //   4  type             = 0 (forward)
  //   4  start            = loopStartSample
  //   4  end              = loopEndSample
  //   4  fraction         = 0
  //   4  playCount        = 0 (infinite)

  const SMPL_CHUNK_DATA_SIZE = 36 + 24;               // header(36) + 1 loop(24) = 60
  const SMPL_TOTAL           = 8 + SMPL_CHUNK_DATA_SIZE; // id(4) + size(4) + data(60) = 68

  const out  = new Uint8Array(wav.length + SMPL_TOTAL);
  out.set(wav);

  const view = new DataView(out.buffer);
  let   off  = wav.length;

  // 'smpl' chunk id
  out[off++] = 0x73; out[off++] = 0x6d; out[off++] = 0x70; out[off++] = 0x6c;
  // chunk data size (60)
  writeU32LE(view, off, SMPL_CHUNK_DATA_SIZE); off += 4;
  // manufacturer
  writeU32LE(view, off, 0); off += 4;
  // product
  writeU32LE(view, off, 0); off += 4;
  // samplePeriod (nanoseconds)
  writeU32LE(view, off, Math.round(1e9 / sr)); off += 4;
  // MIDIUnityNote (middle C)
  writeU32LE(view, off, 60); off += 4;
  // MIDIPitchFraction
  writeU32LE(view, off, 0); off += 4;
  // SMPTEFormat
  writeU32LE(view, off, 0); off += 4;
  // SMPTEOffset
  writeU32LE(view, off, 0); off += 4;
  // numSampleLoops
  writeU32LE(view, off, 1); off += 4;
  // samplerData
  writeU32LE(view, off, 0); off += 4;
  // ── loop entry ──────────────────────────────────────────────────────────────
  writeU32LE(view, off, 0); off += 4;               // cuePointID
  writeU32LE(view, off, 0); off += 4;               // type = forward
  writeU32LE(view, off, loopStartSample); off += 4; // start
  writeU32LE(view, off, loopEndSample);   off += 4; // end
  writeU32LE(view, off, 0); off += 4;               // fraction
  writeU32LE(view, off, 0); off += 4;               // playCount = infinite

  // Update RIFF chunk size at byte offset 4 (= total file size - 8)
  writeU32LE(view, 4, out.length - 8);

  return out;
}
