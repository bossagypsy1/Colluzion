// Scrolling view of the three band envelopes around the playhead, redrawn each
// frame from the stored signals (no accumulated state).

import { sampleSignal } from '../core/analysis/envelope.ts';
import { state } from './state.ts';

const WINDOW_SEC = 8;
const PLAYHEAD_AT = 0.3;
const COLORS: Record<string, string> = { bass: '#e0602a', mid: '#3fb68b', treble: '#5b8def' };

export class EnvelopeView {
  selected = 'bass';
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.canvas.clientWidth * dpr);
    this.canvas.height = Math.round(120 * dpr);
  }

  draw(musicTime: number): void {
    const { canvas: c, g } = this;
    const dpr = window.devicePixelRatio || 1;
    g.fillStyle = '#0c0f13';
    g.fillRect(0, 0, c.width, c.height);
    if (state.signals.length === 0) return;
    const t0 = musicTime - WINDOW_SEC * PLAYHEAD_AT;
    const pxPerSec = c.width / WINDOW_SEC;

    // Export range shading.
    const r = state.project.exportRange;
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect((r.start - t0) * pxPerSec, 0, r.duration * pxPerSec, c.height);

    // Selected band last so it sits on top.
    const ordered = [...state.signals].sort((a, b) => Number(a.id === this.selected) - Number(b.id === this.selected));
    for (const sig of ordered) {
      g.strokeStyle = COLORS[sig.id] ?? '#ccc';
      g.globalAlpha = sig.id === this.selected ? 1 : 0.45;
      g.lineWidth = (sig.id === this.selected ? 2 : 1.25) * dpr;
      g.beginPath();
      for (let x = 0; x < c.width; x += 2) {
        const t = t0 + x / pxPerSec;
        const v = t < 0 ? 0 : sampleSignal(sig, t);
        const y = c.height - v * (c.height - 4 * dpr) - 2 * dpr;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    g.fillStyle = '#ffffff';
    g.fillRect(Math.round(c.width * PLAYHEAD_AT), 0, Math.max(1, dpr), c.height);
  }
}
