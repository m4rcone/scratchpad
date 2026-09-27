/** Pure helpers over a draft: title, slug, snippet, counters and grouping. */
import type { Draft } from '../storage/types.ts';
import { SCHEMA_VERSION } from '../storage/types.ts';
import { strings } from './strings.ts';

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
 * The title is the first non-empty line — never a dialog asking for a name —
 * read the way the preview would show it: without the block marker in front
 * (heading, quote, list, task box) and with inline markup reduced to its text.
 * A draft that opens with `- [ ] ship [the fix](https://…)` is titled
 * "ship the fix", not with the URL. Underscores are left alone, since they are
 * as likely to be `snake_case` as emphasis.
 */
export function titleOf(text: string): string {
  const first = text.split('\n').find((line) => line.trim());
  if (!first) return '';
  return first
    .trim()
    .replace(/^#{1,6}(\s+|$)/, '')
    .replace(/^(>\s*)+/, '')
    .replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
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
  if (!query) {
    const lines = text.split('\n');
    const body = flatten(
      lines.slice(lines.findIndex((line) => line.trim()) + 1).join('\n'),
    );
    return body.slice(0, limit) + (body.length > limit ? '…' : '');
  }
  const at = flat.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return flat.slice(0, limit) + (flat.length > limit ? '…' : '');
  const start = Math.max(0, at - 28);
  const cut = flat.slice(start, start + limit);
  return (start ? '…' : '') + cut + (start + limit < flat.length ? '…' : '');
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
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

export function matches(draft: Draft, query: string): boolean {
  return draft.text.toLowerCase().includes(query.toLowerCase());
}
