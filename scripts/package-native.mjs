import { existsSync } from 'node:fs';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
import { resolve } from 'node:path';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const folder = resolve('release', `Ancient-Lens-${version}-Tauri`);
await mkdir(folder, { recursive: true });
const files = {
  'Ancient Lens.exe': 'src-tauri/target/release/ancient-lens.exe',
  LICENSE: 'LICENSE',
  'THIRD_PARTY_NOTICES.md': 'THIRD_PARTY_NOTICES.md',
  'licenses/Fira-OFL.txt': 'src/ui/fonts/OFL.txt',
  'licenses/Saira-OFL.txt': 'src/ui/fonts/saira-semi-condensed-LICENSE.txt',
  'licenses/Valve-ranks.txt': 'public/ranks/README.txt',
  'licenses/Valve-roles.md': 'public/roles/SOURCES.md',
  'licenses/Profile-sites.md': 'public/sites/SOURCES.md',
  // MIT requires the notice with every copy; the flags are bundled inside the app.
  'licenses/Flags-MIT.txt': 'public/flags/LICENSE.txt',
  'licenses/Flags-sources.md': 'public/flags/SOURCES.md',
};
// The optional local statistics service is a separate binary. Include it when it was built
// beside the app, so a portable install can start it after the token is saved once.
if (existsSync('src-tauri/target/release/stats-service.exe'))
  files['stats-service.exe'] = 'src-tauri/target/release/stats-service.exe';
const archive = {};
for (const [destination, source] of Object.entries(files)) {
  const target = resolve(folder, destination);
  await mkdir(resolve(target, '..'), { recursive: true });
  await copyFile(source, target);
  archive[destination] = new Uint8Array(await readFile(target));
}
const readme = `Ancient Lens ${version} — Windows portable build

Extract the complete ZIP and run Ancient Lens.exe as your normal user.
Microsoft Edge WebView2 Runtime must be installed. This build is unsigned.

FIRST LAUNCH
1. Open Settings > Connect Dota 2. It shows what is missing; Fix connection
   installs the GSI file and the launch option. Restart Dota afterwards.
2. Spectate a match to check the connection. Public OpenDota profiles need no key.
3. Optional STRATZ draft features: save your token once with the Python launcher
   from the project repository (Windows Credential Manager), then start this
   folder's stats-service.exe from Ancient Lens automatically. See the STRATZ
   guide. If stats-service.exe is missing, the app still uses public OpenDota.

MEMORY READING (OPTIONAL, OFF BY DEFAULT)
Participant GSI supplies only your own player. Settings > Allow Dota memory reading
adds the ten-player roster, picks, bans and lanes of your own match, and your exact
MMR and rank confidence. It reads the game process only; it never writes, injects
or calls game code. The anti-cheat response is unknown. Public rank medals are not
exact MMR.

DATA AND HELP
Settings, notes and rating history are stored in %APPDATA%/Ancient Lens.
The generated GSI config and personal exports contain private data; do not share them.
Only one app instance can use GSI port 32123 at a time.
Setup: https://github.com/PavluntiyJ/ancient-lens/blob/main/docs/guide/setup.md
STRATZ: https://github.com/PavluntiyJ/ancient-lens/blob/main/docs/guide/stats-service.md
Issues: https://github.com/PavluntiyJ/ancient-lens/issues

Project code is MIT licensed. Third-party artwork/fonts retain separate rights.
See THIRD_PARTY_NOTICES.md and licenses/ in this archive.
`;
await writeFile(`${folder}/README.txt`, readme.replaceAll('\n', '\r\n'));
archive['README.txt'] = strToU8(readme.replaceAll('\n', '\r\n'));
const zip = resolve('release', `Ancient-Lens-${version}-Tauri-win.zip`);
await writeFile(zip, zipSync(archive, { level: 6 }));
console.log(zip);
