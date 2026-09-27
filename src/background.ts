/**
 * Service worker: the toolbar icon opens the scratchpad.
 *
 * One tab is enough. If the page is already open somewhere, the click brings
 * that tab and its window to the front instead of stacking a second copy of
 * the same drafts. `runtime.getContexts` sees the extension's own pages without
 * the `tabs` permission, so finding it costs nothing in the manifest.
 *
 * The keyboard command (`_execute_action` in the manifest) lands here too: with
 * no popup declared, Chrome reports it as a click on the icon.
 */
const PAGE = chrome.runtime.getURL('pad/index.html');

/** The page's own URL, whatever fragment or query it picked up since. */
const isPage = (url: string | undefined) => url?.split(/[?#]/)[0] === PAGE;

async function openPad(): Promise<void> {
  // Filtered here rather than through `documentUrls`, which matches the whole
  // URL: a footnote link or a reload with `#` would hide the tab from it.
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.TAB],
  });
  const open = contexts.find(
    (context) => context.tabId !== -1 && isPage(context.documentUrl),
  );

  if (open) {
    await chrome.tabs.update(open.tabId, { active: true });
    await chrome.windows.update(open.windowId, { focused: true });
    return;
  }

  await chrome.tabs.create({ url: PAGE });
}

chrome.action.onClicked.addListener(() => void openPad());

// Chrome tucks a new extension into the puzzle-piece menu, so a first install
// would otherwise leave nothing on screen to click. Updates stay silent.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) void openPad();
});
