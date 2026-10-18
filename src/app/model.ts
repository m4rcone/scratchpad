/** Pure helpers over a draft: title, slug, snippet, counters and grouping. */
import type { Draft } from '../storage/types.ts';
import { SCHEMA_VERSION } from '../storage/types.ts';
import { strings } from './strings.ts';
import { parseLine, readFrontMatter } from './syntax.ts';
import type { FrontMatter } from './syntax.ts';

export function newDraft(text = ''): Draft {
  const now = Date.now();
  return {
    id: `d${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    text,
    createdAt: now,
    updatedAt: now,
    schemaVersion: SCHEMA_VERSION,
    caret: text.length,
  };
}

/**
 * The front matter of the last draft read. The rail and search ask for a
 * draft's title and then its snippet, and both start from it.
 */
let lastRead: { text: string; front: FrontMatter } | null = null;

function frontMatterOf(text: string): FrontMatter {
  if (lastRead?.text !== text) lastRead = { text, front: readFrontMatter(text) };
  return lastRead.front;
}

/**
 * The title is the first non-empty line — never a dialog asking for a name —
 * read the way the preview would show it: without the block marker in front
 * (heading, quote, list, task box) and with inline markup reduced to its text.
 * A draft that opens with `- [ ] ship [the fix](https://…)` is titled
 * "ship the fix", not with the URL. Underscores are left alone, since they are
 * as likely to be `snake_case` as emphasis.
 *
 * Front matter is not shown in the preview, so it is not the first line
 * either: its `title:` or `name:` is the title, and without one the title is
 * the first line after it.
 */
export function titleOf(text: string): string {
  const front = frontMatterOf(text);
  if (front.name) return front.name.slice(0, 46);
  const first = text
    .split('\n')
    .slice(front.lines)
    .find((line) => line.trim());
  if (!first) return '';
  return parseLine(first.trim())
    .body.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<(https?:\/\/[^>\s]+)>/g, '$1')
    .replace(/(\*\*|~~|`)/g, '')
    .replace(/(^|\s)\*(\S(?:.*?\S)?)\*(?=\s|$|[.,;:!?])/g, '$1$2')
    .trim()
    .slice(0, 46);
}

export function slugOf(text: string): string {
  const slug = titleOf(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'draft';
}

/** One character as search compares it: lowercase, without its accents. */
const plain = (char: string) =>
  char < '\u0080'
    ? char.toLowerCase()
    : char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Text as search compares it — lowercase and without accents, so "titulo"
 * finds "título" — with, for each folded character, where it came from in the
 * original: a match found in the folded text is marked in the original one,
 * whose lengths differ (`é` is one character, `İ` lowers to two).
 */
export function fold(text: string): { text: string; at: number[] } {
  let folded = '';
  const at: number[] = [];
  let index = 0;
  for (const char of text) {
    const part = plain(char);
    for (let k = 0; k < part.length; k++) at.push(index);
    folded += part;
    index += char.length;
  }
  // One past the end, so a match running to the last character maps too.
  at.push(index);
  return { text: folded, at };
}

/**
 * The folded text alone, for a yes-or-no match: no offsets to keep. Folded a
 * character at a time like `fold`, so the filter, the snippet and the marks
 * all agree — lowering a whole string turns a final `Σ` into `ς`, and one
 * character at a time into `σ`.
 */
function folded(text: string): string {
  let out = '';
  for (const char of text) out += plain(char);
  return out;
}

/** A query as search compares it: folded, and without the spaces around it. */
const needleOf = (query: string) => folded(query.trim());

/**
 * The line under a search result. With no query it is the start of the body —
 * the title is already printed right above it, so repeating it says nothing.
 * With one, it is a window centred on the first match, title included.
 */
export function snippetOf(text: string, query: string): string {
  const flatten = (value: string) =>
    value
      .replace(/\s+/g, ' ')
      .replace(/^#+\s*/, '')
      .trim();
  const flat = flatten(text);
  const limit = 78;
  const needle = needleOf(query);
  if (!needle) {
    // After the front matter, and after the line the title came from, if it
    // came from one: the title's own line is already printed above.
    const front = frontMatterOf(text);
    const lines = text.split('\n').slice(front.lines);
    const first = front.name ? 0 : lines.findIndex((line) => line.trim()) + 1;
    const body = flatten(lines.slice(first).join('\n'));
    return body.slice(0, limit) + (body.length > limit ? '…' : '');
  }
  const { text: haystack, at: from } = fold(flat);
  const found = haystack.indexOf(needle);
  if (found < 0) return flat.slice(0, limit) + (flat.length > limit ? '…' : '');
  const at = from[found]!;
  const start = Math.max(0, at - 28);
  const cut = flat.slice(start, start + limit);
  return (start ? '…' : '') + cut + (start + limit < flat.length ? '…' : '');
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * A rough token count, for text headed to a model: about four characters a
 * token, which is close for English prose and code and within reach for most
 * other text. The footer shows it with a `~`, never as exact.
 */
export function tokenEstimate(text: string): number {
  return Math.ceil(text.trim().length / 4);
}

/** Small counts as they are, then `1.9k`, then `12k`: the footer is one line. */
export function compactCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 10000) return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(count / 1000)}k`;
}

/** Clock for today, weekday for this week, date beyond that. */
export function timeLabel(at: number, now = Date.now()): string {
  const date = new Date(at);
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return strings.now;
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (at >= startOfToday) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  if (now - at < 7 * 86400000) {
    return date.toLocaleDateString(undefined, { weekday: 'short' }).toLowerCase();
  }
  return date.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
}

export interface DraftGroup {
  label: string;
  drafts: Draft[];
}

/** Groups for the rail: today, yesterday, older. Empty groups are dropped. */
export function groupByDay(drafts: Draft[], now = Date.now()): DraftGroup[] {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const startOfYesterday = startOfToday - 86400000;
  const buckets: DraftGroup[] = [
    { label: 'today', drafts: [] },
    { label: 'yesterday', drafts: [] },
    { label: 'earlier', drafts: [] },
  ];
  for (const draft of drafts) {
    if (draft.updatedAt >= startOfToday) buckets[0]!.drafts.push(draft);
    else if (draft.updatedAt >= startOfYesterday) buckets[1]!.drafts.push(draft);
    else buckets[2]!.drafts.push(draft);
  }
  return buckets.filter((group) => group.drafts.length > 0);
}

/**
 * Whether a file dropped on the page becomes a draft. The extension decides,
 * not the type: Chrome reports `.md` as `text/markdown` on some systems and as
 * nothing at all on others, so a known name is enough and a text type without
 * one (a `.log`, say) is not let in on the strength of its type alone.
 */
export function isTextFile(name: string): boolean {
  return /\.(md|markdown|txt)$/i.test(name);
}

/** A zip of notes: each text file in it opens as a draft. */
export function isArchive(name: string): boolean {
  return /\.zip$/i.test(name);
}

/** A backup from the settings: read, previewed, then restored. */
export function isBackupFile(name: string): boolean {
  return /\.json$/i.test(name);
}

/** Whether a draft holds the query, in any case and with or without accents. */
export function matches(draft: Draft, query: string): boolean {
  return folded(draft.text).includes(needleOf(query));
}
