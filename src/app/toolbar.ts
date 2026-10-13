/**
 * Keyboard access to ByteMD's toolbar, which ships as a row of bare `div`s:
 * nothing in it takes focus, and its own keydown listener only fires on the
 * bar itself, which cannot be focused either. Everything here is added on top
 * of its markup, again after each redraw.
 *
 * The bar becomes one tab stop, as a toolbar should be: the arrows walk its
 * buttons in the order they are seen — `bytemd.css` reorders the right half,
 * so the order on screen is not the order in the DOM — and Home and End jump
 * to either end. Enter or space presses the button. A button with a menu
 * (headings, diagrams) opens it on focus, the way it opens on hover; ↓ steps
 * into the menu, the arrows move inside it, and escape steps back out. Escape
 * on the bar hands the caret back to the text.
 *
 * ByteMD keeps each button's title in the tooltip it builds on hover or
 * focus, not in the markup, so a button is named from that tooltip the first
 * time it is focused — which is before a screen reader announces it.
 */
import { step } from './find.ts';

const ICON = '.bytemd-toolbar-icon';
const ITEM = '.bytemd-dropdown-item';

interface Tippy {
  props: { content: unknown };
  popper: HTMLElement;
}

const tippyOf = (el: HTMLElement) => (el as HTMLElement & { _tippy?: Tippy })._tippy;

const shown = (el: HTMLElement) =>
  el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

/** Left to right, then top to bottom: the bar wraps to two rows on a phone. */
function onScreen(els: HTMLElement[]): HTMLElement[] {
  const at = new Map(els.map((el) => [el, el.getBoundingClientRect()] as const));
  return els.sort((a, b) => {
    const ra = at.get(a)!;
    const rb = at.get(b)!;
    return Math.abs(ra.top - rb.top) > ra.height / 2
      ? ra.top - rb.top
      : ra.left - rb.left;
  });
}

/**
 * The tooltip's text: a plain title, or a menu's heading. Some menus have no
 * heading (ByteMD's headings, the maths), and are named by what is in them.
 */
function titleOf(el: HTMLElement): string {
  const content = tippyOf(el)?.props.content;
  if (typeof content !== 'string') return '';
  if (!content.startsWith('<')) return content;
  const markup = document.createElement('template');
  markup.innerHTML = content;
  const heading = markup.content.querySelector('.bytemd-dropdown-title')?.textContent;
  if (heading) return heading;
  return [...markup.content.querySelectorAll('.bytemd-dropdown-item-title')]
    .map((title) => title.textContent)
    .join(', ');
}

export function keyboardToolbar(
  host: HTMLElement,
  label: string,
  backToText: () => void,
): { refresh(): void } {
  let bar: HTMLElement | null = null;
  /** Kept across redraws, so tabbing back lands where the arrows left off. */
  let current: HTMLElement | null = null;

  const icons = () =>
    onScreen([...(bar?.querySelectorAll<HTMLElement>(ICON) ?? [])].filter(shown));

  function rove(to: HTMLElement | undefined) {
    if (!to) return;
    for (const icon of icons()) icon.tabIndex = icon === to ? 0 : -1;
    current = to;
    to.focus({ preventScroll: true });
  }

  /** Every button focusable by script, and exactly one by tab. */
  function refresh() {
    bar = host.querySelector<HTMLElement>('.bytemd-toolbar');
    if (!bar) return;
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', label);
    const all = icons();
    if (!current || !all.includes(current)) current = all[0] ?? null;
    for (const icon of all) {
      icon.setAttribute('role', 'button');
      icon.tabIndex = icon === current ? 0 : -1;
    }
    for (const item of bar.querySelectorAll<HTMLElement>(ITEM)) {
      item.setAttribute('role', 'menuitem');
      item.tabIndex = -1;
    }
  }

  host.addEventListener('focusin', (event) => {
    const icon = (event.target as HTMLElement).closest<HTMLElement>(ICON);
    // A button with words on it (the views) is already named by them.
    if (!icon || icon.hasAttribute('aria-label') || icon.textContent?.trim()) return;
    const title = titleOf(icon);
    if (title) icon.setAttribute('aria-label', title);
  });

  host.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    const item = target.closest<HTMLElement>(ITEM);
    const icon = item ? null : target.closest<HTMLElement>(ICON);
    if (!item && !icon) return;

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      target.click();
      // A menu's choice is made: the menu goes, and the caret goes back to
      // where the choice was written.
      if (item) backToText();
      return;
    }

    if (item) {
      const menu = [...item.parentElement!.querySelectorAll<HTMLElement>(ITEM)];
      const at = menu.indexOf(item);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        menu[step(at, event.key === 'ArrowDown' ? 1 : -1, menu.length)]?.focus({
          preventScroll: true,
        });
      } else if (event.key === 'Escape' || event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopPropagation();
        current?.focus({ preventScroll: true });
      }
      return;
    }

    const all = icons();
    const at = all.indexOf(icon!);
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      rove(all[step(at, event.key === 'ArrowRight' ? 1 : -1, all.length)]);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      rove(event.key === 'Home' ? all[0] : all[all.length - 1]);
    } else if (event.key === 'ArrowDown') {
      // The menu is the tooltip ByteMD opened on focus, this button's own;
      // a button without a menu has nothing below it.
      const first = tippyOf(icon!)?.popper.querySelector<HTMLElement>(ITEM);
      if (first) {
        event.preventDefault();
        refresh();
        first.focus({ preventScroll: true });
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      backToText();
    }
  });

  // ByteMD builds a menu's items when it opens; they are given their role
  // and made reachable as they arrive.
  new MutationObserver(() => {
    for (const item of host.querySelectorAll<HTMLElement>(`${ITEM}:not([role])`)) {
      item.setAttribute('role', 'menuitem');
      item.tabIndex = -1;
    }
  }).observe(host.querySelector('.bytemd-toolbar') ?? host, {
    childList: true,
    subtree: true,
  });

  return { refresh };
}
