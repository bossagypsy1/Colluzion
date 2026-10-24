// Project data model. Platform-agnostic: no DOM, WebGL or browser APIs here, so
// the same model can be consumed by a future native (Kotlin) exporter.
//
// Bump PROJECT_FORMAT_VERSION whenever the shape changes and add a migration.

export const PROJECT_FORMAT_VERSION = 1;

/** Identifier of a control signal produced by analysis, e.g. 'bass'. */
export type SignalId = string;

export interface BandDefinition {
  id: SignalId;
  label: string;
  /** High-pass corner in Hz (0 = no high-pass). */
  lowHz: number;
  /** Low-pass corner in Hz (clamped below Nyquist at analysis time). */
  highHz: number;
}

/** Cheap post-analysis shaping; changing these does not require re-filtering the audio. */
export interface ConditioningSettings {
  attackMs: number;
  releaseMs: number;
  /** Multiplier applied after normalization and threshold. */
  gain: number;
  /** 0..1; values below are treated as silence and the rest rescaled to 0..1. */
  threshold: number;
}

export interface MediaRef {
  /** 'file' = user-imported; 'generated' = built-in test media. */
  kind: 'file' | 'generated';
  name: string;
  size?: number;
  lastModified?: number;
  mimeType?: string;
  generator?: 'test-beat' | 'test-pattern';
}

export type ResponseCurve = 'linear' | 'square' | 'sqrt' | 'smoothstep';

export interface RoutingConnection {
  id: string;
  enabled: boolean;
  source: SignalId;
  effectId: string;
  param: string;
  gain: number;
  offset: number;
  invert: boolean;
  /** 0..1, applied to the source signal before the curve. */
  threshold: number;
  curve: ResponseCurve;
  /** 0..1 overall strength; the timeline will automate this in Phase 5. */
  strength: number;
}

export interface EffectInstance {
  id: string;
  /** Key into the effect definition registry. */
  type: string;
  enabled: boolean;
  /** Base (un-modulated) parameter values. */
  params: Record<string, number>;
}

/** Phase 1: one music segment mapped onto one video segment. */
export interface Segment {
  /** Start of the segment in the music track, seconds. */
  musicStart: number;
  /** Start of the segment in the video clip, seconds. */
  videoStart: number;
  /** Segment length in seconds. */
  duration: number;
}

export interface ExportSettings {
  width: number;
  height: number;
  fps: number;
  /** If AAC encoding is unavailable, allow Opus-in-MP4 rather than failing. */
  allowOpusFallback: boolean;
}

export interface Project {
  formatVersion: number;
  id: string;
  name: string;
  createdAt: string;
  modifiedAt: string;
  media: {
    audio: MediaRef | null;
    video: MediaRef | null;
  };
  analysis: {
    frameRate: number;
    bands: BandDefinition[];
    conditioning: Record<SignalId, ConditioningSettings>;
  };
  effects: EffectInstance[];
  routing: RoutingConnection[];
  segment: Segment;
  export: ExportSettings;
  // Timeline sections and automation curves arrive in Phase 5 (with a format migration).
}

export const DEFAULT_BANDS: BandDefinition[] = [
  { id: 'bass', label: 'Bass', lowHz: 20, highHz: 150 },
  { id: 'mid', label: 'Mid', lowHz: 150, highHz: 2000 },
  { id: 'treble', label: 'Treble', lowHz: 2000, highHz: 20000 },
];

export const DEFAULT_CONDITIONING: ConditioningSettings = {
  attackMs: 5,
  releaseMs: 120,
  gain: 1,
  threshold: 0.1,
};

export function createDefaultProject(now: Date = new Date()): Project {
  const conditioning: Record<SignalId, ConditioningSettings> = {};
  for (const b of DEFAULT_BANDS) conditioning[b.id] = { ...DEFAULT_CONDITIONING };
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    id: `prj-${now.getTime().toString(36)}`,
    name: 'Untitled',
    createdAt: now.toISOString(),
    modifiedAt: now.toISOString(),
    media: { audio: null, video: null },
    analysis: { frameRate: 100, bands: DEFAULT_BANDS.map((b) => ({ ...b })), conditioning },
    effects: [
      { id: 'fx1', type: 'pulse', enabled: true, params: { zoom: 0, displaceX: 0, displaceY: 0, rows: 40 } },
    ],
    routing: [
      {
        id: 'r1', enabled: true, source: 'bass', effectId: 'fx1', param: 'zoom',
        gain: 0.35, offset: 0, invert: false, threshold: 0, curve: 'linear', strength: 1,
      },
      {
        id: 'r2', enabled: true, source: 'bass', effectId: 'fx1', param: 'displaceX',
        gain: 0.06, offset: 0, invert: false, threshold: 0.3, curve: 'square', strength: 1,
      },
    ],
    segment: { musicStart: 0, videoStart: 0, duration: 10 },
    export: { width: 640, height: 360, fps: 30, allowOpusFallback: false },
  };
}
