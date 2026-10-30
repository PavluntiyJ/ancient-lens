// Capture only the isolated UI and selected geometry, never application state or credentials.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function redactNativeLog(value) {
  return String(value)
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b[a-f0-9]{64}\b/gi, '[redacted]')
    .replace(/synthetic-not-a-token/g, '[synthetic credential]');
}

const geometryScript = `
  const box = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect(), css = getComputedStyle(el);
    return { x:r.x, y:r.y, width:r.width, height:r.height,
      scrollWidth:el.scrollWidth, scrollHeight:el.scrollHeight,
      zoom:css.zoom, minHeight:css.minHeight, display:css.display };
  };
  const selectors = ['.app-shell', '.app-toolbar', '.match-page', '.match-fit',
    '.match-roster', '.analysis-strip', '.analysis-panel', '.analysis-content', 'dialog[open]'];
  return {
    viewport:{width:innerWidth,height:innerHeight,dpi:devicePixelRatio},
    frame:{left:screenX,top:screenY,width:outerWidth,height:outerHeight},
    screen:{width:screen.width,height:screen.height,availableWidth:screen.availWidth,availableHeight:screen.availHeight},
    focused:document.hasFocus(), visibility:document.visibilityState,
    elements:Object.fromEntries(selectors.map(s => [s,[...document.querySelectorAll(s)].map(box)])),
    pageErrors:window.smokeErrors ?? []
  };
`;

// A wedged renderer must not prevent logs and the original failure from being preserved.
async function bounded(task) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(task),
      new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('Capture timed out')), 5000))),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function captureNativeFailure({ driver, error, log = '', operation = null }) {
  const directory = join('test-results', 'native', process.env.ANCIENT_NATIVE_SCENARIO || 'standalone');
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'error.txt'), redactNativeLog(error?.stack || error));
    await writeFile(join(directory, 'application.log'), redactNativeLog(log));
    const report = { platform: process.platform, operation, windows: {}, captureErrors: [] };
    for (const name of ['main', 'profile']) {
      try {
        if (!driver) throw new Error('Native driver was not initialized');
        await bounded(() => driver.useWindow(name));
        // Try geometry and screenshot independently; either can survive the other's failure.
        for (const kind of ['geometry', 'screenshot']) {
          try {
            if (kind === 'geometry') report.windows[name] = await bounded(() => driver.execute(geometryScript));
            else await writeFile(join(directory, `failure-${name}.png`), await bounded(() => driver.screenshot()));
          } catch (captureError) {
            report.captureErrors.push(`${name} ${kind}: ${captureError.message}`);
          }
        }
      } catch (captureError) {
        report.captureErrors.push(`${name}: ${captureError.message}`);
      }
    }
    await writeFile(join(directory, 'geometry.json'), redactNativeLog(JSON.stringify(report, null, 2)));
  } catch (captureError) {
    console.error(`Native diagnostics unavailable: ${redactNativeLog(captureError.message)}`);
  }
}
