import { EditorState } from '../state/EditorState';
import { KeyFrame, JsonPatchOp, InterpolationMode, TangentMode, TangentHandle } from '../../src/protocol';
import {
  getEffectiveInterp,
  getEffectiveTangentMode,
  applyInterpToKey,
  applyTangentModeToKey,
  getComponentCount,
} from '../math/effective';

type PostEditFn = (ops: JsonPatchOp[]) => void;

export class KeyInspector {
  private container: HTMLElement;
  private contentEl: HTMLElement;

  constructor(
    parent: HTMLElement,
    private state: EditorState,
    private postEdit: PostEditFn
  ) {
    this.container = document.createElement('div');
    this.container.className = 'key-inspector';
    this.container.setAttribute('role', 'region');
    this.container.setAttribute('aria-label', 'Key inspector panel');
    parent.appendChild(this.container);

    const title = document.createElement('div');
    title.className = 'inspector-title';
    title.textContent = 'Key Inspector';
    this.container.appendChild(title);

    this.contentEl = document.createElement('div');
    this.contentEl.className = 'inspector-content';
    this.container.appendChild(this.contentEl);

    state.onChange(() => this.update());
    this.update();
  }

  private update(): void {
    const { state } = this;
    const keys = state.selectedKeys;

    // Only preserve focus for the native color picker — rebuilding would close it.
    // Other inputs (text fields, selects) are fine to rebuild because clicking a
    // different keyframe means the user wants to see that new key's values.
    const active = document.activeElement as HTMLElement | null;
    if (
      active &&
      this.contentEl.contains(active) &&
      active instanceof HTMLInputElement &&
      active.type === 'color'
    ) {
      return;
    }

    this.contentEl.innerHTML = '';

    if (keys.length === 0) {
      this.renderEmpty();
      return;
    }

    if (keys.length === 1) {
      this.renderSingleKey(keys[0]);
    } else {
      this.renderMultiKey(keys);
    }
  }

  /** Render placeholder fields so the panel's height stays the same
   *  regardless of whether a key is selected. */
  private renderEmpty(): void {
    const grid = document.createElement('div');
    grid.className = 'inspector-grid inspector-empty';

    const addDisabledField = (label: string) => {
      const group = document.createElement('div');
      group.className = 'inspector-field';

      const lbl = document.createElement('label');
      lbl.className = 'inspector-label';
      lbl.textContent = label;
      group.appendChild(lbl);

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'inspector-input';
      input.disabled = true;
      input.placeholder = '—';
      group.appendChild(input);
      grid.appendChild(group);
    };

    addDisabledField('Time');
    addDisabledField('Value');

    const addDisabledSelect = (label: string) => {
      const group = document.createElement('div');
      group.className = 'inspector-field';

      const lbl = document.createElement('label');
      lbl.className = 'inspector-label';
      lbl.textContent = label;
      group.appendChild(lbl);

      const sel = document.createElement('select');
      sel.className = 'inspector-select';
      sel.disabled = true;
      group.appendChild(sel);
      grid.appendChild(group);
    };

    addDisabledSelect('Interp');
    addDisabledSelect('Tangent');

    this.contentEl.appendChild(grid);

    // Pad out the height to match the typical selected-key layout
    // (which includes the tangent handles row below the main grid).
    const pad = document.createElement('div');
    pad.className = 'inspector-tangent-section inspector-empty-pad';
    pad.style.visibility = 'hidden';
    pad.textContent = 'placeholder';
    this.contentEl.appendChild(pad);

    const hint = document.createElement('div');
    hint.className = 'inspector-empty-hint';
    hint.textContent = 'Select a keyframe to edit';
    this.contentEl.appendChild(hint);
  }

  private renderSingleKey(sk: { curveIndex: number; keyIndex: number }): void {
    const { state } = this;
    const key = state.getKey(sk.curveIndex, sk.keyIndex);
    const curve = state.doc.curves[sk.curveIndex];
    const isColor = curve.type === 'color';
    const isVec = ['vec2', 'vec3', 'vec4', 'color'].includes(curve.type);
    const isStateCurve = curve.type === 'int' && !!curve.states;

    const grid = document.createElement('div');
    grid.className = 'inspector-grid';

    // Time field
    this.addInputField(grid, 'Time', key.time.toFixed(4), (val) => {
      const numVal = parseFloat(val);
      if (!isNaN(numVal)) {
        this.postEdit([{ op: 'replace', path: `/curves/${sk.curveIndex}/keys/${sk.keyIndex}/time`, value: numVal }]);
      }
    });

    // Value field(s)
    if (isStateCurve) {
      const labels = curve.states!.labels || [];
      const options = Array.from({ length: curve.states!.count }, (_, i) => ({
        label: labels[i] || String(i),
        value: String(i),
      }));
      this.addSelectField(grid, 'State', String(key.value), options, (val) => {
        this.postEdit([{ op: 'replace', path: `/curves/${sk.curveIndex}/keys/${sk.keyIndex}/value`, value: parseInt(val) }]);
      });
    } else if (isVec) {
      const values = key.value as number[];
      const compNames = isColor ? ['R', 'G', 'B', 'A'] : ['X', 'Y', 'Z', 'W'].slice(0, values.length);

      if (state.activeComponent !== null && state.activeComponent < values.length) {
        // Show only the active component's value field. This matches the "Editing:" scope
        // so what you edit is clearly tied to the component you clicked.
        const ci = state.activeComponent;
        this.addInputField(grid, compNames[ci], values[ci].toFixed(4), (val) => {
          const numVal = parseFloat(val);
          if (!isNaN(numVal)) {
            const newValues = [...values];
            newValues[ci] = numVal;
            this.postEdit([{ op: 'replace', path: `/curves/${sk.curveIndex}/keys/${sk.keyIndex}/value`, value: newValues }]);
          }
        });
      } else {
        // No active component — show all components so bulk editing is still easy
        for (let ci = 0; ci < values.length; ci++) {
          this.addInputField(grid, compNames[ci], values[ci].toFixed(4), (val) => {
            const numVal = parseFloat(val);
            if (!isNaN(numVal)) {
              const newValues = [...values];
              newValues[ci] = numVal;
              this.postEdit([{ op: 'replace', path: `/curves/${sk.curveIndex}/keys/${sk.keyIndex}/value`, value: newValues }]);
            }
          });
        }
      }
    } else {
      this.addInputField(grid, 'Value', (key.value as number).toFixed(4), (val) => {
        const numVal = parseFloat(val);
        if (!isNaN(numVal)) {
          this.postEdit([{ op: 'replace', path: `/curves/${sk.curveIndex}/keys/${sk.keyIndex}/value`, value: numVal }]);
        }
      });
    }

    // Color swatch + hex input for color curves
    if (isColor) {
      const values = key.value as number[];
      const hexColor = rgbaToHex(values[0], values[1], values[2]);

      const colorGroup = document.createElement('div');
      colorGroup.className = 'color-picker-wrapper';

      const swatch = document.createElement('input');
      swatch.type = 'color';
      swatch.className = 'color-swatch-btn';
      swatch.value = hexColor;
      swatch.setAttribute('aria-label', 'Color picker');
      // Use 'change' instead of 'input' so commits happen when the picker closes.
      // The 'input' event fires continuously while the user drags, which causes
      // the inspector to rebuild and the native picker to close prematurely.
      swatch.addEventListener('change', () => {
        const [r, g, b] = hexToRgb(swatch.value);
        const newValues = [r, g, b, values[3]];
        this.postEdit([{ op: 'replace', path: `/curves/${sk.curveIndex}/keys/${sk.keyIndex}/value`, value: newValues }]);
      });
      colorGroup.appendChild(swatch);

      const hexInput = document.createElement('input');
      hexInput.type = 'text';
      hexInput.className = 'color-hex-input';
      hexInput.value = hexColor;
      hexInput.setAttribute('aria-label', 'Hex color value');
      hexInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const [r, g, b] = hexToRgb(hexInput.value);
          const newValues = [r, g, b, values[3]];
          this.postEdit([{ op: 'replace', path: `/curves/${sk.curveIndex}/keys/${sk.keyIndex}/value`, value: newValues }]);
          hexInput.blur();
        }
        e.stopPropagation();
      });
      colorGroup.appendChild(hexInput);

      grid.appendChild(colorGroup);
    }

    // Per-component awareness: if an activeComponent is set on a vec/color curve,
    // show and edit that component's effective values. Otherwise edit the default.
    const isVecOrColor = isVec || isColor;
    const activeComp = isVecOrColor ? state.activeComponent : null;

    if (isVecOrColor) {
      const scopeLabel = document.createElement('div');
      scopeLabel.className = 'inspector-scope-label';
      if (activeComp !== null) {
        const compNames = isColor ? ['R', 'G', 'B', 'A'] : ['X', 'Y', 'Z', 'W'];
        scopeLabel.textContent = `Editing: ${compNames[activeComp] || `component ${activeComp}`}`;
      } else {
        scopeLabel.textContent = 'Editing: all components';
      }
      grid.appendChild(scopeLabel);
    }

    const effInterp = getEffectiveInterp(key, activeComp ?? undefined);
    const effTangentMode = getEffectiveTangentMode(key, activeComp ?? undefined);
    const componentCount = getComponentCount(curve.type);

    // Interpolation
    this.addSelectField(grid, 'Interp', effInterp, [
      { label: 'Bezier', value: 'bezier' },
      { label: 'Linear', value: 'linear' },
      { label: 'Constant', value: 'constant' },
    ], (val) => {
      const newKey = applyInterpToKey(key, val as InterpolationMode, componentCount, activeComp);
      this.postEdit([{ op: 'replace', path: `/curves/${sk.curveIndex}/keys/${sk.keyIndex}`, value: newKey }]);
    });

    // Tangent mode
    this.addSelectField(grid, 'Tangent', effTangentMode, [
      { label: 'Auto', value: 'auto' },
      { label: 'User', value: 'user' },
      { label: 'Break', value: 'break' },
      { label: 'Aligned', value: 'aligned' },
    ], (val) => {
      const newKey = applyTangentModeToKey(key, val as TangentMode, componentCount, activeComp);
      this.postEdit([{ op: 'replace', path: `/curves/${sk.curveIndex}/keys/${sk.keyIndex}`, value: newKey }]);
    });

    this.contentEl.appendChild(grid);

    // Tangent handles are only shown when the effective interp for the scope is bezier.
    // For vec/color with an active component, we show that component's tangent values.
    // When activeComp is null on a vec/color, we show component 0 as a representative view.
    if (effInterp === 'bezier') {
      const tangentScopeComp = activeComp;

      const tanIn = this.getTangent(key, 'in', tangentScopeComp ?? 0);
      const tanOut = this.getTangent(key, 'out', tangentScopeComp ?? 0);

      const tanSection = document.createElement('div');
      tanSection.className = 'inspector-tangent-section';

      const inLabel = document.createElement('span');
      inLabel.className = 'inspector-section-label';
      inLabel.textContent = 'Tan In:';
      tanSection.appendChild(inLabel);

      const inRow = document.createElement('div');
      inRow.className = 'inspector-row';
      this.addInputField(inRow, 'dx', tanIn.dx.toFixed(4), (val) => {
        const numVal = parseFloat(val);
        if (!isNaN(numVal)) {
          this.writeTangent(sk, 'in', { dx: numVal, dy: tanIn.dy }, tangentScopeComp, componentCount);
        }
      });
      this.addInputField(inRow, 'dy', tanIn.dy.toFixed(4), (val) => {
        const numVal = parseFloat(val);
        if (!isNaN(numVal)) {
          this.writeTangent(sk, 'in', { dx: tanIn.dx, dy: numVal }, tangentScopeComp, componentCount);
        }
      });
      tanSection.appendChild(inRow);

      const outLabel = document.createElement('span');
      outLabel.className = 'inspector-section-label';
      outLabel.textContent = 'Tan Out:';
      tanSection.appendChild(outLabel);

      const outRow = document.createElement('div');
      outRow.className = 'inspector-row';
      this.addInputField(outRow, 'dx', tanOut.dx.toFixed(4), (val) => {
        const numVal = parseFloat(val);
        if (!isNaN(numVal)) {
          this.writeTangent(sk, 'out', { dx: numVal, dy: tanOut.dy }, tangentScopeComp, componentCount);
        }
      });
      this.addInputField(outRow, 'dy', tanOut.dy.toFixed(4), (val) => {
        const numVal = parseFloat(val);
        if (!isNaN(numVal)) {
          this.writeTangent(sk, 'out', { dx: tanOut.dx, dy: numVal }, tangentScopeComp, componentCount);
        }
      });
      tanSection.appendChild(outRow);

      this.contentEl.appendChild(tanSection);
    }
  }

  private renderMultiKey(keys: { curveIndex: number; keyIndex: number }[]): void {
    const { state } = this;
    const grid = document.createElement('div');
    grid.className = 'inspector-grid';

    // Time: mixed
    const timeField = this.addInputField(grid, 'Time', '(mixed)', () => {});
    timeField.disabled = true;

    // Value: mixed
    const valField = this.addInputField(grid, 'Value', '(mixed)', () => {});
    valField.disabled = true;

    // Interp: if all same, show it (uses effective interp based on activeComponent)
    const activeComp = state.activeComponent;
    const interps = new Set(
      keys.map((sk) => getEffectiveInterp(state.getKey(sk.curveIndex, sk.keyIndex), activeComp ?? undefined))
    );
    this.addSelectField(grid, 'Interp', interps.size === 1 ? interps.values().next().value! : '', [
      { label: 'Bezier', value: 'bezier' },
      { label: 'Linear', value: 'linear' },
      { label: 'Constant', value: 'constant' },
    ], (val) => {
      const ops = keys.map((sk) => {
        const curve = state.doc.curves[sk.curveIndex];
        const key = curve.keys[sk.keyIndex];
        const newKey = applyInterpToKey(
          key,
          val as InterpolationMode,
          getComponentCount(curve.type),
          activeComp
        );
        return {
          op: 'replace' as const,
          path: `/curves/${sk.curveIndex}/keys/${sk.keyIndex}`,
          value: newKey,
        };
      });
      this.postEdit(ops);
    });

    // Tangent mode
    const tangentModes = new Set(
      keys.map((sk) => getEffectiveTangentMode(state.getKey(sk.curveIndex, sk.keyIndex), activeComp ?? undefined))
    );
    this.addSelectField(grid, 'Tangent', tangentModes.size === 1 ? tangentModes.values().next().value! : '', [
      { label: 'Auto', value: 'auto' },
      { label: 'User', value: 'user' },
      { label: 'Break', value: 'break' },
      { label: 'Aligned', value: 'aligned' },
    ], (val) => {
      const ops = keys.map((sk) => {
        const curve = state.doc.curves[sk.curveIndex];
        const key = curve.keys[sk.keyIndex];
        const newKey = applyTangentModeToKey(
          key,
          val as TangentMode,
          getComponentCount(curve.type),
          activeComp
        );
        return {
          op: 'replace' as const,
          path: `/curves/${sk.curveIndex}/keys/${sk.keyIndex}`,
          value: newKey,
        };
      });
      this.postEdit(ops);
    });

    const info = document.createElement('div');
    info.style.fontSize = '11px';
    info.style.opacity = '0.5';
    info.style.padding = '4px 0';
    info.textContent = `${keys.length} keys selected`;
    grid.appendChild(info);

    this.contentEl.appendChild(grid);
  }

  private addInputField(
    parent: HTMLElement,
    label: string,
    value: string,
    onCommit: (val: string) => void
  ): HTMLInputElement {
    const group = document.createElement('div');
    group.className = 'inspector-field';

    const lbl = document.createElement('label');
    lbl.className = 'inspector-label';
    lbl.textContent = label;
    group.appendChild(lbl);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inspector-input';
    input.value = value;
    input.setAttribute('aria-label', label);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { onCommit(input.value); input.blur(); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const step = e.shiftKey ? 0.1 : 0.01;
        const delta = e.key === 'ArrowUp' ? step : -step;
        const current = parseFloat(input.value) || 0;
        input.value = (current + delta).toFixed(4);
        onCommit(input.value);
      }
      e.stopPropagation();
    });
    input.addEventListener('blur', () => onCommit(input.value));

    group.appendChild(input);
    parent.appendChild(group);
    return input;
  }

  private addSelectField(
    parent: HTMLElement,
    label: string,
    value: string,
    options: { label: string; value: string }[],
    onChange: (val: string) => void
  ): HTMLSelectElement {
    const group = document.createElement('div');
    group.className = 'inspector-field';

    const lbl = document.createElement('label');
    lbl.className = 'inspector-label';
    lbl.textContent = label;
    group.appendChild(lbl);

    const select = document.createElement('select');
    select.className = 'inspector-select';
    select.setAttribute('aria-label', label);
    for (const opt of options) {
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.label;
      select.appendChild(el);
    }
    select.value = value;
    select.addEventListener('change', () => onChange(select.value));

    group.appendChild(select);
    parent.appendChild(group);
    return select;
  }

  private getTangent(key: KeyFrame, which: 'in' | 'out', component?: number): TangentHandle {
    const tangent = which === 'in' ? key.tangentIn : key.tangentOut;
    const fallback = { dx: which === 'in' ? -0.1 : 0.1, dy: 0 };
    if (!tangent) return fallback;
    if (Array.isArray(tangent)) {
      const idx = component ?? 0;
      return tangent[idx] || fallback;
    }
    return tangent;
  }

  /** Write a single tangent value back to the key, preserving per-component
   *  arrays for vec/color curves. */
  private writeTangent(
    sk: { curveIndex: number; keyIndex: number },
    which: 'in' | 'out',
    newHandle: TangentHandle,
    component: number | null,
    componentCount: number
  ): void {
    const curve = this.state.doc.curves[sk.curveIndex];
    const key = curve.keys[sk.keyIndex];
    const newKey: KeyFrame = JSON.parse(JSON.stringify(key));
    const field = which === 'in' ? 'tangentIn' : 'tangentOut';

    if (component !== null && componentCount > 1) {
      // Per-component: materialize array if needed, update just the slot
      const existing = newKey[field];
      const arr: TangentHandle[] = Array.isArray(existing)
        ? [...existing]
        : new Array(componentCount).fill(0).map(() =>
            existing ? { ...(existing as TangentHandle) } : { dx: which === 'in' ? -0.1 : 0.1, dy: 0 }
          );
      while (arr.length < componentCount) {
        arr.push({ dx: which === 'in' ? -0.1 : 0.1, dy: 0 });
      }
      arr[component] = newHandle;
      newKey[field] = arr;
    } else {
      newKey[field] = newHandle;
    }

    // Auto tangent mode no longer applies once the user edits by hand
    if (newKey.tangentMode === 'auto') newKey.tangentMode = 'user';

    this.postEdit([{ op: 'replace', path: `/curves/${sk.curveIndex}/keys/${sk.keyIndex}`, value: newKey }]);
  }
}

function rgbaToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6) return [1, 1, 1];
  const r = parseInt(cleaned.substring(0, 2), 16) / 255;
  const g = parseInt(cleaned.substring(2, 4), 16) / 255;
  const b = parseInt(cleaned.substring(4, 6), 16) / 255;
  return [r, g, b];
}
