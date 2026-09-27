# Privacy policy

_Last updated: 2026-09-27_

Scratchpad is a Chrome extension that keeps markdown drafts on your computer.

## What it collects

Nothing. There is no account, no analytics, no telemetry and no server. The
extension makes no network requests, and its content security policy forbids
them — even a remote image in a draft is not loaded.

## What it stores

Everything stays in your Chrome profile:

- **Drafts**, in the extension's IndexedDB.
- **Preferences** — the theme and the open draft — in `chrome.storage.local`.
- **A copy of the draft being edited**, in `localStorage`, so the last
  keystroke survives a tab closed mid-save. It is cleared on the next open.

Nothing is synced or readable by websites. Removing the extension deletes it
all.

## Permissions

Only `storage`, for the preferences above. There is no host permission: the
extension cannot read or change the pages you visit.

## Links

Links in the preview and the Ko-fi cup on the toolbar open a new tab when you
click them. That site's own policy applies there.

## Contact

<https://github.com/m4rcone/scratchpad-newtab/issues>
