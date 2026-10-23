#!/usr/bin/env node
/**
 * fetch.mjs – downloads ONE file (a product photo, a JSON or HTML page) for the research agents.
 *
 *   node tools/research/fetch.mjs <url> <outFile> [--no-cache]
 *
 * Goes through tools/research/net.mjs politeFetch: a shared per-host throttle (≥ 2 s between requests to one host
 * from ALL processes), a 60 s back-off on HTTP 429 / bot challenges (no retry loop) and a 12 h response cache under
 * .shots/net/ (--no-cache skips it). Writes the body to <outFile> (folders are created) only on HTTP 2xx – and, when
 * <outFile> has an image extension, only when the answer is an image – and prints one line: status, bytes, content
 * type, final URL. Exit code 1 on an error, a non-2xx status or a non-image answer for an image file.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { politeFetch } from './net.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const args = process.argv.slice(2);
const [url, outFile] = args.filter((a) => !a.startsWith('--'));
if (!url || !outFile) {
  console.error('usage: node tools/research/fetch.mjs <url> <outFile> [--no-cache]');
  process.exit(2);
}
try {
  const res = await politeFetch(url, { headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8' } }, { cache: !args.includes('--no-cache') });
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') || '?';
  if (!res.ok) {
    console.log(`HTTP ${res.status} ${buf.length} B ${type} ${res.url} – not saved`);
    process.exit(1);
  }
  // a photo URL that answers with a web page (a challenge, a soft 404) must not end up as «photo.jpg»
  if (/\.(jpe?g|png|webp|gif|avif|svg)$/i.test(outFile) && !/^image\//i.test(type)) {
    console.log(`HTTP ${res.status} ${buf.length} B ${type} ${res.url} – not an image, not saved`);
    process.exit(1);
  }
  const out = resolve(outFile);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buf);
  console.log(`HTTP ${res.status} ${buf.length} B ${type} ${res.url}${res.fromCache ? ' (cache)' : ''} → ${out}`);
} catch (e) {
  console.log(`FETCH ERROR ${url}: ${e.message}`);
  process.exit(1);
}
