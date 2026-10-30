import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildManifest, verifyManifest } from '../scripts/native-build-artifact.mjs';
import { captureNativeFailure, redactNativeLog } from '../scripts/native-diagnostics.mjs';

const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

it('rejects an artifact from another revision or modified executables', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'native-artifact-test-'));
  directories.push(directory);
  await writeFile(join(directory, 'ancient-lens.exe'), 'synthetic app');
  await writeFile(join(directory, 'stats-service.exe'), 'synthetic service');
  const commit = '1'.repeat(40);
  await writeFile(join(directory, 'native-build.json'), JSON.stringify(await buildManifest(directory, commit)));
  expect((await verifyManifest(directory, commit)).commit).toBe(commit);
  await expect(verifyManifest(directory, '2'.repeat(40))).rejects.toThrow('source revision');
  await writeFile(join(directory, 'ancient-lens.exe'), 'modified');
  await expect(verifyManifest(directory, commit)).rejects.toThrow('checksum mismatch');
});

it('preserves geometry and logs when a screenshot fails, without leaking a fixture token', async () => {
  const name = `unit-${process.pid}`;
  const directory = join('test-results', 'native', name);
  directories.push(directory);
  const previous = process.env.ANCIENT_NATIVE_SCENARIO;
  process.env.ANCIENT_NATIVE_SCENARIO = name;
  try {
    await captureNativeFailure({
      driver: {
        useWindow: async () => {},
        execute: async () => ({ viewport: { width: 1024, height: 720 } }),
        screenshot: async () => {
          throw new Error('Renderer unavailable');
        },
      },
      error: new Error('synthetic failure'),
      log: `Bearer private-value ${'a'.repeat(64)}`,
    });
    const report = JSON.parse(await readFile(join(directory, 'geometry.json'), 'utf8'));
    expect(report.windows.main.viewport.height).toBe(720);
    expect(report.captureErrors).toContain('main screenshot: Renderer unavailable');
    expect(await readFile(join(directory, 'application.log'), 'utf8')).toBe('Bearer [redacted] [redacted]');
    expect(await readFile(join(directory, 'error.txt'), 'utf8')).toContain('synthetic failure');
  } finally {
    if (previous === undefined) delete process.env.ANCIENT_NATIVE_SCENARIO;
    else process.env.ANCIENT_NATIVE_SCENARIO = previous;
  }
  expect(redactNativeLog('synthetic-not-a-token')).not.toContain('synthetic-not-a-token');
});
