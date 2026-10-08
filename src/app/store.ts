/**
 * In-memory state plus the autosave policy. Everything the UI needs to draw is
 * here; nothing here touches IndexedDB directly — it goes through DraftStore.
 */
import type { Draft, DraftStore, PrefsStore, ThemeChoice } from '../storage/types.ts';
import { newDraft } from './model.ts';
import { strings } from './strings.ts';

/**
 * What the editor pane shows: the source alone, the source with the preview
 * beside it, or the preview alone for reading.
 */
export type Mode = 'write' | 'split' | 'read';

export interface State {
  drafts: Draft[];
  activeId: string | null;
  mode: Mode;
  theme: ThemeChoice;
  searchOpen: boolean;
  /** The drafts list, when it is an overlay (narrow screens) rather than a rail. */
  railOpen: boolean;
  query: string;
  cursor: number;
  status: string;
  /**
   * Whether typed text is still waiting for the disk. The footer says "saved"
   * only once it is false, so the word means what it says.
   */
  saving: boolean;
  /** The delete button was pressed once and waits for a second press. */
  pendingDelete: boolean;
  /** A draft was just deleted and can still be brought back. */
  deleted: boolean;
  loaded: boolean;
}

const SAVE_DEBOUNCE = 250;
/** How long a deleted draft can be brought back from the footer. */
const UNDO_WINDOW = 6000;
/**
 * Synchronous mirror of the drafts being written. IndexedDB writes are async and
 * a tab that closes right after a keystroke may cut one short; localStorage is
 * synchronous, so the last character always survives and boot reconciles it.
 *
 * The value is a list, because more than one draft can be waiting at once. The
 * shape before it was a lone draft, which `readMirror` still accepts: a writer
 * upgrading mid-sentence would otherwise lose exactly the keystroke this key
 * exists to keep.
 */
const PENDING_KEY = 'scratchpad.pending.v1';

interface Pending {
  draft: Draft;
  /** Ordering marker, so a finished write can tell whether it is stale. */
  revision: number;
  /** Whether this draft's text is in the synchronous mirror. */
  mirrored: boolean;
}

/** `theme` is the synchronous best guess, so the first paint does not flash. */
export function createStore(drafts: DraftStore, prefs: PrefsStore, theme: ThemeChoice) {
  const state: State = {
    drafts: [],
    activeId: null,
    mode: 'write',
    theme,
    searchOpen: false,
    railOpen: false,
    query: '',
    cursor: 0,
    status: '',
    saving: false,
    pendingDelete: false,
    deleted: false,
    loaded: false,
  };

  const listeners = new Set<(state: State) => void>();
  let saveTimer: number | undefined;
  /**
   * The drafts waiting to be written, keyed by id. One slot used to be enough
   * until it wasn't: creating, deleting or merely switching drafts schedules a
   * save for a *different* draft, and inside the debounce that dropped the
   * pending write of the draft being left behind — along with its mirror.
   */
  const dirty = new Map<string, Pending>();
  let revision = 0;
  let statusTimer: number | undefined;
  /**
   * The draft the last delete took, and the empty one created in its place
   * when it was the only draft — which undoing makes pointless again.
   */
  let undo: { draft: Draft; replacement: string | null } | null = null;
  let undoTimer: number | undefined;

  const notify = () => listeners.forEach((listener) => listener(state));

  function active(): Draft | null {
    return state.drafts.find((draft) => draft.id === state.activeId) ?? null;
  }

  function sort() {
    state.drafts.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Text waiting for the disk, not a caret or a scroll position: those save
   * too, but an arrow key that flipped the footer to "saving" would be noise.
   * Returns whether it changed, so the async path knows to repaint.
   */
  function syncSaving(): boolean {
    const saving = [...dirty.values()].some((entry) => entry.mirrored);
    if (saving === state.saving) return false;
    state.saving = saving;
    return true;
  }

  function forgetUndo() {
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = undefined;
    undo = null;
    state.deleted = false;
  }

  /**
   * Rewrites the mirror from what is still pending, which is the only way it
   * can never be cleared out from under an unsaved keystroke. Caret-only moves
   * stay out of it — a whole draft written on every arrow key is not worth it —
   * except under `all`, which is the tab going away for good.
   */
  function mirror(all = false) {
    const pending = [...dirty.values()]
      .filter((entry) => all || entry.mirrored)
      .map((entry) => entry.draft);
    try {
      if (pending.length) localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
      else localStorage.removeItem(PENDING_KEY);
    } catch {
      /* private mode or full profile: the debounced save still runs */
    }
  }

  /** Reads both shapes: the list written now, and the lone draft written before. */
  function readMirror(): Draft[] {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Draft | Draft[];
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  }

  /**
   * Writes everything that is waiting. A draft stops being pending only once
   * its write has landed: a rejected put keeps both the draft and its mirror,
   * so the next keystroke or flush tries again instead of leaving the footer
   * claiming a save that never happened.
   */
  async function flush() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = undefined;
    let failed = false;
    for (const [id, entry] of [...dirty]) {
      try {
        await drafts.put(entry.draft);
      } catch {
        failed = true;
        continue;
      }
      // Only the revision just written is cleared. A draft is one mutable
      // object and the put copied it as it was at the call, so an edit that
      // landed while it was in flight is not covered by it and stays pending.
      if (dirty.get(id)?.revision === entry.revision) dirty.delete(id);
    }
    mirror();
    if (syncSaving()) notify();
    if (failed) api.flash(strings.saveFailed);
  }

  function scheduleSave(draft: Draft, textChanged = true) {
    dirty.set(draft.id, {
      draft,
      revision: ++revision,
      mirrored: textChanged || (dirty.get(draft.id)?.mirrored ?? false),
    });
    if (textChanged) mirror();
    syncSaving();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void flush(), SAVE_DEBOUNCE);
  }

  const api = {
    get state() {
      return state;
    },
    active,
    subscribe(listener: (state: State) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /**
     * Loads what is on disk. Anything typed before this lands is kept.
     *
     * `typedBeforeLoad` is a getter, not a string, and that matters: it is read
     * when the disk answers, not when the load starts. `write` has nowhere to
     * put a keystroke until there is an active draft, so everything typed
     * during the gap lives only in the editor — reading it eagerly would
     * capture the empty document the editor was born with and then overwrite
     * the writer's first sentence with what came off the disk.
     */
    async load(typedBeforeLoad: () => string) {
      const [stored, saved] = await Promise.all([drafts.all(), prefs.read()]);
      state.drafts = stored;

      // The mirror wins unless the disk is strictly newer. Each survivor is
      // scheduled rather than written here: a put that fails during boot must
      // not take the mirror — or the load — down with it, and `flush` already
      // knows how to hold on and try again.
      for (const pending of readMirror()) {
        const known = state.drafts.find((draft) => draft.id === pending.id);
        if (known && known.updatedAt > pending.updatedAt) continue;
        state.drafts = [
          pending,
          ...state.drafts.filter((draft) => draft.id !== pending.id),
        ];
        scheduleSave(pending);
      }
      // Drops whatever the disk had already superseded.
      mirror();

      if (saved.theme) state.theme = saved.theme;
      state.activeId =
        (saved.activeId && state.drafts.some((draft) => draft.id === saved.activeId)
          ? saved.activeId
          : state.drafts[0]?.id) ?? null;

      // Characters typed while the disk was still answering become their own
      // draft: nothing the writer typed is ever thrown away.
      const typed = typedBeforeLoad();
      if (typed.trim()) {
        const draft = newDraft(typed);
        state.drafts.unshift(draft);
        state.activeId = draft.id;
        scheduleSave(draft);
      } else if (!state.drafts.length) {
        const draft = newDraft();
        state.drafts.push(draft);
        state.activeId = draft.id;
      }

      sort();
      state.loaded = true;
      notify();
      return active();
    },

    write(text: string, caret: number) {
      const draft = active();
      if (!draft) return;
      draft.text = text;
      draft.caret = caret;
      draft.updatedAt = Date.now();
      state.pendingDelete = false;
      scheduleSave(draft);
      notify();
    },

    moveCaret(caret: number) {
      const draft = active();
      if (!draft || draft.caret === caret) return;
      draft.caret = caret;
      scheduleSave(draft, false);
    },

    /** Where the reading view stands, as a fraction; see `Draft.scroll`. */
    moveScroll(scroll: number) {
      const draft = active();
      if (!draft || draft.scroll === scroll) return;
      draft.scroll = scroll;
      scheduleSave(draft, false);
    },

    open(id: string) {
      // Opening the draft that is already active still means "take me to it":
      // it closes search and leaves preview. Returning early skipped that.
      const same = state.activeId === id;
      state.activeId = id;
      state.searchOpen = false;
      state.railOpen = false;
      state.query = '';
      state.mode = 'write';
      state.pendingDelete = false;
      if (!same) void prefs.write({ activeId: id });
      notify();
    },

    /**
     * A new draft, empty or holding a dropped file. A file opens at its top:
     * the caret is where the reading starts, not past the last line.
     */
    create(text = '') {
      const draft = newDraft(text);
      draft.caret = 0;
      state.drafts.unshift(draft);
      state.activeId = draft.id;
      state.mode = 'write';
      state.searchOpen = false;
      state.railOpen = false;
      state.query = '';
      state.pendingDelete = false;
      void prefs.write({ activeId: draft.id });
      scheduleSave(draft);
      notify();
    },

    /** Deleting only asks when there is something to lose. */
    requestDelete(): 'confirm' | 'deleted' {
      const draft = active();
      if (!draft) return 'deleted';
      if (draft.text.trim() && !state.pendingDelete) {
        state.pendingDelete = true;
        notify();
        return 'confirm';
      }
      void api.remove();
      return 'deleted';
    },

    cancelDelete() {
      if (!state.pendingDelete) return;
      state.pendingDelete = false;
      notify();
    },

    /**
     * Deletes the active draft. Once confirmed it goes at once, and the footer
     * still offers it back for a few seconds. An empty draft has nothing to
     * bring back, so it goes without the offer.
     */
    async remove() {
      const draft = active();
      if (!draft) return;
      forgetUndo();
      state.pendingDelete = false;
      state.drafts = state.drafts.filter((other) => other.id !== draft.id);
      if (dirty.delete(draft.id)) mirror();
      syncSaving();
      let replacement: string | null = null;
      if (!state.drafts.length) {
        const fresh = newDraft();
        state.drafts.push(fresh);
        replacement = fresh.id;
        scheduleSave(fresh);
      }
      if (draft.text.trim()) {
        undo = { draft, replacement };
        state.deleted = true;
        undoTimer = window.setTimeout(() => {
          forgetUndo();
          notify();
        }, UNDO_WINDOW);
      }
      // The next draft is on screen before the disk is asked to forget this one.
      state.activeId = state.drafts[0]?.id ?? null;
      void prefs.write({ activeId: state.activeId });
      notify();
      await drafts.remove(draft.id);
    },

    /**
     * Brings the last deleted draft back where it was in the rail. The disk
     * already forgot it, so it is written again; the empty draft that stood
     * in for it goes, unless something was typed there in the meantime.
     */
    undoRemove(): boolean {
      if (!undo) return false;
      const { draft, replacement } = undo;
      forgetUndo();
      const stand = state.drafts.find((other) => other.id === replacement);
      if (stand && !stand.text.trim()) {
        state.drafts = state.drafts.filter((other) => other !== stand);
        if (dirty.delete(stand.id)) mirror();
        void drafts.remove(stand.id);
      }
      state.drafts.push(draft);
      sort();
      state.activeId = draft.id;
      void prefs.write({ activeId: draft.id });
      scheduleSave(draft);
      notify();
      return true;
    },

    setMode(mode: Mode) {
      if (state.mode === mode) return;
      state.mode = mode;
      notify();
    },

    /**
     * Each view button is a switch back to writing: pressing the one already on
     * returns to `write`, pressing the other goes straight to it — split to
     * read, or read to split, with no stop in between.
     */
    toggleMode(mode: Exclude<Mode, 'write'>) {
      api.setMode(state.mode === mode ? 'write' : mode);
    },

    setTheme(theme: ThemeChoice) {
      state.theme = theme;
      void prefs.write({ theme });
      notify();
    },

    setSearch(open: boolean) {
      state.searchOpen = open;
      if (open) state.railOpen = false;
      state.query = '';
      state.cursor = 0;
      notify();
    },

    setRail(open: boolean) {
      if (state.railOpen === open) return;
      state.railOpen = open;
      notify();
    },

    setQuery(query: string) {
      state.query = query;
      state.cursor = 0;
      notify();
    },

    moveCursor(delta: number, total: number) {
      state.cursor = Math.max(0, Math.min(state.cursor + delta, Math.max(total - 1, 0)));
      notify();
    },

    flash(message: string) {
      state.status = message;
      notify();
      if (statusTimer) clearTimeout(statusTimer);
      statusTimer = window.setTimeout(() => {
        state.status = '';
        notify();
      }, 1800);
    },

    flush,
    /** Last-resort save when the tab is going away: synchronous by design. */
    flushSync() {
      // Nothing is coming after this, so the caret rides along too.
      mirror(true);
    },
  };

  return api;
}
