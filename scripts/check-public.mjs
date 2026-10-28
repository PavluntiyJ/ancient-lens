// Guard public source/docs against accidental local data and untranslated copy.
// This complements a secret scanner; it is not a full privacy/security audit.
// It checks the working tree, untracked files included, so problems show before a commit;
// export-public.mjs applies the same rules to the exported commit.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { assertSafePath, brokenLinks, isBinary, problemsOf } from './public-source.mjs';

let sourceFiles;
try {
  sourceFiles = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .split('\0')
    .filter(Boolean);
} catch {
  // Exported source ZIPs deliberately contain no Git metadata.
  const manifest = JSON.parse(await readFile('SOURCE-MANIFEST.json', 'utf8'));
  sourceFiles = [...manifest.files.map(({ path }) => path), 'SOURCE-MANIFEST.json'];
}
const files = [...new Set(sourceFiles)];
const known = new Set(files);
const problems = [];
for (const file of files) {
  assertSafePath(file);
  let text;
  if (!isBinary(file)) {
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      continue;
    }
  }
  problems.push(...problemsOf(file, text));
  if (text !== undefined && file.endsWith('.md')) problems.push(...brokenLinks(file, text, known));
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else console.log(`Public-source checks passed for ${files.length} files.`);
