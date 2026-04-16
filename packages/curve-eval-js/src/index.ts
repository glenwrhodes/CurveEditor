// ── Types ──

export interface TangentHandle {
  dx: number;
  dy: number;
}

export interface KeyFrame {
  time: number;
  value: number | number[];
  interp: 'bezier' | 'linear' | 'constant';
  tangentMode?: string;
  tangentIn?: TangentHandle | TangentHandle[];
  tangentOut?: TangentHandle | TangentHandle[];
}

export interface StatesDefinition {
  count: number;
  labels?: string[];
}

export interface CurveDefinition {
  name: string;
  type: 'float' | 'int' | 'vec2' | 'vec3' | 'vec4' | 'color';
  range?: { min: number; max: number };
  timeRange?: { start: number; end: number };
  states?: StatesDefinition;
  preInfinity?: 'constant' | 'linear' | 'cycle' | 'oscillate';
  postInfinity?: 'constant' | 'linear' | 'cycle' | 'oscillate';
  keys: KeyFrame[];
}

export interface CurveFile {
  version: number;
  curves: CurveDefinition[];
}

export interface EvaluateOptions {
  normalized?: boolean;
}

export interface StateResult {
  index: number;
  label?: string;
}

// ── Public API ──

export function evaluate(
  curveFile: CurveFile,
  curveName: string,
  time: number,
  options?: EvaluateOptions
): number | number[] | { r: number; g: number; b: number; a: number } | null {
  const curve = findCurve(curveFile, curveName);
  if (!curve) return null;
  if (curve.keys.length === 0) return null;

  const t = resolveTime(curve, time, options);
  const remapped = remapInfinity(curve, t);

  switch (curve.type) {
    case 'float':
      return evaluateScalar(curve.keys, remapped);
    case 'int':
      if (curve.states) {
        return evaluateConstantInt(curve.keys, remapped);
      }
      return evaluateInt(curve.keys, remapped);
    case 'vec2':
    case 'vec3':
    case 'vec4': {
      const count = componentCount(curve.type);
      return Array.from({ length: count }, (_, i) =>
        evaluateScalar(curve.keys, remapped, i)
      );
    }
    case 'color': {
      const [r, g, b, a] = [0, 1, 2, 3].map((i) =>
        Math.max(0, Math.min(1, evaluateScalar(curve.keys, remapped, i)))
      );
      return { r, g, b, a };
    }
    default:
      return null;
  }
}

export function evaluateAll(
  curveFile: CurveFile,
  time: number,
  options?: EvaluateOptions
): Record<string, ReturnType<typeof evaluate>> {
  const result: Record<string, ReturnType<typeof evaluate>> = {};
  for (const curve of curveFile.curves) {
    result[curve.name] = evaluate(curveFile, curve.name, time, options);
  }
  return result;
}

export function evaluateState(
  curveFile: CurveFile,
  curveName: string,
  time: number,
  options?: EvaluateOptions
): StateResult | null {
  const curve = findCurve(curveFile, curveName);
  if (!curve || curve.type !== 'int' || !curve.states) return null;
  if (curve.keys.length === 0) return null;

  const t = resolveTime(curve, time, options);
  const remapped = remapInfinity(curve, t);
  const index = evaluateConstantInt(curve.keys, remapped);
  const label = curve.states.labels?.[index];

  return { index, label };
}

export function getCurveNames(curveFile: CurveFile): string[] {
  return curveFile.curves.map((c) => c.name);
}

export function getCurveTimeRange(
  curveFile: CurveFile,
  curveName: string
): { start: number; end: number } | null {
  const curve = findCurve(curveFile, curveName);
  if (!curve || curve.keys.length === 0) return null;
  return {
    start: curve.keys[0].time,
    end: curve.keys[curve.keys.length - 1].time,
  };
}

// ── Internal ──

function findCurve(file: CurveFile, name: string): CurveDefinition | undefined {
  return file.curves.find((c) => c.name === name);
}

function resolveTime(curve: CurveDefinition, time: number, options?: EvaluateOptions): number {
  if (options?.normalized && curve.keys.length >= 2) {
    const first = curve.keys[0].time;
    const last = curve.keys[curve.keys.length - 1].time;
    return first + time * (last - first);
  }
  return time;
}

function componentCount(type: string): number {
  switch (type) {
    case 'vec2': return 2;
    case 'vec3': return 3;
    case 'vec4': case 'color': return 4;
    default: return 1;
  }
}

function getScalar(value: number | number[], component?: number): number {
  if (typeof value === 'number') return value;
  if (component !== undefined) return value[component] ?? 0;
  return value[0] ?? 0;
}

function getTangent(
  key: KeyFrame,
  which: 'in' | 'out',
  component?: number
): TangentHandle {
  const raw = which === 'in' ? key.tangentIn : key.tangentOut;
  if (!raw) return { dx: which === 'in' ? -0.1 : 0.1, dy: 0 };
  if (Array.isArray(raw)) {
    return raw[component ?? 0] || { dx: which === 'in' ? -0.1 : 0.1, dy: 0 };
  }
  return raw;
}

function computeAutoTangents(
  keys: KeyFrame[],
  i: number,
  component?: number
): { tangentIn: TangentHandle; tangentOut: TangentHandle } {
  const key = keys[i];
  const value = getScalar(key.value, component);
  const hasPrev = i > 0;
  const hasNext = i < keys.length - 1;

  if (!hasPrev && !hasNext) {
    return { tangentIn: { dx: -0.1, dy: 0 }, tangentOut: { dx: 0.1, dy: 0 } };
  }

  if (!hasPrev) {
    const next = keys[i + 1];
    const nextVal = getScalar(next.value, component);
    const slope = (nextVal - value) / (next.time - key.time);
    const dx = (next.time - key.time) / 3;
    return { tangentIn: { dx: -dx, dy: -slope * dx }, tangentOut: { dx, dy: slope * dx } };
  }

  if (!hasNext) {
    const prev = keys[i - 1];
    const prevVal = getScalar(prev.value, component);
    const slope = (value - prevVal) / (key.time - prev.time);
    const dx = (key.time - prev.time) / 3;
    return { tangentIn: { dx: -dx, dy: -slope * dx }, tangentOut: { dx, dy: slope * dx } };
  }

  const prev = keys[i - 1];
  const next = keys[i + 1];
  const prevVal = getScalar(prev.value, component);
  const nextVal = getScalar(next.value, component);
  const slope = (nextVal - prevVal) / (next.time - prev.time);
  const dxOut = (next.time - key.time) / 3;
  const dxIn = -(key.time - prev.time) / 3;

  return {
    tangentIn: { dx: dxIn, dy: slope * dxIn },
    tangentOut: { dx: dxOut, dy: slope * dxOut },
  };
}

function getEffectiveTangent(
  keys: KeyFrame[],
  i: number,
  which: 'in' | 'out',
  component?: number
): TangentHandle {
  const key = keys[i];
  if (key.tangentMode === 'auto' || (!key.tangentIn && !key.tangentOut)) {
    const auto = computeAutoTangents(keys, i, component);
    return which === 'in' ? auto.tangentIn : auto.tangentOut;
  }
  return getTangent(key, which, component);
}

// ── Bezier Evaluation ──

function cubicBezier(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function cubicBezierDeriv(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const mt = 1 - t;
  return 3 * mt * mt * (p1 - p0) + 6 * mt * t * (p2 - p1) + 3 * t * t * (p3 - p2);
}

function solveBezierT(x: number, x0: number, x1: number, x2: number, x3: number): number {
  if (x <= x0) return 0;
  if (x >= x3) return 1;

  let t = (x - x0) / (x3 - x0);

  for (let i = 0; i < 8; i++) {
    const cx = cubicBezier(t, x0, x1, x2, x3);
    const err = cx - x;
    if (Math.abs(err) < 1e-7) return t;
    const dx = cubicBezierDeriv(t, x0, x1, x2, x3);
    if (Math.abs(dx) < 1e-10) break;
    t -= err / dx;
    t = Math.max(0, Math.min(1, t));
  }

  // Bisection fallback
  let lo = 0, hi = 1;
  t = 0.5;
  for (let i = 0; i < 20; i++) {
    const cx = cubicBezier(t, x0, x1, x2, x3);
    if (Math.abs(cx - x) < 1e-7) return t;
    if (cx < x) lo = t; else hi = t;
    t = (lo + hi) / 2;
  }
  return t;
}

// ── Scalar Evaluation ──

function evaluateScalar(keys: KeyFrame[], time: number, component?: number): number {
  if (keys.length === 0) return 0;
  if (keys.length === 1) return getScalar(keys[0].value, component);

  if (time <= keys[0].time) return getScalar(keys[0].value, component);
  if (time >= keys[keys.length - 1].time) return getScalar(keys[keys.length - 1].value, component);

  // Find the segment
  let idx = 0;
  for (let i = 0; i < keys.length - 1; i++) {
    if (time >= keys[i].time && time <= keys[i + 1].time) {
      idx = i;
      break;
    }
  }

  const k0 = keys[idx];
  const k1 = keys[idx + 1];
  const v0 = getScalar(k0.value, component);
  const v1 = getScalar(k1.value, component);

  if (k0.interp === 'constant') {
    return v0;
  }

  if (k0.interp === 'linear') {
    const t = (time - k0.time) / (k1.time - k0.time);
    return v0 + (v1 - v0) * t;
  }

  // Bezier
  const tanOut = getEffectiveTangent(keys, idx, 'out', component);
  const tanIn = getEffectiveTangent(keys, idx + 1, 'in', component);

  const px0 = k0.time;
  const py0 = v0;
  const px1 = k0.time + tanOut.dx;
  const py1 = v0 + tanOut.dy;
  const px2 = k1.time + tanIn.dx;
  const py2 = v1 + tanIn.dy;
  const px3 = k1.time;
  const py3 = v1;

  const t = solveBezierT(time, px0, px1, px2, px3);
  return cubicBezier(t, py0, py1, py2, py3);
}

function evaluateInt(keys: KeyFrame[], time: number): number {
  if (keys.length === 0) return 0;
  if (keys.length === 1) return Math.round(keys[0].value as number);

  if (time <= keys[0].time) return Math.round(keys[0].value as number);
  if (time >= keys[keys.length - 1].time) return Math.round(keys[keys.length - 1].value as number);

  let idx = 0;
  for (let i = 0; i < keys.length - 1; i++) {
    if (time >= keys[i].time && time <= keys[i + 1].time) { idx = i; break; }
  }

  const k0 = keys[idx];
  const k1 = keys[idx + 1];
  const v0 = k0.value as number;
  const v1 = k1.value as number;

  if (k0.interp === 'constant') return v0;
  if (k0.interp === 'linear') {
    const t = (time - k0.time) / (k1.time - k0.time);
    return Math.round(v0 + (v1 - v0) * t);
  }
  return Math.round(v0);
}

function evaluateConstantInt(keys: KeyFrame[], time: number): number {
  if (keys.length === 0) return 0;
  if (time <= keys[0].time) return keys[0].value as number;

  for (let i = keys.length - 1; i >= 0; i--) {
    if (time >= keys[i].time) return keys[i].value as number;
  }
  return keys[0].value as number;
}

// ── Infinity Remapping ──

function remapInfinity(curve: CurveDefinition, time: number): number {
  const keys = curve.keys;
  if (keys.length < 2) return time;

  const first = keys[0].time;
  const last = keys[keys.length - 1].time;
  const range = last - first;
  if (range <= 0) return time;

  if (time < first) {
    const mode = curve.preInfinity || 'constant';
    return applyInfinityMode(mode, time, first, last, range, true);
  }

  if (time > last) {
    const mode = curve.postInfinity || 'constant';
    return applyInfinityMode(mode, time, first, last, range, false);
  }

  return time;
}

function applyInfinityMode(
  mode: string,
  time: number,
  first: number,
  last: number,
  range: number,
  isPre: boolean
): number {
  switch (mode) {
    case 'constant':
      return isPre ? first : last;

    case 'linear':
      return time;

    case 'cycle': {
      const offset = time - first;
      const mod = ((offset % range) + range) % range;
      return first + mod;
    }

    case 'oscillate': {
      const offset = time - first;
      const period = 2 * range;
      const mod = ((offset % period) + period) % period;
      if (mod <= range) {
        return first + mod;
      }
      return last - (mod - range);
    }

    default:
      return isPre ? first : last;
  }
}
