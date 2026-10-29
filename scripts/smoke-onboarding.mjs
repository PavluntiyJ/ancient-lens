// Real native first-run dialogs, using isolated data and synthetic credentials only.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeCapture, waitFor } from './native-capture.mjs';

const directory = await mkdtemp(join(tmpdir(), 'ancient-onboarding-'));
const env = { ANCIENT_READER_PROMPT: '1', ANCIENT_STATS_URL: undefined };
const captures = process.env.ANCIENT_ONBOARDING_CAPTURE_DIR;
if (captures) await mkdir(captures, { recursive: true });
let app;
const dialog = (title) =>
  waitFor(
    () =>
      app.execute('return [...document.querySelectorAll("dialog[open]")].some(d=>d.innerText.includes(arguments[0]))', [
        title,
      ]),
    `Missing dialog: ${title}`,
  );
const screenshot = async (name) => {
  if (captures) await app.capture(join(captures, name), 'dialog[open]');
};
try {
  app = await nativeCapture(directory, env);
  await dialog('See all ten players');
  assert.equal(await app.execute('return document.querySelectorAll("dialog[open]").length'), 1);
  await screenshot('reader.png');
  await app.click('Not now');
  await dialog('Connect STRATZ');
  assert.equal((await app.call('getState')).nativeRosterReader, 'off');
  assert.equal(await app.execute('return document.querySelectorAll("dialog[open]").length'), 1);
  await screenshot('stratz.png');
  // Keep the real IPC path: isolated sessions return the URL without opening a browser.
  await app.execute(`
    const original = window.ancient.openStratzTokens;
    window.ancient.openStratzTokens = async () => window.openedTokenUrl = await original();
  `);
  await app.click('Open stratz.com/api');
  await waitFor(
    () => app.execute('return window.openedTokenUrl === "https://stratz.com/api"'),
    'Token URL was not dispatched',
  );
  await app.execute('window.ancient.openStratzTokens = async () => { throw new Error("Synthetic browser failure"); }');
  await app.click('Open stratz.com/api');
  await waitFor(
    () => app.execute('return document.querySelector("dialog").innerText.includes("Synthetic browser failure")'),
    'Browser error was hidden',
  );
  assert.ok(await app.execute('return document.querySelector("dialog").innerText.includes("https://stratz.com/api")'));
  await screenshot('stratz-error.png');
  // The Rust test-mode guard rejects tokens without touching the keyring or services.
  await app.execute(`
    const input = document.querySelector('input[aria-label="Your STRATZ API token"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'synthetic-not-a-token');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await app.click('Connect');
  await waitFor(
    () =>
      app.execute('return document.querySelector("dialog").innerText.includes("disabled in isolated test sessions")'),
    'Isolated token error was hidden',
  );
  assert.equal(await app.execute('return document.querySelector("dialog input").value'), '');
  await app.click('Not now');
  assert.equal(await app.execute('return document.querySelectorAll("dialog[open]").length'), 0);
  // WebKit batches local-storage writes. The driver forcibly stops the process,
  // so give it a flush interval before checking persistence in a new process.
  await new Promise((done) => setTimeout(done, 2000));
  await app.close();
  app = await nativeCapture(directory, env);
  assert.equal(await app.execute('return localStorage.getItem("ancient-reader-asked")'), 'true');
  assert.equal(await app.execute('return localStorage.getItem("ancient-stratz-asked")'), 'true');
  assert.equal(await app.execute('return document.querySelectorAll("dialog[open]").length'), 0);
  // Use a clean directory for the enable branch, without depending on WebKit
  // flushing local-storage deletions while its process is shutting down.
  await app.close();
  const enableDirectory = await mkdtemp(join(tmpdir(), 'ancient-onboarding-enable-'));
  app = await nativeCapture(enableDirectory, env);
  await dialog('See all ten players');
  await app.click('Enable memory reading');
  await dialog('Connect STRATZ');
  assert.equal((await app.call('getState')).nativeRosterReader, 'on');
  // Synthetic pending/successful connection: never touch the system keyring.
  await app.execute(`
    window.ancient.connectStratz = () => new Promise(resolve => window.finishSyntheticConnection = resolve);
    const input = document.querySelector('input[aria-label="Your STRATZ API token"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'synthetic-not-a-token');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await app.click('Connect');
  assert.ok(await app.execute('return document.querySelector("dialog button[aria-label=Close]").disabled'));
  assert.equal(await app.execute('return document.querySelector("dialog input").value'), '');
  await app.execute(`
    window.finishSyntheticConnection({source:'STRATZ',hasToken:true,persistent:true,serviceConfigured:true,message:'Synthetic connection complete.'});
  `);
  await dialog('Synthetic connection complete.');
  await app.click('Done');
  assert.equal(await app.execute('return localStorage.getItem("ancient-stratz-asked")'), 'true');
  await app.call('setNativeRosterReader', 'off');
  console.log(
    'Native onboarding passed: both reader choices, STRATZ URL/error, isolated token rejection, busy/success UI, dismissal/restart.',
  );
} finally {
  await app?.close();
}
