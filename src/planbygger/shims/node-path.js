/**
 * Browser stand-in for node:path, only for src/data/scripts/house.mjs in the planbygger page (the validator computes
 * its folders at load time; the page passes every file and registry itself, so the paths are never used for I/O).
 * Wired up by tools/planbygger-vite-plugin.mjs.
 */
const norm = (p) => String(p ?? '').split(String.fromCharCode(92)).join('/');
export const sep = '/';
export function dirname(p) {
  const s = norm(p).replace(/\/+$/, '');
  const i = s.lastIndexOf('/');
  return i > 0 ? s.slice(0, i) : i === 0 ? '/' : '.';
}
export function basename(p, ext = '') {
  const b = norm(p).split('/').pop() ?? '';
  return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b;
}
export function join(...parts) {
  const out = [];
  for (const seg of parts.map(norm).join('/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return (norm(parts[0]).startsWith('/') ? '/' : '') + out.join('/');
}
export const resolve = (...parts) => join(...parts);
export const isAbsolute = (p) => norm(p).startsWith('/');
export default { sep, dirname, basename, join, resolve, isAbsolute };
