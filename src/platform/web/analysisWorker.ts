import { analyzeMono, mixToMono } from '../../core/analysis/analyze.ts';
import type { BandDefinition } from '../../core/project/model.ts';

interface Request {
  channels: Float32Array[];
  sampleRate: number;
  bands: BandDefinition[];
  frameRate: number;
  sourceFingerprint: string;
}

// Typed locally to avoid pulling the WebWorker lib (which conflicts with DOM) into the project.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

scope.onmessage = (e) => {
  try {
    const { channels, sampleRate, bands, frameRate, sourceFingerprint } = e.data;
    const result = analyzeMono(mixToMono(channels), sampleRate, bands, frameRate, sourceFingerprint);
    scope.postMessage({ ok: true, result }, result.bands.map((b) => b.rms.buffer as ArrayBuffer));
  } catch (err) {
    scope.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) }, []);
  }
};
