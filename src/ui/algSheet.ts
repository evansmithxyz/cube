/** The algorithm sheet: every OLL and PLL with the algorithm the coach shows, which the user can change. */

import { CASES, caseById, type CaseInfo, type CaseKind } from '../teach/algs';
import type { LastLayerAlgStore } from '../teach/store';
import { caseDiagram } from './coachView';
import { el } from './dom';

function actionButton(label: string, action: string, className = 'link'): HTMLButtonElement {
  const button = el('button', className, label) as HTMLButtonElement;
  button.type = 'button';
  button.dataset.action = action;
  return button;
}

export class AlgSheet {
  private kind: CaseKind = 'oll';
  /** Case whose algorithm is being typed. */
  private editing: string | null = null;

  constructor(
    private readonly dialog: HTMLDialogElement,
    private readonly list: HTMLElement,
    private readonly store: LastLayerAlgStore,
  ) {
    for (const tab of dialog.querySelectorAll<HTMLButtonElement>('[data-sheet]')) {
      tab.addEventListener('click', () => {
        this.kind = tab.dataset.sheet as CaseKind;
        this.editing = null;
        this.render();
        this.list.scrollTop = 0;
      });
    }
    list.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
      const info = caseById(button?.closest<HTMLElement>('[data-id]')?.dataset.id ?? '');
      if (button && info) this.act(button.dataset.action!, info);
    });
    list.addEventListener('keydown', (event) => {
      const info = caseById((event.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id ?? '');
      if (!info || !(event.target instanceof HTMLInputElement)) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        this.act('save', info);
      }
    });
    // Esc while typing gives up the edit rather than closing the sheet
    dialog.addEventListener('cancel', (event) => {
      if (!this.editing) return;
      event.preventDefault();
      const info = caseById(this.editing)!;
      this.act('cancel', info);
    });
    dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());
  }

  /** Open on a case's tab, scrolled to it (or where it was last left). */
  open(id?: string): void {
    const info = id ? caseById(id) : undefined;
    if (info) this.kind = info.kind;
    this.editing = null;
    this.render();
    this.dialog.showModal();
    if (info) {
      const card = this.list.querySelector<HTMLElement>(`[data-id="${info.id}"]`);
      card?.scrollIntoView({ block: 'center' });
      card?.classList.add('flash');
    }
  }

  private act(action: string, info: CaseInfo): void {
    if (action === 'save') {
      const input = this.cardOf(info)?.querySelector('input');
      const problem = this.store.set(info, input?.value ?? '');
      if (problem) {
        this.cardOf(info)!.querySelector('.error')!.textContent = problem;
        return;
      }
      this.editing = null;
    } else if (action === 'edit') {
      const previous = this.editing;
      this.editing = info.id;
      if (previous && previous !== info.id) this.refresh(caseById(previous)!);
    } else if (action === 'cancel') {
      this.editing = null;
    } else if (action === 'reset') {
      this.store.reset(info);
    }
    this.refresh(info);
    if (action !== 'edit') this.cardOf(info)?.querySelector<HTMLButtonElement>('[data-action="edit"]')?.focus();
  }

  private cardOf(info: CaseInfo): HTMLElement | null {
    return this.list.querySelector<HTMLElement>(`[data-id="${info.id}"]`);
  }

  private refresh(info: CaseInfo): void {
    this.cardOf(info)?.replaceWith(this.card(info));
  }

  private render(): void {
    for (const tab of this.dialog.querySelectorAll<HTMLButtonElement>('[data-sheet]')) {
      tab.setAttribute('aria-selected', String(tab.dataset.sheet === this.kind));
    }
    this.list.replaceChildren(...CASES.filter((c) => c.kind === this.kind).map((c) => this.card(c)));
  }

  private card(info: CaseInfo): HTMLElement {
    const alg = this.store.algFor(info);
    const card = el('article', 'sheet-case');
    card.dataset.id = info.id;
    const title = el('div', 'sheet-title');
    title.append(el('strong', '', info.name), el('span', 'muted', info.group));
    const body = el('div', 'sheet-body');
    body.append(title);
    const actions = el('div', 'sheet-actions');
    if (this.editing === info.id) {
      const input = document.createElement('input');
      input.className = 'sheet-input';
      input.value = alg;
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.setAttribute('aria-label', `Algorithm for ${info.name}`);
      actions.append(actionButton('Save', 'save', 'primary small'), actionButton('Cancel', 'cancel', 'small'));
      body.append(input, el('p', 'error'), actions);
      requestAnimationFrame(() => input.focus());
    } else {
      body.append(el('div', 'sheet-alg mono', alg));
      actions.append(actionButton('Change', 'edit'));
      if (this.store.isCustom(info)) actions.append(actionButton('Back to J Perm’s', 'reset'));
      body.append(actions);
    }
    card.append(caseDiagram(info.kind, alg, 60), body);
    return card;
  }
}
