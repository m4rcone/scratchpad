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
- `npm test` uses Node's built-in runner, no dependency. Pure behaviour of our
  own (titles, slugs, snippets, grouping, view toggles) lands with a test;
  markdown rendering is ByteMD's and is not tested here.
- `npm run dev` has no content security policy; check anything network-related
  on a build.
- Releases: the same version in `package.json` and `public/manifest.json`
  (integers only), and an entry in `CHANGELOG.md`.
