// One scenario on both systems; Windows adds its memory-reader worker check.
if (!['linux', 'win32'].includes(process.platform)) throw new Error('Native smoke tests support Linux and Windows.');
await import('./smoke-native-scenario.mjs');
if (process.platform === 'win32') await import('./smoke-roster-windows.mjs');
await import('./smoke-onboarding.mjs');
