/**
 * The two facts the UI adapts to: which modifier key the OS uses, and whether
 * there is a keyboard at all. Both are read once; neither changes mid-session.
 */

const nav = typeof navigator === 'undefined' ? null : navigator;
const platform =
  (nav as { userAgentData?: { platform?: string } } | null)?.userAgentData?.platform ??
  nav?.platform ??
  '';

export const isMac = /mac|iphone|ipad|ipod/i.test(platform);

/** Coarse pointer and no hover: a phone or tablet, where shortcuts mean nothing. */
export const isTouch =
  typeof matchMedia === 'function' &&
  matchMedia('(pointer: coarse) and (hover: none)').matches;

/** `shortcut('K')` reads ⌘K on a Mac and Ctrl+K elsewhere. */
export function shortcut(key: string, shift = false): string {
  return isMac ? `⌘${shift ? '⇧' : ''}${key}` : `Ctrl+${shift ? 'Shift+' : ''}${key}`;
}

/**
 * The platform's command modifier, and only it: Ctrl on a Mac is not ⌘, and on
 * Windows AltGr reports as Ctrl+Alt, so any Alt rules the chord out.
 */
export function isMod(event: KeyboardEvent): boolean {
  if (event.altKey) return false;
  return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

const MAC_GLYPHS: Record<string, string> = {
  Cmd: '⌘',
  Mod: '⌘',
  Ctrl: '⌃',
  Alt: '⌥',
  Option: '⌥',
  Shift: '⇧',
};
/** Modifiers in the order the app writes them: `⌘⇧F`, `Ctrl+Shift+F`. */
const ORDER = ['Cmd', 'Mod', 'Ctrl', 'Alt', 'Option', 'Shift'];

/**
 * A chord as ByteMD and CodeMirror write it — `Cmd-Shift-C`, `Shift-Cmd-K` —
 * in the app's own notation, so every shortcut in the `?` sheet reads alike:
 * `⌘⇧C` on a Mac, `Ctrl+Shift+C` elsewhere, modifiers always in one order.
 */
export function formatChord(chord: string, mac = isMac): string {
  const parts = chord.split(/-(?!$)/);
  const key = parts.pop() ?? '';
  const mods = parts.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  if (!mac) return [...mods.map((mod) => (mod === 'Mod' ? 'Ctrl' : mod)), key].join('+');
  return mods.map((mod) => MAC_GLYPHS[mod] ?? mod).join('') + key;
}

/**
 * The letter a shortcut is matched on, lowercased. `key` is the letter the
 * layout prints, which is what a shortcut means on AZERTY or Dvorak. A layout
 * that prints no Latin letter at all — Russian, Greek, Hebrew — sends `ф`
 * where ⌘⇧F is wanted, so there the key's place on the board, `code`, says
 * which one it is, as Chrome's own shortcuts do.
 */
export function shortcutKey(event: Pick<KeyboardEvent, 'key' | 'code'>): string {
  const key = event.key.toLowerCase();
  if (/^[a-z]$/.test(key)) return key;
  const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
  return letter ? letter.toLowerCase() : key;
}

/**
 * How wide the page's scrollbars are: 0 where they float over the content
 * (macOS by default), their width where they take a column of their own
 * (Windows, Linux, a Mac set to always show them). Measured, not guessed from
 * the OS: a Mac can have either.
 */
export function scrollbarWidth(): number {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:absolute;top:-999px;width:100px;height:100px;overflow:scroll';
  document.body.append(probe);
  const width = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return width;
}
