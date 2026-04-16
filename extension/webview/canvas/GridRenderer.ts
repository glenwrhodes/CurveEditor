import { EditorState } from '../state/EditorState';
import { curveToScreenX, curveToScreenY, getVisibleRange } from '../math/transforms';

/**
 * Compute a "nice" grid interval for a given pixel-per-unit zoom level.
 * Produces intervals in the 1-2-5 pattern (e.g., 0.01, 0.02, 0.05, 0.1, 0.2, ...).
 */
function niceInterval(pixelsPerUnit: number, minPixelGap: number = 50): number {
  const rawInterval = minPixelGap / pixelsPerUnit;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
  const normalized = rawInterval / magnitude;

  let nice: number;
  if (normalized <= 1) nice = 1;
  else if (normalized <= 2) nice = 2;
  else if (normalized <= 5) nice = 5;
  else nice = 10;

  return nice * magnitude;
}

export function renderGrid(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  dpr: number
): void {
  const { viewport, canvasWidth, canvasHeight } = state;
  const range = getVisibleRange(viewport, canvasWidth, canvasHeight);

  const timeInterval = niceInterval(viewport.zoomX);
  const valueInterval = niceInterval(viewport.zoomY);

  const majorEvery = 5;

  // Grid colors from CSS variables — read once from the body's computed style
  const styles = getComputedStyle(document.documentElement);
  const minorColor = styles.getPropertyValue('--curve-grid').trim() || 'rgba(128,128,128,0.15)';
  const majorColor = styles.getPropertyValue('--curve-grid-major').trim() || 'rgba(128,128,128,0.35)';
  const textColor = styles.getPropertyValue('--curve-text').trim() || '#999';
  const originColor = 'rgba(128,128,128,0.5)';

  ctx.save();

  // Vertical grid lines (time axis)
  const firstTimeGrid = Math.floor(range.minX / timeInterval) * timeInterval;
  for (let t = firstTimeGrid; t <= range.maxX + timeInterval; t += timeInterval) {
    const sx = curveToScreenX(viewport, t) * dpr;
    const gridIndex = Math.round(t / timeInterval);
    const isMajor = gridIndex % majorEvery === 0;
    const isOrigin = Math.abs(t) < timeInterval * 0.01;

    ctx.beginPath();
    ctx.strokeStyle = isOrigin ? originColor : isMajor ? majorColor : minorColor;
    ctx.lineWidth = isOrigin ? 2 * dpr : dpr;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, canvasHeight * dpr);
    ctx.stroke();
  }

  // Horizontal grid lines (value axis)
  const firstValueGrid = Math.floor(range.minY / valueInterval) * valueInterval;
  for (let v = firstValueGrid; v <= range.maxY + valueInterval; v += valueInterval) {
    const sy = curveToScreenY(viewport, v, canvasHeight) * dpr;
    const gridIndex = Math.round(v / valueInterval);
    const isMajor = gridIndex % majorEvery === 0;
    const isOrigin = Math.abs(v) < valueInterval * 0.01;

    ctx.beginPath();
    ctx.strokeStyle = isOrigin ? originColor : isMajor ? majorColor : minorColor;
    ctx.lineWidth = isOrigin ? 2 * dpr : dpr;
    ctx.moveTo(0, sy);
    ctx.lineTo(canvasWidth * dpr, sy);
    ctx.stroke();
  }

  // Axis labels
  if (state.settings.showGridLabels) {
    ctx.fillStyle = textColor;
    ctx.font = `${11 * dpr}px monospace`;
    ctx.textBaseline = 'top';

    // Time labels (bottom)
    for (let t = firstTimeGrid; t <= range.maxX + timeInterval; t += timeInterval) {
      const gridIndex = Math.round(t / timeInterval);
      if (gridIndex % majorEvery !== 0) continue;
      const sx = curveToScreenX(viewport, t) * dpr;
      const label = formatNumber(t, timeInterval);
      ctx.fillText(label, sx + 3 * dpr, (canvasHeight - 16) * dpr);
    }

    // Value labels (left)
    ctx.textBaseline = 'middle';
    for (let v = firstValueGrid; v <= range.maxY + valueInterval; v += valueInterval) {
      const gridIndex = Math.round(v / valueInterval);
      if (gridIndex % majorEvery !== 0) continue;
      const sy = curveToScreenY(viewport, v, canvasHeight) * dpr;
      const label = formatNumber(v, valueInterval);
      ctx.fillText(label, 4 * dpr, sy);
    }
  }

  ctx.restore();
}

function formatNumber(value: number, interval: number): string {
  if (interval >= 1) return Math.round(value).toString();
  const decimals = Math.max(0, -Math.floor(Math.log10(interval)));
  return value.toFixed(decimals);
}
