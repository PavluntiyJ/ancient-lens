// Separate processes preserve results and logs even when a scenario crashes.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { redactNativeLog } from './native-diagnostics.mjs';

if (!['linux', 'win32'].includes(process.platform)) throw new Error('Native smoke tests support Linux and Windows.');
const directory = join('test-results', 'native');
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
const binary = resolve(
  process.env.ANCIENT_NATIVE_BINARY ||
    `src-tauri/target/release/ancient-lens${process.platform === 'win32' ? '.exe' : ''}`,
);
const report = {
  platform: process.platform,
  commit: process.env.NATIVE_SOURCE_SHA || process.env.GITHUB_SHA || 'local',
  testCommit: process.env.GITHUB_SHA || 'local',
  runAttempt: process.env.GITHUB_RUN_ATTEMPT || 'local',
  binarySha256: null,
  scenarios: [],
};
const scenarios = [
  ['shared', 'scripts/smoke-native-scenario.mjs'],
  ...(process.platform === 'win32' ? [['reader', 'scripts/smoke-roster-windows.mjs']] : []),
  ['onboarding', 'scripts/smoke-onboarding.mjs'],
];
try {
  report.binarySha256 = createHash('sha256')
    .update(await readFile(binary))
    .digest('hex');
  for (const [name, script] of scenarios) {
    const output = join(directory, name);
    await mkdir(output, { recursive: true });
    const started = Date.now();
    const log = [];
    const code = await new Promise((done) => {
      const child = spawn(process.execPath, [script], {
        env: { ...process.env, ANCIENT_NATIVE_BINARY: binary, ANCIENT_NATIVE_SCENARIO: name },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      for (const stream of [child.stdout, child.stderr]) {
        stream.setEncoding('utf8');
        let pending = '';
        stream.on('data', (data) => {
          log.push(data);
          pending += data;
          const end = pending.lastIndexOf('\n');
          if (end >= 0) {
            process.stdout.write(redactNativeLog(pending.slice(0, end + 1)));
            pending = pending.slice(end + 1);
          }
        });
        stream.on('end', () => process.stdout.write(redactNativeLog(pending)));
      }
      child.on('error', (error) => {
        log.push(redactNativeLog(error.stack));
        done(1);
      });
      child.on('close', (status) => done(status ?? 1));
    });
    await writeFile(join(output, 'scenario.log'), redactNativeLog(log.join('')));
    const error =
      code === 0
        ? null
        : redactNativeLog(
            await readFile(join(output, 'error.txt'), 'utf8').catch(
              () =>
                log
                  .join('')
                  .split('\n')
                  .find((line) => /Error[: \[]/.test(line)) || 'See scenario.log for the failure',
            ),
          )
            .split('\n')[0]
            .slice(0, 500);
    report.scenarios.push({
      name,
      status: code === 0 ? 'passed' : 'failed',
      exitCode: code,
      seconds: (Date.now() - started) / 1000,
      error,
    });
    if (code !== 0) {
      process.exitCode = 1;
      break;
    }
  }
} catch (error) {
  await writeFile(join(directory, 'runner-error.txt'), redactNativeLog(error.stack));
  process.exitCode = 1;
} finally {
  await writeFile(join(directory, 'results.json'), JSON.stringify(report, null, 2));
  const summary = [
    `## Native smoke: ${process.exitCode ? 'failed' : 'passed'} (${report.platform})`,
    '',
    `Commit: \`${report.commit}\` · attempt: ${report.runAttempt}`,
    `Test scripts: \`${report.testCommit}\``,
    `Executable SHA-256: \`${report.binarySha256 || 'unavailable'}\``,
    '',
    '| Scenario | Result | Seconds |',
    '| --- | --- | ---: |',
    ...scenarios.map(([name]) => {
      const result = report.scenarios.find((item) => item.name === name);
      return `| ${name} | ${result?.status || 'not run'} | ${result?.seconds.toFixed(1) || '—'} |`;
    }),
    '',
    ...report.scenarios
      .filter((result) => result.error)
      .map((result) => `Failure: \`${result.error.replaceAll('`', "'")}\``),
    '',
    'Failure diagnostics include isolated window screenshots, geometry and logs when the renderer responds.',
    'Use the workflow’s three native source fields to recheck this build without compilation or packaging.',
    '',
  ].join('\n');
  await writeFile(join(directory, 'summary.md'), summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
}
