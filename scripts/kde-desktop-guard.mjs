// Keeps native UI runs from breaking the developer's KDE desktop.
//
//   node scripts/kde-desktop-guard.mjs check            report the desktop state
//   node scripts/kde-desktop-guard.mjs repair           fix what a test run broke
//   node scripts/kde-desktop-guard.mjs run -- <command> run in a private bus and a virtual
//                                                       KWin, then repair (always)
//
// Known damage from nested test sessions:
// - KWin's window-switching shortcuts (Alt+Tab) go inactive: the keys stay assigned, but
//   `/component/kwin` reports `isActive = false` and the keys do nothing. Registering the
//   same keys again with the "present" flag brings them back; the saved assignments in
//   `kglobalshortcutsrc` are not touched.
// - The flatpak document portal stops, `/run/user/<uid>/doc` is unmounted and flatpak apps
//   fail with "bwrap: Can't find source path".
// - An `xdg-desktop-portal-kde` stays alive on the dead test bus.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const uid = process.getuid?.();
const docMount = `/run/user/${uid}/doc`;
const userBus = `unix:path=/run/user/${uid}/bus`;
const switchActions = [
  'Walk Through Windows',
  'Walk Through Windows (Reverse)',
  'Walk Through Windows Alternative',
  'Walk Through Windows Alternative (Reverse)',
  'Walk Through Windows of Current Application',
  'Walk Through Windows of Current Application (Reverse)',
  'Walk Through Windows of Current Application Alternative',
  'Walk Through Windows of Current Application Alternative (Reverse)',
];
// KGlobalAccel::SetShortcutFlag SetPresent: the action exists again; keys are not reloaded.
const SET_PRESENT = 2;

/** `busctl --json` call on the user's real session bus; `undefined` when it fails. */
function busctl(...args) {
  const result = spawnSync('busctl', ['--user', '--json=short', 'call', ...args], {
    encoding: 'utf8',
    env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: userBus },
  });
  if (result.status !== 0) return undefined;
  return JSON.parse(result.stdout).data;
}
const kglobalaccel = (method, signature, ...args) =>
  busctl('org.kde.kglobalaccel', '/kglobalaccel', 'org.kde.KGlobalAccel', method, signature, ...args);

function kwinActive() {
  return busctl('org.kde.kglobalaccel', '/component/kwin', 'org.kde.kglobalaccel.Component', 'isActive')?.[0];
}
function switchShortcuts() {
  return switchActions.flatMap((name) => {
    const keys = kglobalaccel('shortcut', 'as', 4, 'kwin', name, 'KWin', name)?.[0] ?? [];
    return keys.length ? [{ name, keys }] : [];
  });
}
function docMounted() {
  return spawnSync('findmnt', ['-rn', docMount]).status === 0;
}
/** KDE portals whose session bus no longer exists (left over from a test bus). */
function orphanPortals() {
  return readdirSync('/proc').flatMap((pid) => {
    if (!/^\d+$/.test(pid)) return [];
    try {
      if (!readFileSync(`/proc/${pid}/comm`, 'utf8').startsWith('xdg-desktop-por')) return [];
      const bus = readFileSync(`/proc/${pid}/environ`, 'utf8')
        .split('\0')
        .find((line) => line.startsWith('DBUS_SESSION_BUS_ADDRESS='))
        ?.slice('DBUS_SESSION_BUS_ADDRESS='.length);
      const path = bus?.match(/^unix:path=([^,]+)/)?.[1];
      return path && bus !== userBus && !existsSync(path) ? [{ pid: Number(pid), bus }] : [];
    } catch {
      return [];
    }
  });
}

function state() {
  return {
    kwinShortcutsActive: kwinActive(),
    switchShortcuts: switchShortcuts().map(({ name, keys }) => `${name}: ${keys.join(',')}`),
    documentPortalMounted: docMounted(),
    orphanPortals: orphanPortals().map(({ pid, bus }) => `${pid} on ${bus}`),
  };
}

function repair() {
  const done = [];
  // Single actions can go inactive while the component stays active, and D-Bus has no
  // per-action query. Registering the same keys again is harmless, so it always runs;
  // it is reported only when the whole component was off.
  const active = kwinActive();
  for (const { name, keys } of switchShortcuts()) {
    const result = kglobalaccel(
      'setShortcut',
      'asaiu',
      4,
      'kwin',
      name,
      'KWin',
      name,
      keys.length,
      ...keys,
      SET_PRESENT,
    );
    if (!result) done.push(`could not reactivate "${name}"`);
    else if (active === false) done.push(`reactivated "${name}"`);
  }
  if (!docMounted() && existsSync(`/run/user/${uid}`)) {
    const restart = spawnSync('systemctl', ['--user', 'restart', 'xdg-document-portal.service']);
    done.push(
      restart.status === 0 && docMounted() ? 'restarted the document portal' : 'document portal is still not mounted',
    );
  }
  for (const { pid, bus } of orphanPortals()) {
    try {
      process.kill(pid);
      done.push(`stopped portal ${pid} left on ${bus}`);
    } catch {
      // Already gone.
    }
  }
  return done;
}

function report(title, value) {
  console.log(`${title}\n${JSON.stringify(value, null, 2)}`);
}

/** Runs a command inside a private session bus that activates no services, in a virtual KWin. */
async function run(command) {
  const directory = mkdtempSync(join(tmpdir(), 'ancient-kde-guard-'));
  const config = join(directory, 'session.conf');
  writeFileSync(
    config,
    `<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig><type>session</type><keep_umask/><listen>unix:tmpdir=${directory}</listen><auth>EXTERNAL</auth>
<policy context="default"><allow send_destination="*" eavesdrop="true"/><allow eavesdrop="true"/><allow own="*"/></policy></busconfig>
`,
  );
  const socket = `ancient-guard-${process.pid}`;
  const [width, height] = (process.env.ANCIENT_GUARD_SCREEN || '2560x1600').split('x');
  // KWin splits --exit-with-session like QProcess::splitCommand, which has no escape for `"`.
  if (command.some((part) => part.includes('"'))) throw new Error('The command must not contain double quotes.');
  const quoted = command.map((part) => `'${part.replaceAll("'", "'\\''")}'`).join(' ');
  const before = state();
  const child = spawn(
    'dbus-run-session',
    [
      `--config-file=${config}`,
      '--',
      'kwin_wayland',
      '--virtual',
      '--no-lockscreen',
      '--width',
      width,
      '--height',
      height,
      '--socket',
      socket,
      '--exit-with-session',
      `/bin/sh -c "WAYLAND_DISPLAY=${socket} exec ${quoted}"`,
    ],
    { stdio: 'inherit' },
  );
  const forward = (signal) => child.kill(signal);
  process.on('SIGINT', forward);
  process.on('SIGTERM', forward);
  const code = await new Promise((resolve) =>
    child.on('exit', (status, signal) => resolve(status ?? (signal ? 1 : 0))),
  );
  rmSync(directory, { recursive: true, force: true });
  const after = state();
  const done = repair();
  if (before.kwinShortcutsActive && after.kwinShortcutsActive === false)
    console.log('The run deactivated KWin shortcuts (Alt+Tab).');
  console.log(done.length ? `Desktop repaired: ${done.join('; ')}.` : 'Desktop unchanged.');
  return code;
}

const [mode, ...rest] = process.argv.slice(2);
if (process.platform !== 'linux') {
  console.log('Nothing to guard outside Linux.');
} else if (mode === 'check') {
  report('Desktop state', state());
} else if (mode === 'repair') {
  const done = repair();
  console.log(done.length ? `Repaired: ${done.join('; ')}.` : 'Nothing to repair.');
  report('Desktop state', state());
} else if (mode === 'run' && rest[0] === '--' && rest.length > 1) {
  process.exitCode = await run(rest.slice(1));
} else {
  console.error('Usage: kde-desktop-guard.mjs check | repair | run -- <command…>');
  process.exitCode = 2;
}
