if (process.platform === 'linux') {
  await import('./smoke-native-linux.mjs');
} else if (process.platform === 'win32') {
  await import('./smoke-native-windows.mjs');
  await import('./smoke-roster-windows.mjs');
} else {
  throw new Error('Native smoke tests support Linux and Windows.');
}
await import('./smoke-onboarding.mjs');
