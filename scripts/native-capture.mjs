// Native-window driver shared by the smoke scenario and documentation capture on Linux/Windows.
// Every launch uses isolated fixture data; no game or Steam files are accessed.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { access, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** W3C WebDriver element reference key; Windows emulates it so scripts can pass elements around. */
export const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';
// WebDriver key codes used by the scenario, for the Windows keyboard.
const keys = {
  '\uE003': 'Backspace',
  '\uE004': 'Tab',
  '\uE006': 'Enter',
  '\uE007': 'Enter',
  '\uE00C': 'Escape',
  '\uE012': 'ArrowLeft',
  '\uE013': 'ArrowUp',
  '\uE014': 'ArrowRight',
  '\uE015': 'ArrowDown',
};

export async function waitFor(check, message, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error(message);
}

/**
 * Starts the app with isolated data and returns the same primitives on both systems:
 * WebKitWebDriver on Linux, Playwright over the WebView2 debugging protocol on Windows.
 * `execute` returns and accepts element references like WebDriver; `clickElement`, `point`
 * and `type` use real input.
 */
export async function nativeDriver(directory, extraEnv = {}) {
  if (!['linux', 'win32'].includes(process.platform)) throw new Error('Native tests require Linux or Windows.');
  const windows = process.platform === 'win32';
  const binary = resolve(
    process.env.ANCIENT_NATIVE_BINARY || `src-tauri/target/release/ancient-lens${windows ? '.exe' : ''}`,
  );
  await access(binary).catch(() => {
    throw new Error('Build the desktop app first: npm run build');
  });
  const probe = createServer();
  await new Promise((done) => probe.listen(0, '127.0.0.1', done));
  const port = probe.address().port;
  await new Promise((done) => probe.close(done));
  const child = spawn(
    windows ? binary : process.env.WEBKIT_WEBDRIVER || 'WebKitWebDriver',
    windows ? [] : [`--port=${port}`, '--host=127.0.0.1'],
    {
      detached: !windows,
      windowsHide: true,
      env: {
        ...process.env,
        ...extraEnv,
        ANCIENT_TEST_DATA: directory,
        ANCIENT_WEBVIEW_DEBUG_PORT: String(port),
        TAURI_WEBVIEW_AUTOMATION: 'true',
        XDG_DATA_HOME: join(directory, 'xdg-data'),
        XDG_CACHE_HOME: join(directory, 'xdg-cache'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let failure;
  let browser;
  let session;
  let diagnostic = '';
  child.on('error', (error) => {
    failure = error;
  });
  child.stdout.resume();
  child.stderr.on('data', (data) => {
    diagnostic = (diagnostic + data).slice(-4000);
    if (process.env.ANCIENT_NATIVE_LOG) process.stderr.write(data);
  });
  const request = async (path, data, method = data ? 'POST' : 'GET') => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const body = await response.json();
    if (!response.ok || body.value?.error) throw new Error(JSON.stringify(body.value));
    return body.value;
  };
  const close = async () => {
    if (session) await request(`/session/${session}`, undefined, 'DELETE').catch(() => {});
    await browser?.close().catch(() => {});
    if (windows) child.kill();
    else if (child.pid) {
      // The process group includes the app, even if a wedged renderer prevented deletion.
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* Already stopped. */
      }
    }
  };
  try {
    await waitFor(async () => {
      if (failure) throw new Error(`Cannot start the native app. On Linux install WebKitWebDriver: ${failure.message}`);
      if (child.exitCode !== null) throw new Error(`Native app exited: ${diagnostic}`);
      return fetch(`http://127.0.0.1:${port}/${windows ? 'json/version' : 'status'}`).then(
        (r) => r.ok,
        () => false,
      );
    }, 'Native app did not start; close other Ancient Lens windows and retry.');
    // The app has a match window (label `main`) and a profile window; `useWindow` switches
    // every following call to one of them.
    let driver;
    if (windows) {
      const endpoint = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
      const context = browser.contexts()[0];
      const appPages = () => context.pages().filter((p) => p.url().includes('tauri.localhost'));
      const label = (p) => p.evaluate(() => window.ancient?.windowName).catch(() => undefined);
      const pageFor = async (name) => {
        for (const p of appPages()) if ((await label(p)) === name) return p;
      };
      let page;
      const execute = (script, args = []) =>
        page.evaluate(
          async ({ script, args, key }) => {
            const refs = (window.__smokeRefs ??= []);
            const plain = (v) => v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
            const decode = (v) =>
              Array.isArray(v)
                ? v.map(decode)
                : plain(v)
                  ? key in v
                    ? refs[Number(v[key])]
                    : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]))
                  : v;
            const encode = (v) =>
              v instanceof Element
                ? { [key]: String(refs.push(v) - 1) }
                : Array.isArray(v) || v instanceof NodeList || v instanceof HTMLCollection
                  ? [...v].map(encode)
                  : plain(v)
                    ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]))
                    : v === undefined
                      ? null
                      : v;
            return encode(await new Function(script)(...decode(args)));
          },
          { script, args, key: ELEMENT },
        );
      const handle = async (element) =>
        (await page.evaluateHandle((i) => window.__smokeRefs[i], Number(element[ELEMENT]))).asElement();
      driver = {
        execute,
        async useWindow(name) {
          let found;
          await waitFor(async () => !!(found = await pageFor(name)), `No ${name} window`);
          page = found;
        },
        call: (name, ...args) => page.evaluate(({ name, args }) => window.ancient[name](...args), { name, args }),
        windowCount: async () => appPages().length,
        resize: (width, height) => page.setViewportSize({ width, height }),
        screenshot: async (selector) => (selector ? page.locator(selector).first().screenshot() : page.screenshot()),
        // CDP input reaches the page whether or not the window has the desktop focus.
        realPointer: async () => true,
        point: (x, y) => page.mouse.move(x, y),
        clickElement: async (element) => (await handle(element)).click({ timeout: 10000 }),
        async type(element, text) {
          await (await handle(element)).focus();
          for (const char of text) {
            if (keys[char]) await page.keyboard.press(keys[char]);
            else await page.keyboard.type(char);
          }
        },
      };
    } else {
      session = (
        await request('/session', { capabilities: { alwaysMatch: { 'webkitgtk:browserOptions': { binary } } } })
      ).sessionId;
      const execute = (script, args = []) => request(`/session/${session}/execute/sync`, { script, args });
      driver = {
        execute,
        async useWindow(name) {
          await waitFor(async () => {
            for (const handle of await request(`/session/${session}/window/handles`)) {
              await request(`/session/${session}/window`, { handle });
              if ((await execute('return window.ancient?.windowName')) === name) return true;
            }
            return false;
          }, `No ${name} window`);
        },
        async call(name, ...args) {
          const result = await request(`/session/${session}/execute/async`, {
            script:
              'const done=arguments[arguments.length-1];window.ancient[arguments[0]](...arguments[1]).then(value=>done({value}),error=>done({error:String(error)}));',
            args: [name, args],
          });
          if (result.error) throw new Error(result.error);
          return result.value;
        },
        windowCount: async () => (await request(`/session/${session}/window/handles`)).length,
        resize: (width, height) => request(`/session/${session}/window/rect`, { width, height }),
        async screenshot(selector) {
          let route = `/session/${session}/screenshot`;
          if (selector) {
            const element = await execute('return document.querySelector(arguments[0])', [selector]);
            if (!element) throw new Error(`Screenshot element missing: ${selector}`);
            route = `/session/${session}/element/${element[ELEMENT]}/screenshot`;
          }
          return Buffer.from(await request(route), 'base64');
        },
        // WebKitWebDriver hangs on pointer actions while the window lacks keyboard focus.
        realPointer: () => execute('return document.hasFocus()'),
        point: (x, y) =>
          request(`/session/${session}/actions`, {
            actions: [
              {
                type: 'pointer',
                id: 'mouse',
                parameters: { pointerType: 'mouse' },
                actions: [{ type: 'pointerMove', duration: 0, origin: 'viewport', x, y }],
              },
            ],
          }),
        clickElement: (element) => request(`/session/${session}/element/${element[ELEMENT]}/click`, {}),
        type: (element, text) => request(`/session/${session}/element/${element[ELEMENT]}/value`, { text }),
      };
    }
    await driver.useWindow('main');
    return { ...driver, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Documentation capture and short checks: the match window at a fixed size, clicks by label. */
export async function nativeCapture(directory, extraEnv) {
  const driver = await nativeDriver(directory, extraEnv);
  const { execute } = driver;
  try {
    await driver.resize(1600, 1240);
    await waitFor(
      () => execute('return !!window.ancient && document.body.innerText.includes("Match players")'),
      'Native UI did not load',
    );
  } catch (error) {
    await driver.close();
    throw error;
  }
  const click = async (label) => {
    const found = await execute(
      `const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===arguments[0]||b.getAttribute('aria-label')===arguments[0]);if(!button)return false;button.click();return true;`,
      [label],
    );
    if (!found) throw new Error(`Button missing: ${label}`);
  };
  const capture = async (path, selector) => {
    await waitFor(
      () =>
        execute(
          'return document.fonts.status === "loaded" && [...document.images].every(img => img.complete && img.naturalWidth > 0)',
        ),
      'Some images did not load; check the Steam CDN connection.',
    );
    const text = await execute('return document.body.innerText');
    if (/[\u0400-\u04ff]/u.test(text)) throw new Error('Non-English UI text found in documentation screenshot');
    await writeFile(path, await driver.screenshot(selector));
  };
  const { call, close, resize, useWindow } = driver;
  return { execute, call, click, capture, close, resize, useWindow };
}
