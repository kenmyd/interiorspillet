// Baseline facts at c28070d for tools/house-tests/fixtures/catalog-baseline.json (QA): archetype ids, research files,
// product ids per category, original design item uids.  usage: node <this> <worktree> <out.json>
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const WT = process.argv[2];
const { imp, readJson } = await import(pathToFileURL(WT + '/tools/house-tests/_lib.mjs').href);
const cat = await imp('src/catalog/index.js');
const { DesignState } = await imp('src/design/DesignState.js');
const head = execSync('git rev-parse --short HEAD', { cwd: WT }).toString().trim();
const dirty = execSync('git status --porcelain -- src research tools', { cwd: WT }).toString().trim();
if (dirty) throw new Error(`tree not pristine:\n${dirty}`);
const out = {
  note: 'Catalogue + design facts before the møbler/lys/kunst round (generated, do not edit by hand)',
  commit: head,
  archetypes: Object.keys(readJson('src/data/archetypes.json').archetypes).sort(),
  researchNewFiles: fs.readdirSync(WT + '/research/catalog-new').filter((f) => f.endsWith('.json')).sort(),
  categories: cat.CATEGORIES.map((c) => c.key),
  counts: Object.fromEntries(cat.CATEGORIES.map((c) => [c.key, cat.products(c.key).length])),
  products: Object.fromEntries(cat.CATEGORIES.map((c) => [c.key, cat.products(c.key).map((p) => p.id)])),
  subcategoryCounts: Object.fromEntries(cat.CATEGORIES.map((c) => [c.key, cat.products(c.key).reduce((m, p) => ((m[p.subcategory ?? '-'] = (m[p.subcategory ?? '-'] || 0) + 1), m), {})])),
  originalItems: new DesignState().list().map((i) => i.uid),
};
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
console.log('wrote', process.argv[3], out.archetypes.length, 'archetypes', out.researchNewFiles.length, 'files', Object.values(out.counts).reduce((a, b) => a + b, 0), 'products', out.originalItems.length, 'original items');
