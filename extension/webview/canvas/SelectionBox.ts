import { EditorState } from '../state/EditorState';

export function renderSelectionBox(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  dpr: number
): void {
  if (state.drag.type !== 'marquee') return;

  const x1 = Math.min(state.drag.startScreenX, state.drag.currentScreenX) * dpr;
  const y1 = Math.min(state.drag.startScreenY, state.drag.currentScreenY) * dpr;
  const x2 = Math.max(state.drag.startScreenX, state.drag.currentScreenX) * dpr;
  const y2 = Math.max(state.drag.startScreenY, state.drag.currentScreenY) * dpr;

  const w = x2 - x1;
  const h = y2 - y1;

  ctx.save();

  const styles = getComputedStyle(document.documentElement);
  const selectColor = styles.getPropertyValue('--key-selected').trim() || '#007acc';

  ctx.fillStyle = selectColor + '22';
  ctx.strokeStyle = selectColor;
  ctx.lineWidth = 1 * dpr;
  ctx.setLineDash([4 * dpr, 4 * dpr]);

  ctx.fillRect(x1, y1, w, h);
  ctx.strokeRect(x1, y1, w, h);

  ctx.restore();
}
