// Compact, versioned binary container for AnalysisResult.
//
// Layout (little-endian):
//   bytes 0..3   magic "CLZA"
//   u32          container version
//   u32          JSON header byte length (N)
//   N bytes      UTF-8 JSON header (everything except the RMS arrays, plus their lengths)
//   pad to 4-byte alignment
//   float32[]    RMS arrays for each band, in header order

import { ANALYSIS_FORMAT_VERSION, type AnalysisResult } from './analyze.ts';

const MAGIC = 0x415a4c43; // "CLZA" read as little-endian u32

interface Header {
  version: number;
  frameRate: number;
  sampleRate: number;
  durationSec: number;
  sourceFingerprint: string;
  bands: { band: AnalysisResult['bands'][number]['band']; length: number }[];
}

export function encodeAnalysis(a: AnalysisResult): ArrayBuffer {
  const header: Header = {
    version: a.version,
    frameRate: a.frameRate,
    sampleRate: a.sampleRate,
    durationSec: a.durationSec,
    sourceFingerprint: a.sourceFingerprint,
    bands: a.bands.map((b) => ({ band: b.band, length: b.rms.length })),
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const dataOffset = align4(12 + json.length);
  const total = dataOffset + a.bands.reduce((s, b) => s + b.rms.length * 4, 0);
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, ANALYSIS_FORMAT_VERSION, true);
  view.setUint32(8, json.length, true);
  new Uint8Array(buf, 12, json.length).set(json);
  let off = dataOffset;
  for (const b of a.bands) {
    for (let i = 0; i < b.rms.length; i++, off += 4) view.setFloat32(off, b.rms[i]!, true);
  }
  return buf;
}

export function decodeAnalysis(buf: ArrayBuffer): AnalysisResult {
  const view = new DataView(buf);
  if (buf.byteLength < 12 || view.getUint32(0, true) !== MAGIC) throw new Error('Not a Colluzion analysis file');
  const version = view.getUint32(4, true);
  if (version > ANALYSIS_FORMAT_VERSION) throw new Error(`Analysis format v${version} is newer than supported`);
  const jsonLen = view.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, jsonLen))) as Header;
  let off = align4(12 + jsonLen);
  const bands = header.bands.map(({ band, length }) => {
    const rms = new Float32Array(length);
    for (let i = 0; i < length; i++, off += 4) rms[i] = view.getFloat32(off, true);
    return { band, rms };
  });
  return {
    version: header.version,
    frameRate: header.frameRate,
    sampleRate: header.sampleRate,
    durationSec: header.durationSec,
    sourceFingerprint: header.sourceFingerprint,
    bands,
  };
}

function align4(n: number): number {
  return (n + 3) & ~3;
}
