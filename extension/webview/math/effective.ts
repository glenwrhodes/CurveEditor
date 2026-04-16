/**
 * Resolve effective interpolation and tangent mode for a key,
 * taking per-component overrides into account.
 */

import { KeyFrame, InterpolationMode, TangentMode } from '../../src/protocol';

export function getEffectiveInterp(key: KeyFrame, component?: number): InterpolationMode {
  if (component !== undefined && key.componentInterp && key.componentInterp[component]) {
    return key.componentInterp[component];
  }
  return key.interp;
}

export function getEffectiveTangentMode(key: KeyFrame, component?: number): TangentMode {
  if (component !== undefined && key.componentTangentMode && key.componentTangentMode[component]) {
    return key.componentTangentMode[component];
  }
  return key.tangentMode || 'auto';
}

/**
 * Apply an interpolation change to a key, writing to the per-component slot
 * when `activeComponent` is set, otherwise setting the default and clearing overrides.
 */
export function applyInterpToKey(
  key: KeyFrame,
  interp: InterpolationMode,
  componentCount: number,
  activeComponent: number | null
): KeyFrame {
  const newKey: KeyFrame = JSON.parse(JSON.stringify(key));

  if (activeComponent !== null && componentCount > 1) {
    const arr = newKey.componentInterp ? [...newKey.componentInterp] : [];
    while (arr.length < componentCount) {
      arr.push(newKey.interp);
    }
    arr[activeComponent] = interp;
    newKey.componentInterp = arr;
  } else {
    newKey.interp = interp;
    delete newKey.componentInterp;
  }

  return newKey;
}

export function applyTangentModeToKey(
  key: KeyFrame,
  tangentMode: TangentMode,
  componentCount: number,
  activeComponent: number | null
): KeyFrame {
  const newKey: KeyFrame = JSON.parse(JSON.stringify(key));

  if (activeComponent !== null && componentCount > 1) {
    const arr = newKey.componentTangentMode ? [...newKey.componentTangentMode] : [];
    const defaultMode = newKey.tangentMode || 'auto';
    while (arr.length < componentCount) {
      arr.push(defaultMode);
    }
    arr[activeComponent] = tangentMode;
    newKey.componentTangentMode = arr;
  } else {
    newKey.tangentMode = tangentMode;
    delete newKey.componentTangentMode;
  }

  return newKey;
}

export function getComponentCount(curveType: string): number {
  switch (curveType) {
    case 'vec2': return 2;
    case 'vec3': return 3;
    case 'vec4': case 'color': return 4;
    default: return 1;
  }
}
