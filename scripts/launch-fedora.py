#!/usr/bin/env python3
"""Fedora launcher: unlock saved credentials, start the user service, open the app."""
import argparse
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request
from stratz_credentials import load_token

ROOT = Path(__file__).resolve().parent.parent
UNIT = 'ancient-lens-stats.service'
URL = 'http://127.0.0.1:8787'


def quoted(value):
    # Both systemd ExecStart and Desktop Entry Exec accept double-quoted arguments.
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"').replace('`', '\\`').replace('$', '\\$').replace('%', '%%') + '"'


def install():
    config = Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config'))
    data = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local/share'))
    units = config / 'systemd/user'
    units.mkdir(parents=True, exist_ok=True)
    (units / UNIT).write_text(
        '[Unit]\nDescription=Ancient Lens personal STRATZ service\n'
        'StartLimitIntervalSec=120\nStartLimitBurst=3\n\n[Service]\n'
        f'ExecStart=/usr/bin/python3 {quoted(ROOT / "scripts/start-personal-stratz.py")} --saved-token\n'
        'Restart=on-failure\nRestartSec=5\nUMask=0077\n')
    apps = data / 'applications'
    apps.mkdir(parents=True, exist_ok=True)
    (apps / 'org.ancientlens.desktop').write_text(
        '[Desktop Entry]\nType=Application\nName=Ancient Lens\nComment=Dota 2 companion\n'
        f'Exec=/usr/bin/python3 {quoted(ROOT / "scripts/launch-fedora.py")}\n'
        f'Icon={ROOT / "build/icon.png"}\nTerminal=false\nCategories=Game;\n'
        'StartupWMClass=ancient-lens\nActions=ConfigureStratz;\n\n'
        '[Desktop Action ConfigureStratz]\nName=Configure STRATZ\n'
        f'Exec=/usr/bin/python3 {quoted(ROOT / "scripts/launch-fedora.py")} --configure\n')
    subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True, capture_output=True, timeout=15)


def ready():
    try:
        with urllib.request.urlopen(URL + '/health', timeout=1) as response:
            data = json.load(response)
            return data.get('status') == 'ready' and data.get('protocol') == 1
    except (OSError, ValueError, urllib.error.URLError):
        return False


def configure():
    result = subprocess.run([sys.executable, str(ROOT / 'scripts/start-personal-stratz.py'), '--dialog', '--configure'],
                            capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or 'Could not connect to STRATZ.')


def start_service():
    # Repeated launches reuse an existing service; systemd serializes concurrent starts.
    if ready():
        return
    if not load_token():
        configure()
    subprocess.run(['systemctl', '--user', 'reset-failed', UNIT], capture_output=True, timeout=15)
    result = subprocess.run(['systemctl', '--user', 'start', UNIT], capture_output=True, timeout=15)
    if result.returncode:
        raise RuntimeError('Could not start the STRATZ service.')
    for _ in range(50):
        if ready():
            return
        time.sleep(.1)
    raise RuntimeError('The STRATZ service did not respond. Check your system keyring and try again.')


def collect_debug():
    logs = Path(os.environ.get('XDG_STATE_HOME', Path.home() / '.local/state')) / 'ancient-lens/logs'
    out = ROOT / 'test-results' / 'live-logs'
    out.mkdir(parents=True, exist_ok=True)
    copied = []
    sessions = sorted(logs.glob('session-*.log'))
    if sessions:
        latest = sessions[-1]
        target = out / latest.name
        shutil.copy2(latest, target)
        copied.append(str(target))
    diag = Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'Ancient Lens' / 'gsi-draft-diagnostics.jsonl'
    if diag.is_file():
        # The source file keeps growing across launches; each collection is a separate copy.
        target = out / time.strftime('gsi-draft-diagnostics-%Y%m%d-%H%M%S.jsonl')
        shutil.copy2(diag, target)
        copied.append(str(target))
    if not copied:
        raise RuntimeError('No debug logs or diagnostics found.')
    print('\n'.join(copied))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--install', action='store_true', help='Install the menu shortcut and user service')
    parser.add_argument('--configure', action='store_true', help='Replace the saved token')
    parser.add_argument('--debug', action='store_true', help='Enable verbose roster/GSI diagnostics for a live test')
    parser.add_argument('--collect', action='store_true', help='Copy the latest session logs and diagnostics into test-results/live-logs')
    args = parser.parse_args()
    if args.collect:
        collect_debug()
        return
    if args.install:
        install()
        return
    binary = ROOT / 'src-tauri/target/release/ancient-lens'
    if not binary.is_file():
        raise RuntimeError('Build Ancient Lens first; see docs/guide/fedora.md.')
    if args.configure:
        configure()
        subprocess.run(['systemctl', '--user', 'stop', UNIT], check=True, capture_output=True, timeout=15)
    start_service()
    env = os.environ.copy()
    env.pop('STRATZ_API_TOKEN', None)
    env['ANCIENT_STATS_URL'] = URL
    if args.debug:
        env['ANCIENT_DEBUG'] = '1'
        env['ANCIENT_GSI_DRAFT_DIAGNOSTICS'] = '1'
    log_session(binary)
    os.execve(binary, [str(binary)], env)


def log_session(binary):
    # Each launch gets its own log: reader states, request outcomes. No tokens or account IDs.
    logs = Path(os.environ.get('XDG_STATE_HOME', Path.home() / '.local/state')) / 'ancient-lens/logs'
    logs.mkdir(parents=True, exist_ok=True, mode=0o700)
    for old in sorted(logs.glob('session-*.log'))[:-19]:
        old.unlink(missing_ok=True)
    path = logs / time.strftime('session-%Y%m%d-%H%M%S.log')
    commit = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', '--short', 'HEAD'],
                            capture_output=True, text=True).stdout.strip() or 'unknown'
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    os.write(fd, f'{time.strftime("%Y-%m-%d %H:%M:%S %z")} Ancient Lens {commit}, binary built '
                 f'{time.strftime("%Y-%m-%d %H:%M", time.localtime(binary.stat().st_mtime))}\n'.encode())
    os.dup2(fd, 1)
    os.dup2(fd, 2)
    os.close(fd)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        message = str(error) if isinstance(error, RuntimeError) else 'Could not start Ancient Lens. Check the service installation.'
        subprocess.run(['kdialog', '--title', 'Ancient Lens', '--error', message], check=False)
        sys.exit(1)
