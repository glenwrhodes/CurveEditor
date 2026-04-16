/**
 * Coordinate transforms between screen (pixel) space and curve (time/value) space.
 */

export interface Viewport {
  panX: number;   // curve-space X at the left edge of the canvas
  panY: number;   // curve-space Y at the bottom edge of the canvas
  zoomX: number;  // pixels per curve-space unit (horizontal)
  zoomY: number;  // pixels per curve-space unit (vertical)
}

export function createViewport(): Viewport {
  return {
    panX: -0.5,
    panY: -0.5,
    zoomX: 200,
    zoomY: 200,
  };
}

/** Convert curve-space X (time) to screen pixel X */
export function curveToScreenX(viewport: Viewport, curveX: number): number {
  return (curveX - viewport.panX) * viewport.zoomX;
}

/** Convert curve-space Y (value) to screen pixel Y (inverted: Y increases upward) */
export function curveToScreenY(viewport: Viewport, curveY: number, canvasHeight: number): number {
  return canvasHeight - (curveY - viewport.panY) * viewport.zoomY;
}

/** Convert screen pixel X to curve-space X (time) */
export function screenToCurveX(viewport: Viewport, screenX: number): number {
  return screenX / viewport.zoomX + viewport.panX;
}

/** Convert screen pixel Y to curve-space Y (value) */
export function screenToCurveY(viewport: Viewport, screenY: number, canvasHeight: number): number {
  return (canvasHeight - screenY) / viewport.zoomY + viewport.panY;
}

/** Get the visible curve-space range for the current viewport */
export function getVisibleRange(
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number
): { minX: number; maxX: number; minY: number; maxY: number } {
  return {
    minX: viewport.panX,
    maxX: viewport.panX + canvasWidth / viewport.zoomX,
    minY: viewport.panY,
    maxY: viewport.panY + canvasHeight / viewport.zoomY,
  };
}

/** Zoom centered on a screen point */
export function zoomAt(
  viewport: Viewport,
  screenX: number,
  screenY: number,
  canvasHeight: number,
  factorX: number,
  factorY: number
): Viewport {
  const curveX = screenToCurveX(viewport, screenX);
  const curveY = screenToCurveY(viewport, screenY, canvasHeight);

  const newZoomX = clampZoom(viewport.zoomX * factorX);
  const newZoomY = clampZoom(viewport.zoomY * factorY);

  return {
    panX: curveX - screenX / newZoomX,
    panY: curveY - (canvasHeight - screenY) / newZoomY,
    zoomX: newZoomX,
    zoomY: newZoomY,
  };
}

/** Pan by screen delta */
export function pan(viewport: Viewport, dScreenX: number, dScreenY: number): Viewport {
  return {
    ...viewport,
    panX: viewport.panX - dScreenX / viewport.zoomX,
    panY: viewport.panY + dScreenY / viewport.zoomY,
  };
}

/** Frame a bounding box in curve space, with padding */
export function frameRegion(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  canvasWidth: number,
  canvasHeight: number,
  padding: number = 0.1
): Viewport {
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  const paddedRangeX = rangeX * (1 + padding * 2);
  const paddedRangeY = rangeY * (1 + padding * 2);

  const zoomX = clampZoom(canvasWidth / paddedRangeX);
  const zoomY = clampZoom(canvasHeight / paddedRangeY);

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return {
    panX: centerX - canvasWidth / (2 * zoomX),
    panY: centerY - canvasHeight / (2 * zoomY),
    zoomX,
    zoomY,
  };
}

const MIN_ZOOM = 0.001;
const MAX_ZOOM = 1000000;

function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

/** Distance between two screen points */
export function screenDistance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}
