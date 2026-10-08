# Project context

Chrome extension (MV3): a markdown scratchpad opened from the toolbar icon, in a
tab of its own. Audience: developers who work with AI. Free, MIT, no account, no
network.

Repository: <https://github.com/m4rcone/scratchpad-newtab>. Everything in this
repository — code, comments, docs, commits, issues and PRs — is written in
English.

## Non-negotiable principles

1. Nothing waits on the disk. The editor is mounted and focused before the first
   read from IndexedDB, and whatever is typed while that read is in flight
   becomes a draft instead of being lost.
2. Saving is automatic and silent.
3. No network request. No telemetry. No permission beyond what is needed — a new
   permission needs a justification in the README. The manifest's content
   security policy enforces this (`connect-src 'none'`, nothing remote in
   `img-src`); loosening it needs an issue first.
4. Markdown is the editing format.

## Stack

TypeScript, Vite, IndexedDB for content, `chrome.storage.local` for
preferences. No UI framework: the shell is static markup plus a few modules that
paint `innerHTML`. `src/background.ts` is the service worker behind the toolbar
icon and the `Alt+Shift+S` command (`⌥⇧S` on macOS, where Chrome reads `Alt`
as Option).

The editor and preview are [ByteMD](https://bytemd.js.org/) (CodeMirror 5,
remark, rehype) with six plugins: `gfm`, `highlight-ssr`, `math`, `mermaid`,
`breaks`, `gemoji`. `src/app/editor.ts` wraps the component and types the slice
of its Svelte API it uses by hand (neither Svelte nor its compiler is
installed); `src/app/plugins.ts` is the only place that decides what markdown
means here.

The app owns the view state: `data-mode` is `write`, `split` or `read`.
ByteMD's own right-hand toolbar buttons 2–5 (write only, preview only,
fullscreen, GitHub) are hidden in `bytemd.css`; the app's split, read and Ko-fi
buttons come from the bridge plugin in `editor.ts` and sit at indexes 6, 7
and 8. A ByteMD upgrade that reorders those buttons breaks that CSS.

Markdown markers stay visible, dimmed. Obsidian-style live preview (markers
hidden until the caret reaches them) was declined: it means hand-built widgets
on top of CodeMirror 5. Reading happens in the `read` view.

## Working rules

- Persistence sits behind the `Storage` interface; the UI never calls IndexedDB.
- A new shortcut means checking ByteMD's toolbar actions and CodeMirror's
  `macDefault`/`pcDefault` first: the editor gets the key before the page, so a
  shared chord is lost.
- `npm test` uses Node's own runner, no dependency. Pure behaviour that is ours
  (titles, slugs, snippets, grouping, view toggles) lands with a test; markdown
  rendering is ByteMD's and is not tested here.
- `npm run dev` has no content security policy; check anything network-related
  on a build.
- Releases: the same version in `package.json` and `public/manifest.json`
  (integers only), an entry in `CHANGELOG.md`.
