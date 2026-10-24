// Per-parameter controls for the active effect: base value plus one routing
// connection (band × amount). Generated from the effect definition, so new
// effects get controls without UI changes. Edits apply on the next frame.

import { EFFECT_DEFINITIONS } from '../core/effects/definitions.ts';
import type { RoutingConnection } from '../core/project/model.ts';
import type { FrameState } from '../core/render/frameState.ts';
import { state } from './state.ts';

interface ParamRow {
  effectId: string;
  param: string;
  live: HTMLElement;
  lastShown: number;
}

const rows: ParamRow[] = [];

export function buildEffectControls(container: HTMLElement, nameEl: HTMLElement): void {
  container.textContent = '';
  rows.length = 0;
  const fx = state.project.effects[0];
  if (!fx) return;
  const def = EFFECT_DEFINITIONS[fx.type];
  if (!def) return;
  nameEl.textContent = def.label;
  const bands = state.project.analysis.bands;

  for (const [param, spec] of Object.entries(def.params)) {
    const span = spec.max - spec.min;
    const step = span / 200;
    const conn = () => state.project.routing.find((r) => r.effectId === fx.id && r.param === param);

    const wrap = el('div', 'param');
    const head = el('div', 'param-head');
    head.append(text('span', spec.label));
    const live = text('span', '', 'live');
    head.append(live);
    wrap.append(head);

    const base = range(spec.min, spec.max, step, fx.params[param] ?? spec.default);
    const baseLabel = el('label', 'base');
    baseLabel.append(text('span', 'Base'), base);
    base.addEventListener('input', () => (fx.params[param] = Number(base.value)));
    wrap.append(baseLabel);

    const drive = el('div', 'drive');
    const source = document.createElement('select');
    source.append(new Option('No band', ''));
    for (const b of bands) source.append(new Option(b.label, b.id));
    const c = conn();
    source.value = c?.enabled ? c.source : '';
    const amount = range(-span, span, step, c?.gain ?? span * 0.25);
    amount.disabled = !c?.enabled;
    amount.setAttribute('aria-label', `${spec.label} amount`);

    source.addEventListener('change', () => {
      let r = conn();
      if (!source.value) {
        if (r) r.enabled = false;
      } else if (r) {
        r.enabled = true;
        r.source = source.value;
      } else {
        r = newConnection(fx.id, param, source.value, Number(amount.value));
        state.project.routing.push(r);
      }
      amount.disabled = !source.value;
    });
    amount.addEventListener('input', () => {
      const r = conn();
      if (r) r.gain = Number(amount.value);
    });
    drive.append(source, amount);
    wrap.append(drive);
    container.append(wrap);
    rows.push({ effectId: fx.id, param, live, lastShown: NaN });
  }
}

/** Shows the routed (live) value of each parameter for the frame being displayed. */
export function updateEffectReadouts(frame: FrameState): void {
  for (const row of rows) {
    const v = frame.effects.find((e) => e.id === row.effectId)?.params[row.param];
    if (v === undefined || Math.abs(v - row.lastShown) < 0.0005) continue;
    row.lastShown = v;
    row.live.textContent = v.toFixed(3);
  }
}

function newConnection(effectId: string, param: string, source: string, gain: number): RoutingConnection {
  return {
    id: `${effectId}:${param}`, enabled: true, source, effectId, param,
    gain, offset: 0, invert: false, threshold: 0, curve: 'linear', strength: 1,
  };
}

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function text(tag: string, content: string, cls?: string): HTMLElement {
  const e = el(tag, cls);
  e.textContent = content;
  return e;
}

function range(min: number, max: number, step: number, value: number): HTMLInputElement {
  const r = document.createElement('input');
  r.type = 'range';
  r.min = String(min);
  r.max = String(max);
  r.step = String(step);
  r.value = String(value);
  return r;
}
