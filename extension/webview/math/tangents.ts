/**
 * Auto-tangent calculation using Catmull-Rom splines (spec §5.2).
 */

import { TangentHandle, KeyFrame } from '../../src/protocol';

/**
 * Compute auto tangents for a key at index `i` in a sorted key array.
 * Returns { tangentIn, tangentOut } for a scalar value.
 */
export function computeAutoTangents(
  keys: KeyFrame[],
  i: number,
  component?: number
): { tangentIn: TangentHandle; tangentOut: TangentHandle } {
  const key = keys[i];
  const value = getScalarValue(key.value, component);

  const hasPrev = i > 0;
  const hasNext = i < keys.length - 1;

  if (!hasPrev && !hasNext) {
    return {
      tangentIn: { dx: -0.1, dy: 0 },
      tangentOut: { dx: 0.1, dy: 0 },
    };
  }

  if (!hasPrev) {
    const next = keys[i + 1];
    const nextVal = getScalarValue(next.value, component);
    const slope = (nextVal - value) / (next.time - key.time);
    const dx = (next.time - key.time) / 3;
    return {
      tangentIn: { dx: -dx, dy: -slope * dx },
      tangentOut: { dx, dy: slope * dx },
    };
  }

  if (!hasNext) {
    const prev = keys[i - 1];
    const prevVal = getScalarValue(prev.value, component);
    const slope = (value - prevVal) / (key.time - prev.time);
    const dx = (key.time - prev.time) / 3;
    return {
      tangentIn: { dx: -dx, dy: -slope * dx },
      tangentOut: { dx, dy: slope * dx },
    };
  }

  const prev = keys[i - 1];
  const next = keys[i + 1];
  const prevVal = getScalarValue(prev.value, component);
  const nextVal = getScalarValue(next.value, component);

  const slope = (nextVal - prevVal) / (next.time - prev.time);

  const dxOut = (next.time - key.time) / 3;
  const dxIn = -(key.time - prev.time) / 3;

  return {
    tangentIn: { dx: dxIn, dy: slope * dxIn },
    tangentOut: { dx: dxOut, dy: slope * dxOut },
  };
}

/**
 * Get the effective tangent handles for a key, computing auto tangents if needed.
 */
export function getEffectiveTangents(
  keys: KeyFrame[],
  i: number,
  component?: number
): { tangentIn: TangentHandle; tangentOut: TangentHandle } {
  const key = keys[i];

  if (key.tangentMode === 'auto' || (!key.tangentIn && !key.tangentOut)) {
    return computeAutoTangents(keys, i, component);
  }

  let tangentIn: TangentHandle;
  let tangentOut: TangentHandle;

  if (component !== undefined && Array.isArray(key.tangentIn)) {
    tangentIn = (key.tangentIn as TangentHandle[])[component] || { dx: -0.1, dy: 0 };
  } else {
    tangentIn = (key.tangentIn as TangentHandle) || { dx: -0.1, dy: 0 };
  }

  if (component !== undefined && Array.isArray(key.tangentOut)) {
    tangentOut = (key.tangentOut as TangentHandle[])[component] || { dx: 0.1, dy: 0 };
  } else {
    tangentOut = (key.tangentOut as TangentHandle) || { dx: 0.1, dy: 0 };
  }

  if (key.tangentMode === 'aligned') {
    const slope = tangentOut.dx !== 0 ? tangentOut.dy / tangentOut.dx : 0;
    tangentIn = {
      dx: -Math.abs(tangentIn.dx),
      dy: -slope * Math.abs(tangentIn.dx),
    };
  }

  return { tangentIn, tangentOut };
}

function getScalarValue(value: number | number[], component?: number): number {
  if (typeof value === 'number') return value;
  if (component !== undefined) return value[component] ?? 0;
  return value[0] ?? 0;
}

/**
 * Flatten tangents — set dy to 0 for both handles.
 */
export function flattenTangent(handle: TangentHandle): TangentHandle {
  return { dx: handle.dx, dy: 0 };
}
