// Export one commit as a public source snapshot: no Git history, no working-tree or untracked
// files, and none of the private paths. `npm run export:public -- <ref>` (default HEAD).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import {
  brokenLinks,
  commitBlob,
  commitFiles,
  isBinary,
  isPrivate,
  problemsOf,
  PRIVATE_PATHS,
} from './public-source.mjs';

const ref = process.argv[2] ?? 'HEAD';
const commit = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8' }).trim();
const { version } = JSON.parse(commitBlob(commit, 'package.json').toString('utf8'));
const prefix = `ancient-lens-${version}-source`;
const files = commitFiles(commit).filter(({ path }) => !isPrivate(path));
const archive = {};
const manifest = {
  version,
  commit,
  description: 'Reviewed source snapshot of one commit. No Git history, local or private files.',
  excluded: PRIVATE_PATHS,
  files: [],
};
const problems = [];
// A public document must not link to a private one: links resolve inside the snapshot only.
const known = new Set(files.map(({ path }) => path));
for (const { path, mode } of files) {
  const bytes = commitBlob(commit, path);
  const text = isBinary(path) ? undefined : bytes.toString('utf8');
  problems.push(...problemsOf(path, text));
  if (text !== undefined && path.endsWith('.md')) problems.push(...brokenLinks(path, text, known));
  manifest.files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  archive[`${prefix}/${path}`] = [new Uint8Array(bytes), { os: 3, attrs: (parseInt(mode, 8) & 0xffff) << 16 }];
}
if (problems.length) {
  console.error(problems.join('\n'));
  throw new Error('Fix public-source check failures in this commit before exporting.');
}
archive[`${prefix}/SOURCE-MANIFEST.json`] = strToU8(JSON.stringify(manifest, null, 2) + '\n');
await mkdir('release', { recursive: true });
const path = resolve('release', `${prefix}.zip`);
const bytes = zipSync(archive, { level: 6 });
await writeFile(path, bytes);
await writeFile(`${path}.sha256`, `${createHash('sha256').update(bytes).digest('hex')}  ${prefix}.zip\n`);
console.log(`Exported ${manifest.files.length} source files of ${commit.slice(0, 12)}: ${path}`);
console.log('Publishing this ZIP does not remove old branches, tags, or commits from an existing remote.');
