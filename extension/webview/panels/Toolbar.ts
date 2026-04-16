import { EditorState } from '../state/EditorState';
import { CurveType, InterpolationMode, TangentMode, JsonPatchOp } from '../../src/protocol';

type PostEditFn = (ops: JsonPatchOp[]) => void;
type PostCommandFn = (msg: any) => void;
type FrameFn = () => void;

export class Toolbar {
  private container: HTMLElement;

  constructor(
    parent: HTMLElement,
    private state: EditorState,
    private postCommand: PostCommandFn,
    private postEdit: PostEditFn,
    private onFrameAll: FrameFn,
    private onFrameSelection: FrameFn
  ) {
    this.container = document.createElement('div');
    this.container.className = 'toolbar';
    this.container.setAttribute('role', 'toolbar');
    this.container.setAttribute('aria-label', 'Curve editor toolbar');
    parent.appendChild(this.container);
    this.build();
    state.onChange(() => this.update());
  }

  private build(): void {
    this.container.innerHTML = '';

    // Add Curve dropdown
    const addGroup = this.createGroup();
    const addBtn = this.createDropdownButton('Add Curve', [
      { label: 'Float', value: 'float' },
      { label: 'Int', value: 'int' },
      { label: 'Vec2', value: 'vec2' },
      { label: 'Vec3', value: 'vec3' },
      { label: 'Vec4', value: 'vec4' },
      { label: 'Color', value: 'color' },
    ], (val) => {
      this.postCommand({ type: 'command:newCurve', curveType: val });
    });
    addGroup.appendChild(addBtn);
    this.container.appendChild(addGroup);

    // Snap toggle
    const snapGroup = this.createGroup();
    const snapBtn = document.createElement('button');
    snapBtn.className = 'toolbar-btn snap-toggle';
    snapBtn.setAttribute('aria-label', 'Toggle snap to grid');
    snapBtn.textContent = 'Snap';
    snapBtn.addEventListener('click', () => {
      this.state.snapEnabled = !this.state.snapEnabled;
      this.state.markDirty();
    });
    snapGroup.appendChild(snapBtn);
    this.container.appendChild(snapGroup);

    // Frame buttons
    const frameGroup = this.createGroup();

    const frameAllBtn = document.createElement('button');
    frameAllBtn.className = 'toolbar-btn';
    frameAllBtn.setAttribute('aria-label', 'Frame all curves');
    frameAllBtn.textContent = 'Frame All';
    frameAllBtn.addEventListener('click', () => this.onFrameAll());
    frameGroup.appendChild(frameAllBtn);

    const frameSelBtn = document.createElement('button');
    frameSelBtn.className = 'toolbar-btn';
    frameSelBtn.setAttribute('aria-label', 'Frame selected keys');
    frameSelBtn.textContent = 'Frame Sel';
    frameSelBtn.addEventListener('click', () => this.onFrameSelection());
    frameGroup.appendChild(frameSelBtn);
    this.container.appendChild(frameGroup);

    // Interpolation override
    const interpGroup = this.createGroup();
    const interpLabel = document.createElement('span');
    interpLabel.className = 'toolbar-label';
    interpLabel.textContent = 'Interp:';
    interpGroup.appendChild(interpLabel);

    const interpSelect = this.createSelect('interp-select', 'Interpolation mode', [
      { label: 'Bezier', value: 'bezier' },
      { label: 'Linear', value: 'linear' },
      { label: 'Constant', value: 'constant' },
    ], (val) => {
      this.setSelectedInterp(val as InterpolationMode);
    });
    interpGroup.appendChild(interpSelect);
    this.container.appendChild(interpGroup);

    // Tangent mode override
    const tangentGroup = this.createGroup();
    const tangentLabel = document.createElement('span');
    tangentLabel.className = 'toolbar-label';
    tangentLabel.textContent = 'Tangent:';
    tangentGroup.appendChild(tangentLabel);

    const tangentSelect = this.createSelect('tangent-select', 'Tangent mode', [
      { label: 'Auto', value: 'auto' },
      { label: 'User', value: 'user' },
      { label: 'Break', value: 'break' },
      { label: 'Aligned', value: 'aligned' },
    ], (val) => {
      this.setSelectedTangentMode(val as TangentMode);
    });
    tangentGroup.appendChild(tangentSelect);
    this.container.appendChild(tangentGroup);

    // Pre-Infinity dropdown
    const preInfGroup = this.createGroup();
    const preInfLabel = document.createElement('span');
    preInfLabel.className = 'toolbar-label';
    preInfLabel.textContent = 'Pre \u221E:';
    preInfGroup.appendChild(preInfLabel);

    const preInfSelect = this.createSelect('pre-inf-select', 'Pre-infinity mode', [
      { label: 'Constant', value: 'constant' },
      { label: 'Linear', value: 'linear' },
      { label: 'Cycle', value: 'cycle' },
      { label: 'Oscillate', value: 'oscillate' },
    ], (val) => {
      this.setInfinityMode('preInfinity', val);
    });
    preInfGroup.appendChild(preInfSelect);
    this.container.appendChild(preInfGroup);

    // Post-Infinity dropdown
    const postInfGroup = this.createGroup();
    const postInfLabel = document.createElement('span');
    postInfLabel.className = 'toolbar-label';
    postInfLabel.textContent = 'Post \u221E:';
    postInfGroup.appendChild(postInfLabel);

    const postInfSelect = this.createSelect('post-inf-select', 'Post-infinity mode', [
      { label: 'Constant', value: 'constant' },
      { label: 'Linear', value: 'linear' },
      { label: 'Cycle', value: 'cycle' },
      { label: 'Oscillate', value: 'oscillate' },
    ], (val) => {
      this.setInfinityMode('postInfinity', val);
    });
    postInfGroup.appendChild(postInfSelect);
    this.container.appendChild(postInfGroup);
  }

  private update(): void {
    const snapToggle = this.container.querySelector('.snap-toggle') as HTMLButtonElement;
    if (snapToggle) {
      snapToggle.classList.toggle('active', this.state.snapEnabled);
    }
  }

  private createGroup(): HTMLElement {
    const group = document.createElement('div');
    group.className = 'toolbar-group';
    return group;
  }

  private createSelect(
    className: string,
    ariaLabel: string,
    options: { label: string; value: string }[],
    onChange: (val: string) => void
  ): HTMLSelectElement {
    const select = document.createElement('select');
    select.className = `toolbar-select ${className}`;
    select.setAttribute('aria-label', ariaLabel);
    for (const opt of options) {
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.label;
      select.appendChild(el);
    }
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }

  private createDropdownButton(
    label: string,
    items: { label: string; value: string }[],
    onSelect: (val: string) => void
  ): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'dropdown-wrapper';

    const btn = document.createElement('button');
    btn.className = 'toolbar-btn dropdown-btn';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = label + ' \u25BE';

    const menu = document.createElement('div');
    menu.className = 'dropdown-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', label + ' options');
    menu.style.display = 'none';

    for (const item of items) {
      const option = document.createElement('div');
      option.className = 'dropdown-item';
      option.setAttribute('role', 'menuitem');
      option.textContent = item.label;
      option.addEventListener('click', () => {
        onSelect(item.value);
        menu.style.display = 'none';
        btn.setAttribute('aria-expanded', 'false');
      });
      menu.appendChild(option);
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = menu.style.display !== 'none';
      menu.style.display = isOpen ? 'none' : 'block';
      btn.setAttribute('aria-expanded', String(!isOpen));
    });

    document.addEventListener('click', () => {
      menu.style.display = 'none';
      btn.setAttribute('aria-expanded', 'false');
    });

    wrapper.appendChild(btn);
    wrapper.appendChild(menu);
    return wrapper;
  }

  private setSelectedInterp(interp: InterpolationMode): void {
    if (this.state.selectedKeys.length === 0) return;
    const ops: JsonPatchOp[] = this.state.selectedKeys.map((sk) => ({
      op: 'replace' as const,
      path: `/curves/${sk.curveIndex}/keys/${sk.keyIndex}/interp`,
      value: interp,
    }));
    this.postEdit(ops);
  }

  private setSelectedTangentMode(mode: TangentMode): void {
    if (this.state.selectedKeys.length === 0) return;
    const ops: JsonPatchOp[] = this.state.selectedKeys.map((sk) => ({
      op: 'replace' as const,
      path: `/curves/${sk.curveIndex}/keys/${sk.keyIndex}/tangentMode`,
      value: mode,
    }));
    this.postEdit(ops);
  }

  private setInfinityMode(field: 'preInfinity' | 'postInfinity', mode: string): void {
    const ops: JsonPatchOp[] = [];
    for (const curveIdx of this.state.selectedCurves) {
      ops.push({
        op: 'replace',
        path: `/curves/${curveIdx}/${field}`,
        value: mode,
      });
    }
    if (ops.length > 0) this.postEdit(ops);
  }
}
