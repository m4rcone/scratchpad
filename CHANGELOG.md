# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[unreleased]: https://github.com/m4rcone/scratchpad-newtab/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/m4rcone/scratchpad-newtab/releases/tag/v1.0.0
