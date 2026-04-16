import { EditorState } from '../state/EditorState';
import { CurveDefinition, KeyFrame, TangentHandle } from '../../src/protocol';
import { curveToScreenX, curveToScreenY } from '../math/transforms';
import { getEffectiveTangents } from '../math/tangents';

const KEY_SIZE = 8;
const HANDLE_RADIUS = 4;
const HANDLE_LINE_WIDTH = 1;

export function renderKeys(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  dpr: number
): void {
  const visibleCurves = state.getVisibleCurves();

  for (const { curve, index: curveIndex } of visibleCurves) {
    const color = state.getCurveColor(curveIndex);
    const keys = curve.keys;

    for (let ki = 0; ki < keys.length; ki++) {
      const key = state.getKey(curveIndex, ki);
      const isSelected = state.isKeySelected(curveIndex, ki);
      const isHovered =
        state.hoveredKey?.curveIndex === curveIndex &&
        state.hoveredKey?.keyIndex === ki;

      if (curve.type === 'float' || curve.type === 'int') {
        const val = typeof key.value === 'number' ? key.value : 0;
        const sx = curveToScreenX(state.viewport, key.time) * dpr;
        const sy = curveToScreenY(state.viewport, val, state.canvasHeight) * dpr;

        if (isSelected && key.interp === 'bezier' && state.tangentDisplayEnabled) {
          renderTangentHandles(ctx, state, keys, curveIndex, ki, sx, sy, val, color, dpr);
        }

        drawDiamond(ctx, sx, sy, KEY_SIZE * dpr, color, isSelected, isHovered, dpr);
      } else {
        const values = key.value as number[];
        const componentCount = values.length;
        const componentColors = getComponentColors(componentCount);

        for (let comp = 0; comp < componentCount; comp++) {
          const val = values[comp];
          const sx = curveToScreenX(state.viewport, key.time) * dpr;
          const sy = curveToScreenY(state.viewport, val, state.canvasHeight) * dpr;

          if (isSelected && key.interp === 'bezier' && state.tangentDisplayEnabled) {
            renderTangentHandles(ctx, state, keys, curveIndex, ki, sx, sy, val, componentColors[comp], dpr, comp);
          }

          drawDiamond(ctx, sx, sy, KEY_SIZE * dpr, componentColors[comp], isSelected, isHovered, dpr);
        }
      }
    }
  }
}

function renderTangentHandles(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  keys: KeyFrame[],
  curveIndex: number,
  ki: number,
  keySx: number,
  keySy: number,
  keyValue: number,
  color: string,
  dpr: number,
  component?: number
): void {
  const allKeys = keys.map((_, idx) => state.getKey(curveIndex, idx));
  const tangents = getEffectiveTangents(allKeys, ki, component);
  const key = state.getKey(curveIndex, ki);

  const styles = getComputedStyle(document.documentElement);
  const handleColor = styles.getPropertyValue('--key-handle').trim() || color;

  // Tangent In
  if (ki > 0) {
    const inX = curveToScreenX(state.viewport, key.time + tangents.tangentIn.dx) * dpr;
    const inY = curveToScreenY(state.viewport, keyValue + tangents.tangentIn.dy, state.canvasHeight) * dpr;

    ctx.save();
    ctx.strokeStyle = handleColor;
    ctx.lineWidth = HANDLE_LINE_WIDTH * dpr;
    ctx.beginPath();
    ctx.moveTo(keySx, keySy);
    ctx.lineTo(inX, inY);
    ctx.stroke();

    const isHoveredIn =
      state.hoveredTangent?.curveIndex === curveIndex &&
      state.hoveredTangent?.keyIndex === ki &&
      state.hoveredTangent?.which === 'in';

    drawCircle(ctx, inX, inY, (isHoveredIn ? HANDLE_RADIUS + 2 : HANDLE_RADIUS) * dpr, handleColor);
    ctx.restore();
  }

  // Tangent Out
  if (ki < keys.length - 1) {
    const outX = curveToScreenX(state.viewport, key.time + tangents.tangentOut.dx) * dpr;
    const outY = curveToScreenY(state.viewport, keyValue + tangents.tangentOut.dy, state.canvasHeight) * dpr;

    ctx.save();
    ctx.strokeStyle = handleColor;
    ctx.lineWidth = HANDLE_LINE_WIDTH * dpr;
    ctx.beginPath();
    ctx.moveTo(keySx, keySy);
    ctx.lineTo(outX, outY);
    ctx.stroke();

    const isHoveredOut =
      state.hoveredTangent?.curveIndex === curveIndex &&
      state.hoveredTangent?.keyIndex === ki &&
      state.hoveredTangent?.which === 'out';

    drawCircle(ctx, outX, outY, (isHoveredOut ? HANDLE_RADIUS + 2 : HANDLE_RADIUS) * dpr, handleColor);
    ctx.restore();
  }
}

function drawDiamond(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  fillColor: string,
  selected: boolean,
  hovered: boolean,
  dpr: number
): void {
  const half = (size / 2) * (hovered ? 1.3 : 1);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y - half);
  ctx.lineTo(x + half, y);
  ctx.lineTo(x, y + half);
  ctx.lineTo(x - half, y);
  ctx.closePath();

  ctx.fillStyle = selected ? lightenColor(fillColor, 0.3) : fillColor;
  ctx.fill();

  if (selected) {
    const styles = getComputedStyle(document.documentElement);
    ctx.strokeStyle = styles.getPropertyValue('--key-selected').trim() || '#007acc';
    ctx.lineWidth = 2.5 * dpr;
  } else {
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1 * dpr;
  }
  ctx.stroke();
  ctx.restore();
}

function drawCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string
): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function lightenColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, ((num >> 16) & 255) + Math.round(255 * amount));
  const g = Math.min(255, ((num >> 8) & 255) + Math.round(255 * amount));
  const b = Math.min(255, (num & 255) + Math.round(255 * amount));
  return `rgb(${r},${g},${b})`;
}

function getComponentColors(count: number): string[] {
  if (count === 2) return ['#e06c75', '#61afef'];
  if (count === 3) return ['#e06c75', '#98c379', '#61afef'];
  return ['#e06c75', '#98c379', '#61afef', '#cccccc'];
}

/**
 * Hit test: check if screen point is near a keyframe diamond.
 * Returns the hit key or null.
 */
export function hitTestKeys(
  state: EditorState,
  screenX: number,
  screenY: number,
  dpr: number
): { curveIndex: number; keyIndex: number } | null {
  const hitRadius = (KEY_SIZE + 4) / 2;
  const visibleCurves = state.getVisibleCurves();

  for (const { curve, index: curveIndex } of visibleCurves) {
    for (let ki = curve.keys.length - 1; ki >= 0; ki--) {
      const key = state.getKey(curveIndex, ki);
      const vals = typeof key.value === 'number' ? [key.value] : (key.value as number[]);

      for (const val of vals) {
        const sx = curveToScreenX(state.viewport, key.time);
        const sy = curveToScreenY(state.viewport, val, state.canvasHeight);
        const dx = screenX - sx;
        const dy = screenY - sy;
        if (Math.abs(dx) <= hitRadius && Math.abs(dy) <= hitRadius) {
          return { curveIndex, keyIndex: ki };
        }
      }
    }
  }
  return null;
}

/**
 * Hit test tangent handles. Returns which handle was hit.
 */
export function hitTestTangents(
  state: EditorState,
  screenX: number,
  screenY: number,
  dpr: number
): { curveIndex: number; keyIndex: number; which: 'in' | 'out'; component?: number } | null {
  const hitRadius = HANDLE_RADIUS + 4;
  const visibleCurves = state.getVisibleCurves();

  for (const { curve, index: curveIndex } of visibleCurves) {
    for (let ki = 0; ki < curve.keys.length; ki++) {
      if (!state.isKeySelected(curveIndex, ki)) continue;
      const key = state.getKey(curveIndex, ki);
      if (key.interp !== 'bezier') continue;

      const allKeys = curve.keys.map((_, idx) => state.getKey(curveIndex, idx));
      const components = typeof key.value === 'number' ? [undefined] : (key.value as number[]).map((_, i) => i);

      for (const comp of components) {
        const val = typeof key.value === 'number' ? key.value : (key.value as number[])[comp ?? 0];
        const tangents = getEffectiveTangents(allKeys, ki, comp);

        // Check tangent in
        if (ki > 0) {
          const inSx = curveToScreenX(state.viewport, key.time + tangents.tangentIn.dx);
          const inSy = curveToScreenY(state.viewport, val + tangents.tangentIn.dy, state.canvasHeight);
          if (Math.abs(screenX - inSx) <= hitRadius && Math.abs(screenY - inSy) <= hitRadius) {
            return { curveIndex, keyIndex: ki, which: 'in', component: comp };
          }
        }

        // Check tangent out
        if (ki < curve.keys.length - 1) {
          const outSx = curveToScreenX(state.viewport, key.time + tangents.tangentOut.dx);
          const outSy = curveToScreenY(state.viewport, val + tangents.tangentOut.dy, state.canvasHeight);
          if (Math.abs(screenX - outSx) <= hitRadius && Math.abs(screenY - outSy) <= hitRadius) {
            return { curveIndex, keyIndex: ki, which: 'out', component: comp };
          }
        }
      }
    }
  }
  return null;
}
