# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

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

[unreleased]: https://github.com/m4rcone/scratchpad-newtab/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/m4rcone/scratchpad-newtab/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/m4rcone/scratchpad-newtab/releases/tag/v1.0.0
