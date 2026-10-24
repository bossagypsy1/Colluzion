import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EFFECT_DEFINITIONS } from '../src/core/effects/definitions.ts';
import { migrateProject } from '../src/core/project/migrate.ts';
import { createDefaultProject, PROJECT_FORMAT_VERSION, type RoutingConnection } from '../src/core/project/model.ts';
import { computeFrameState, frameTimestamps, mapVideoTime } from '../src/core/render/frameState.ts';
import { connectionContribution, evaluateRouting } from '../src/core/routing/routing.ts';
import { isBeatMarkerOn } from '../src/core/testMedia.ts';

const base: RoutingConnection = {
  id: 'c', enabled: true, source: 'bass', effectId: 'fx1', param: 'zoom',
  gain: 1, offset: 0, invert: false, threshold: 0, curve: 'linear', strength: 1,
};

test('connection contribution applies threshold, curve, invert, gain, offset, strength', () => {
  assert.equal(connectionContribution(base, 0.5), 0.5);
  assert.equal(connectionContribution({ ...base, threshold: 0.5 }, 0.5), 0);
  assert.equal(connectionContribution({ ...base, curve: 'square' }, 0.5), 0.25);
  assert.equal(connectionContribution({ ...base, invert: true }, 0.25), 0.75);
  assert.equal(connectionContribution({ ...base, gain: 2, offset: 0.1, strength: 0.5 }, 0.5), 0.55);
});

test('multiple connections sum and clamp to parameter range', () => {
  const effects = [{ id: 'fx1', type: 'pulse', enabled: true, params: { zoom: 0.2 } }];
  const conns = [base, { ...base, id: 'd', source: 'mid' }];
  const out = evaluateRouting(effects, EFFECT_DEFINITIONS, conns, (id) => (id === 'bass' ? 0.3 : 0.9));
  assert.equal(out.fx1!.zoom, 1); // 0.2 + 0.3 + 0.9 clamped to max 1
  assert.equal(out.fx1!.rows, 40); // default filled in
});

test('disabled connections and unknown params are ignored', () => {
  const effects = [{ id: 'fx1', type: 'pulse', enabled: true, params: {} }];
  const conns = [{ ...base, enabled: false }, { ...base, param: 'nope' }];
  const out = evaluateRouting(effects, EFFECT_DEFINITIONS, conns, () => 1);
  assert.equal(out.fx1!.zoom, 0);
});

test('frame state is a pure function of music time', () => {
  const p = createDefaultProject(new Date(0));
  const sig = { id: 'bass', frameRate: 100, values: Float32Array.from({ length: 1000 }, (_, i) => (i % 50) / 50) };
  const a = computeFrameState(p, [sig], 3.2345, 7);
  const b = computeFrameState(p, [sig], 3.2345, 7);
  assert.deepEqual(a, b);
  assert.equal(a.musicTime, 3.2345);
  assert.ok(Math.abs(a.signals.bass! - 0.469) < 1e-6); // between frames 323 (0.46) and 324 (0.48)
});

test('frame state does not depend on the order or history of evaluation', () => {
  const p = createDefaultProject(new Date(0));
  const sig = { id: 'bass', frameRate: 100, values: Float32Array.from({ length: 1000 }, (_, i) => Math.abs(Math.sin(i))) };
  const forward = [1, 2, 3, 4].map((t) => computeFrameState(p, [sig], t, 7));
  const shuffled = [3, 1, 4, 2].map((t) => computeFrameState(p, [sig], t, 7));
  assert.deepEqual(shuffled[1], forward[0]);
  assert.deepEqual(shuffled[0], forward[2]);
});

test('video time loops from the in-point, aligned to the sync music time', () => {
  const clip = { inPoint: 1, syncMusicTime: 0 };
  assert.equal(mapVideoTime(clip, 4, 0), 1);
  assert.equal(mapVideoTime(clip, 4, 2.5), 3.5);
  assert.equal(mapVideoTime(clip, 4, 3.5), 1.5);
  const shifted = { inPoint: 0, syncMusicTime: 10 };
  assert.equal(mapVideoTime(shifted, 4, 10), 0);
  assert.equal(mapVideoTime(shifted, 4, 9), 3); // before the sync point it wraps backwards
});

test('v1 projects migrate to v2 with identical video mapping', () => {
  const v1 = { ...createDefaultProject(new Date(0)), formatVersion: 1, segment: { musicStart: 5, videoStart: 2, duration: 8 } } as Record<string, unknown>;
  delete v1.clip;
  delete v1.exportRange;
  const p = migrateProject(v1);
  assert.equal(p.formatVersion, PROJECT_FORMAT_VERSION);
  assert.deepEqual(p.exportRange, { start: 5, duration: 8 });
  // v1 showed videoStart + localTime at musicStart + localTime.
  assert.equal(mapVideoTime(p.clip, 20, 5 + 3), 2 + 3);
  assert.equal('segment' in p, false);
  assert.throws(() => migrateProject({ formatVersion: 99 }));
});

test('frame timestamps are exact multiples of 1/fps', () => {
  const ts = frameTimestamps(10, 30);
  assert.equal(ts.length, 300);
  assert.equal(ts[0], 0);
  assert.equal(ts[299], 299 / 30);
});

test('beat marker is on exactly at beat frames', () => {
  for (const fps of [24, 30]) {
    for (let i = 0; i < fps * 3; i++) {
      const t = i / fps;
      const nearestBeat = Math.round(t / 0.5) * 0.5;
      if (Math.abs(t - nearestBeat) < 1e-9) assert.ok(isBeatMarkerOn(t), `fps ${fps} frame ${i}`);
    }
  }
});
