// RBJ "Audio EQ Cookbook" biquads. Pure TypeScript so results are identical on
// every platform (unlike Web Audio's BiquadFilterNode) and easy to port to Kotlin.

export interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export function lowpass(cutoffHz: number, sampleRate: number, q = Math.SQRT1_2): BiquadCoeffs {
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cos) / 2 / a0,
    b1: (1 - cos) / a0,
    b2: (1 - cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

export function highpass(cutoffHz: number, sampleRate: number, q = Math.SQRT1_2): BiquadCoeffs {
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cos) / 2 / a0,
    b1: -(1 + cos) / a0,
    b2: (1 + cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** Filters `x` in place (transposed direct form II, double-precision state). */
export function applyBiquadInPlace(x: Float32Array, c: BiquadCoeffs): void {
  const { b0, b1, b2, a1, a2 } = c;
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const input = x[i]!;
    const y = b0 * input + z1;
    z1 = b1 * input - a1 * y + z2;
    z2 = b2 * input - a2 * y;
    x[i] = y;
  }
}
