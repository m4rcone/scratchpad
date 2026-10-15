/**
 * Retakes the Chrome Web Store images and the README banner from the built
 * extension, with no dependency: Node serves `dist/` and drives headless
 * Chrome over the DevTools protocol.
 *
 * The page runs as a plain web page, not as the extension — branded Chrome
 * no longer loads unpacked extensions from the command line — so preferences
 * fall back to localStorage, as they do under `npm run dev`. The drafts come
 * from `docs/store/demo-backup.json`, moved to today so the rail groups them
 * the same way every time.
 *
 *   npm run build && node scripts/screenshots.mjs
 *
 * CHROME=/path/to/chrome overrides the browser.
 */
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const STORE = join(ROOT, 'docs', 'store');
const PREFS_KEY = 'scratchpad.prefs.v1';

const CHROME =
  process.env.CHROME ??
  {
    darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  }[process.platform] ??
  'google-chrome';

/** What each image shows: the open draft, the preferences, then the keys. */
const SCENES = [
  {
    file: 'screenshot-1-split-dark.png',
    draft: 'dprompt',
    prefs: { theme: 'dark', lineNumbers: true },
    keys: [{ key: '/' }],
  },
  {
    file: 'screenshot-2-focus-light.png',
    draft: 'dreview',
    prefs: { theme: 'light', focusWidth: 640 },
    keys: [{ key: 'Enter', shift: true }],
  },
  {
    file: 'screenshot-3-read-light.png',
    draft: 'dretry',
    prefs: { theme: 'light', readingFont: 'serif' },
    keys: [{ key: 'P', code: 'KeyP', shift: true }],
  },
  {
    file: 'screenshot-4-search-dark.png',
    draft: 'dprompt',
    prefs: { theme: 'dark' },
    keys: [{ key: 'F', code: 'KeyF', shift: true }],
    search: 'stream',
  },
];

/** Pages drawn in HTML around the screenshots, at the store's exact sizes. */
const COMPOSED = [
  {
    page: 'screenshot-0-banner.html',
    file: 'screenshot-0-banner.png',
    size: [1280, 800],
  },
  { page: 'promo.html', file: 'promo-marquee-1400x560.png', size: [1400, 560] },
  { page: 'promo.html?small', file: 'promo-small-440x280.png', size: [440, 280] },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

function serve() {
  const server = createServer((request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname));
    const file = join(DIST, path);
    if (!file.startsWith(DIST) || !existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    });
    response.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function launch() {
  const profile = mkdtempSync(join(tmpdir(), 'scratchpad-shots-'));
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,800',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; !existsSync(portFile); i++) {
    if (i > 100) throw new Error(`Chrome did not start: ${CHROME}`);
    await sleep(100);
  }
  await sleep(100);
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((target) => target.type === 'page');
  const close = async () => {
    const exited = new Promise((resolve) => chrome.once('exit', resolve));
    chrome.kill();
    await exited;
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  };
  return { url: page.webSocketDebuggerUrl, close };
}

/** One DevTools session: `send` a command, `until` an event. */
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let next = 0;
  const pending = new Map();
  const waiting = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id !== undefined) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    } else {
      for (const wait of waiting.filter((w) => w.method === message.method)) {
        waiting.splice(waiting.indexOf(wait), 1);
        wait.resolve(message.params);
      }
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const until = (method) => new Promise((resolve) => waiting.push({ method, resolve }));
  return { send, until, close: () => socket.close() };
}

async function evaluate(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails)
    throw new Error(exceptionDetails.exception?.description ?? 'evaluate failed');
  return result.value;
}

async function open(cdp, url, [width, height]) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const loaded = cdp.until('Page.loadEventFired');
  await cdp.send('Page.navigate', { url });
  await loaded;
}

async function capture(cdp, path) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path, Buffer.from(data, 'base64'));
  console.log(`wrote ${path.slice(ROOT.length + 1)}`);
}

/** The demo drafts, moved so the newest lands today at the same time of day. */
function demoDrafts() {
  const { drafts } = JSON.parse(readFileSync(join(STORE, 'demo-backup.json'), 'utf8'));
  const dayOf = (at) => new Date(at).setHours(0, 0, 0, 0);
  const shift = dayOf(Date.now()) - dayOf(Math.max(...drafts.map((d) => d.updatedAt)));
  return drafts.map((d) => ({
    ...d,
    createdAt: d.createdAt + shift,
    updatedAt: d.updatedAt + shift,
  }));
}

const seed = (drafts) => `new Promise((resolve, reject) => {
  localStorage.clear();
  const request = indexedDB.open('scratchpad', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' });
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    const tx = db.transaction('drafts', 'readwrite');
    const store = tx.objectStore('drafts');
    store.clear();
    for (const draft of ${JSON.stringify(drafts)}) store.put(draft);
    tx.oncomplete = () => { db.close(); resolve(true); };
    tx.onerror = () => reject(tx.error);
  };
})`;

const press = ({ key, code = '', shift = false }) =>
  `window.dispatchEvent(new KeyboardEvent('keydown', {
    key: ${JSON.stringify(key)}, code: ${JSON.stringify(code)},
    metaKey: true, shiftKey: ${shift}, bubbles: true, cancelable: true,
  }))`;

async function settle(cdp, test, what) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(cdp, test)) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function main() {
  if (!existsSync(join(DIST, 'pad', 'index.html')))
    throw new Error('run `npm run build` first');
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await launch();
  const cdp = await connect(browser.url);
  try {
    await cdp.send('Page.enable');
    const app = `${origin}/pad/index.html`;
    await open(cdp, app, [1280, 800]);
    const drafts = demoDrafts();

    for (const scene of SCENES) {
      await evaluate(cdp, seed(drafts));
      const prefs = { activeId: scene.draft, whatsNew: null, ...scene.prefs };
      await evaluate(
        cdp,
        `localStorage.setItem('${PREFS_KEY}', ${JSON.stringify(JSON.stringify(prefs))})`,
      );
      await open(cdp, app, [1280, 800]);
      await settle(
        cdp,
        `document.querySelectorAll('.rail [data-id]').length >= ${drafts.length} && !!document.querySelector('.CodeMirror')`,
        'the drafts',
      );
      for (const key of scene.keys) await evaluate(cdp, press(key));
      if (scene.search) {
        await settle(cdp, `!!document.querySelector('.search__input')`, 'search');
        await evaluate(
          cdp,
          `(() => { const input = document.querySelector('.search__input');
            input.value = ${JSON.stringify(scene.search)};
            input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
        );
      }
      // Mermaid, KaTeX and the fonts land after the first paint.
      await evaluate(cdp, 'document.fonts.ready.then(() => true)');
      await sleep(1500);
      await capture(cdp, join(STORE, scene.file));
    }

    for (const { page, file, size } of COMPOSED) {
      const [name, query] = page.split('?');
      const url =
        pathToFileURL(join(STORE, name)).href + (query !== undefined ? `?${query}` : '');
      await open(cdp, url, size);
      await evaluate(cdp, 'document.fonts.ready.then(() => true)');
      await sleep(300);
      await capture(cdp, join(STORE, file));
    }
    copyFileSync(
      join(STORE, 'screenshot-0-banner.png'),
      join(ROOT, '.github', 'banner.png'),
    );
    console.log('wrote .github/banner.png');
  } finally {
    cdp.close();
    await browser.close();
    server.close();
  }
}

await main();
