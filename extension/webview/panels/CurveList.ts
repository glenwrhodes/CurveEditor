import { EditorState } from '../state/EditorState';
import { JsonPatchOp, CurveType } from '../../src/protocol';
import { ContextMenu } from './ContextMenu';
import { StatesModal } from './StatesModal';

type PostEditFn = (ops: JsonPatchOp[]) => void;
type PostCommandFn = (msg: any) => void;

const CURVE_PALETTE = [
  '#e06c75', '#61afef', '#98c379', '#e5c07b', '#c678dd',
  '#56b6c2', '#d19a66', '#be5046', '#7ec699', '#f0c674',
];

const STATE_COLORS = CURVE_PALETTE;

export class CurveList {
  private container: HTMLElement;
  private listEl: HTMLElement;
  private dragSourceIndex: number | null = null;

  constructor(
    parent: HTMLElement,
    private state: EditorState,
    private postCommand: PostCommandFn,
    private postEdit: PostEditFn
  ) {
    this.container = document.createElement('div');
    this.container.className = 'curve-list';
    this.container.setAttribute('role', 'list');
    this.container.setAttribute('aria-label', 'Curve list');

    const header = document.createElement('div');
    header.className = 'curve-list-header';

    const headerLabel = document.createElement('span');
    headerLabel.textContent = 'Curves';
    header.appendChild(headerLabel);

    const toggleAllBtn = document.createElement('button');
    toggleAllBtn.className = 'curve-list-toggle-all';
    toggleAllBtn.setAttribute('aria-label', 'Toggle visibility of all curves');
    toggleAllBtn.addEventListener('click', () => this.toggleAllVisibility());
    header.appendChild(toggleAllBtn);
    this.toggleAllBtn = toggleAllBtn;

    this.container.appendChild(header);

    this.listEl = document.createElement('div');
    this.listEl.className = 'curve-list-items';
    this.container.appendChild(this.listEl);

    parent.appendChild(this.container);

    state.onChange(() => this.render());
    this.render();
  }

  private toggleAllBtn!: HTMLButtonElement;

  /** Tracks the last click on a curve row for manual double-click detection.
   *  We need this because markDirty() re-renders the list between clicks,
   *  destroying the DOM element and breaking the native dblclick event. */
  private lastClickedCurveIndex: number | null = null;
  private lastClickTime = 0;
  private readonly DOUBLE_CLICK_MS = 400;

  private toggleAllVisibility(): void {
    const { state } = this;
    const anyVisible = state.doc.curves.some((_, i) => state.isCurveVisible(i));
    const newValue = !anyVisible;
    for (let i = 0; i < state.doc.curves.length; i++) {
      state.curveVisibility.set(i, newValue);
    }
    state.markDirty();
  }

  private render(): void {
    const { state, listEl } = this;
    listEl.innerHTML = '';

    // Update the global visibility toggle button
    const anyVisible = state.doc.curves.some((_, i) => state.isCurveVisible(i));
    this.toggleAllBtn.innerHTML = anyVisible ? '&#x1F441;' : '&#x25CB;';
    this.toggleAllBtn.classList.toggle('active', anyVisible);
    this.toggleAllBtn.setAttribute(
      'aria-label',
      anyVisible ? 'Hide all curves' : 'Show all curves'
    );

    for (let i = 0; i < state.doc.curves.length; i++) {
      const curve = state.doc.curves[i];
      const isSelected = state.selectedCurves.has(i);
      const isVisible = state.isCurveVisible(i);
      const isLocked = state.isCurveLocked(i);
      const color = state.getCurveColor(i);

      const row = document.createElement('div');
      row.className = `curve-list-item ${isSelected ? 'selected' : ''}`;
      row.setAttribute('role', 'listitem');
      row.setAttribute('aria-selected', String(isSelected));
      row.setAttribute('aria-label', `Curve: ${curve.name}`);
      row.tabIndex = 0;
      row.draggable = true;
      row.dataset.index = String(i);

      // Drag reorder events
      row.addEventListener('dragstart', (e) => {
        this.dragSourceIndex = i;
        row.classList.add('dragging');
        e.dataTransfer!.effectAllowed = 'move';
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        this.dragSourceIndex = null;
        listEl.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer!.dropEffect = 'move';
        row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over');
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        if (this.dragSourceIndex !== null && this.dragSourceIndex !== i) {
          this.reorderCurve(this.dragSourceIndex, i);
        }
      });

      // Color swatch
      const swatch = document.createElement('span');
      swatch.className = 'curve-swatch';
      swatch.style.backgroundColor = color;
      swatch.setAttribute('aria-hidden', 'true');
      row.appendChild(swatch);

      // Curve name
      const nameEl = document.createElement('span');
      nameEl.className = 'curve-name';
      nameEl.textContent = curve.name;
      nameEl.title = 'Double-click to rename';
      row.appendChild(nameEl);

      // Double-click to rename (manual detection because re-renders between clicks
      // would otherwise break the native dblclick event)
      nameEl.addEventListener('click', (e) => {
        const now = Date.now();
        if (
          this.lastClickedCurveIndex === i &&
          now - this.lastClickTime < this.DOUBLE_CLICK_MS
        ) {
          e.stopPropagation();
          e.preventDefault();
          this.lastClickedCurveIndex = null;
          this.lastClickTime = 0;
          // Defer so the row's click handler can finish first without re-rendering away the input
          setTimeout(() => {
            const currentNameEl = this.listEl.children[i]?.querySelector('.curve-name') as HTMLSpanElement | null;
            if (currentNameEl) this.startInlineRename(i, currentNameEl);
          }, 0);
        } else {
          this.lastClickedCurveIndex = i;
          this.lastClickTime = now;
        }
      });

      // Native dblclick as a fallback (works when re-render doesn't happen)
      nameEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.startInlineRename(i, nameEl);
      });

      // Type badge
      const typeEl = document.createElement('span');
      typeEl.className = 'curve-type-badge';
      typeEl.textContent = curve.type;
      row.appendChild(typeEl);

      // Visibility toggle
      const visBtn = document.createElement('button');
      visBtn.className = `curve-icon-btn ${isVisible ? 'active' : ''}`;
      visBtn.setAttribute('aria-label', `Toggle visibility for ${curve.name}`);
      visBtn.innerHTML = isVisible ? '&#x1F441;' : '&#x25CB;';
      visBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.curveVisibility.set(i, !isVisible);
        state.markDirty();
      });
      row.appendChild(visBtn);

      // Lock toggle
      const lockBtn = document.createElement('button');
      lockBtn.className = `curve-icon-btn ${isLocked ? 'active' : ''}`;
      lockBtn.setAttribute('aria-label', `Toggle lock for ${curve.name}`);
      lockBtn.innerHTML = isLocked ? '&#x1F512;' : '&#x1F513;';
      lockBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.curveLocked.set(i, !isLocked);
        state.markDirty();
      });
      row.appendChild(lockBtn);

      // Click to select (and reset active component to "all")
      row.addEventListener('click', (e) => {
        // Capture prior state so we can skip re-rendering when nothing changed
        const wasSoleSelected =
          state.selectedCurves.size === 1 && state.selectedCurves.has(i);
        const priorActiveComp = state.activeComponent;

        if (e.ctrlKey || e.metaKey) {
          if (state.selectedCurves.has(i)) {
            state.selectedCurves.delete(i);
          } else {
            state.selectedCurves.add(i);
          }
        } else {
          state.selectedCurves.clear();
          state.selectedCurves.add(i);
        }
        state.activeComponent = null;

        // Only mark dirty if something actually changed; otherwise repeated clicks
        // would destroy the DOM node and break our double-click detection.
        const nothingChanged =
          !(e.ctrlKey || e.metaKey) &&
          wasSoleSelected &&
          priorActiveComp === null;
        if (!nothingChanged) {
          state.markDirty();
        }
      });

      // Right-click context menu
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        state.selectedCurves.clear();
        state.selectedCurves.add(i);
        state.markDirty();
        this.showContextMenu(e.clientX, e.clientY, i);
      });

      listEl.appendChild(row);

      // Component children for vec/color types
      if (['vec2', 'vec3', 'vec4', 'color'].includes(curve.type) && isSelected) {
        const compCount = curve.type === 'vec2' ? 2 : curve.type === 'vec3' ? 3 : 4;
        const compNames = curve.type === 'color'
          ? ['R', 'G', 'B', 'A']
          : ['X', 'Y', 'Z', 'W'].slice(0, compCount);
        const compColors = getComponentColors(compCount);

        for (let ci = 0; ci < compCount; ci++) {
          const compVisible = state.isComponentVisible(i, ci);
          const isActiveComp = state.activeComponent === ci;
          const compRow = document.createElement('div');
          compRow.className = `curve-list-item curve-component-item ${isActiveComp ? 'selected' : ''}`;
          compRow.setAttribute('role', 'listitem');
          compRow.setAttribute('aria-label', `Component ${compNames[ci]} of ${curve.name}`);
          compRow.setAttribute('aria-selected', String(isActiveComp));

          const indent = document.createElement('span');
          indent.className = 'component-indent';
          indent.textContent = '\u2514';
          compRow.appendChild(indent);

          const compSwatch = document.createElement('span');
          compSwatch.className = 'curve-swatch';
          compSwatch.style.backgroundColor = compColors[ci];
          compRow.appendChild(compSwatch);

          const compLabel = document.createElement('span');
          compLabel.className = 'curve-name';
          compLabel.textContent = compNames[ci];
          compRow.appendChild(compLabel);

          const compVisBtn = document.createElement('button');
          compVisBtn.className = `curve-icon-btn ${compVisible ? 'active' : ''}`;
          compVisBtn.setAttribute('aria-label', `Toggle visibility for ${compNames[ci]}`);
          compVisBtn.innerHTML = compVisible ? '&#x1F441;' : '&#x25CB;';
          compVisBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            state.setComponentVisibility(i, ci, !compVisible);
          });
          compRow.appendChild(compVisBtn);

          // Click to select this component as active drag target
          compRow.addEventListener('click', (e) => {
            e.stopPropagation();
            state.activeComponent = isActiveComp ? null : ci;
            state.markDirty();
          });

          listEl.appendChild(compRow);
        }
      }

      // State label sub-items for int state curves
      if (curve.type === 'int' && curve.states && isSelected) {
        const stateCount = curve.states.count;
        const stateLabels = curve.states.labels || [];

        for (let si = 0; si < stateCount; si++) {
          const label = stateLabels[si] || `State ${si}`;
          const stateRow = document.createElement('div');
          stateRow.className = 'curve-list-item curve-component-item';
          stateRow.setAttribute('role', 'listitem');
          stateRow.setAttribute('aria-label', `State ${si}: ${label}`);

          const indent = document.createElement('span');
          indent.className = 'component-indent';
          indent.textContent = '\u2514';
          stateRow.appendChild(indent);

          const stateSwatch = document.createElement('span');
          stateSwatch.className = 'curve-swatch';
          stateSwatch.style.backgroundColor = STATE_COLORS[si % STATE_COLORS.length];
          stateRow.appendChild(stateSwatch);

          const stateLabelEl = document.createElement('span');
          stateLabelEl.className = 'curve-name';
          stateLabelEl.textContent = `${si}: ${label}`;
          stateRow.appendChild(stateLabelEl);

          // Double-click to rename label inline
          stateLabelEl.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            this.startStateLabelRename(i, si, stateLabelEl, label);
          });

          listEl.appendChild(stateRow);
        }
      }
    }

    if (state.doc.curves.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'curve-list-empty';
      empty.textContent = 'No curves. Use "Add Curve" above.';
      listEl.appendChild(empty);
    }
  }

  private startInlineRename(curveIndex: number, nameEl: HTMLSpanElement): void {
    const curve = this.state.doc.curves[curveIndex];
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'curve-rename-input';
    input.value = curve.name;
    input.setAttribute('aria-label', 'Rename curve');

    nameEl.textContent = '';
    nameEl.appendChild(input);
    input.focus();
    input.select();

    const commit = () => {
      const newName = input.value.trim();
      if (newName && newName !== curve.name) {
        this.postEdit([{
          op: 'replace',
          path: `/curves/${curveIndex}/name`,
          value: newName,
        }]);
      } else {
        nameEl.textContent = curve.name;
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { commit(); input.blur(); }
      if (e.key === 'Escape') { nameEl.textContent = curve.name; input.blur(); }
      e.stopPropagation();
    });
    input.addEventListener('blur', commit);
  }

  private startStateLabelRename(
    curveIndex: number,
    stateIndex: number,
    labelEl: HTMLSpanElement,
    currentLabel: string
  ): void {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'curve-rename-input';
    input.value = currentLabel;
    input.setAttribute('aria-label', `Rename state ${stateIndex}`);

    labelEl.textContent = '';
    labelEl.appendChild(input);
    input.focus();
    input.select();

    const commit = () => {
      const newLabel = input.value.trim();
      if (newLabel && newLabel !== currentLabel) {
        const curve = this.state.doc.curves[curveIndex];
        const labels = [...(curve.states?.labels || [])];
        while (labels.length <= stateIndex) labels.push(`State ${labels.length}`);
        labels[stateIndex] = newLabel;
        this.postEdit([{
          op: 'replace',
          path: `/curves/${curveIndex}/states/labels`,
          value: labels,
        }]);
      } else {
        labelEl.textContent = `${stateIndex}: ${currentLabel}`;
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { commit(); input.blur(); }
      if (e.key === 'Escape') { labelEl.textContent = `${stateIndex}: ${currentLabel}`; input.blur(); }
      e.stopPropagation();
    });
    input.addEventListener('blur', commit);
  }

  private showContextMenu(clientX: number, clientY: number, curveIndex: number): void {
    const curve = this.state.doc.curves[curveIndex];

    const items = [
      { label: 'Rename', action: () => {
        const nameEl = this.listEl.children[curveIndex]?.querySelector('.curve-name') as HTMLSpanElement;
        if (nameEl) this.startInlineRename(curveIndex, nameEl);
      }},
      { label: 'Duplicate', action: () => this.duplicateCurve(curveIndex) },
      { label: 'Delete', action: () => this.postCommand({ type: 'command:deleteCurve', name: curve.name }) },
      { type: 'separator' as const },
      { label: 'Change Color', submenu: CURVE_PALETTE.map((c, ci) => ({
        label: c,
        color: c,
        action: () => {
          this.state.curveColorOverride.set(curveIndex, c);
          this.state.markDirty();
        }
      }))},
      { type: 'separator' as const },
      { label: 'Change Type', submenu: [
        { label: 'Float', action: () => this.changeCurveType(curveIndex, 'float') },
        { label: 'Int', action: () => this.changeCurveType(curveIndex, 'int') },
        { label: 'Vec2', action: () => this.changeCurveType(curveIndex, 'vec2') },
        { label: 'Vec3', action: () => this.changeCurveType(curveIndex, 'vec3') },
        { label: 'Vec4', action: () => this.changeCurveType(curveIndex, 'vec4') },
        { label: 'Color', action: () => this.changeCurveType(curveIndex, 'color') },
      ]},
      ...(curve.type === 'int' ? [
        { type: 'separator' as const },
        { label: 'Edit States...', action: () => this.openStatesModal(curveIndex) },
      ] : []),
    ];

    ContextMenu.show(clientX, clientY, items);
  }

  private duplicateCurve(curveIndex: number): void {
    const curve = this.state.doc.curves[curveIndex];
    const newCurve = JSON.parse(JSON.stringify(curve));
    newCurve.name = curve.name + '_copy';

    this.postEdit([{
      op: 'add',
      path: `/curves/-`,
      value: newCurve,
    }]);
  }

  private changeCurveType(curveIndex: number, newType: CurveType): void {
    this.postEdit([{
      op: 'replace',
      path: `/curves/${curveIndex}/type`,
      value: newType,
    }]);
  }

  private reorderCurve(fromIndex: number, toIndex: number): void {
    const curves = [...this.state.doc.curves];
    const [moved] = curves.splice(fromIndex, 1);
    curves.splice(toIndex, 0, moved);

    this.postEdit([{
      op: 'replace',
      path: '/curves',
      value: curves,
    }]);
  }

  private openStatesModal(curveIndex: number): void {
    const curve = this.state.doc.curves[curveIndex];
    const count = curve.states?.count || 2;
    const labels = curve.states?.labels || [];

    const modal = new StatesModal(curveIndex, count, labels, this.postEdit);
    modal.show();
  }
}

function getComponentColors(count: number): string[] {
  if (count === 2) return ['#e06c75', '#61afef'];
  if (count === 3) return ['#e06c75', '#98c379', '#61afef'];
  return ['#e06c75', '#98c379', '#61afef', '#cccccc'];
}
