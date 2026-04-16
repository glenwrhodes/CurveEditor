import { EditorState } from '../state/EditorState';
import { CurveDefinition, KeyFrame, TangentHandle } from '../../src/protocol';
import { curveToScreenX, curveToScreenY, screenToCurveX, getVisibleRange } from '../math/transforms';
import { evaluateBezierSegment, BezierSegment } from '../math/bezier';
import { getEffectiveTangents } from '../math/tangents';
import { getEffectiveInterp } from '../math/effective';

export function renderCurves(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  dpr: number
): void {
  const visibleCurves = state.getVisibleCurves();
  for (const { curve, index } of visibleCurves) {
    const color = state.getCurveColor(index);

    // State curves get special Gantt-style rendering
    if (curve.type === 'int' && curve.states) {
      renderStateCurve(ctx, state, curve, index, dpr);
      continue;
    }

    if (curve.type === 'float' || curve.type === 'int') {
      renderScalarCurve(ctx, state, curve, index, color, dpr);
      renderInfinityPreview(ctx, state, curve, index, color, dpr);
    } else {
      const componentCount = getComponentCount(curve.type);
      const componentColors = getComponentColors(componentCount);
      for (let comp = 0; comp < componentCount; comp++) {
        if (!state.isComponentVisible(index, comp)) continue;
        renderScalarCurve(ctx, state, curve, index, componentColors[comp], dpr, comp);
        renderInfinityPreview(ctx, state, curve, index, componentColors[comp], dpr, comp);
      }

      // Color gradient strip for color type
      if (curve.type === 'color') {
        renderColorGradient(ctx, state, curve, index, dpr);
      }
    }
  }
}

const STATE_COLORS = [
  '#e06c75', '#61afef', '#98c379', '#e5c07b', '#c678dd',
  '#56b6c2', '#d19a66', '#be5046', '#7ec699', '#f0c674',
];

function renderStateCurve(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  curve: CurveDefinition,
  curveIndex: number,
  dpr: number
): void {
  const { viewport, canvasWidth, canvasHeight } = state;
  const keys = curve.keys;
  const stateCount = curve.states!.count;
  const labels = curve.states!.labels;
  const range = getVisibleRange(viewport, canvasWidth, canvasHeight);

  if (keys.length === 0) return;

  ctx.save();

  const getKeyAt = (ki: number): KeyFrame => state.getKey(curveIndex, ki);

  const segments: { startTime: number; endTime: number; stateIdx: number }[] = [];

  const firstKey = getKeyAt(0);
  if (range.minX < firstKey.time) {
    segments.push({
      startTime: range.minX,
      endTime: firstKey.time,
      stateIdx: firstKey.value as number,
    });
  }

  for (let i = 0; i < keys.length; i++) {
    const k = getKeyAt(i);
    const nextTime = i < keys.length - 1 ? getKeyAt(i + 1).time : range.maxX;
    segments.push({
      startTime: k.time,
      endTime: nextTime,
      stateIdx: k.value as number,
    });
  }

  // Bands are positioned using viewport transforms so they pan/zoom with keyframes.
  // Each state integer value N gets a band from N-0.5 to N+0.5 in curve space.
  for (const seg of segments) {
    const sx0 = curveToScreenX(viewport, seg.startTime) * dpr;
    const sx1 = curveToScreenX(viewport, seg.endTime) * dpr;

    if (sx1 < 0 || sx0 > canvasWidth * dpr) continue;

    const bandTop = curveToScreenY(viewport, seg.stateIdx + 0.5, canvasHeight) * dpr;
    const bandBottom = curveToScreenY(viewport, seg.stateIdx - 0.5, canvasHeight) * dpr;
    const bandH = bandBottom - bandTop;

    if (bandTop > canvasHeight * dpr || bandBottom < 0) continue;

    const color = STATE_COLORS[seg.stateIdx % STATE_COLORS.length];

    ctx.fillStyle = color + '44';
    ctx.fillRect(
      Math.max(0, sx0),
      bandTop,
      Math.min(canvasWidth * dpr, sx1) - Math.max(0, sx0),
      bandH
    );

    ctx.fillStyle = color;
    ctx.fillRect(
      Math.max(0, sx0),
      bandBottom - 3 * dpr,
      Math.min(canvasWidth * dpr, sx1) - Math.max(0, sx0),
      3 * dpr
    );

    if (labels && seg.stateIdx < labels.length) {
      const labelWidth = sx1 - sx0;
      if (labelWidth > 40 * dpr && bandH > 14 * dpr) {
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--curve-text').trim() || '#ccc';
        ctx.font = `${Math.min(11, bandH / dpr * 0.5) * dpr}px sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.fillText(
          labels[seg.stateIdx],
          Math.max(0, sx0) + 6 * dpr,
          bandTop + bandH / 2
        );
      }
    }
  }

  // Left-side state labels
  if (labels) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--curve-text').trim() || '#ccc';
    ctx.font = `${10 * dpr}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.5;
    for (let s = 0; s < stateCount; s++) {
      if (s < labels.length) {
        const centerY = curveToScreenY(viewport, s, canvasHeight) * dpr;
        ctx.fillText(labels[s], 4 * dpr, centerY);
      }
    }
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function getComponentCount(type: string): number {
  switch (type) {
    case 'vec2': return 2;
    case 'vec3': return 3;
    case 'vec4': case 'color': return 4;
    default: return 1;
  }
}

function getComponentColors(count: number): string[] {
  if (count === 2) return ['#e06c75', '#61afef'];
  if (count === 3) return ['#e06c75', '#98c379', '#61afef'];
  return ['#e06c75', '#98c379', '#61afef', '#cccccc'];
}

function renderScalarCurve(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  curve: CurveDefinition,
  curveIndex: number,
  color: string,
  dpr: number,
  component?: number
): void {
  const { viewport, canvasWidth, canvasHeight } = state;
  const keys = curve.keys;

  if (keys.length === 0) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = state.settings.curveLineWidth * dpr;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();

  const range = getVisibleRange(viewport, canvasWidth, canvasHeight);
  let firstPoint = true;

  // Use state.getKey to get preview overrides during drag
  const getKeyAt = (ki: number): KeyFrame => state.getKey(curveIndex, ki);

  if (keys.length === 1) {
    const key = getKeyAt(0);
    const val = getScalar(key.value, component);
    const sy = curveToScreenY(viewport, val, canvasHeight) * dpr;
    ctx.moveTo(0, sy);
    ctx.lineTo(canvasWidth * dpr, sy);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Render before first key (pre-infinity shown as constant for now)
  const firstKey = getKeyAt(0);
  const firstVal = getScalar(firstKey.value, component);
  if (range.minX < firstKey.time) {
    const sy = curveToScreenY(viewport, firstVal, canvasHeight) * dpr;
    const sx = 0;
    ctx.moveTo(sx, sy);
    ctx.lineTo(curveToScreenX(viewport, firstKey.time) * dpr, sy);
    firstPoint = false;
  }

  // Render segments between keys
  for (let i = 0; i < keys.length - 1; i++) {
    const k0 = getKeyAt(i);
    const k1 = getKeyAt(i + 1);
    const v0 = getScalar(k0.value, component);
    const v1 = getScalar(k1.value, component);

    const sx0 = curveToScreenX(viewport, k0.time) * dpr;
    const sx1 = curveToScreenX(viewport, k1.time) * dpr;

    // Skip segments entirely outside viewport
    if (sx1 < 0 || sx0 > canvasWidth * dpr) continue;

    // Use effective interp per component so sub-curves can have independent modes
    const effectiveInterp = getEffectiveInterp(k0, component);

    if (effectiveInterp === 'constant') {
      const sy0 = curveToScreenY(viewport, v0, canvasHeight) * dpr;
      const sy1 = curveToScreenY(viewport, v1, canvasHeight) * dpr;
      if (firstPoint) { ctx.moveTo(sx0, sy0); firstPoint = false; }
      else ctx.lineTo(sx0, sy0);
      ctx.lineTo(sx1, sy0);
      ctx.lineTo(sx1, sy1);
    } else if (effectiveInterp === 'linear') {
      const sy0 = curveToScreenY(viewport, v0, canvasHeight) * dpr;
      const sy1 = curveToScreenY(viewport, v1, canvasHeight) * dpr;
      if (firstPoint) { ctx.moveTo(sx0, sy0); firstPoint = false; }
      else ctx.lineTo(sx0, sy0);
      ctx.lineTo(sx1, sy1);
    } else {
      // Bezier
      const t0 = getEffectiveTangents(keys.map((_, ki) => getKeyAt(ki)), i, component);
      const t1 = getEffectiveTangents(keys.map((_, ki) => getKeyAt(ki)), i + 1, component);

      const seg: BezierSegment = {
        p0: { x: k0.time, y: v0 },
        p1: { x: k0.time + t0.tangentOut.dx, y: v0 + t0.tangentOut.dy },
        p2: { x: k1.time + t1.tangentIn.dx, y: v1 + t1.tangentIn.dy },
        p3: { x: k1.time, y: v1 },
      };

      const pixelStart = Math.max(0, Math.floor(sx0 / dpr));
      const pixelEnd = Math.min(canvasWidth, Math.ceil(sx1 / dpr));

      for (let px = pixelStart; px <= pixelEnd; px++) {
        const cx = screenToCurveX(viewport, px);
        if (cx < k0.time) continue;
        if (cx > k1.time) break;

        const cy = evaluateBezierSegment(seg, cx);
        const sy = curveToScreenY(viewport, cy, canvasHeight) * dpr;

        if (firstPoint) { ctx.moveTo(px * dpr, sy); firstPoint = false; }
        else ctx.lineTo(px * dpr, sy);
      }
    }
  }

  // Render after last key (post-infinity shown as constant for now)
  const lastKey = getKeyAt(keys.length - 1);
  const lastVal = getScalar(lastKey.value, component);
  if (range.maxX > lastKey.time) {
    const sy = curveToScreenY(viewport, lastVal, canvasHeight) * dpr;
    ctx.lineTo(canvasWidth * dpr, sy);
  }

  ctx.stroke();
  ctx.restore();
}

function getScalar(value: number | number[], component?: number): number {
  if (typeof value === 'number') return value;
  if (component !== undefined) return value[component] ?? 0;
  return value[0] ?? 0;
}

function renderInfinityPreview(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  curve: CurveDefinition,
  curveIndex: number,
  color: string,
  dpr: number,
  component?: number
): void {
  const { viewport, canvasWidth, canvasHeight } = state;
  const keys = curve.keys;
  if (keys.length < 1) return;

  const range = getVisibleRange(viewport, canvasWidth, canvasHeight);
  const getKeyAt = (ki: number): KeyFrame => state.getKey(curveIndex, ki);
  const firstKey = getKeyAt(0);
  const lastKey = getKeyAt(keys.length - 1);
  const firstVal = getScalar(firstKey.value, component);
  const lastVal = getScalar(lastKey.value, component);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = state.settings.curveLineWidth * dpr * 0.7;
  ctx.setLineDash([6 * dpr, 4 * dpr]);
  ctx.globalAlpha = 0.5;

  // Pre-infinity
  const preMode = curve.preInfinity || 'constant';
  if (range.minX < firstKey.time) {
    ctx.beginPath();
    if (preMode === 'constant') {
      const sy = curveToScreenY(viewport, firstVal, canvasHeight) * dpr;
      ctx.moveTo(0, sy);
      ctx.lineTo(curveToScreenX(viewport, firstKey.time) * dpr, sy);
    } else if (preMode === 'linear' && keys.length > 1) {
      const nextKey = getKeyAt(1);
      const nextVal = getScalar(nextKey.value, component);
      const slope = (nextVal - firstVal) / (nextKey.time - firstKey.time);
      const startY = firstVal + slope * (range.minX - firstKey.time);
      ctx.moveTo(0, curveToScreenY(viewport, startY, canvasHeight) * dpr);
      ctx.lineTo(curveToScreenX(viewport, firstKey.time) * dpr, curveToScreenY(viewport, firstVal, canvasHeight) * dpr);
    }
    ctx.stroke();
  }

  // Post-infinity
  const postMode = curve.postInfinity || 'constant';
  if (range.maxX > lastKey.time) {
    ctx.beginPath();
    if (postMode === 'constant') {
      const sy = curveToScreenY(viewport, lastVal, canvasHeight) * dpr;
      ctx.moveTo(curveToScreenX(viewport, lastKey.time) * dpr, sy);
      ctx.lineTo(canvasWidth * dpr, sy);
    } else if (postMode === 'linear' && keys.length > 1) {
      const prevKey = getKeyAt(keys.length - 2);
      const prevVal = getScalar(prevKey.value, component);
      const slope = (lastVal - prevVal) / (lastKey.time - prevKey.time);
      const endY = lastVal + slope * (range.maxX - lastKey.time);
      ctx.moveTo(curveToScreenX(viewport, lastKey.time) * dpr, curveToScreenY(viewport, lastVal, canvasHeight) * dpr);
      ctx.lineTo(canvasWidth * dpr, curveToScreenY(viewport, endY, canvasHeight) * dpr);
    }
    ctx.stroke();
  }

  ctx.restore();
}

function renderColorGradient(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  curve: CurveDefinition,
  curveIndex: number,
  dpr: number
): void {
  const { viewport, canvasWidth, canvasHeight } = state;
  const keys = curve.keys;
  if (keys.length === 0) return;

  const stripHeight = 24 * dpr;
  const stripY = (canvasHeight - 28) * dpr;

  ctx.save();

  const getKeyAt = (ki: number): KeyFrame => state.getKey(curveIndex, ki);

  for (let px = 0; px < canvasWidth; px++) {
    const cx = screenToCurveX(viewport, px);
    const color = evaluateColorAtTime(keys, cx, getKeyAt);
    ctx.fillStyle = `rgba(${Math.round(color[0] * 255)},${Math.round(color[1] * 255)},${Math.round(color[2] * 255)},${color[3]})`;
    ctx.fillRect(px * dpr, stripY, dpr, stripHeight);
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = dpr;
  ctx.strokeRect(0, stripY, canvasWidth * dpr, stripHeight);

  ctx.restore();
}

function evaluateColorAtTime(
  keys: KeyFrame[],
  time: number,
  getKeyAt: (ki: number) => KeyFrame
): number[] {
  if (keys.length === 0) return [0, 0, 0, 1];

  const first = getKeyAt(0);
  if (time <= first.time) return first.value as number[];

  const last = getKeyAt(keys.length - 1);
  if (time >= last.time) return last.value as number[];

  for (let i = 0; i < keys.length - 1; i++) {
    const k0 = getKeyAt(i);
    const k1 = getKeyAt(i + 1);
    if (time >= k0.time && time <= k1.time) {
      const v0 = k0.value as number[];
      const v1 = k1.value as number[];
      const t = (time - k0.time) / (k1.time - k0.time);

      // Per-component interpolation for gradient strip
      return v0.map((c, ci) => {
        const compInterp = getEffectiveInterp(k0, ci);
        if (compInterp === 'constant') return c;
        return c + (v1[ci] - c) * t;
      });
    }
  }

  return last.value as number[];
}
