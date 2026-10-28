// What may enter a public source snapshot, and the checks every public file must pass.
// Shared by check-public.mjs (working tree) and export-public.mjs (one commit).
import { execFileSync } from 'node:child_process';

/**
 * Kept in the private development repository only: research notes, their archive, internal
 * reports and plans, and the working log. Public documents must not link to them.
 */
export const PRIVATE_PATHS = ['docs/research/', 'docs/archive/', 'docs/internal/', 'docs/handoff.md'];

export const isPrivate = (path) => PRIVATE_PATHS.some((prefix) => path === prefix || path.startsWith(prefix));

/**
 * Relative Markdown links of `text` (in file `path`) that do not resolve to a file in `known`.
 * External links, anchors within the page and links inside code blocks are ignored.
 */
export function brokenLinks(path, text, known) {
  const broken = [];
  const base = path.split('/').slice(0, -1);
  let fenced = false;
  for (const [index, line] of text.split('\n').entries()) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    for (const [, target] of line.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
      const file = decodeURI(target.split('#')[0]);
      const parts = [...base];
      for (const part of file.split('/')) {
        if (part === '..') parts.pop();
        else if (part !== '.' && part !== '') parts.push(part);
      }
      const resolved = parts.join('/');
      if (!known.has(resolved) && ![...known].some((name) => name.startsWith(`${resolved}/`)))
        broken.push(`${path}:${index + 1}: link to ${target} does not resolve`);
    }
  }
  return broken;
}

export function assertSafePath(path) {
  if (path.startsWith('/') || path.split(/[\\/]/).some((part) => part === '..' || part === '.git'))
    throw new Error(`Unsafe source path: ${path}`);
}

/** Problems of one file; `text` is undefined for binary files. */
export function problemsOf(path, text) {
  const problems = [];
  if (
    /(^|\/)(?:state(?:\.pre-tauri)?\.json|stratz-key\.bin|gamestate_integration_ancient_lens\.cfg|ancient-lens-backup\.json|\.env(?:\.(?!example$).*)?)$/.test(
      path,
    )
  )
    problems.push(`${path}: private runtime file must not be published`);
  if (/\.(?:exe|dll|dylib|dmp|dem|bz2|pem|key|p12|pfx)$/i.test(path))
    problems.push(`${path}: binary capture or credential artifact must not be published as source`);
  if (text === undefined) return problems;
  for (const [index, line] of text.split('\n').entries()) {
    if (/[\u0400-\u04ff]/u.test(line)) problems.push(`${path}:${index + 1}: translate public text to English`);
    if (
      /\/home\/(?!<user>|user\/|USER\/)[\w.-]+\//.test(line) ||
      /[A-Z]:[\\/]Users[\\/](?!<user>|user[\\/])[^\\/\s]+[\\/]/.test(line)
    )
      problems.push(`${path}:${index + 1}: replace a personal filesystem path with a placeholder`);
  }
  return problems;
}

export const isBinary = (path) => /\.(?:png|ico|woff2|zip|pdf)$/i.test(path);

/**
 * Regular files of a commit with their Git mode. Symbolic links and submodules are refused:
 * a snapshot must not point outside itself.
 */
export function commitFiles(commit) {
  return execFileSync('git', ['ls-tree', '-r', '-z', '--full-tree', commit], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const [meta, path] = entry.split('\t');
      const [mode, type] = meta.split(' ');
      assertSafePath(path);
      if (type !== 'blob' || !['100644', '100755'].includes(mode))
        throw new Error(`Only regular files can be published: ${path} (${type} ${mode})`);
      return { path, mode };
    });
}

export const commitBlob = (commit, path) =>
  execFileSync('git', ['cat-file', 'blob', `${commit}:${path}`], { maxBuffer: 256 * 1024 * 1024 });
