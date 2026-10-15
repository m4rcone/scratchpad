# Privacy policy

_Last updated: 2026-10-15_

Scratchpad is a Chrome extension that keeps markdown drafts on your computer.

## Data collection

None. There is no account, analytics, telemetry or server. The extension makes
no network requests, and its content security policy blocks them, including
remote images in a draft.

## Data storage

Everything stays in your Chrome profile:

- **Drafts** in the extension's IndexedDB.
- **Preferences** in `chrome.storage.local`: theme, line numbers, reading
  typeface, focus width, the open draft, the date of the last backup and
  whether an update's notes have been seen.
- **A copy of the draft being edited** in `localStorage`, so the last
  keystroke survives a tab closed mid-save. It is cleared on the next open.

Nothing is synced or readable by websites, and uninstalling the extension
deletes it all. Backups and exports are files your browser saves when you ask;
the extension does not send them anywhere.

## Permissions

Only `storage`, for the preferences above. There is no host permission: the
extension cannot read or change the pages you visit.

## External links

Links in the preview and in the settings open in a new tab when clicked. The
destination site's own policy applies there.

## Contact

<https://github.com/m4rcone/scratchpad/issues>
