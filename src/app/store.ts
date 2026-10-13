/**
 * In-memory state plus the autosave policy. Everything the UI needs to draw is
 * here; nothing here touches IndexedDB directly — it goes through DraftStore.
 */
import type {
  Draft,
  DraftEvent,
  DraftStore,
  DraftSync,
  PrefsStore,
  ThemeChoice,
} from '../storage/types.ts';
import { newDraft } from './model.ts';

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
  /** The find-and-replace bar over the source. */
  findOpen: boolean;
  /** The settings panel: backup, export, theme, about. */
  settingsOpen: boolean;
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
  /**
   * The last write was refused. It stays true — the footer keeps saying so —
   * until a write lands, which the store keeps retrying on its own.
   */
  saveFailed: boolean;
  /** The delete button was pressed once and waits for a second press. */
  pendingDelete: boolean;
  /** A draft was just deleted and can still be brought back. */
  deleted: boolean;
  /** When that delete happened, so the undo countdown restarts on each one. */
  deletedAt: number;
  /**
   * A version updated to whose news has not been looked at yet. Settings is
   * flagged until it is opened; the About section points at it while open.
   */
  whatsNew: string | null;
  /** When every draft was last backed up; the rail says how long ago. */
  lastBackup: number | null;
  /**
   * Bumped whenever the open draft's text is replaced from outside the editor
   * — another tab, a restored backup — so the page knows to load it again.
   * Typing never bumps it: the editor already holds what was typed.
   */
  replaced: number;
  loaded: boolean;
  /**
   * The disk could not be read at boot. The page still opens, on a draft of
   * its own, so whatever is typed is kept and saved if the disk lets it; the
   * footer says so until the tab is reloaded.
   */
  loadFailed: boolean;
}

const SAVE_DEBOUNCE = 250;
/** How soon a refused write is tried again, with nothing typed to prompt it. */
const SAVE_RETRY = 3000;
/** How long a deleted draft can be brought back from the footer. */
export const UNDO_WINDOW = 3000;
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

/** What a restore does, or would do: drafts added, updated, already here. */
export interface ImportPreview {
  added: number;
  updated: number;
  same: number;
}

const noSync: DraftSync = { publish() {}, subscribe() {} };

/** `theme` is the synchronous best guess, so the first paint does not flash. */
export function createStore(
  drafts: DraftStore,
  prefs: PrefsStore,
  theme: ThemeChoice,
  sync: DraftSync = noSync,
) {
  const state: State = {
    drafts: [],
    activeId: null,
    mode: 'write',
    theme,
    searchOpen: false,
    findOpen: false,
    settingsOpen: false,
    railOpen: false,
    query: '',
    cursor: 0,
    status: '',
    saving: false,
    saveFailed: false,
    pendingDelete: false,
    deleted: false,
    deletedAt: 0,
    whatsNew: null,
    lastBackup: null,
    replaced: 0,
    loaded: false,
    loadFailed: false,
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
  /** What other tabs said before this one had read the disk. */
  const early: DraftEvent[] = [];
  /**
   * The blank draft put up here when another tab deleted the last one. That
   * tab writes a blank of its own in its place, and when it arrives this one
   * gives way to it, rather than leaving two "untitled" behind.
   */
  let standIn: string | null = null;

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
   * and the footer says "not saved" until a later flush — the next keystroke,
   * or the retry scheduled here — gets it through.
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
      sync.publish({ type: 'put', draft: entry.draft });
      // Only the revision just written is cleared. A draft is one mutable
      // object and the put copied it as it was at the call, so an edit that
      // landed while it was in flight is not covered by it and stays pending.
      if (dirty.get(id)?.revision === entry.revision) dirty.delete(id);
    }
    mirror();
    const changed = syncSaving();
    if (failed !== state.saveFailed) {
      state.saveFailed = failed;
      notify();
    } else if (changed) notify();
    if (failed && !saveTimer)
      saveTimer = window.setTimeout(() => void flush(), SAVE_RETRY);
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

  /**
   * Takes in a draft written elsewhere — by another tab, or out of a backup —
   * if it is newer than the copy here. The copy is updated in place: a save
   * already queued for it holds the same object, so it writes the newer text
   * instead of putting the stale one back. The open draft keeps this tab's
   * caret and reading position; only its text moves.
   */
  function adopt(incoming: Draft): 'added' | 'updated' | 'kept' {
    const local = state.drafts.find((draft) => draft.id === incoming.id);
    if (!local) {
      state.drafts.push({ ...incoming });
      return 'added';
    }
    if (local.updatedAt >= incoming.updatedAt || local.text === incoming.text)
      return 'kept';
    const { caret, scroll } = local;
    Object.assign(local, incoming);
    if (local.id === state.activeId) {
      if (caret === undefined) delete local.caret;
      else local.caret = caret;
      if (scroll === undefined) delete local.scroll;
      else local.scroll = scroll;
      state.replaced += 1;
    }
    return 'updated';
  }

  /**
   * How a draft from a backup relates to what is here: new, newer than the
   * copy here, or nothing to do — the same text, or an older one. `coming` is
   * the text a preview has already counted in, so it adds up to what the
   * restore itself would do when the backup holds the same text twice.
   */
  function classify(incoming: Draft, coming?: Set<string>): keyof ImportPreview {
    const local = state.drafts.find((draft) => draft.id === incoming.id);
    if (!local) {
      const here =
        coming?.has(incoming.text) ||
        state.drafts.some((draft) => draft.text === incoming.text);
      return here ? 'same' : 'added';
    }
    if (local.text === incoming.text || local.updatedAt >= incoming.updatedAt)
      return 'same';
    return 'updated';
  }

  /**
   * An empty draft has nothing to keep, so leaving it — for another draft or
   * a new one — takes it away. Without this, every ⌘⇧D left one more
   * "untitled" behind in the rail, and they stayed there after a reload.
   */
  function dropIfEmpty(id: string | null) {
    const draft = state.drafts.find((other) => other.id === id);
    if (!draft || draft.text.trim()) return;
    state.drafts = state.drafts.filter((other) => other !== draft);
    if (dirty.delete(draft.id)) mirror();
    syncSaving();
    void drafts.remove(draft.id).then(
      () => sync.publish({ type: 'remove', id: draft.id, ifEmpty: true }),
      () => {
        /* never written, or the disk is away: nothing there to clear */
      },
    );
  }

  /** A draft taken up — opened or created: every panel closes onto its text. */
  function toWriting() {
    state.mode = 'write';
    state.searchOpen = false;
    state.settingsOpen = false;
    state.railOpen = false;
    state.query = '';
    state.pendingDelete = false;
  }

  /**
   * A draft another tab deleted, or cleared away as empty. One it cleared
   * away stays here if it is not empty here — typed into before that tab saw
   * it — and is written back, since the disk just lost it; and it stays if it
   * is the page open here, which is where the next keystroke goes.
   */
  function forget(id: string, ifEmpty = false) {
    const local = state.drafts.find((draft) => draft.id === id);
    if (!local) return;
    if (ifEmpty && (local.text.trim() || id === state.activeId)) {
      if (local.text.trim()) scheduleSave(local);
      return;
    }
    state.drafts = state.drafts.filter((draft) => draft !== local);
    if (dirty.delete(id)) mirror();
    syncSaving();
    if (state.activeId !== id) return;
    state.pendingDelete = false;
    // The other tab writes the empty draft it put in its place, and that
    // arrives here too; this one only holds the page up until it does.
    if (!state.drafts.length) {
      const fresh = newDraft();
      state.drafts.push(fresh);
      standIn = fresh.id;
    }
    state.activeId = state.drafts[0]!.id;
  }

  /** The blank another tab wrote arrived: the stand-in here gives way to it. */
  function giveWay(incoming: Draft) {
    const stand = state.drafts.find((draft) => draft.id === standIn);
    if (!stand || stand.text.trim()) {
      standIn = null;
      return;
    }
    if (incoming.text.trim()) return;
    standIn = null;
    if (state.activeId === stand.id) state.activeId = incoming.id;
    dropIfEmpty(stand.id);
  }

  function receive(event: DraftEvent) {
    if (!state.loaded) {
      early.push(event);
      return;
    }
    if (event.type === 'put') {
      if (adopt(event.draft) === 'added' && standIn) giveWay(event.draft);
    } else forget(event.id, event.ifEmpty);
    sort();
    notify();
  }

  sync.subscribe(receive);

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
      // A disk that cannot be read must not leave the page without a draft:
      // `write` would have nowhere to put a keystroke, not even the mirror.
      const [stored, saved] = await Promise.all([
        drafts.all().catch(() => {
          state.loadFailed = true;
          return [];
        }),
        prefs.read(),
      ]);
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
      if (saved.lastBackup !== undefined) state.lastBackup = saved.lastBackup;
      // Kept on the disk until settings is opened: a flag nobody saw in the
      // session it arrived in is still there in the next one.
      if (saved.whatsNew) state.whatsNew = saved.whatsNew;
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

      // Empty drafts left behind before they were cleared on the way out.
      for (const empty of state.drafts.filter((draft) => draft.id !== state.activeId))
        dropIfEmpty(empty.id);

      sort();
      state.loaded = true;
      for (const event of early.splice(0)) receive(event);
      notify();
      return active();
    },

    write(text: string, caret: number) {
      const draft = active();
      if (!draft) return;
      draft.text = text;
      draft.caret = caret;
      // Never backwards, even against a clock that has been wrong: the disk
      // and the other tabs keep whichever copy is newer, and this one is.
      draft.updatedAt = Math.max(Date.now(), draft.updatedAt + 1);
      state.pendingDelete = false;
      // The rail is ordered by the last change, and this is one: the draft
      // being written moves to the top now, not at the next reload.
      sort();
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
      if (!same) dropIfEmpty(state.activeId);
      state.activeId = id;
      toWriting();
      if (!same) void prefs.write({ activeId: id });
      notify();
    },

    /**
     * A new draft, empty or holding a dropped file. A file opens at its top:
     * the caret is where the reading starts, not past the last line. `at`
     * dates the draft, for a dropped file: it comes in as old as the file is,
     * never later than now.
     *
     * Asked for an empty one while the open draft is empty, it is that draft:
     * there is already a blank page on screen. Returns whether a draft was
     * made.
     */
    create(text = '', at?: number): boolean {
      const open = active();
      if (!text && open && !open.text.trim()) {
        toWriting();
        notify();
        return false;
      }
      dropIfEmpty(state.activeId);
      const draft = newDraft(text);
      draft.caret = 0;
      if (at !== undefined && Number.isFinite(at)) {
        draft.createdAt = draft.updatedAt = Math.min(at, draft.updatedAt);
      }
      state.drafts.unshift(draft);
      state.activeId = draft.id;
      toWriting();
      void prefs.write({ activeId: draft.id });
      scheduleSave(draft);
      notify();
      return true;
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
        state.deletedAt = Date.now();
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
      sync.publish({ type: 'remove', id: draft.id });
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
      dropIfEmpty(replacement);
      state.drafts.push(draft);
      sort();
      state.activeId = draft.id;
      void prefs.write({ activeId: draft.id });
      scheduleSave(draft);
      notify();
      return true;
    },

    /** What restoring these drafts would do, without doing it. */
    previewImport(incoming: Draft[]): ImportPreview {
      const preview = { added: 0, updated: 0, same: 0 };
      const coming = new Set<string>();
      for (const draft of incoming) {
        const kind = classify(draft, coming);
        preview[kind] += 1;
        if (kind !== 'same') coming.add(draft.text);
      }
      return preview;
    },

    /**
     * Drafts out of a backup or a zip of notes. Each one is written to the
     * disk only if it is new here or newer than the copy here; a draft whose
     * text is already here word for word — the same notes restored twice — is
     * not added again. Once something came in, empty drafts go: the blank one
     * a fresh install opens with has nothing to keep and would only sit on
     * top of what was restored.
     */
    importDrafts(incoming: Draft[]): ImportPreview {
      const outcome = { added: 0, updated: 0, same: 0 };
      for (const draft of incoming) {
        const kind = classify(draft);
        outcome[kind] += 1;
        if (kind === 'same') continue;
        adopt(draft);
        scheduleSave(state.drafts.find((other) => other.id === draft.id)!);
      }
      if (outcome.added + outcome.updated) {
        for (const empty of state.drafts.filter((draft) => !draft.text.trim()))
          dropIfEmpty(empty.id);
      }
      sort();
      if (!state.drafts.some((draft) => draft.id === state.activeId)) {
        state.activeId = state.drafts[0]?.id ?? null;
        void prefs.write({ activeId: state.activeId });
      }
      notify();
      return outcome;
    },

    markBackedUp(at = Date.now()) {
      state.lastBackup = at;
      void prefs.write({ lastBackup: at });
      notify();
    },

    setMode(mode: Mode) {
      if (state.mode === mode) return;
      state.mode = mode;
      // Reading has no source to search; Chrome's own find covers the page.
      if (mode === 'read') state.findOpen = false;
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

    setFind(open: boolean) {
      if (state.findOpen === open) return;
      state.findOpen = open;
      notify();
    },

    /**
     * Opening settings is seeing the news: it is cleared on the disk at once,
     * but stays marked in the About section until the panel closes.
     */
    setSettings(open: boolean) {
      if (state.settingsOpen === open) return;
      state.settingsOpen = open;
      if (state.whatsNew) {
        if (open) void prefs.write({ whatsNew: null });
        else state.whatsNew = null;
      }
      if (open) {
        state.searchOpen = false;
        state.railOpen = false;
        state.pendingDelete = false;
      }
      notify();
    },

    setSearch(open: boolean) {
      state.searchOpen = open;
      if (open) {
        state.railOpen = false;
        state.settingsOpen = false;
      }
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
