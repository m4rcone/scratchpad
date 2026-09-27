/**
 * Follows the system by default; a pinned choice wins over it. The choice is
 * mirrored in localStorage because the real preference store answers
 * asynchronously, and a pinned theme must not flash the other one first.
 */
import type { ThemeChoice } from '../storage/types.ts';

const MIRROR_KEY = 'scratchpad.theme.v1';
const THEMES: ThemeChoice[] = ['system', 'dark', 'light'];

let applied: ThemeChoice | null = null;

/** The synchronous best guess for the first paint. */
export function bootTheme(): ThemeChoice {
  try {
    const raw = localStorage.getItem(MIRROR_KEY) as ThemeChoice | null;
    return raw && THEMES.includes(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(choice: ThemeChoice): void {
  if (choice === applied) return;
  applied = choice;
  if (choice === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  try {
    localStorage.setItem(MIRROR_KEY, choice);
  } catch {
    /* the preference store still has it; only the first paint may flash */
  }
}

export function systemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function effectiveTheme(choice: ThemeChoice): 'dark' | 'light' {
  return choice === 'system' ? systemTheme() : choice;
}
