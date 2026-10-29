// Small native-window adapter shared by documentation capture on Linux/Windows.
// Every launch uses isolated fixture data; no game or Steam files are accessed.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { access, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export async function waitFor(check, message, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error(message);
}

export async function nativeCapture(directory, extraEnv) {
  if (!['linux', 'win32'].includes(process.platform)) throw new Error('Native screenshots require Linux or Windows.');
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
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* Already stopped. */
      }
    }
  };
  try {
    await waitFor(async () => {
      if (failure) throw new Error(`Cannot start native capture. On Linux install WebKitWebDriver: ${failure.message}`);
      if (child.exitCode !== null) throw new Error(`Native capture exited: ${diagnostic}`);
      return fetch(`http://127.0.0.1:${port}/${windows ? 'json/version' : 'status'}`).then(
        (r) => r.ok,
        () => false,
      );
    }, 'Native capture did not start; close other Ancient Lens windows and retry.');
    // The app has a match window (label `main`) and a profile window; `useWindow` switches
    // every following call to one of them.
    let execute, call, screenshot, resize, useWindow;
    if (windows) {
      const endpoint = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
      const context = browser.contexts()[0];
      const label = (p) => p.evaluate(() => window.ancient?.windowName).catch(() => undefined);
      const pageFor = async (name) => {
        for (const p of context.pages().filter((p) => p.url().includes('tauri.localhost')))
          if ((await label(p)) === name) return p;
      };
      let page;
      await waitFor(async () => !!(page = await pageFor('main')), 'No app window');
      await page.setViewportSize({ width: 1600, height: 1240 });
      useWindow = async (name) => {
        let found;
        await waitFor(async () => !!(found = await pageFor(name)), `No ${name} window`);
        page = found;
      };
      resize = (width, height) => page.setViewportSize({ width, height });
      execute = (script, args = []) =>
        page.evaluate(({ script, args }) => new Function(script)(...args), { script, args });
      call = (name, ...args) => page.evaluate(({ name, args }) => window.ancient[name](...args), { name, args });
      screenshot = (path, selector) =>
        selector ? page.locator(selector).screenshot({ path }) : page.screenshot({ path });
    } else {
      session = (
        await request('/session', { capabilities: { alwaysMatch: { 'webkitgtk:browserOptions': { binary } } } })
      ).sessionId;
      execute = (script, args = []) => request(`/session/${session}/execute/sync`, { script, args });
      useWindow = async (name) => {
        await waitFor(async () => {
          for (const handle of await request(`/session/${session}/window/handles`)) {
            await request(`/session/${session}/window`, { handle });
            if ((await execute('return window.ancient?.windowName')) === name) return true;
          }
          return false;
        }, `No ${name} window`);
      };
      await useWindow('main');
      await request(`/session/${session}/window/rect`, { width: 1600, height: 1240 });
      resize = (width, height) => request(`/session/${session}/window/rect`, { width, height });
      call = async (name, ...args) => {
        const result = await request(`/session/${session}/execute/async`, {
          script:
            'const done=arguments[arguments.length-1];window.ancient[arguments[0]](...arguments[1]).then(value=>done({value}),error=>done({error:String(error)}));',
          args: [name, args],
        });
        if (result.error) throw new Error(result.error);
        return result.value;
      };
      screenshot = async (path, selector) => {
        let route = `/session/${session}/screenshot`;
        if (selector) {
          const element = await execute('return document.querySelector(arguments[0])', [selector]);
          if (!element) throw new Error(`Screenshot element missing: ${selector}`);
          route = `/session/${session}/element/${element['element-6066-11e4-a52e-4f735466cecf']}/screenshot`;
        }
        await writeFile(path, Buffer.from(await request(route), 'base64'));
      };
    }
    await waitFor(
      () => execute('return !!window.ancient && document.body.innerText.includes("Match players")'),
      'Native UI did not load',
    );
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
      await screenshot(path, selector);
    };
    return { execute, call, click, capture, close, resize, useWindow };
  } catch (error) {
    await close();
    throw error;
  }
}
