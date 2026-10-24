// Measures the audio encoder's priming delay on this device.
//
// Some encoders (e.g. Android's MediaCodec AAC encoder, as used by Chrome on the
// Galaxy S21) prepend priming samples but timestamp their output as if they did
// not, which plays the music late by the priming length (2048 samples = 42.7 ms
// at 48 kHz on the S21). Instead of hard-coding a per-device number, we encode a
// short click, decode it back and measure where it lands. The exporter then
// starts the audio track at a negative timestamp, which the MP4 muxer writes as
// an edit list so players trim the priming.

import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  type AudioCodec,
} from 'mediabunny';

const ONSET_SEC = 0.25;
const MAX_PLAUSIBLE_DELAY_SEC = 0.2;

/** Returns the measured delay in seconds (positive = encoded audio comes out late). */
export async function measureAudioEncoderDelay(codec: AudioCodec, sampleRate: number, channels: number): Promise<number> {
  const length = Math.round(sampleRate * 1);
  const probe = new AudioBuffer({ numberOfChannels: channels, length, sampleRate });
  const onset = Math.round(ONSET_SEC * sampleRate);
  const burst = new Float32Array(Math.round(sampleRate * 0.02));
  for (let i = 0; i < burst.length; i++) burst[i] = 0.5 * Math.sin((2 * Math.PI * 3000 * i) / sampleRate);
  for (let c = 0; c < channels; c++) probe.copyToChannel(burst, c, onset);

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const source = new AudioBufferSource({ codec, quality: new Quality('high') });
  output.addAudioTrack(source);
  await output.start();
  await source.add(probe);
  await output.finalize();
  const bytes = output.target.buffer;
  if (!bytes) throw new Error('Calibration produced no data.');

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(new Blob([bytes], { type: 'audio/mp4' })) });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('Calibration file has no audio track.');
    for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers()) {
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i]!) > 0.25) {
          const delay = timestamp + i / buffer.sampleRate - onset / sampleRate;
          if (Math.abs(delay) > MAX_PLAUSIBLE_DELAY_SEC) throw new Error(`Implausible encoder delay ${(delay * 1000).toFixed(1)} ms.`);
          // Round to whole samples; ignore sub-millisecond noise.
          const samples = Math.round(delay * sampleRate);
          return Math.abs(samples) < sampleRate / 1000 ? 0 : samples / sampleRate;
        }
      }
    }
    throw new Error('Calibration click not found in the encoded audio.');
  } finally {
    input.dispose();
  }
}
