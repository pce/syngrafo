function escapeAttrValue(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function queryBlockTarget(blockId: string, selector: string): HTMLElement | null {
  const blockSelector = `[data-block-id="${escapeAttrValue(blockId)}"]`;
  return document.querySelector<HTMLElement>(`${blockSelector}${selector}, ${blockSelector} ${selector}`);
}

function focusElement(target: HTMLElement | null): void {
  if (!target || document.activeElement === target) return;
  target.focus({ preventScroll: true });
}

function moveCaretToEnd(target: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function focusBlockNavigationTarget(blockId: string): void {
  focusElement(queryBlockTarget(blockId, `[data-block-focus-target="true"]`));
}

export function focusBlockEditable(blockId: string, moveCaret = false): void {
  const target = queryBlockTarget(blockId, `[data-block-editable="true"]`);
  if (!target) return;
  focusElement(target);
  if (moveCaret) moveCaretToEnd(target);
}
