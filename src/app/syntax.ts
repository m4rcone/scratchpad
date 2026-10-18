/**
 * Markdown read by hand, where the parse cannot help: a line's lead, which
 * the toolbar, the list continuation, the task boxes and the title read from
 * the text as it is typed, and front matter, which the editor colours, the
 * preview leaves out and the title is taken from. How markdown renders is
 * `plugins.ts`; what a line or a front matter is, is here and nowhere else.
 */

/** A line read as markdown reads its lead: quote, indent, marker, box, heading. */
export interface LineParts {
  /** `>` marks, with the space after each: `> `, `> > `. */
  quote: string;
  indent: string;
  /** `-`, `*`, `+`, `1.` or `1)`; `null` when the line is no list item. */
  marker: string | null;
  /** The task box's character, `' '` or `x`; `null` when there is none. */
  box: string | null;
  /** The heading level, 0 for none. */
  heading: number;
  /** Everything after the lead. */
  body: string;
  /** Everything after the marker and box: the heading mark and the body. */
  rest: string;
}

/** A list marker and the space after it; nine digits at most, as CommonMark has it. */
const MARKER = /^([-*+]|\d{1,9}[.)])(?:[ \t]+|$)/;
const BOX = /^\[([ xX])\](?:[ \t]+|$)/;
/** A code fence: up to three spaces, three or more backticks or tildes, and an info string. */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** Only a `#` run followed by a space is a heading: `#tag` is a word. */
const HEADING = /^(#{1,6})(?:[ \t]+|$)/;

export function parseLine(line: string): LineParts {
  const quote = /^(?:[ \t]*>[ \t]?)*/.exec(line)![0];
  let rest = line.slice(quote.length);
  const indent = /^[ \t]*/.exec(rest)![0];
  rest = rest.slice(indent.length);
  let marker: string | null = null;
  let box: string | null = null;
  const item = MARKER.exec(rest);
  if (item) {
    marker = item[1]!;
    rest = rest.slice(item[0].length);
    const task = readBox(rest);
    if (task) ({ box, rest } = task);
  }
  const afterMarker = rest;
  const hashes = HEADING.exec(rest);
  const heading = hashes ? hashes[1]!.length : 0;
  if (hashes) rest = rest.slice(hashes[0].length);
  return { quote, indent, marker, box, heading, body: rest, rest: afterMarker };
}

/** A task box at the start of `text`, `[ ]` or `[x]`, and what follows it. */
export function readBox(text: string): { box: string; rest: string } | null {
  const task = BOX.exec(text);
  return task ? { box: task[1]!, rest: text.slice(task[0].length) } : null;
}

/**
 * A line that opens or closes a code fence: its run of backticks or tildes,
 * and the info string after it. `null` for any other line, and for a run of
 * backticks whose info string holds one, which CommonMark reads as code.
 */
export function readFence(line: string): { run: string; info: string } | null {
  const fence = FENCE.exec(line);
  if (!fence) return null;
  const [, run, info] = fence;
  if (run![0] === '`' && info!.includes('`')) return null;
  return { run: run!, info: info! };
}

export const isBullet = (marker: string | null) =>
  marker !== null && /^[-*+]$/.test(marker);
export const isNumber = (marker: string | null) => marker !== null && /^\d/.test(marker);

/**
 * A line front matter may hold: blank, indented (a nested key, a list item, a
 * block scalar's text), a comment, a top-level `- item`, or a `key:` whose
 * key is one word — `title`, `allowed-tools`, `og.image` — not a phrase.
 */
const YAML_LINE = /^(|[ \t].*|#.*|-([ \t].*)?|[A-Za-z_][\w.-]*:([ \t].*)?)$/;
/**
 * The key one line at least must have: lowercase, as front matter's keys are.
 * `TODO: fix the build` between two rules is a heading under a rule.
 */
const YAML_KEY = /^[a-z_][\w.-]*:([ \t]|$)/;
/** A top-level `title:` or `name:`, and its value. */
const NAMED = /^(title|name):[ \t]*(.*)$/;

/**
 * A one-line YAML value as a title reads it: inside its quotes if it is
 * quoted, and without a comment after it. Empty for a block scalar's `|` or
 * `>`, whose text is on the lines below.
 */
function scalarOf(raw: string): string {
  const quoted = /^(["'])(.*?)\1/.exec(raw);
  if (quoted) return quoted[2]!.trim();
  const value = raw.replace(/(^|[ \t])#.*$/, '').trim();
  return /^[|>]/.test(value) ? '' : value;
}

export interface FrontMatter {
  /** How many lines it takes, fences included; 0 when there is none. */
  lines: number;
  /**
   * Its `title:`, or else its `name:` — what a post, a skill or an agent
   * definition is called — with the quotes taken off. Empty when it has
   * neither, or only a multi-line one.
   */
  name: string;
}

const NONE: FrontMatter = { lines: 0, name: '' };

/**
 * The front matter at the top of a draft — a `---` line, YAML, and the first
 * line that is `---` again — read the way Jekyll and Hugo do: the fences
 * start the draft and may have spaces after them.
 *
 * What lies between them must read as YAML, with a lowercase `key:` at
 * least, or the `---` is a rule: a draft that opens with one and uses more as
 * separators is prose, and so is one whose code sample holds a `---`, and two
 * rules in a row are two rules. That also keeps the
 * editor on this rule: its YAML mode ends front matter at any line that starts
 * with `---` or `...`, and here such a line is either the closing fence or no
 * YAML.
 */
export function readFrontMatter(text: string): FrontMatter {
  if (!/^---[ \t]*\r?(\n|$)/.test(text)) return NONE;
  let start = text.indexOf('\n') + 1;
  if (start === 0) return NONE;
  let keyed = false;
  let title = '';
  let name = '';
  for (let count = 2; ; count++) {
    const end = text.indexOf('\n', start);
    const line = (end < 0 ? text.slice(start) : text.slice(start, end)).replace(
      /\r$/,
      '',
    );
    if (/^---[ \t]*$/.test(line)) {
      return keyed ? { lines: count, name: title || name } : NONE;
    }
    if (!YAML_LINE.test(line)) return NONE;
    keyed ||= YAML_KEY.test(line);
    const field = NAMED.exec(line);
    const value = field ? scalarOf(field[2]!) : '';
    if (value) {
      if (field![1] === 'title') title ||= value;
      else name ||= value;
    }
    if (end < 0) return NONE;
    start = end + 1;
  }
}

/** How many lines the front matter takes, or 0 when there is none. */
export const frontMatterLines = (text: string) => readFrontMatter(text).lines;

/**
 * The draft as the preview parses it: the front matter's lines are left blank,
 * so none of the YAML is read as markdown — not a heading, and not an HTML or
 * code block that would run past the closing fence into the text. Every
 * character keeps its offset, which the task boxes are found by (`tasks.ts`).
 *
 * `remark-frontmatter` would do this, but the version that fits ByteMD's
 * parser turns every list and quote in a draft into plain text once the draft
 * opens with a `---` it does not close.
 */
export function blankFrontMatter(text: string): string {
  const lines = frontMatterLines(text);
  if (!lines) return text;
  let end = 0;
  for (let i = 0; i < lines; i++) end = text.indexOf('\n', end) + 1 || text.length;
  return text.slice(0, end).replace(/[^\r\n]/g, ' ') + text.slice(end);
}
