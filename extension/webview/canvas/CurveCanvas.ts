import { EditorState } from '../state/EditorState';
import { renderGrid } from './GridRenderer';
import { renderCurves } from './CurveRenderer';
import { renderKeys } from './KeyRenderer';
import { renderSelectionBox } from './SelectionBox';

export class CurveCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr: number = 1;
  private rafId: number = 0;
  private disposed = false;

  constructor(
    private container: HTMLElement,
    private state: EditorState
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Curve editor canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d', { alpha: false })!;

    this.handleResize();
    this.observe();

    state.onChange(() => this.scheduleRender());
    this.scheduleRender();
  }

  private resizeObserver: ResizeObserver | null = null;

  private observe(): void {
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);
  }

  private handleResize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const rect = this.container.getBoundingClientRect();
    this.state.canvasWidth = rect.width;
    this.state.canvasHeight = rect.height;
    this.canvas.width = rect.width * this.dpr;
    this.canvas.height = rect.height * this.dpr;
    this.state.forceDirty();
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      if (this.disposed) return;
      this.render();
    });
  }

  private render(): void {
    const { ctx, dpr, state } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;

    if (w === 0 || h === 0) return;

    // Background
    const styles = getComputedStyle(document.documentElement);
    const bgColor = styles.getPropertyValue('--curve-bg').trim() || '#1e1e1e';
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    // Enable/disable anti-aliasing
    ctx.imageSmoothingEnabled = state.settings.antiAlias;

    // Render layers back to front
    renderGrid(ctx, state, dpr);
    renderCurves(ctx, state, dpr);
    renderKeys(ctx, state, dpr);
    renderSelectionBox(ctx, state, dpr);

    // Tooltip for hovered key
    if (state.hoveredKey && state.drag.type === 'none') {
      this.renderTooltip(state.hoveredKey.curveIndex, state.hoveredKey.keyIndex);
    }

    // Drag tooltip showing precise values
    if (state.drag.type === 'key' && state.selectedKeys.length > 0) {
      const sk = state.selectedKeys[0];
      this.renderTooltip(sk.curveIndex, sk.keyIndex);
    }
  }

  private renderTooltip(curveIndex: number, keyIndex: number): void {
    const { ctx, dpr, state } = this;
    const key = state.getKey(curveIndex, keyIndex);
    const val = typeof key.value === 'number' ? key.value : (key.value as number[])[0];

    const sx = (key.time - state.viewport.panX) * state.viewport.zoomX * dpr;
    const sy = (state.canvasHeight - (val - state.viewport.panY) * state.viewport.zoomY) * dpr;

    const timeStr = `t: ${key.time.toFixed(3)}`;
    const valStr = typeof key.value === 'number'
      ? `v: ${key.value.toFixed(3)}`
      : `v: [${(key.value as number[]).map((v) => v.toFixed(2)).join(', ')}]`;
    const text = `${timeStr}  ${valStr}`;

    ctx.save();
    ctx.font = `${11 * dpr}px monospace`;
    const metrics = ctx.measureText(text);
    const padX = 6 * dpr;
    const padY = 4 * dpr;
    const boxW = metrics.width + padX * 2;
    const boxH = 16 * dpr + padY * 2;
    let bx = sx + 12 * dpr;
    let by = sy - boxH - 8 * dpr;
    if (bx + boxW > state.canvasWidth * dpr) bx = sx - boxW - 12 * dpr;
    if (by < 0) by = sy + 12 * dpr;

    ctx.fillStyle = 'rgba(30,30,30,0.9)';
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, 4 * dpr);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = dpr;
    ctx.stroke();

    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--curve-text').trim() || '#ccc';
    ctx.fillStyle = textColor;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + padX, by + boxH / 2);
    ctx.restore();
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.resizeObserver?.disconnect();
    this.canvas.remove();
  }
}
