import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EFFECT_DEFINITIONS } from '../src/core/effects/definitions.ts';
import { createDefaultProject, type RoutingConnection } from '../src/core/project/model.ts';
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

test('frame state is a pure function of timestamp', () => {
  const p = createDefaultProject(new Date(0));
  p.segment.musicStart = 2;
  const sig = { id: 'bass', frameRate: 100, values: Float32Array.from({ length: 1000 }, (_, i) => (i % 50) / 50) };
  const a = computeFrameState(p, [sig], 1.2345, 7);
  const b = computeFrameState(p, [sig], 1.2345, 7);
  assert.deepEqual(a, b);
  assert.ok(Math.abs(a.musicTime - 3.2345) < 1e-12);
});

test('video time loops when the clip is shorter than the segment', () => {
  const seg = { musicStart: 0, videoStart: 1, duration: 10 };
  assert.equal(mapVideoTime(seg, 4, 0), 1);
  assert.equal(mapVideoTime(seg, 4, 2.5), 3.5);
  assert.equal(mapVideoTime(seg, 4, 3.5), 1.5);
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
