// Linux native launches are blocked after repeated disruption of the host KDE session.
import { spawn } from 'node:child_process';

if (process.platform === 'linux') {
  console.error(
    'Linux native tests, captures and demos are disabled after repeated host Alt+Tab failures. ' +
      'Do not start nested KWin or bypass this guard on the user desktop. See docs/dev/verification.md#desktop-isolation.',
  );
  process.exitCode = 1;
} else {
  const args = process.argv.slice(2);
  if (args[0] === '--desktop') args.shift();
  const script = args.shift() || 'scripts/smoke-native.mjs';
  const child = spawn(process.execPath, [script, ...args], { env: process.env, stdio: 'inherit' });
  const stop = () => child.kill('SIGTERM');
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    });
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
