import { JsonPatchOp } from '../../src/protocol';

type PostEditFn = (ops: JsonPatchOp[]) => void;

export class StatesModal {
  private overlay: HTMLElement;
  private modal: HTMLElement;
  private countInput: HTMLInputElement;
  private labelsContainer: HTMLElement;
  private currentCount: number;
  private currentLabels: string[];

  constructor(
    private curveIndex: number,
    private initialCount: number,
    private initialLabels: string[],
    private postEdit: PostEditFn
  ) {
    this.currentCount = initialCount;
    this.currentLabels = [...initialLabels];
    while (this.currentLabels.length < this.currentCount) {
      this.currentLabels.push(`State ${this.currentLabels.length}`);
    }

    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-label', 'Edit States');
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    this.modal = document.createElement('div');
    this.modal.className = 'modal-content';

    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = 'Edit States';
    this.modal.appendChild(title);

    // Count row
    const countRow = document.createElement('div');
    countRow.className = 'modal-row';

    const countLabel = document.createElement('label');
    countLabel.className = 'modal-label';
    countLabel.textContent = 'Number of states:';
    countLabel.setAttribute('for', 'states-count-input');
    countRow.appendChild(countLabel);

    this.countInput = document.createElement('input');
    this.countInput.type = 'number';
    this.countInput.id = 'states-count-input';
    this.countInput.className = 'modal-input';
    this.countInput.min = '1';
    this.countInput.max = '20';
    this.countInput.value = String(this.currentCount);
    this.countInput.setAttribute('aria-label', 'Number of states');
    this.countInput.addEventListener('input', () => this.onCountChange());
    countRow.appendChild(this.countInput);
    this.modal.appendChild(countRow);

    // Labels section
    const labelsTitle = document.createElement('div');
    labelsTitle.className = 'modal-section-title';
    labelsTitle.textContent = 'State Labels:';
    this.modal.appendChild(labelsTitle);

    this.labelsContainer = document.createElement('div');
    this.labelsContainer.className = 'modal-labels-list';
    this.modal.appendChild(this.labelsContainer);

    this.renderLabels();

    // Buttons
    const btnRow = document.createElement('div');
    btnRow.className = 'modal-buttons';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'modal-btn modal-btn-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.setAttribute('aria-label', 'Cancel editing states');
    cancelBtn.addEventListener('click', () => this.close());
    btnRow.appendChild(cancelBtn);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'modal-btn modal-btn-save';
    saveBtn.textContent = 'Save';
    saveBtn.setAttribute('aria-label', 'Save state changes');
    saveBtn.addEventListener('click', () => this.save());
    btnRow.appendChild(saveBtn);

    this.modal.appendChild(btnRow);
    this.overlay.appendChild(this.modal);

    document.addEventListener('keydown', this.onKeyDown);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.close();
  };

  private onCountChange(): void {
    const val = parseInt(this.countInput.value);
    if (isNaN(val) || val < 1) return;
    this.currentCount = Math.min(20, val);

    while (this.currentLabels.length < this.currentCount) {
      this.currentLabels.push(`State ${this.currentLabels.length}`);
    }
    this.currentLabels.length = this.currentCount;

    this.renderLabels();
  }

  private renderLabels(): void {
    this.labelsContainer.innerHTML = '';

    for (let i = 0; i < this.currentCount; i++) {
      const row = document.createElement('div');
      row.className = 'modal-label-row';

      const idx = document.createElement('span');
      idx.className = 'modal-label-index';
      idx.textContent = `${i}:`;
      row.appendChild(idx);

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'modal-input modal-label-input';
      input.value = this.currentLabels[i] || '';
      input.setAttribute('aria-label', `Label for state ${i}`);
      const capturedIndex = i;
      input.addEventListener('input', () => {
        this.currentLabels[capturedIndex] = input.value;
      });
      row.appendChild(input);

      this.labelsContainer.appendChild(row);
    }
  }

  private save(): void {
    const labels = this.currentLabels.map((l) => l.trim() || `State ${this.currentLabels.indexOf(l)}`);

    this.postEdit([{
      op: 'replace',
      path: `/curves/${this.curveIndex}/states`,
      value: {
        count: this.currentCount,
        labels,
      },
    }]);

    this.close();
  }

  show(): void {
    document.body.appendChild(this.overlay);
    this.countInput.focus();
  }

  private close(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    this.overlay.remove();
  }
}
