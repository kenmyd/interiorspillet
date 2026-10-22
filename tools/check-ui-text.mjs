#!/usr/bin/env node
/**
 * UI language check (MASTER §4.2 P09 item 7, §5 step 9): the game's UI is Norwegian bokmål. Lists string literals
 * ADDED under src/ since a base commit that the player can see – in textContent / innerText / label / title /
 * placeholder / hint / text / aria-label / note / error contexts and toast(…) / confirm(…) / alert(…) calls – and that
 * look English (a small word list of English UI words that Norwegian does not use). Prints file:line and the text.
 *
 *   node tools/check-ui-text.mjs [--base=c28070d] [--all] [--json=<file>]
 *     --base   the commit the round started from (default c28070d); added lines come from `git diff <base> -U0 -- src`
 *              plus every untracked file under src/ (read-only git)
 *     --all    scan every line of every src/ file, not only the added ones (an audit of the whole UI)
 *
 *   exit 0 = nothing English found, 1 = hits (fix them, or mark a deliberate one with the comment «ui-text-ok» on the
 *   same line – e.g. a product or brand name), 2 = tool error (git missing …)
 *
 * Comments, console.* lines, import lines and object keys are not UI text and are skipped; ${…} inside template
 * literals is removed before the words are looked at.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.CR_ROOT ? path.resolve(process.env.CR_ROOT) : path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const opt = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => {
  const i = a.indexOf('=');
  return i < 0 ? [a.slice(2), 'true'] : [a.slice(2, i), a.slice(i + 1)];
}));
const unknown = Object.keys(opt).filter((k) => !['base', 'all', 'json', 'help'].includes(k));
if (opt.help || unknown.length) {
  if (unknown.length) console.error(`check-ui-text: ukjent valg --${unknown.join(' --')}`);
  console.log('bruk: node tools/check-ui-text.mjs [--base=c28070d] [--all] [--json=<fil>]');
  process.exit(unknown.length ? 2 : 0);
}
const BASE = opt.base ?? 'c28070d';

/** English UI words Norwegian bokmål does not use (lower case). «for», «spot», «LED», «on/off» are left out on purpose. */
const ENGLISH = new Set(('the and with without this that these those your you add added remove removed delete deleted save saved load loaded loading '
  + 'open close cancel show hide image images upload uploaded picture pictures size width height depth color colour colors light lights '
  + 'error failed missing select choose edit reset apply done back next click drag drop here file files please set settings change changed '
  + 'new old item items room rooms wall walls ceiling floor grid row rows column columns spacing distribute split evenly lamp lamps brightness '
  + 'dimmer warm cold white black wood frame frames poster posters art gallery shop shopping cart price total quantity pack packs '
  + 'should could would will can cannot not yes no ok none all some many more less than then when where which while because only also '
  + 'is are was were be been has have had do does did get got make made use used using try again undo redo copy paste replace swap').split(/\s+/));
/** Words both languages share or product vocabulary (never a hit by themselves). */
const SHARED = new Set(['led', 'spot', 'spots', 'downlight', 'downlights', 'gu10', 'e27', 'e14', 'g9', 'ip44', 'ip65', 'dimmer', 'hue', 'smart', 'design', 'ok']);
/** A Norwegian word in the string makes a single English word much more likely a name (Philips Hue «White Ambiance»). */
const NORWEGIAN = /[æøå]|\b(og|ikke|med|uten|på|til|fra|den|det|du|en|et|er|som|kan|vil|skal|har|lys|lampe|lamper|bilde|bilder|rom|tak|vegg|ramme|størrelse|bredde|høyde|dybde|farge|legg|fjern|lagre|åpne|lukk|avbryt|velg|nytt|ny|alle|rutenett|antall|del|fordel|jevnt|egen|eget|last|opp|bytt)\b/i;

/** Where a UI string starts: each regex ends right before its opening quote. */
const CONTEXT = [
  /\b(?:textContent|innerText|placeholder|title|label|hint|text|ariaLabel|note|error|message|tip|caption|heading|empty)\s*[:=]\s*(?=['"`])/g,
  /\bsetAttribute\(\s*['"](?:title|aria-label|placeholder)['"]\s*,\s*(?=['"`])/g,
  /\b(?:toast|confirm|alert|notify|status)\s*\(\s*(?=['"`])/g,
  /\bel\(\s*['"][\w.#-]+['"]\s*,\s*(?:['"][\w\s.-]*['"]\s*,\s*)?(?=['"`])/g,
];
const QUOTES = `'"\``;

/** Index of the closing quote of the literal that starts at code[i] (code.length when it does not end on the line). */
function skipLiteral(code, i) {
  const q = code[i];
  for (let k = i + 1; k < code.length; k++) {
    const c = code[k];
    if (c === '\\') k++;
    else if (c === q) return k;
    else if (q === '`' && c === '$' && code[k + 1] === '{') k = skipExpr(code, k + 1);
  }
  return code.length;
}
/** Index of the `}` closing the `${` whose `{` is at code[i] (strings and nested templates inside skipped). */
function skipExpr(code, i) {
  let depth = 0;
  for (let k = i; k < code.length; k++) {
    const c = code[k];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return k;
    else if (QUOTES.includes(c)) k = skipLiteral(code, k);
  }
  return code.length;
}
/** The literal's own text (every ${…} → one space, escapes → a space), or null when it does not end on the line. */
function readLiteral(code, i) {
  const q = code[i];
  let out = '';
  for (let k = i + 1; k < code.length; k++) {
    const c = code[k];
    if (c === '\\') {
      k++;
      out += ' ';
    } else if (c === q) return out;
    else if (q === '`' && c === '$' && code[k + 1] === '{') {
      k = skipExpr(code, k + 1);
      out += ' ';
    } else out += c;
  }
  return null;
}

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${(r.stderr || r.error || '').toString().split('\n')[0]}`);
  return r.stdout;
}

/** { file: [lineNo, text][] } of the lines to scan. */
function addedLines() {
  const out = new Map();
  const add = (f, n, t) => {
    if (!/\.(m?js|html)$/.test(f)) return;
    if (!out.has(f)) out.set(f, []);
    out.get(f).push([n, t]);
  };
  const listAll = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listAll(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
  if (opt.all) {
    for (const f of listAll('src')) fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/).forEach((t, i) => add(f, i + 1, t));
    return out;
  }
  let file = null, n = 0;
  for (const l of git(['diff', BASE, '-U0', '--no-color', '--', 'src']).split(/\r?\n/)) {
    if (l.startsWith('+++ ')) file = l.slice(4).replace(/^b\//, '');
    else if (l.startsWith('@@')) n = Number(/\+(\d+)/.exec(l)?.[1] ?? 0);
    else if (l.startsWith('+') && file) add(file, n++, l.slice(1));
    else if (!l.startsWith('-') && file && !l.startsWith('\\')) n++;
  }
  for (const f of git(['ls-files', '--others', '--exclude-standard', '--', 'src']).split(/\r?\n/).filter(Boolean)) {
    fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/).forEach((t, i) => add(f, i + 1, t));
  }
  return out;
}

let lines;
try {
  lines = addedLines();
} catch (e) {
  console.error(`check-ui-text: ${e.message}`);
  process.exit(2);
}
const hits = [];
let scanned = 0, strings = 0;
for (const [file, list] of lines) {
  for (const [n, raw] of list) {
    scanned++;
    const t = raw.trim();
    if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || /^import\b|console\.\w+\(/.test(t) || /ui-text-ok/.test(t)) continue;
    const code = t.replace(/\/\/.*$/, '');
    for (const re of CONTEXT) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(code))) {
        const text = readLiteral(code, m.index + m[0].length);
        if (text == null) continue;
        if (!/[a-z]{2,}/i.test(text)) continue;
        // identifiers, css classes, ids, keys, urls, file names, numbers with units – not prose
        if (/^[\w.#:/-]*$/.test(text.trim()) && !/\s/.test(text.trim()) && !ENGLISH.has(text.trim().toLowerCase())) continue;
        strings++;
        const words = (text.toLowerCase().match(/[a-zæøå]+/g) || []).filter((w) => !SHARED.has(w));
        const eng = words.filter((w) => ENGLISH.has(w));
        if (!eng.length) continue;
        // one English word in an otherwise Norwegian text is usually a name; two or more, or no Norwegian at all, is a hit
        if (NORWEGIAN.test(text) && eng.length < 2) continue;
        hits.push({ file, line: n, text: text.trim().slice(0, 140), words: [...new Set(eng)] });
      }
    }
  }
}
for (const h of hits) console.log(`${h.file}:${h.line}  «${h.text}»  (${h.words.join(', ')})`);
if (opt.json) {
  fs.mkdirSync(path.dirname(path.resolve(opt.json)), { recursive: true });
  fs.writeFileSync(path.resolve(opt.json), `${JSON.stringify({ base: BASE, all: !!opt.all, scanned, strings, hits }, null, 1)}\n`);
}
console.log(`${hits.length ? `${hits.length} mulige engelske UI-tekster` : 'ingen engelske UI-tekster funnet'} – ${scanned} ${opt.all ? '' : 'nye '}linjer i ${lines.size} filer, ${strings} UI-strenger sjekket${opt.all ? '' : ` (siden ${BASE})`}`);
process.exit(hits.length ? 1 : 0);
