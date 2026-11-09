# Project context

Chrome extension (MV3): a markdown scratchpad opened from the toolbar icon in
its own tab. Audience: developers who work with AI. Free, MIT, no account, no
network.

Repository: <https://github.com/m4rcone/scratchpad>. Everything in it —
code, comments, docs, commits, issues and PRs — is written in English.

## Non-negotiable principles

1. Nothing waits on the disk. The editor is mounted and focused before the
   first IndexedDB read; anything typed during that read becomes a draft
   instead of being lost.
2. Saving is automatic and silent.
3. No network requests, no telemetry, no permission beyond what is needed. A
   new permission needs a justification in the README. The manifest's content
   security policy enforces this (`connect-src 'none'`, nothing remote in
   `img-src`); loosening it needs an issue first.
4. Markdown is the editing format.

## Stack

TypeScript, Vite, IndexedDB for content, `chrome.storage.local` for
preferences. No UI framework: static markup plus a few modules that paint
`innerHTML`. `src/background.ts` is the service worker behind the toolbar icon
and the `Alt+Shift+S` command (`⌥⇧S` on macOS, where Chrome reads `Alt` as
Option).

Editor and preview are [ByteMD](https://bytemd.js.org/) (CodeMirror 5, remark,
rehype) with six plugins: `gfm`, `highlight-ssr`, `math`, `mermaid`, `breaks`,
`gemoji`. `src/app/editor.ts` wraps the component and hand-types the slice of
its Svelte API it uses (Svelte is not installed). `src/app/plugins.ts` is the
only place that decides how markdown renders. `src/app/syntax.ts` is the only
place that reads markdown by hand, outside the parse: a line's lead (quote,
indent, list marker, task box, heading) and front matter, for the toolbar, list
continuation, task boxes, titles and the editor's YAML colouring.

The app owns the view state: `data-mode` is `write`, `split` or `read`. Focus
is independent of it: `data-focus` on the shell, in any view.

A draft's text and its name change apart, so each has its own clock:
`updatedAt` dates the text and orders the rail, `nameAt` dates the name.
`src/storage/merge.ts` puts two copies together field by field, and every
place copies meet goes through it: another tab's copy (`adopt`), the disk's
guard in `put`, a restore (`classify`) and the boot mirror. A new per-draft
field that can change without the text needs a clock of its own and a place
in `mergeDraft`, or it is dropped on its way to the other tab, the disk or a
backup. Bumping `updatedAt` instead moves the draft to the top of the rail.

The toolbar and footer float over the text (`--toolbar-h`, `--footer-h`).
Anything scrolled to a target — a contents entry, a link, a revealed row —
has to clear them.

The rail repaints by rebuilding its `innerHTML` when the markup differs. That
resets the list's scroll and destroys any field in it, so `rail.ts` keeps the
scroll across the rebuild and does not rebuild while a rename field is open.

The contents drawer is ByteMD's, but where an entry leads and which one is lit
are the app's: ByteMD counts every heading in the preview, including ones in
quotes and lists, and does nothing in `write`. `src/app/toc.ts` marks the
headings the drawer lists with their source offset (`data-heading-at`), and
`editor.ts` takes over the click and the highlight.

ByteMD's right-hand toolbar buttons 2–5 (write only, preview only, fullscreen,
GitHub) are hidden in `bytemd.css`. The app's write/split/read switch comes
from the bridge plugin in `editor.ts` at indexes 6, 7 and 8, with focus at 9.
A ByteMD upgrade that reorders those buttons breaks that CSS.

Markdown markers stay visible, dimmed. Obsidian-style live preview (markers
hidden until the caret reaches them) was declined: it would need hand-built
widgets on top of CodeMirror 5. Reading happens in the `read` view.

## Working rules

- Persistence sits behind the `Storage` interface; the UI never calls
  IndexedDB.
- Before adding a shortcut, check ByteMD's toolbar actions and CodeMirror's
  `macDefault`/`pcDefault`: the editor gets the key before the page, so a
  shared chord is lost.
- Shortcut labels follow the OS — `⌘⇧F` on macOS, `Ctrl+Shift+F` elsewhere —
  and come from `shortcut` or `formatChord` in `src/app/platform.ts`. Never
  write the glyphs into a string by hand.
- `npm test` uses Node's built-in runner, no dependency. Pure behaviour of our
  own (titles, slugs, snippets, grouping, view toggles) lands with a test;
  markdown rendering is ByteMD's and is not tested here.
- `npm run dev` has no content security policy; check anything network-related
  on a build. The Vite root is `src/`, so the page is at `/pad/index.html`.
  Drafts made there live in the dev server's origin, not the installed
  extension's.
- Releases: the same version in `package.json` and `public/manifest.json`
  (integers only), and an entry in `CHANGELOG.md`.
