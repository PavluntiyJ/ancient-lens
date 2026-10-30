// Bind reusable Windows executables to their exact source revision and content.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const files = ['ancient-lens.exe', 'stats-service.exe'];
const digest = (data) => createHash('sha256').update(data).digest('hex');

export async function buildManifest(directory, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('A full source commit SHA is required');
  const hashes = Object.fromEntries(
    await Promise.all(files.map(async (name) => [name, digest(await readFile(join(directory, name)))])),
  );
  return { commit, platform: 'win32', files: hashes };
}

export async function verifyManifest(directory, commit) {
  const saved = JSON.parse(await readFile(join(directory, 'native-build.json'), 'utf8'));
  const actual = await buildManifest(directory, commit);
  if (saved.commit !== actual.commit || saved.platform !== actual.platform) {
    throw new Error('Native artifact does not match this source revision or platform');
  }
  if (
    Object.keys(saved.files || {})
      .sort()
      .join() !== [...files].sort().join()
  ) {
    throw new Error('Native artifact file list is invalid');
  }
  for (const name of files) {
    if (saved.files[name] !== actual.files[name]) throw new Error(`Native artifact checksum mismatch: ${name}`);
  }
  return saved;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, directory = 'src-tauri/target/release'] = process.argv.slice(2);
  if (command === 'create') {
    await writeFile(
      join(directory, 'native-build.json'),
      JSON.stringify(await buildManifest(directory, process.env.GITHUB_SHA), null, 2),
    );
  } else if (command === 'verify') {
    await verifyManifest(directory, process.env.GITHUB_SHA);
    console.log('Native artifact revision and both executable checksums verified.');
  } else throw new Error('Expected create or verify');
}
