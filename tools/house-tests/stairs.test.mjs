// The stair walk test (steg 20, M2: tools/test-stairs.mjs, §7.3) as part of the shared run (node tools/test-house.mjs):
// it starts the walk test in its own process and passes its output and exit code on (about 10–50 s). Integrator,
// bølge 1 gruppe 2 – the request from steg 20.
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'test-stairs.mjs'), ...process.argv.slice(2)], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\s+$/, '');
if (out) console.log(out);
if (r.error) console.log(`test-stairs.mjs did not run: ${r.error.message}`);
process.exit(r.error ? 1 : r.status ?? 1);
