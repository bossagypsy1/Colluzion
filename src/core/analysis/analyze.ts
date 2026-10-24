// Offline band analysis: audio samples -> per-band RMS frames at a fixed rate.
// This is the expensive step and runs once per track; see envelope.ts for the
// cheap conditioning that turns RMS frames into 0..1 control signals.

import type { BandDefinition } from '../project/model.ts';
import { applyBiquadInPlace, highpass, lowpass, type BiquadCoeffs } from './biquad.ts';

export const ANALYSIS_FORMAT_VERSION = 1;

export interface BandAnalysis {
  band: BandDefinition;
  /** RMS of the band-filtered signal; frame k is centred on time k / frameRate. */
  rms: Float32Array;
}

export interface AnalysisResult {
  version: number;
  frameRate: number;
  sampleRate: number;
  durationSec: number;
  /** Identifies the source audio so stored analysis can be matched to media. */
  sourceFingerprint: string;
  bands: BandAnalysis[];
}

/** Two cascaded 2nd-order Butterworth sections per edge (24 dB/oct). */
export function bandFilterChain(band: BandDefinition, sampleRate: number): BiquadCoeffs[] {
  const chain: BiquadCoeffs[] = [];
  const nyquistGuard = sampleRate * 0.45;
  if (band.lowHz > 0) chain.push(highpass(band.lowHz, sampleRate), highpass(band.lowHz, sampleRate));
  if (band.highHz < nyquistGuard) chain.push(lowpass(band.highHz, sampleRate), lowpass(band.highHz, sampleRate));
  return chain;
}

export function mixToMono(channels: Float32Array[]): Float32Array {
  const first = channels[0];
  if (!first) return new Float32Array(0);
  if (channels.length === 1) return first.slice();
  const out = new Float32Array(first.length);
  const scale = 1 / channels.length;
  for (const ch of channels) {
    for (let i = 0; i < out.length; i++) out[i]! += ch[i]! * scale;
  }
  return out;
}

/** RMS over windows of one hop, centred on k / frameRate. */
export function computeRms(x: Float32Array, sampleRate: number, frameRate: number): Float32Array {
  const hop = sampleRate / frameRate;
  const frames = Math.floor(x.length / hop) + 1;
  const out = new Float32Array(frames);
  for (let k = 0; k < frames; k++) {
    const start = Math.max(0, Math.round(k * hop - hop / 2));
    const end = Math.min(x.length, Math.round(k * hop + hop / 2));
    let sum = 0;
    for (let i = start; i < end; i++) sum += x[i]! * x[i]!;
    out[k] = end > start ? Math.sqrt(sum / (end - start)) : 0;
  }
  return out;
}

export function analyzeMono(
  mono: Float32Array,
  sampleRate: number,
  bands: BandDefinition[],
  frameRate: number,
  sourceFingerprint: string,
): AnalysisResult {
  const results: BandAnalysis[] = [];
  const work = new Float32Array(mono.length);
  for (const band of bands) {
    work.set(mono);
    for (const c of bandFilterChain(band, sampleRate)) applyBiquadInPlace(work, c);
    results.push({ band: { ...band }, rms: computeRms(work, sampleRate, frameRate) });
  }
  return {
    version: ANALYSIS_FORMAT_VERSION,
    frameRate,
    sampleRate,
    durationSec: mono.length / sampleRate,
    sourceFingerprint,
    bands: results,
  };
}
