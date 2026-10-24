import { isBeatMarkerOn } from '../../core/testMedia.ts';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Deterministic test pattern for a given video time: grid, moving bar, timestamp,
 * and a white centre marker during each beat window (used by the sync check).
 */
export function drawTestPattern(ctx: Ctx2D, w: number, h: number, t: number): void {
  ctx.fillStyle = '#202830';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#4a6a8a';
  ctx.lineWidth = Math.max(1, w / 320);
  const step = w / 16;
  for (let x = 0; x <= w; x += step) line(ctx, x, 0, x, h);
  for (let y = 0; y <= h; y += step) line(ctx, 0, y, w, y);

  ctx.fillStyle = '#e0602a';
  const barX = ((t % 2) / 2) * w;
  ctx.fillRect(barX, h * 0.85, w * 0.03, h * 0.1);

  const box = Math.min(w, h) * 0.3;
  ctx.fillStyle = isBeatMarkerOn(t) ? '#ffffff' : '#000000';
  ctx.fillRect((w - box) / 2, (h - box) / 2, box, box);

  ctx.fillStyle = '#ffffff';
  ctx.font = `${Math.round(h / 12)}px monospace`;
  ctx.fillText(`t=${t.toFixed(3)}s`, w * 0.03, h * 0.12);
}

function line(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}
