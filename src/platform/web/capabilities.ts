// Device capability probe. Results are measured, not assumed.

import { canEncodeAudio, canEncodeVideo } from 'mediabunny';

export interface CapabilityReport {
  userAgent: string;
  secureContext: boolean;
  webgl2: boolean;
  videoEncoder: boolean;
  audioEncoder: boolean;
  videoDecoder: boolean;
  offscreenCanvas: boolean;
  h264: Record<string, boolean>;
  aac48k: boolean;
  aac44k: boolean;
  opus48k: boolean;
  shareFiles: boolean;
  deviceMemoryGb: number | null;
}

export const EXPORT_SIZES: [number, number][] = [[640, 360], [1280, 720], [1920, 1080]];

export async function probeCapabilities(): Promise<CapabilityReport> {
  const hasVE = typeof VideoEncoder !== 'undefined';
  const hasAE = typeof AudioEncoder !== 'undefined';
  const h264: Record<string, boolean> = {};
  for (const [w, h] of EXPORT_SIZES) {
    h264[`${w}x${h}`] = hasVE ? await safe(canEncodeVideo('avc', { width: w, height: h, frameRate: 30 })) : false;
  }
  const testFile = new File([new Uint8Array(1)], 't.mp4', { type: 'video/mp4' });
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: navigator.userAgent,
    secureContext: window.isSecureContext,
    webgl2: !!document.createElement('canvas').getContext('webgl2'),
    videoEncoder: hasVE,
    audioEncoder: hasAE,
    videoDecoder: typeof VideoDecoder !== 'undefined',
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    h264,
    aac48k: hasAE ? await safe(canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000 })) : false,
    aac44k: hasAE ? await safe(canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 44100 })) : false,
    opus48k: hasAE ? await safe(canEncodeAudio('opus', { numberOfChannels: 2, sampleRate: 48000 })) : false,
    shareFiles: typeof navigator.canShare === 'function' && navigator.canShare({ files: [testFile] }),
    deviceMemoryGb: nav.deviceMemory ?? null,
  };
}

async function safe(p: Promise<boolean>): Promise<boolean> {
  try {
    return await p;
  } catch {
    return false;
  }
}
