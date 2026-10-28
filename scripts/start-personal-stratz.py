#!/usr/bin/env python3
"""Start the statistics service using the system keyring or a hidden token prompt."""
import argparse
import getpass
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import urllib.error
import urllib.request
from stratz_credentials import delete_token, load_token, save_token, valid_token
from stratz_service import run_windows

parser = argparse.ArgumentParser()
parser.add_argument('--dialog', action='store_true', help='Use the KDE password dialog')
parser.add_argument('--inspect-schema', action='store_true', help='Save public GraphQL schema metadata for integration work')
parser.add_argument('--saved-token', action='store_true', help='Use only the saved token; never ask for an API token')
parser.add_argument('--configure', action='store_true', help='Validate and save a new token, without starting the service')
parser.add_argument('--forget', action='store_true', help='Remove the saved token and exit')
parser.add_argument('--session-only', action='store_true', help='Do not save the entered token')
args = parser.parse_args()
if args.forget:
    try:
        delete_token()
    except RuntimeError as error:
        sys.exit(str(error))
    print('Saved STRATZ token removed.', flush=True)
    sys.exit(0)
root = Path(__file__).resolve().parent.parent
executable = 'stats-service.exe' if os.name == 'nt' else 'stats-service'
binary = root / 'src-tauri/target/release' / executable
if not binary.is_file():
    binary = root / 'src-tauri/target/debug' / executable
if not binary.is_file():
    sys.exit('Build stats-service first; see docs/guide/stats-service.md.')
if not args.configure:
    with socket.socket() as probe:
        if probe.connect_ex(('127.0.0.1', 8787)) == 0:
            sys.exit('A service is already listening on 127.0.0.1:8787.')
try:
    token = load_token() if args.saved_token else None
except RuntimeError as error:
    sys.exit(str(error))
if args.saved_token and not token:
    sys.exit('STRATZ is not configured. Run this launcher without --saved-token once, or use --configure.')
if not args.saved_token:
    if args.dialog:
        prompt = subprocess.run(['kdialog', '--title', 'Ancient Lens · STRATZ', '--password',
            'Paste your STRATZ Default Token from My Tokens.\n' +
            ('The token is used until the service stops.' if args.session_only else
             'The token will be saved in your system keyring. You will not need to enter it on subsequent launches.')],
            capture_output=True, text=True)
        if prompt.returncode:
            sys.exit('Token entry cancelled.')
        token = prompt.stdout.strip()
    else:
        token = getpass.getpass('STRATZ Default Token (hidden): ').strip()
if not valid_token(token):
    sys.exit('Invalid token format.')

def query(document):
    request = urllib.request.Request('https://api.stratz.com/graphql',
        data=json.dumps({'query': document}).encode(),
        headers={'Content-Type': 'application/json', 'User-Agent': 'STRATZ_API', 'Authorization': 'Bearer ' + token})
    with urllib.request.urlopen(request, timeout=25) as response:
        return json.load(response)

try:
    if not args.saved_token:
        result = query('{ players(steamAccountIds:[87278757]) { steamAccountId matchCount } }')
        if result.get('errors') or not result.get('data', {}).get('players'):
            sys.exit('STRATZ did not grant access to player statistics. Check the token in My Tokens.')
        if not args.session_only:
            save_token(token)
        print('STRATZ connected.', flush=True)
    if args.inspect_schema:
        schema = query('{ __schema { types { kind name fields { name args { name type { kind name ofType { kind name ofType { kind name } } } } type { kind name ofType { kind name ofType { kind name } } } } enumValues { name } inputFields { name type { kind name ofType { kind name ofType { kind name } } } } } } }')
        (root / 'test-results').mkdir(exist_ok=True)
        (root / 'test-results/stratz-schema.json').write_text(json.dumps(schema))
except RuntimeError as error:
    sys.exit(str(error))
except urllib.error.HTTPError as error:
    sys.exit(f'STRATZ returned HTTP {error.code}. The service was not started.')
except (urllib.error.URLError, TimeoutError, ValueError):
    sys.exit('Could not validate the token: network, timeout or invalid API response. Try again.')
if args.configure:
    sys.exit(0)
env = os.environ.copy()
env.update(STRATZ_API_TOKEN=token, ANCIENT_SERVICE_BIND='127.0.0.1:8787', ANCIENT_UPSTREAM_HOURLY_BUDGET='60')
if os.name == 'nt':
    # os.execve detaches on Windows and Ctrl+C would no longer reach the service.
    sys.exit(run_windows(binary, env))
os.execve(binary, [str(binary)], env)
