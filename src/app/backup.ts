/**
 * Backups, and the Markdown export beside them. They are two things on
 * purpose.
 *
 * A backup is one `.json` file holding every draft whole: its text, its id,
 * when it was created and last changed, where the caret and the reading were.
 * Restoring it puts back exactly that, and restoring it twice changes nothing,
 * because drafts are matched by id. It is not meant to be read; it is meant to
 * come back.
 *
 * The export is a `.zip` of plain `.md` files, one per draft, for reading or
 * taking elsewhere. Each file carries its draft's last change as its own date,
 * which is all a loose file can carry; dropping those files back in opens
 * them as drafts dated from that, but the way back in full is the backup.
 */
import type { Draft } from '../storage/types.ts';
import { SCHEMA_VERSION } from '../storage/types.ts';
import { isTextFile, newDraft, slugOf } from './model.ts';
import { strings } from './strings.ts';
import type { ZipEntry } from './zip.ts';

interface BackupFile {
  app: 'scratchpad';
  kind: 'backup';
  version: 1;
  createdAt: number;
  drafts: Draft[];
}

/** What a backup file holds, read and checked. */
export interface Backup {
  createdAt: number;
  drafts: Draft[];
}

/**
 * The date of the last backup, for the settings. A plain fact, never a
 * warning. `null` when there is nothing to back up.
 */
export function backupLabel(lastBackup: number | null, drafts: Draft[]): string | null {
  if (!drafts.some((draft) => draft.text.trim())) return null;
  if (lastBackup === null) return strings.backupNever;
  return strings.backupOn(
    new Date(lastBackup).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }),
  );
}

const day = (now: number) => {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** `scratchpad-backup-2026-10-13.json`, in local time: the day the writer sees. */
export function backupName(now = Date.now()): string {
  return `scratchpad-backup-${day(now)}.json`;
}

/** `scratchpad-markdown-2026-10-13.zip`. */
export function exportName(now = Date.now()): string {
  return `scratchpad-markdown-${day(now)}.zip`;
}

/** Every draft with text in it, whole. Empty drafts have nothing to keep. */
export function writeBackup(drafts: Draft[], now = Date.now()): string {
  const file: BackupFile = {
    app: 'scratchpad',
    kind: 'backup',
    version: 1,
    createdAt: now,
    drafts: drafts
      .filter((draft) => draft.text.trim())
      .map((draft) => ({ ...draft, schemaVersion: SCHEMA_VERSION })),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/**
 * The shape `newDraft` gives an id. A backup is a file anyone can write, and
 * the id is put into the rail's and search's markup as an attribute, so
 * anything else — a quote, a bracket — is turned away here.
 */
const DRAFT_ID = /^[\w-]{1,64}$/;

const isDraft = (value: unknown): value is Draft => {
  const draft = value as Partial<Draft> | null;
  return (
    !!draft &&
    typeof draft.id === 'string' &&
    DRAFT_ID.test(draft.id) &&
    typeof draft.text === 'string' &&
    Number.isFinite(draft.createdAt) &&
    Number.isFinite(draft.updatedAt)
  );
};

/**
 * Reads a backup file. Throws when the text is not one, so the caller can say
 * so instead of restoring nothing in silence. A draft that does not hold up is
 * skipped; the rest still come back. A date in the future — a clock off
 * somewhere, or a hand-edited file — is taken as now: the newer copy of a
 * draft wins, and one dated years ahead would win over every edit after it.
 */
export function readBackup(text: string, now = Date.now()): Backup {
  let file: Partial<BackupFile>;
  try {
    file = JSON.parse(text) as Partial<BackupFile>;
  } catch {
    throw new Error('not a backup');
  }
  if (file?.app !== 'scratchpad' || file.kind !== 'backup' || !Array.isArray(file.drafts))
    throw new Error('not a backup');
  const drafts = file.drafts.filter(isDraft).map((draft) => {
    const updatedAt = Math.min(draft.updatedAt, now);
    const restored: Draft = {
      id: draft.id,
      text: draft.text,
      createdAt: Math.min(draft.createdAt, updatedAt),
      updatedAt,
      schemaVersion: SCHEMA_VERSION,
    };
    if (Number.isFinite(draft.caret)) restored.caret = draft.caret!;
    if (Number.isFinite(draft.scroll)) restored.scroll = draft.scroll!;
    return restored;
  });
  return { createdAt: Number(file.createdAt) || 0, drafts };
}

/** One `.md` per draft, named after its title, dated by its last change. */
export function markdownEntries(drafts: Draft[]): ZipEntry[] {
  const taken = new Set<string>();
  const entries: ZipEntry[] = [];
  for (const draft of drafts) {
    if (!draft.text.trim()) continue;
    const slug = slugOf(draft.text);
    let file = `${slug}.md`;
    for (let n = 2; taken.has(file); n++) file = `${slug}-${n}.md`;
    taken.add(file);
    entries.push({ name: file, text: draft.text, modified: draft.updatedAt });
  }
  return entries;
}

/**
 * A new draft from a text file, dated by the file: a note written last week
 * comes in as last week's, not as today's. A date in the future — a clock off
 * somewhere — is taken as now.
 */
export function draftFromFile(
  text: string,
  modified: number | undefined,
  now = Date.now(),
) {
  const draft = newDraft(text.replace(/\r\n?/g, '\n'));
  draft.caret = 0;
  if (modified && Number.isFinite(modified)) {
    draft.createdAt = draft.updatedAt = Math.min(modified, now);
  }
  return draft;
}

/** The text files in a `.zip` of notes, each a new draft dated by its file. */
export function draftsFromArchive(entries: ZipEntry[], now = Date.now()): Draft[] {
  return entries
    .filter((entry) => isTextFile(entry.name) && entry.text.trim())
    .map((entry) => draftFromFile(entry.text, entry.modified, now));
}
