/**
 * «Meld feil» for the planbygger's dev server: POST /api/planbygger/feedback stores what the owner saw while testing.
 *
 *   body { kind: 'feil'|'ide', text, where, image?: dataURL (jpeg/png), state?: {…} }  →  { ok, id }
 *
 * The screenshot and the state (the plan, the file names, the last «Generer» report) go to
 * .shots/planbygger/tilbakemeldinger/<id>.{jpg|png,json} (gitignored). A short entry is appended under «Feil» or
 * «Ideer» in notes/planbygger-tilbakemeldinger.md, numbered after the highest F/I number already there. Local
 * testing only: the route is mounted by tools/planbygger-vite-plugin.mjs, never by server.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';

const MAX_BODY = 20 * 1024 * 1024;

/** The next free number for F (feil) or I (idé) in the notes file. */
function nextId(md, prefix) {
  let n = 0;
  // the templates inside <!-- --> do not count
  for (const m of md.replace(/<!--[\s\S]*?-->/g, '').matchAll(new RegExp(`^### ${prefix}(\\d+)\\b`, 'gm'))) n = Math.max(n, Number(m[1]));
  return `${prefix}${n + 1}`;
}

/** The entry inserted at the end of its section (before the next «---» or the end of the file). */
function insertEntry(md, section, entry) {
  const head = md.indexOf(`\n## ${section}`);
  if (head < 0) return `${md.trimEnd()}\n\n## ${section}\n\n${entry}\n`;
  const next = md.indexOf('\n---', head + 1);
  const at = next < 0 ? md.length : next;
  return `${md.slice(0, at).trimEnd()}\n\n${entry}\n${md.slice(at)}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('for stor'), { status: 413 }));
        req.destroy();
      } else parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

export function createFeedbackHandler({ root }) {
  const dir = path.join(root, '.shots', 'planbygger', 'tilbakemeldinger');
  const notes = path.join(root, 'notes', 'planbygger-tilbakemeldinger.md');
  return async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'POST' });
    try {
      const body = JSON.parse(await readBody(req));
      const kind = body.kind === 'ide' ? 'ide' : 'feil';
      const text = String(body.text ?? '').trim().slice(0, 4000);
      if (!text) return send(res, 400, { ok: false, error: 'tom tekst' });
      fs.mkdirSync(dir, { recursive: true });
      const md = fs.existsSync(notes) ? fs.readFileSync(notes, 'utf8') : '# Planbygger: tilbakemeldinger fra testingen\n\n## Feil\n\n---\n\n## Ideer: forbedringer og nye funksjoner\n';
      const id = nextId(md, kind === 'ide' ? 'I' : 'F');
      const rel = (f) => path.relative(root, f).split(path.sep).join('/');
      let shot = null;
      const m = /^data:image\/(jpeg|png);base64,(.+)$/.exec(body.image ?? '');
      if (m) {
        shot = path.join(dir, `${id}.${m[1] === 'jpeg' ? 'jpg' : 'png'}`);
        fs.writeFileSync(shot, Buffer.from(m[2], 'base64'));
      }
      const stateFile = path.join(dir, `${id}.json`);
      fs.writeFileSync(stateFile, JSON.stringify({ id, kind, text, where: body.where ?? null, time: new Date().toISOString(), state: body.state ?? null }, null, 1));
      const title = text.split('\n')[0].slice(0, 70);
      const entry = [
        `### ${id} – ${title}`,
        `- **Tekst:** ${text.replace(/\n+/g, ' ')}`,
        `- **Hvor:** ${body.where ?? '–'}`,
        shot ? `- **Skjermbilde:** \`${rel(shot)}\`` : null,
        `- **Tilstand:** \`${rel(stateFile)}\``,
        `- **Status:** ny`,
      ].filter(Boolean).join('\n');
      fs.writeFileSync(notes, insertEntry(md, kind === 'ide' ? 'Ideer' : 'Feil', entry));
      send(res, 200, { ok: true, id });
    } catch (err) {
      send(res, err.status ?? 500, { ok: false, error: String(err?.message ?? err) });
    }
  };
}
