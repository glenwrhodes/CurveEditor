import { EditorState, SelectedKey } from '../state/EditorState';
import { CurveCanvas } from './CurveCanvas';
import { hitTestKeys, hitTestTangents } from './KeyRenderer';
import {
  screenToCurveX,
  screenToCurveY,
  curveToScreenX,
  curveToScreenY,
  zoomAt,
  pan,
  frameRegion,
} from '../math/transforms';
import { getEffectiveTangents } from '../math/tangents';
import { applyInterpToKey, applyTangentModeToKey, getComponentCount } from '../math/effective';
import { KeyFrame, TangentHandle, JsonPatchOp, CurveDefinition, InterpolationMode, TangentMode } from '../../src/protocol';
import { ContextMenu } from '../panels/ContextMenu';

type PostEditFn = (ops: JsonPatchOp[]) => void;

const CONSTRAIN_THRESHOLD = 5;

export class InteractionHandler {
  private canvas: HTMLCanvasElement;
  private postEdit: PostEditFn;
  private disposed = false;
  private boundHandlers: { event: string; handler: (e: any) => void }[] = [];

  constructor(
    private curveCanvas: CurveCanvas,
    private state: EditorState,
    postEdit: PostEditFn
  ) {
    this.canvas = curveCanvas.getCanvas();
    this.postEdit = postEdit;
    this.attach();
  }

  private on(el: HTMLElement | Window, event: string, handler: (e: any) => void): void {
    el.addEventListener(event, handler);
    this.boundHandlers.push({ event, handler });
  }

  private attach(): void {
    this.on(this.canvas, 'mousedown', (e: MouseEvent) => this.onMouseDown(e));
    this.on(this.canvas, 'mousemove', (e: MouseEvent) => this.onMouseMove(e));
    this.on(this.canvas, 'mouseup', (e: MouseEvent) => this.onMouseUp(e));
    this.on(this.canvas, 'dblclick', (e: MouseEvent) => this.onDoubleClick(e));
    this.on(this.canvas, 'wheel', (e: WheelEvent) => this.onWheel(e));
    this.on(this.canvas, 'contextmenu', (e: MouseEvent) => this.onContextMenu(e));
    this.on(window as any, 'keydown', (e: KeyboardEvent) => this.onKeyDown(e));
  }

  private getCanvasPos(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // ── Mouse Down ──

  private onMouseDown(e: MouseEvent): void {
    const pos = this.getCanvasPos(e);
    const { state } = this;

    // Middle mouse or alt+right: pan
    if (e.button === 1 || (e.button === 2 && e.altKey)) {
      state.drag = {
        type: 'pan',
        startScreenX: pos.x,
        startScreenY: pos.y,
        currentScreenX: pos.x,
        currentScreenY: pos.y,
        shiftHeld: false,
      };
      e.preventDefault();
      return;
    }

    if (e.button !== 0) return;

    // Check tangent handle hit first (only for selected keys on unlocked curves)
    const tangentHit = hitTestTangents(state, pos.x, pos.y, 1);
    if (tangentHit && !state.isCurveLocked(tangentHit.curveIndex)) {
      const key = state.getKey(tangentHit.curveIndex, tangentHit.keyIndex);
      state.drag = {
        type: tangentHit.which === 'in' ? 'tangentIn' : 'tangentOut',
        startScreenX: pos.x,
        startScreenY: pos.y,
        currentScreenX: pos.x,
        currentScreenY: pos.y,
        shiftHeld: e.shiftKey,
        originalKeys: [JSON.parse(JSON.stringify(key))],
        tangentComponent: tangentHit.component,
      };
      state.markDirty();
      return;
    }

    // Check keyframe hit
    const keyHit = hitTestKeys(state, pos.x, pos.y, 1);
    if (keyHit) {
      const isAlreadySelected = state.isKeySelected(keyHit.curveIndex, keyHit.keyIndex);

      if (e.ctrlKey || e.metaKey) {
        state.selectKey(keyHit.curveIndex, keyHit.keyIndex, true);
      } else if (!isAlreadySelected) {
        state.selectKey(keyHit.curveIndex, keyHit.keyIndex, false);
      }

      // Also select the curve in the left panel so the user sees what they're editing
      if (!e.ctrlKey && !e.metaKey) {
        state.selectedCurves.clear();
      }
      state.selectedCurves.add(keyHit.curveIndex);

      // Snapshot for drag
      const originals = state.selectedKeys.map((sk) =>
        JSON.parse(JSON.stringify(state.doc.curves[sk.curveIndex].keys[sk.keyIndex]))
      );

      state.drag = {
        type: 'key',
        startScreenX: pos.x,
        startScreenY: pos.y,
        currentScreenX: pos.x,
        currentScreenY: pos.y,
        shiftHeld: e.shiftKey,
        constrainAxis: null,
        originalKeys: originals,
        dragComponent: keyHit.component ?? state.activeComponent ?? undefined,
      };
      state.markDirty();
      return;
    }

    // Click on empty space — start marquee or deselect
    if (!e.ctrlKey && !e.metaKey) {
      state.deselectAll();
    }
    state.drag = {
      type: 'marquee',
      startScreenX: pos.x,
      startScreenY: pos.y,
      currentScreenX: pos.x,
      currentScreenY: pos.y,
      shiftHeld: e.shiftKey,
    };
    state.markDirty();
  }

  // ── Mouse Move ──

  private onMouseMove(e: MouseEvent): void {
    const pos = this.getCanvasPos(e);
    const { state } = this;

    if (state.drag.type === 'none') {
      // Hover detection
      const tangentHit = hitTestTangents(state, pos.x, pos.y, 1);
      const keyHit = hitTestKeys(state, pos.x, pos.y, 1);

      const prevHover = state.hoveredKey;
      const prevTHover = state.hoveredTangent;
      state.hoveredTangent = tangentHit;
      state.hoveredKey = keyHit ? { curveIndex: keyHit.curveIndex, keyIndex: keyHit.keyIndex } : null;

      if (state.hoveredKey !== prevHover || state.hoveredTangent !== prevTHover) {
        state.markDirty();
      }

      this.canvas.style.cursor = tangentHit ? 'grab' : keyHit ? 'pointer' : 'default';
      return;
    }

    state.drag.currentScreenX = pos.x;
    state.drag.currentScreenY = pos.y;

    if (state.drag.type === 'pan') {
      const dx = pos.x - state.drag.startScreenX;
      const dy = pos.y - state.drag.startScreenY;
      state.viewport = pan(state.viewport, dx, dy);
      state.drag.startScreenX = pos.x;
      state.drag.startScreenY = pos.y;
      state.markDirty();
      return;
    }

    if (state.drag.type === 'key') {
      this.handleKeyDrag(pos);
      return;
    }

    if (state.drag.type === 'tangentIn' || state.drag.type === 'tangentOut') {
      this.handleTangentDrag(pos);
      return;
    }

    if (state.drag.type === 'marquee') {
      this.updateMarqueeSelection();
      state.markDirty();
      return;
    }
  }

  private handleKeyDrag(pos: { x: number; y: number }): void {
    const { state } = this;
    const drag = state.drag;
    if (!drag.originalKeys) return;

    const dx = pos.x - drag.startScreenX;
    const dy = pos.y - drag.startScreenY;

    if (drag.shiftHeld && !drag.constrainAxis) {
      if (Math.abs(dx) > CONSTRAIN_THRESHOLD || Math.abs(dy) > CONSTRAIN_THRESHOLD) {
        drag.constrainAxis = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      }
    }

    const dTime = dx / state.viewport.zoomX;
    const dValue = -dy / state.viewport.zoomY;

    state.previewKeyOverrides.clear();

    for (let i = 0; i < state.selectedKeys.length; i++) {
      const sk = state.selectedKeys[i];
      const orig = drag.originalKeys[i];
      if (!orig) continue;

      const curve = state.doc.curves[sk.curveIndex];
      const newKey: KeyFrame = JSON.parse(JSON.stringify(orig));

      if (drag.constrainAxis !== 'vertical') {
        newKey.time = state.snapEnabled
          ? state.snapTime(orig.time + dTime)
          : orig.time + dTime;
      }

      if (drag.constrainAxis !== 'horizontal') {
        if (typeof newKey.value === 'number') {
          let raw = (orig.value as number) + dValue;

          // State curves: snap to valid integer states
          if (curve.type === 'int' && curve.states) {
            raw = Math.round(raw);
            raw = Math.max(0, Math.min(curve.states.count - 1, raw));
          } else if (state.snapEnabled) {
            raw = state.snapVal(raw);
          }

          newKey.value = raw;
        } else {
          // Vec/color: only move the clicked component, leave others unchanged
          const arr = [...(orig.value as number[])];
          const comp = drag.dragComponent;

          if (comp !== undefined) {
            const raw = arr[comp] + dValue;
            arr[comp] = state.snapEnabled ? state.snapVal(raw) : raw;
          } else {
            for (let c = 0; c < arr.length; c++) {
              const raw = arr[c] + dValue;
              arr[c] = state.snapEnabled ? state.snapVal(raw) : raw;
            }
          }

          newKey.value = arr;
        }
      }

      state.previewKeyOverrides.set(`${sk.curveIndex}:${sk.keyIndex}`, newKey);
    }

    state.markDirty();
  }

  private handleTangentDrag(pos: { x: number; y: number }): void {
    const { state } = this;
    if (state.selectedKeys.length === 0) return;

    const sk = state.selectedKeys[0];
    const curve = state.doc.curves[sk.curveIndex];
    const key = curve.keys[sk.keyIndex];
    const which = state.drag.type === 'tangentIn' ? 'in' : 'out';
    const comp = state.drag.tangentComponent;

    const curveTime = screenToCurveX(state.viewport, pos.x);
    const curveVal = screenToCurveY(state.viewport, pos.y, state.canvasHeight);

    const keyVal = typeof key.value === 'number' ? key.value : (key.value as number[])[comp ?? 0];

    const dx = curveTime - key.time;
    const dy = curveVal - keyVal;

    const newKey: KeyFrame = JSON.parse(JSON.stringify(key));
    newKey.tangentMode = newKey.tangentMode === 'auto' ? 'user' : newKey.tangentMode;

    const newHandle: TangentHandle = { dx, dy };
    const isVec = typeof key.value !== 'number';

    if (isVec && comp !== undefined) {
      // Materialize per-component tangent arrays so each component has its own handle.
      // Fill empty slots with current effective tangents (auto or previously set).
      const componentCount = (key.value as number[]).length;
      const allKeys = curve.keys.map((_, idx) => state.getKey(sk.curveIndex, idx));

      const materializedIn: TangentHandle[] = [];
      const materializedOut: TangentHandle[] = [];

      for (let c = 0; c < componentCount; c++) {
        const effective = getEffectiveTangents(allKeys, sk.keyIndex, c);
        materializedIn.push({ dx: effective.tangentIn.dx, dy: effective.tangentIn.dy });
        materializedOut.push({ dx: effective.tangentOut.dx, dy: effective.tangentOut.dy });
      }

      // Preserve any user-set component tangents that already exist
      if (Array.isArray(newKey.tangentIn)) {
        const arr = newKey.tangentIn as TangentHandle[];
        for (let c = 0; c < componentCount; c++) {
          if (arr[c]) materializedIn[c] = { ...arr[c] };
        }
      }
      if (Array.isArray(newKey.tangentOut)) {
        const arr = newKey.tangentOut as TangentHandle[];
        for (let c = 0; c < componentCount; c++) {
          if (arr[c]) materializedOut[c] = { ...arr[c] };
        }
      }

      // Apply the drag to just this component
      if (which === 'in') {
        materializedIn[comp] = newHandle;
        if (newKey.tangentMode === 'aligned') {
          const outDx = Math.abs(materializedOut[comp].dx);
          const slope = dx !== 0 ? dy / dx : 0;
          materializedOut[comp].dy = -slope * outDx;
        }
      } else {
        materializedOut[comp] = newHandle;
        if (newKey.tangentMode === 'aligned') {
          const inDx = Math.abs(materializedIn[comp].dx);
          const slope = dx !== 0 ? dy / dx : 0;
          materializedIn[comp].dy = -slope * inDx;
        }
      }

      newKey.tangentIn = materializedIn;
      newKey.tangentOut = materializedOut;
    } else {
      if (which === 'in') {
        newKey.tangentIn = newHandle;
        if (newKey.tangentMode === 'aligned' && newKey.tangentOut) {
          const outDx = Math.abs((newKey.tangentOut as TangentHandle).dx);
          const slope = dx !== 0 ? dy / dx : 0;
          (newKey.tangentOut as TangentHandle).dy = -slope * outDx;
        }
      } else {
        newKey.tangentOut = newHandle;
        if (newKey.tangentMode === 'aligned' && newKey.tangentIn) {
          const inDx = Math.abs((newKey.tangentIn as TangentHandle).dx);
          const slope = dx !== 0 ? dy / dx : 0;
          (newKey.tangentIn as TangentHandle).dy = -slope * inDx;
        }
      }
    }

    state.previewKeyOverrides.set(`${sk.curveIndex}:${sk.keyIndex}`, newKey);
    state.markDirty();
  }

  private updateMarqueeSelection(): void {
    const { state } = this;
    const x1 = Math.min(state.drag.startScreenX, state.drag.currentScreenX);
    const y1 = Math.min(state.drag.startScreenY, state.drag.currentScreenY);
    const x2 = Math.max(state.drag.startScreenX, state.drag.currentScreenX);
    const y2 = Math.max(state.drag.startScreenY, state.drag.currentScreenY);

    state.selectedKeys = [];
    const curvesWithHits = new Set<number>();

    for (const { curve, index: ci } of state.getVisibleCurves()) {
      for (let ki = 0; ki < curve.keys.length; ki++) {
        const key = curve.keys[ki];
        const vals = typeof key.value === 'number' ? [key.value] : (key.value as number[]);

        for (const val of vals) {
          const sx = curveToScreenX(state.viewport, key.time);
          const sy = curveToScreenY(state.viewport, val, state.canvasHeight);

          if (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2) {
            state.selectedKeys.push({ curveIndex: ci, keyIndex: ki });
            curvesWithHits.add(ci);
            break;
          }
        }
      }
    }

    // Sync curve list selection to reflect which curves had keys captured
    if (curvesWithHits.size > 0) {
      state.selectedCurves = curvesWithHits;
    }
  }

  // ── Mouse Up ──

  private onMouseUp(e: MouseEvent): void {
    const { state } = this;
    const dragType = state.drag.type;

    if (dragType === 'key' || dragType === 'tangentIn' || dragType === 'tangentOut') {
      this.commitPreviewEdits();
    }

    state.drag = {
      type: 'none',
      startScreenX: 0,
      startScreenY: 0,
      currentScreenX: 0,
      currentScreenY: 0,
      shiftHeld: false,
    };
    state.markDirty();
  }

  private commitPreviewEdits(): void {
    const { state } = this;
    if (state.previewKeyOverrides.size === 0) return;

    const ops: JsonPatchOp[] = [];

    for (const [key, newKeyFrame] of state.previewKeyOverrides) {
      const [ci, ki] = key.split(':').map(Number);
      ops.push({
        op: 'replace',
        path: `/curves/${ci}/keys/${ki}`,
        value: newKeyFrame,
      });
    }

    state.previewKeyOverrides.clear();
    this.postEdit(ops);
  }

  // ── Double Click ──

  private onDoubleClick(e: MouseEvent): void {
    const pos = this.getCanvasPos(e);
    const { state } = this;

    const keyHit = hitTestKeys(state, pos.x, pos.y, 1);
    if (keyHit) return;

    const curveIdx = state.getSelectedCurveIndex();
    if (curveIdx === null) return;

    const curve = state.doc.curves[curveIdx];
    if (!curve) return;

    const time = screenToCurveX(state.viewport, pos.x);
    const clickedY = screenToCurveY(state.viewport, pos.y, state.canvasHeight);
    let value: number | number[];

    if (curve.type === 'int' && curve.states) {
      // State curve: snap to nearest valid state integer
      value = Math.round(clickedY);
      value = Math.max(0, Math.min(curve.states.count - 1, value));
    } else if (curve.type === 'int') {
      value = Math.round(state.snapEnabled ? state.snapVal(clickedY) : clickedY);
    } else if (curve.type === 'float') {
      value = state.snapEnabled ? state.snapVal(clickedY) : clickedY;
    } else {
      // Vec/color: evaluate existing curve at this time to get current component values,
      // then set the clicked component to the clicked Y value
      const compCount = getComponentCount(curve.type);
      const arr = new Array(compCount).fill(0);

      // Interpolate current values from neighboring keys
      for (let c = 0; c < compCount; c++) {
        arr[c] = this.interpolateComponentAt(curve, time, c);
      }

      // Find which component is closest to the clicked Y and set that one
      let closestComp = 0;
      let closestDist = Infinity;
      for (let c = 0; c < compCount; c++) {
        const dist = Math.abs(arr[c] - clickedY);
        if (dist < closestDist) {
          closestDist = dist;
          closestComp = c;
        }
      }
      arr[closestComp] = state.snapEnabled ? state.snapVal(clickedY) : clickedY;

      value = arr;
    }

    const newKey: KeyFrame = {
      time: state.snapEnabled ? state.snapTime(time) : time,
      value,
      interp: curve.type === 'int' ? 'constant' : state.settings.defaultInterpolation,
      tangentMode: state.settings.defaultTangentMode,
    };

    // State curves must always use constant interpolation
    if (curve.type === 'int' && curve.states) {
      newKey.interp = 'constant';
    }

    const insertIdx = curve.keys.findIndex((k) => k.time > newKey.time);
    const actualIdx = insertIdx === -1 ? curve.keys.length : insertIdx;

    this.postEdit([
      {
        op: 'add',
        path: `/curves/${curveIdx}/keys/${actualIdx === curve.keys.length ? '-' : actualIdx}`,
        value: newKey,
      },
    ]);
  }

  /** Simple linear interpolation of a component value at a given time */
  private interpolateComponentAt(curve: CurveDefinition, time: number, component: number): number {
    const keys = curve.keys;
    if (keys.length === 0) return 0;

    const getVal = (k: KeyFrame) => {
      const v = k.value;
      if (typeof v === 'number') return v;
      return (v as number[])[component] ?? 0;
    };

    if (time <= keys[0].time) return getVal(keys[0]);
    if (time >= keys[keys.length - 1].time) return getVal(keys[keys.length - 1]);

    for (let i = 0; i < keys.length - 1; i++) {
      if (time >= keys[i].time && time <= keys[i + 1].time) {
        const t = (time - keys[i].time) / (keys[i + 1].time - keys[i].time);
        return getVal(keys[i]) + (getVal(keys[i + 1]) - getVal(keys[i])) * t;
      }
    }
    return getVal(keys[keys.length - 1]);
  }

  // ── Wheel ──

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const pos = this.getCanvasPos(e);
    const { state } = this;

    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;

    let factorX = zoomFactor;
    let factorY = zoomFactor;

    if (e.shiftKey) {
      factorY = 1; // horizontal zoom only
    } else if (e.ctrlKey || e.metaKey) {
      factorX = 1; // vertical zoom only
    }

    state.viewport = zoomAt(
      state.viewport,
      pos.x,
      pos.y,
      state.canvasHeight,
      factorX,
      factorY
    );
    state.markDirty();
  }

  // ── Context Menu ──

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    const pos = this.getCanvasPos(e);
    const { state } = this;

    const keyHit = hitTestKeys(state, pos.x, pos.y, 1);

    if (keyHit) {
      if (!state.isKeySelected(keyHit.curveIndex, keyHit.keyIndex)) {
        state.selectKey(keyHit.curveIndex, keyHit.keyIndex, false);
      }

      ContextMenu.show(e.clientX, e.clientY, [
        { label: 'Set Interpolation', submenu: [
          { label: 'Bezier', action: () => this.setSelectedInterp('bezier') },
          { label: 'Linear', action: () => this.setSelectedInterp('linear') },
          { label: 'Constant', action: () => this.setSelectedInterp('constant') },
        ]},
        { label: 'Set Tangent Mode', submenu: [
          { label: 'Auto', action: () => this.setSelectedTangentMode('auto') },
          { label: 'User', action: () => this.setSelectedTangentMode('user') },
          { label: 'Break', action: () => this.setSelectedTangentMode('break') },
          { label: 'Aligned', action: () => this.setSelectedTangentMode('aligned') },
        ]},
        { label: 'Flatten Tangents', action: () => this.flattenSelectedTangents() },
        { type: 'separator' },
        { label: 'Delete Key', action: () => this.deleteSelectedKeys() },
        { type: 'separator' },
        { label: 'Copy Key(s)', action: () => this.copyKeys() },
        { label: 'Paste Key(s)', action: () => this.pasteKeys() },
      ]);
    } else {
      const curveTime = screenToCurveX(state.viewport, pos.x);
      const curveValue = screenToCurveY(state.viewport, pos.y, state.canvasHeight);

      ContextMenu.show(e.clientX, e.clientY, [
        { label: 'Add Key Here', action: () => this.addKeyAt(curveTime, curveValue) },
        { type: 'separator' },
        { label: 'Paste Key(s)', action: () => this.pasteKeys() },
        { type: 'separator' },
        { label: 'Frame All', action: () => this.frameAll() },
        { label: 'Frame Selection', action: () => this.frameSelection() },
      ]);
    }
  }

  private addKeyAt(time: number, value: number): void {
    const { state } = this;
    const curveIdx = state.getSelectedCurveIndex();
    if (curveIdx === null) return;

    const curve = state.doc.curves[curveIdx];
    let keyValue: number | number[] = value;

    if (curve.type !== 'float' && curve.type !== 'int') {
      const cc = getComponentCount(curve.type);
      keyValue = new Array(cc).fill(value);
    }

    const newKey: KeyFrame = {
      time: state.snapEnabled ? state.snapTime(time) : time,
      value: keyValue,
      interp: state.settings.defaultInterpolation,
      tangentMode: state.settings.defaultTangentMode,
    };

    const insertIdx = curve.keys.findIndex((k) => k.time > newKey.time);
    const actualIdx = insertIdx === -1 ? curve.keys.length : insertIdx;

    this.postEdit([{
      op: 'add',
      path: `/curves/${curveIdx}/keys/${actualIdx === curve.keys.length ? '-' : actualIdx}`,
      value: newKey,
    }]);
  }

  private setSelectedTangentMode(mode: string): void {
    const { state } = this;
    if (state.selectedKeys.length === 0) return;

    const ops: JsonPatchOp[] = state.selectedKeys.map((sk) => {
      const curve = state.doc.curves[sk.curveIndex];
      const key = curve.keys[sk.keyIndex];
      const newKey = applyTangentModeToKey(
        key,
        mode as TangentMode,
        getComponentCount(curve.type),
        state.activeComponent
      );
      return {
        op: 'replace' as const,
        path: `/curves/${sk.curveIndex}/keys/${sk.keyIndex}`,
        value: newKey,
      };
    });
    this.postEdit(ops);
  }

  private flattenSelectedTangents(): void {
    const { state } = this;
    if (state.selectedKeys.length === 0) return;
    const ops: JsonPatchOp[] = [];
    for (const sk of state.selectedKeys) {
      const key = state.doc.curves[sk.curveIndex].keys[sk.keyIndex];
      if (key.tangentIn) {
        const tin = Array.isArray(key.tangentIn)
          ? (key.tangentIn as TangentHandle[]).map((t) => ({ dx: t.dx, dy: 0 }))
          : { dx: (key.tangentIn as TangentHandle).dx, dy: 0 };
        ops.push({ op: 'replace', path: `/curves/${sk.curveIndex}/keys/${sk.keyIndex}/tangentIn`, value: tin });
      }
      if (key.tangentOut) {
        const tout = Array.isArray(key.tangentOut)
          ? (key.tangentOut as TangentHandle[]).map((t) => ({ dx: t.dx, dy: 0 }))
          : { dx: (key.tangentOut as TangentHandle).dx, dy: 0 };
        ops.push({ op: 'replace', path: `/curves/${sk.curveIndex}/keys/${sk.keyIndex}/tangentOut`, value: tout });
      }
    }
    if (ops.length > 0) this.postEdit(ops);
  }

  /** Clipboard for copy/paste keys */
  private static clipboard: KeyFrame[] = [];

  private copyKeys(): void {
    const { state } = this;
    InteractionHandler.clipboard = state.selectedKeys.map((sk) =>
      JSON.parse(JSON.stringify(state.doc.curves[sk.curveIndex].keys[sk.keyIndex]))
    );
  }

  private pasteKeys(): void {
    const { state } = this;
    if (InteractionHandler.clipboard.length === 0) return;
    const curveIdx = state.getSelectedCurveIndex();
    if (curveIdx === null) return;

    const timeOffset = 0.2;
    const ops: JsonPatchOp[] = InteractionHandler.clipboard.map((key) => {
      const newKey = JSON.parse(JSON.stringify(key));
      newKey.time += timeOffset;
      return {
        op: 'add' as const,
        path: `/curves/${curveIdx}/keys/-`,
        value: newKey,
      };
    });
    this.postEdit(ops);
  }

  // ── Keyboard ──

  private onKeyDown(e: KeyboardEvent): void {
    const { state } = this;

    // Don't intercept if user is in an input
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') {
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      this.deleteSelectedKeys();
      e.preventDefault();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      state.selectAllKeysOnVisibleCurves();
      e.preventDefault();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
      this.duplicateSelectedKeys();
      e.preventDefault();
      return;
    }

    if (e.key === 'Home') {
      this.frameAll();
      e.preventDefault();
      return;
    }

    if (e.key === 'f' || e.key === 'F') {
      this.frameSelection();
      e.preventDefault();
      return;
    }

    // Interpolation shortcuts
    if (e.key === '1') { this.setSelectedInterp('constant'); return; }
    if (e.key === '2') { this.setSelectedInterp('linear'); return; }
    if (e.key === '3') { this.setSelectedInterp('bezier'); return; }

    if (e.key === 's' || e.key === 'S') {
      if (!e.ctrlKey && !e.metaKey) {
        state.snapEnabled = !state.snapEnabled;
        state.markDirty();
        e.preventDefault();
      }
      return;
    }

    if (e.key === 't' || e.key === 'T') {
      if (!e.ctrlKey && !e.metaKey) {
        state.tangentDisplayEnabled = !state.tangentDisplayEnabled;
        state.markDirty();
        e.preventDefault();
      }
      return;
    }

    // Copy/Paste
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      this.copyKeys();
      e.preventDefault();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      this.pasteKeys();
      e.preventDefault();
      return;
    }
  }

  private deleteSelectedKeys(): void {
    const { state } = this;
    if (state.selectedKeys.length === 0) return;

    // Sort descending so we can remove from back to front without index shift
    const sorted = [...state.selectedKeys].sort((a, b) => {
      if (a.curveIndex !== b.curveIndex) return b.curveIndex - a.curveIndex;
      return b.keyIndex - a.keyIndex;
    });

    const ops: JsonPatchOp[] = sorted.map((sk) => ({
      op: 'remove' as const,
      path: `/curves/${sk.curveIndex}/keys/${sk.keyIndex}`,
    }));

    state.selectedKeys = [];
    this.postEdit(ops);
  }

  private duplicateSelectedKeys(): void {
    const { state } = this;
    if (state.selectedKeys.length === 0) return;

    const ops: JsonPatchOp[] = [];
    const timeOffset = 0.2;

    for (const sk of state.selectedKeys) {
      const key = state.doc.curves[sk.curveIndex].keys[sk.keyIndex];
      const newKey: KeyFrame = JSON.parse(JSON.stringify(key));
      newKey.time += timeOffset;

      ops.push({
        op: 'add',
        path: `/curves/${sk.curveIndex}/keys/-`,
        value: newKey,
      });
    }

    this.postEdit(ops);
  }

  private setSelectedInterp(interp: 'constant' | 'linear' | 'bezier'): void {
    const { state } = this;
    if (state.selectedKeys.length === 0) return;

    const ops: JsonPatchOp[] = state.selectedKeys.map((sk) => {
      const curve = state.doc.curves[sk.curveIndex];
      const key = curve.keys[sk.keyIndex];
      const newKey = applyInterpToKey(
        key,
        interp as InterpolationMode,
        getComponentCount(curve.type),
        state.activeComponent
      );
      return {
        op: 'replace' as const,
        path: `/curves/${sk.curveIndex}/keys/${sk.keyIndex}`,
        value: newKey,
      };
    });

    this.postEdit(ops);
  }

  frameAll(): void {
    const { state } = this;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (const { curve } of state.getVisibleCurves()) {
      for (const key of curve.keys) {
        minX = Math.min(minX, key.time);
        maxX = Math.max(maxX, key.time);
        const vals = typeof key.value === 'number' ? [key.value] : (key.value as number[]);
        for (const v of vals) {
          minY = Math.min(minY, v);
          maxY = Math.max(maxY, v);
        }
      }
    }

    if (!isFinite(minX)) { minX = 0; maxX = 1; minY = 0; maxY = 1; }
    state.viewport = frameRegion(minX, maxX, minY, maxY, state.canvasWidth, state.canvasHeight);
    state.markDirty();
  }

  frameSelection(): void {
    const { state } = this;
    if (state.selectedKeys.length === 0) { this.frameAll(); return; }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (const sk of state.selectedKeys) {
      const key = state.doc.curves[sk.curveIndex].keys[sk.keyIndex];
      minX = Math.min(minX, key.time);
      maxX = Math.max(maxX, key.time);
      const vals = typeof key.value === 'number' ? [key.value] : (key.value as number[]);
      for (const v of vals) {
        minY = Math.min(minY, v);
        maxY = Math.max(maxY, v);
      }
    }

    state.viewport = frameRegion(minX, maxX, minY, maxY, state.canvasWidth, state.canvasHeight);
    state.markDirty();
  }

  dispose(): void {
    this.disposed = true;
    for (const { event, handler } of this.boundHandlers) {
      this.canvas.removeEventListener(event, handler);
      window.removeEventListener(event, handler);
    }
  }
}

