#!/usr/bin/env node
/**
 * pageprobe.mjs – one polite GET per URL; saves the HTML and reports status, size, JSON-LD Product data and
 * embedded-state hints (productapis.md §3–§4: IKEA PIP, Lampehuset, Nordic Nest, Fagmøbler, Jysk, Skeidar,
 * Elektroimportøren …).
 *
 *   node tools/research/pageprobe.mjs --out=<dir> <url> [url …] [--no-cache]
 *
 * --out is required (no default): each page is saved as <dir>/<host>__<path>.html (the directory is created).
 * Every request goes through tools/research/net.mjs politeFetch: a shared per-host throttle (≥ 2 s between requests to
 * one host from ALL processes), a 60 s back-off on HTTP 429 / bot challenges (no retry loop – never try to get around
 * a challenge) and a 12 h response cache under .shots/net/ (--no-cache skips it).
 */
import fs from 'node:fs';
import { join } from 'node:path';
import { politeFetch } from './net.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const args = process.argv.slice(2);
const outArg = args.find((a) => a.startsWith('--out='));
const outDir = outArg ? outArg.slice('--out='.length) : '';
const urls = args.filter((a) => !a.startsWith('--'));
if (!outDir || !urls.length) {
  console.error('usage: node tools/research/pageprobe.mjs --out=<dir> <url> [url …] [--no-cache]');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const cache = !args.includes('--no-cache');
const fileFor = (url) => {
  const u = new URL(url);
  const path = `${u.pathname}${u.search}`.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  return join(outDir, `${u.hostname.replace(/^www\./, '')}${path ? `__${path}` : ''}.html`);
};
const flat = (x) => Array.isArray(x) ? x.flatMap(flat) : (x && x['@graph']) ? flat(x['@graph']) : [x];
for (const url of urls) {
  const t0 = Date.now();
  let res, text = '';
  try {
    res = await politeFetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8' }, redirect: 'follow' }, { cache });
    text = await res.text();
  } catch (e) { console.log('##', url, 'FETCH ERROR', e.message); continue; }
  const file = fileFor(url);
  fs.writeFileSync(file, text);
  const hdr = ['server', 'x-powered-by', 'cf-ray', 'x-shopify-stage', 'retry-after', 'x-ratelimit-remaining', 'content-type'].map(h => res.headers.get(h) ? `${h}=${res.headers.get(h)}` : '').filter(Boolean).join(' ');
  console.log(`## ${url}\n   HTTP ${res.status} final=${res.url} ${text.length}B ${Date.now() - t0}ms${res.fromCache ? ' (cache)' : ''} ${hdr}`);
  console.log('   saved:', file);
  console.log('   title:', (text.match(/<title[^>]*>([^<]*)/i) || [])[1]?.trim().slice(0, 120));
  const blocks = [...text.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  console.log('   ld+json blocks:', blocks.length);
  for (const b of blocks) {
    let j; try { j = JSON.parse(b.trim()); } catch { console.log('   (unparseable ld+json)', b.slice(0, 120)); continue; }
    for (const o of flat(j)) {
      if (!o || !/Product|ProductGroup/i.test(String(o['@type']))) continue;
      const offers = flat(o.offers || []).map(f => ({ price: f.price ?? f.lowPrice, cur: f.priceCurrency, avail: f.availability, spec: f.priceSpecification ? JSON.stringify(f.priceSpecification).slice(0, 200) : undefined }));
      console.log('   PRODUCT', JSON.stringify({ type: o['@type'], name: o.name, sku: o.sku, gtin: o.gtin13 || o.gtin, brand: o.brand?.name || o.brand, image: [].concat(o.image || [])[0]?.contentUrl || [].concat(o.image || [])[0], width: o.width, depth: o.depth, height: o.height, color: o.color, material: o.material, additionalProperty: o.additionalProperty ? JSON.stringify(o.additionalProperty).slice(0, 400) : undefined, offers: offers.slice(0, 3), hasVariant: o.hasVariant ? o.hasVariant.length : undefined }).slice(0, 1500));
    }
  }
  const hints = ['__NEXT_DATA__', '__NUXT__', 'window.__INITIAL_STATE__', 'ShopifyAnalytics', 'og:price:amount', 'product:price:amount', 'itemprop="price"', 'algolia', 'klevu', 'loop54', 'elevate', 'apptus', 'clerk', 'hello retail', 'helloretail', 'findify', 'searchspring', 'graphql', '/api/', 'Bredde', 'Dybde', 'Høyde', 'Lengde'];
  const low = text.toLowerCase();
  console.log('   hints:', hints.map(h => [h, low.split(h.toLowerCase()).length - 1]).filter(x => x[1]).map(x => x.join('=')).join(' '));
}
