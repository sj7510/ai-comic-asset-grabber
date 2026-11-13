/**
 * End-to-end test without any npm dependencies.
 *
 * - serves demo/index.html on 127.0.0.1:6912
 * - maps photo.colo14.top to 127.0.0.1 via Chrome's --host-resolver-rules
 * - loads dist/qq-mv3 as an unpacked extension
 * - drives the floating panel through the Chrome DevTools Protocol
 * - verifies the downloaded folder and files on disk
 *
 * Usage: node test/e2e.mjs
 *
 * Chrome 137+ may refuse --load-extension for branded Chrome builds. If that
 * happens, set CHROME_PATH to a Chrome for Testing / Chromium binary.
 */
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../demo/server.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const project = dirname(root);
const extensionDir = process.env.E2E_EXT_DIR
  ? join(project, process.env.E2E_EXT_DIR)
  : join(project, 'dist', 'qq-mv3');
const headlessFlags = process.env.E2E_HEADED ? [] : ['--headless=new'];
const tmp = join(root, '.tmp');
const profileDir = join(tmp, 'profile');
const downloadDir = join(tmp, 'downloads');
const logPath = join(tmp, 'chrome.log');
const debugPort = 9333;
const FOLDER = 'E2E测试_素材';

const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function log(...args) {
  console.log('[e2e]', ...args);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function poll(fn, predicate, timeoutMs = 30000, interval = 250) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await fn();
      if (predicate(last)) return last;
    } catch (error) {
      last = error;
    }
    await sleep(interval);
  }
  const reason = last instanceof Error ? last.message : JSON.stringify(last);
  throw new Error(`poll timed out after ${timeoutMs}ms (last: ${reason})`);
}

function createCDP(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  const handlers = new Map();
  let nextId = 1;

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('CDP socket error')));
  });

  ws.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch (e) { return; }
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
      return;
    }
    if (message.method && handlers.has(message.method)) {
      handlers.get(message.method).forEach((fn) => fn(message.params));
    }
  });

  return {
    ready,
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, fn) {
      if (!handlers.has(method)) handlers.set(method, []);
      handlers.get(method).push(fn);
    },
    close() {
      try { ws.close(); } catch (e) { /* ignore */ }
    }
  };
}

async function getTargets() {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  return response.json();
}

async function main() {
  if (!existsSync(extensionDir)) throw new Error('dist/qq-mv3 missing, run node build.mjs first');
  if (!existsSync(chromePath)) throw new Error(`Chrome not found at ${chromePath}`);

  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(join(profileDir, 'Default'), { recursive: true });
  mkdirSync(downloadDir, { recursive: true });

  writeFileSync(join(profileDir, 'Default', 'Preferences'), JSON.stringify({
    download: { default_directory: downloadDir, prompt_for_download: false, directory_upgrade: true },
    savefile: { default_directory: downloadDir },
    profile: { default_content_setting_values: { automatic_downloads: 1 } }
  }), 'utf8');

  const demo = await startServer(6912, '127.0.0.1');
  log('demo server on', demo.url);

  const logFd = openSync(logPath, 'w');
  const args = [
    ...headlessFlags,
    '--disable-gpu',
    '--no-sandbox',
    '--disable-crash-reporter',
    '--disable-breakpad',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-component-update',
    '--metrics-recording-only',
    '--mute-audio',
    '--remote-allow-origins=*',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    '--host-resolver-rules=MAP photo.colo14.top 127.0.0.1',
    '--window-size=1500,1000',
    '--force-device-scale-factor=1',
    ...(process.env.E2E_SINGLE_PROCESS ? ['--single-process'] : []),
    'http://photo.colo14.top:6912/'
  ];

  const chrome = spawn(chromePath, args, { stdio: ['ignore', logFd, logFd] });
  let exited = false;
  chrome.on('exit', () => { exited = true; });

  let page = null;
  let sw = null;
  const consoleErrors = [];

  try {
    await poll(async () => {
      if (exited) throw new Error('chrome exited early, see chrome.log');
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      return response.json();
    }, Boolean, 20000);

    const target = await poll(async () => {
      const targets = await getTargets();
      return targets.find((item) => item.type === 'page' && item.url.includes('photo.colo14.top')) || null;
    }, Boolean, 20000);
    log('page target:', target.url);

    page = createCDP(target.webSocketDebuggerUrl);
    await Promise.race([
      page.ready,
      sleep(10000).then(() => { throw new Error('CDP connection timed out'); })
    ]);
    await page.send('Runtime.enable');
    await page.send('Page.enable');

    page.on('Runtime.exceptionThrown', (params) => {
      consoleErrors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'exception');
    });
    page.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error') {
        consoleErrors.push((params.args || []).map((arg) => arg.value ?? arg.description).join(' '));
      }
    });

    async function evaluate(expression, awaitPromise = false) {
      const result = await page.send('Runtime.evaluate', {
        expression,
        awaitPromise,
        returnByValue: true,
        userGesture: true
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      }
      return result.result.value;
    }

    const cardCount = await evaluate(`document.querySelectorAll('article.asset-card').length`);
    log('page cards:', cardCount);
    log('targets:', (await getTargets()).map((item) => item.type + ':' + item.url).join(' | '));
    await sleep(1500);
    const diag = await evaluate(`({
      title: document.title,
      ready: document.readyState,
      cards: document.querySelectorAll('article.asset-card').length,
      grid: document.getElementById('grid') ? document.getElementById('grid').children.length : -1,
      hasScript: typeof ASSETS !== 'undefined',
      text: (document.body ? document.body.innerText : '').slice(0, 200)
    })`);
    log('page diag:', JSON.stringify(diag));

    await poll(async () => evaluate(`(() => {
      const host = document.getElementById('asset-grabber-host');
      const sr = host && host.shadowRoot;
      if (!sr) return { rows: 0, visible: false };
      const panel = sr.getElementById('panel');
      return { rows: sr.querySelectorAll('.row').length, visible: !!(panel && !panel.hidden) };
    })()`), (info) => info && info.rows >= 17 && info.visible, 30000);

    const summary = await evaluate(`(() => {
      const sr = document.getElementById('asset-grabber-host').shadowRoot;
      const thumbs = [...sr.querySelectorAll('.thumb')];
      return {
        rows: sr.querySelectorAll('.row').length,
        subtitle: sr.getElementById('subtitle').textContent,
        brokenThumbs: thumbs.filter((img) => img.complete && img.naturalWidth === 0).length,
        checked: sr.getElementById('count-selected').textContent,
        total: sr.getElementById('count-total').textContent
      };
    })()`);
    log('panel summary:', summary);
    if (summary.rows !== 17) throw new Error(`expected 17 rows, got ${summary.rows}`);
    if (summary.brokenThumbs !== 0) throw new Error(`broken thumbnails: ${summary.brokenThumbs}`);



    // search filter
    const filtered = await evaluate(`(() => {
      const sr = document.getElementById('asset-grabber-host').shadowRoot;
      const input = sr.getElementById('search');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '玄铁');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return sr.querySelectorAll('.row').length;
    })()`);
    log('search "玄铁" rows:', filtered);
    if (filtered !== 1) throw new Error(`search filter expected 1 row, got ${filtered}`);

    await evaluate(`(() => {
      const sr = document.getElementById('asset-grabber-host').shadowRoot;
      const input = sr.getElementById('search');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);

    // range selection: click row 0, shift-click row 4
    const shiftCount = await evaluate(`(() => {
      const sr = document.getElementById('asset-grabber-host').shadowRoot;
      const rows = sr.querySelectorAll('.row');
      rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      rows[4].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
      return sr.getElementById('count-selected').textContent;
    })()`);
    log('shift-select count:', shiftCount);
    if (shiftCount !== '5') throw new Error(`shift selection expected 5, got ${shiftCount}`);

    // select all, open dialog, fill folder, confirm
    await evaluate(`(() => {
      const sr = document.getElementById('asset-grabber-host').shadowRoot;
      sr.querySelector('[data-action="clear"]').click();
      sr.querySelector('[data-action="select-all"]').click();
    })()`);

    const selected = await evaluate(`document.getElementById('asset-grabber-host').shadowRoot.getElementById('count-selected').textContent`);
    if (selected !== '17') throw new Error(`select all expected 17, got ${selected}`);
    log('select all:', selected);

    await evaluate(`(() => {
      const sr = document.getElementById('asset-grabber-host').shadowRoot;
      sr.querySelector('[data-action="download"]').click();
    })()`);
    await sleep(250);

    await evaluate(`(() => {
      const sr = document.getElementById('asset-grabber-host').shadowRoot;
      const input = sr.getElementById('folder-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(FOLDER)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      sr.querySelector('[data-action="modal-confirm"]').click();
    })()`);
    log('download started');

    // Wait for the folder to fill up, using the panel itself as the progress source.
    const folderPath = join(downloadDir, FOLDER);
    const finalState = await poll(async () => {
      const info = await evaluate(`(() => {
        const sr = document.getElementById('asset-grabber-host').shadowRoot;
        const toast = sr.getElementById('toast');
        const progress = sr.getElementById('progress');
        return {
          progressText: sr.getElementById('progress-text').textContent,
          progressHidden: progress.hidden,
          toast: toast.hidden ? '' : toast.textContent
        };
      })()`);
      let names = [];
      try { names = readdirSync(folderPath); } catch (e) { /* not created yet */ }
      info.files = names.filter((name) => name.endsWith('.png')).length;
      info.pending = names.filter((name) => name.endsWith('.crdownload')).length;
      return info;
    }, (info) => info.files >= 17 && info.pending === 0, 90000, 500);

    log('download state:', finalState);
    if (finalState.files < 17) {
      throw new Error(`expected 17 files, got ${finalState.files}; panel: ${finalState.progressText} / ${finalState.toast}`);
    }

    const inFolder = readdirSync(folderPath)
      .filter((name) => name.endsWith('.png'))
      .map((name) => join(folderPath, name));
    log('files in folder:', inFolder.length);
    if (inFolder.length !== 17) {
      throw new Error(`expected 17 files in "${FOLDER}", got ${inFolder.length}`);
    }

    for (const file of inFolder) {
      if (!existsSync(file)) throw new Error('missing file: ' + file);
      const size = statSync(file).size;
      if (size < 1000) throw new Error(`suspiciously small file (${size} bytes): ${file}`);
      if (!file.endsWith('.png')) throw new Error('unexpected extension: ' + file);
    }

    const first = inFolder.find((file) => basename(file).includes('大胤前军'));
    if (!first) throw new Error('no file with the original asset name found');
    log('first file:', basename(first));
    if (basename(first) !== '大胤前军·绯黑前军甲.png') {
      throw new Error('unexpected filename: ' + basename(first));
    }

    // Removing a card from the page should drop it (and its selection) from the panel.
    await evaluate(`document.querySelector('article.asset-card').remove()`);
    const afterRemove = await poll(async () => evaluate(`(() => {
      const sr = document.getElementById('asset-grabber-host').shadowRoot;
      return {
        rows: sr.querySelectorAll('.row').length,
        selected: sr.getElementById('count-selected').textContent
      };
    })()`), (info) => info && info.rows === 16, 10000, 250);
    log('after remove:', afterRemove);
    if (afterRemove.selected !== '16') throw new Error('selection was not pruned after card removal');

    // Drag the panel by its header and verify it actually moved.
    const drag = await evaluate(`(() => {
      const host = document.getElementById('asset-grabber-host');
      const head = host.shadowRoot.querySelector('.head');
      const before = host.getBoundingClientRect().toJSON();
      const x = before.left + 120;
      const y = before.top + 20;
      head.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, button: 0, clientX: x, clientY: y }));
      head.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: x - 180, clientY: y + 50 }));
      head.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, clientX: x - 180, clientY: y + 50 }));
      return { before: before, after: host.getBoundingClientRect().toJSON() };
    })()`);
    log('drag:', { leftBefore: drag.before.left, leftAfter: drag.after.left, topAfter: drag.after.top });
    if (drag.after.left > drag.before.left - 100) throw new Error('panel did not move horizontally');

    console.log('\nE2E PASS');
    console.log('download folder:', join(downloadDir, FOLDER));
    console.log('files:', inFolder.length);
    if (consoleErrors.length) console.log('console errors:', consoleErrors.slice(0, 5));
  } catch (error) {
    console.error('\nE2E FAIL:', error.message);
    if (consoleErrors.length) {
      console.error('console errors:\n' + consoleErrors.slice(0, 10).join('\n'));
    }
    if (existsSync(logPath)) {
      const logText = readFileSync(logPath, 'utf8').trim();
      if (logText) console.error('chrome.log tail:\n' + logText.split('\n').slice(-20).join('\n'));
    }
    process.exitCode = 1;
  } finally {
    try { if (sw) sw.close(); } catch (e) {}
    try { if (page) page.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    try { execFileSync('taskkill', ['/pid', String(chrome.pid), '/t', '/f'], { stdio: 'ignore' }); } catch (e) {}
    try { closeSync(logFd); } catch (e) {}
    await demo.close().catch(() => {});
  }
}

main();
