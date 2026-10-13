# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Find and replace inside the open draft (`⌘F`), in a panel floating at the
  top right of the text: the count inside the field, a match-case toggle,
  `⌘G` / `⌘⇧G` to step through, and the replace row folded away until it is
  wanted. Replace-all is undone in one step. Chrome's own find missed text scrolled
  out of view.
- A settings panel, opened from the foot of the rail or with `⌘⇧,`: backup,
  Markdown export, theme (system, light or dark) and what the extension is.
- Backups: every draft, whole — text, dates, caret — in one `.json` file,
  saved through Chrome's save dialog, so a dialog closed without saving does
  not count as a backup. Restoring one, from the settings, first shows what
  it would add, update or leave alone, and asks. Restoring the same backup
  twice changes nothing.
- Export every draft as Markdown, one `.md` per draft in a `.zip`, each file
  dated by its draft's last change. A `.zip` of notes, opened from the
  settings, brings every text file in it in as a draft.
- Two scratchpad tabs keep each other up to date instead of overwriting one
  another's text.
- An empty draft lists the shortcuts worth knowing first; they go with the
  first keystroke.
- The `?` sheet lists the app's own shortcuts above the formatting ones.
- The footer counts tokens, roughly, beside the words.
- Task boxes in the preview tick: a click writes the `x` into the text, and
  undo takes it back.
- Settings says how long ago everything was backed up, in red after two
  weeks; the rail flags it on the way in.

### Changed

- An update's news no longer adds a link to the footer. It flags settings, in
  the rail and on the narrow-screen drafts button, until settings is opened,
  where the About section points at the changelog.
- The About section links to the extension's reviews on the Chrome Web Store,
  and the Ko-fi link reads "Support". The cup on the toolbar is gone: support
  is offered in the settings only.
- When the disk refuses the text, "not saved" stays on screen in red, and
  the write is retried on its own, until it lands.
- Copy and export confirm on the button that was pressed.
- Delete asks on its own button, in red, with the keys that answer it beside
  the status; the three seconds left to undo it run down the footer's top
  hairline.
- Escape after a delete prompt, and any footer button clicked with the
  mouse, hand the caret back to the text.
- Keyboard hints are shown as key caps, and the footer, rail and search no
  longer run their parts together with `·`.
- Write, split and read are one segmented switch on the toolbar, drawn like
  the theme switch in the settings; the formatting buttons step back until
  the pointer reaches the toolbar.
- The open draft is tinted in the rail, and every row's title lines up with
  the day labels. The rail's foot is three plain actions — new draft, search
  drafts, settings — each with its key. Search marks the row under the arrows the same way.
- The toolbar and the footer float over the text, a little see-through, so
  the writing shows as it scrolls under them; the caret is kept clear of
  both.
- The footer is split by hairlines: the save state, then the counts; the
  draft's actions, then the theme. It keeps one height whatever it shows,
  and on a narrow window the status gives way instead of running into the
  actions.
- A key and what it does read the same way everywhere, key first:
  `esc close` in settings and search, `↵ delete` and `esc undo` in the
  footer. The rail's own actions keep their keys in a column on the right.
  The `?` sheet's Scratchpad rows have icons like ByteMD's own.
- The settings' and find panel's buttons are drawn as key caps, like the
  shortcut hints, and so are the rail's shortcuts. The footer's actions stay
  plain words; an empty draft says "empty" there instead of "saved".
- The rail's day labels read as headings over their drafts, and its actions
  answer the pointer.
- On a phone the toolbar takes two tidy rows — the view switch and help
  above, the formatting buttons below — and the top bar carries the logo.
- The `?` sheet writes every shortcut alike, as key caps in the app's own
  notation, ByteMD's included.
- Narrower windows, such as Chrome's split view, keep the toolbar on one
  line: below 1100px the rail and the margins narrow, and below 880px the
  rail becomes a sheet opened from a top bar. The counts give way first on a
  thin window.
- A file dragged over the page brings up a note saying what it will become.
- A dropped `.md` or `.txt` keeps its file's date instead of today's.
- Search marks the query in each result.
- State changes fade in over 150 ms, and nothing animates when the system
  asks for reduced motion.

### Fixed

- Undo right after switching drafts no longer brings the previous draft's
  text into the one now open.
- Enter confirms a delete only from the delete button: tabbing to another
  button and pressing enter used to delete the draft instead.
- A disk that cannot be read at startup no longer leaves the page without a
  draft, where typing went nowhere. It opens a draft of its own, says so in
  the footer, and a disk that comes back is written to again.
- A backup whose draft ids are not the extension's own is refused draft by
  draft, instead of their ids being written into the page.
- The heading, maths and diagram menus open whole, instead of as a sliver
  cut off under the toolbar.
- New draft on an empty draft is that draft, and leaving an empty draft
  takes it away: empty "untitled" drafts no longer pile up in the rail.
  Those already there are cleared on the next open.
- The draft being written moves to the top of the rail at once, as its time
  says, instead of at the next reload.
- Searching drafts ignores accents: "titulo" finds "título", and the match
  is marked as it is written.
- Find leaves room for its panel at the top of the text, so a match on the
  first line is no longer hidden under it.
- A list marker typed again right after enter wrote it (`- - `, `2. 2. `,
  `- [ ] [ ] `) is folded back into one, instead of nesting a list.
- Enter on an empty item of a nested list steps out one level, instead of
  ending the whole list.
- The app's shortcuts work on keyboard layouts without Latin letters
  (Russian, Greek, Hebrew…): ⌘⇧F is the key where F sits, as Chrome's own
  shortcuts are.
- On Windows and Linux, where scrollbars take a column of their own, they
  are thin and tinted to the theme, and no longer run under the toolbar and
  the footer with their ends hidden.
- `npm run package` works on Windows: it packs with a Node script instead of
  `rm` and `zip`, and the release workflow uses the same one. Node 22.18 or
  later is required, which is what running the TypeScript tests needed all
  along.

### Accessibility

- Search results are a listbox a screen reader can follow; the open draft is
  marked in the rail; notices such as "copied" are announced.
- The dimmest text in the dark theme now meets WCAG AA contrast (5:1).
- The toolbar works from the keyboard: one tab stop, the arrows between its
  buttons, enter or space to press one, ↓ into the heading, maths and
  diagram menus, escape back to the text. Each button is named for a screen
  reader.
- The focus ring is thicker, and no longer cut off on the rail's and search's
  rows or on "undo"; the search field shows that it has focus.
- The selection is easier to see, and find's and search's matches have a
  warm wash of their own, so a match is never mistaken for the selection;
  the match find is on has a thicker outline. Inline code in the light theme
  and the time on the open draft's row now reach 4.5:1.

## [1.2.0] — 2026-10-08

### Added

- The logo, small and dimmed, at the head of the drafts rail.

### Changed

- A new logo and toolbar icon.
- After a delete, "undo" sits beside the status instead of taking the delete
  button's place, so another draft can be deleted straight away.

## [1.1.0] — 2026-10-07

### Added

- A copy button on every code block in the preview.
- A soft shadow on the side of a code block or table that still scrolls.
- Dropping `.md` or `.txt` files on the page opens each one as a draft.
- The reading view reopens each draft where the reading stopped.

### Changed

- The footer says "saved" only once the text is on disk, and "saving…" while
  it is not.
- The reading and split views let code blocks, tables and diagrams grow
  rightwards past the prose column, up to the pane's edge, keeping the
  column's left edge.
- In split view the source takes its whole pane, as it already did in write
  view, instead of wrapping at the reading measure.
- Table headers no longer break mid-label; a table too wide for its pane
  scrolls instead.
- A confirmed delete can be undone from the footer, or with `esc`, for a few
  seconds.

## [1.0.0] — 2026-09-27

First release.

### Added

- A markdown scratchpad opened from the toolbar icon or `⌥⇧S` / `Alt+Shift+S`,
  in a tab of its own that is reused when already open.
- Silent autosave, down to the last keystroke; the draft reopens with the caret
  where it was.
- Markdown highlighting with the markers kept visible, dimmed.
- Three views: writing, preview beside it (`⌘/`), and reading (`⌘⇧P`).
- A preview with GFM, code highlighting, KaTeX maths, mermaid diagrams and
  emoji. Embedded HTML is sanitized; links open in a new tab.
- Multiple drafts titled by their first line, grouped by day, with full-text
  search.
- Copy a draft, export it as `.md`, delete it with a confirmation step.
- Light and dark themes following the system.
- A layout for narrow windows.

### Security

- One permission: `storage`. No host permissions, no telemetry, no account.
- A content security policy that allows nothing outside the package: no network
  requests, and remote images in drafts are not loaded.

[unreleased]: https://github.com/m4rcone/scratchpad-newtab/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/m4rcone/scratchpad-newtab/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/m4rcone/scratchpad-newtab/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/m4rcone/scratchpad-newtab/releases/tag/v1.0.0
