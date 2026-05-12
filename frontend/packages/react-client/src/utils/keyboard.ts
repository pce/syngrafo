const PRESERVE_TARGET_FOCUS_SELECTOR = [
  "input",
  "textarea",
  "select",
  "option",
  "[contenteditable]",
  "[contenteditable='true']",
  "[contenteditable='plaintext-only']",
  "[role='textbox']",
].join(", ");

const IGNORE_SHORTCUT_TARGET_SELECTOR = [
  PRESERVE_TARGET_FOCUS_SELECTOR,
  "a[href]",
  "summary",
].join(", ");

function isMatchingTarget(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && !!target.closest(selector);
}

export function shouldPreserveTargetFocus(target: EventTarget | null): boolean {
  return isMatchingTarget(target, PRESERVE_TARGET_FOCUS_SELECTOR);
}

export function shouldIgnoreShortcutTarget(target: EventTarget | null): boolean {
  return isMatchingTarget(target, IGNORE_SHORTCUT_TARGET_SELECTOR);
}

export function ownsKeyboardFocus(container: HTMLElement | null, active: Element | null): boolean {
  if (!container) return false;
  return active === document.body
    || active === container
    || !!container.contains(active);
}

export function shouldHandleOwnedShortcut(
  container: HTMLElement | null,
  active: Element | null,
): boolean {
  return ownsKeyboardFocus(container, active) && !shouldIgnoreShortcutTarget(active);
}

export function focusElementWithoutScroll(target: HTMLElement | null): void {
  if (!target || document.activeElement === target) return;
  target.focus({ preventScroll: true });
}

export function isCoarsePointerEnvironment(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(pointer: coarse)").matches;
}
