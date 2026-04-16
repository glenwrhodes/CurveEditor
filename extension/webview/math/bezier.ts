/**
 * Cubic bezier evaluation using Newton-Raphson to solve for t given x,
 * then evaluating y(t). Handles linear and constant interpolation as well.
 */

export interface Point {
  x: number;
  y: number;
}

export interface BezierSegment {
  p0: Point;
  p1: Point;
  p2: Point;
  p3: Point;
}

function cubicBezier(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function cubicBezierDerivative(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const mt = 1 - t;
  return 3 * mt * mt * (p1 - p0) + 6 * mt * t * (p2 - p1) + 3 * t * t * (p3 - p2);
}

/**
 * Solve for parameter t given an x value along a cubic bezier curve.
 * Uses Newton-Raphson with bisection fallback.
 */
export function solveBezierT(x: number, x0: number, x1: number, x2: number, x3: number): number {
  if (x <= x0) return 0;
  if (x >= x3) return 1;

  // Initial guess via linear interpolation
  let t = (x - x0) / (x3 - x0);

  // Newton-Raphson iterations
  for (let i = 0; i < 8; i++) {
    const currentX = cubicBezier(t, x0, x1, x2, x3);
    const error = currentX - x;
    if (Math.abs(error) < 1e-7) return t;

    const dx = cubicBezierDerivative(t, x0, x1, x2, x3);
    if (Math.abs(dx) < 1e-10) break;

    t -= error / dx;
    t = Math.max(0, Math.min(1, t));
  }

  // Bisection fallback for robustness
  let lo = 0;
  let hi = 1;
  t = (lo + hi) / 2;
  for (let i = 0; i < 20; i++) {
    const currentX = cubicBezier(t, x0, x1, x2, x3);
    if (Math.abs(currentX - x) < 1e-7) return t;
    if (currentX < x) {
      lo = t;
    } else {
      hi = t;
    }
    t = (lo + hi) / 2;
  }

  return t;
}

export function evaluateBezierSegment(seg: BezierSegment, x: number): number {
  const t = solveBezierT(x, seg.p0.x, seg.p1.x, seg.p2.x, seg.p3.x);
  return cubicBezier(t, seg.p0.y, seg.p1.y, seg.p2.y, seg.p3.y);
}

export function evaluateBezierSegmentAtT(seg: BezierSegment, t: number): Point {
  return {
    x: cubicBezier(t, seg.p0.x, seg.p1.x, seg.p2.x, seg.p3.x),
    y: cubicBezier(t, seg.p0.y, seg.p1.y, seg.p2.y, seg.p3.y),
  };
}

export interface PolylineCache {
  curveIndex: number;
  component: number;
  viewportKey: string;
  points: Point[];
}

/**
 * Build a polyline for a curve segment across a pixel range.
 * Returns array of screen-space (x, y) pairs.
 */
export function buildSegmentPolyline(
  seg: BezierSegment,
  screenXStart: number,
  screenXEnd: number,
  curveToScreenX: (cx: number) => number,
  screenToCurveX: (sx: number) => number,
  curveToScreenY: (cy: number) => number
): Point[] {
  const points: Point[] = [];
  const step = 1; // one pixel at a time

  for (let sx = screenXStart; sx <= screenXEnd; sx += step) {
    const cx = screenToCurveX(sx);
    if (cx < seg.p0.x || cx > seg.p3.x) continue;
    const cy = evaluateBezierSegment(seg, cx);
    points.push({ x: sx, y: curveToScreenY(cy) });
  }

  return points;
}
