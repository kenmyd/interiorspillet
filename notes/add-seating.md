# add-seating – the five new recliners (Chicago, Timeout, Zermatt, Grande, Taycan)

Only `src/models/seating.js` was changed. Scripts, reference photos and screenshots: `.shots/add-seating/`
(`rec.mjs` = photo | render pairs at the product photo's angle, `check.mjs` = robustness, `game.mjs` = in-game),
product photos in `.ref/seating/` (reference only).

## What the `recliner` archetype does now

`buildRecliner` works out a style (`reclinerStyle`) and builds one of four bodies. The old model is kept as
`buildReclinerClassic` (body `classic`). Opal still uses it and looks the same as before.

| body | look | products |
| --- | --- | --- |
| `box` | upholstered side panels with a big round front-bottom corner, the rear corner rounded up (a «D» seen from the side), and a rounded arm top that flares outwards. The back is one piece with sewn seams: puffed panels with creases, a lumbar seam, an optional vertical centre seam and an integrated neck cushion with a seam under it. The seat is one thick block. `sides: 'shell'` puts the outer panels, back shell and apron in the `frame` fabric and adds upholstered arm rolls over the top and down the front. `sides: 'veneer'` adds wooden side plates (`frame`) under a fabric arm roll that also covers the front strip | Chicago, Bern, Zermatt (`shell`), Grande (`veneer`) |
| `shell` | a moulded bowl (`frame` outside, cover fabric inside). Its rim is low at the front lip, level along the arms and just above the arms at the back. Padded arm tops have a flared front end. A thick seat overhangs the lip, a tall reclined back cushion sits inside, and a sausage neck roll rests on it | Timeout |
| `tulip` | thin petal arms that hug the seat, narrow to a foot under the seat and lean out into a broad, rounded top. On wood variants a `frame` plate covers the outer face. A dark mechanism sits under the seat | Taycan |
| `classic` | the first model, unchanged | Opal |

Shared parts:
- **Neck cushions** (`headStyle`):
  - `integrated`: built into the back
  - `block`: rectangular, on two posts
  - `roll`: Timeout
  - `wing`: one bent cushion that is wider at the top, with its wings coming forward and two vertical seams
- **Footrest:** a separate footstool on its own 4-arm star, outside `dims.d` with its own collider. Or an integrated footrest: a tall panel under the seat front, sloping back on Grande. It is closed by default; `footrestOpen` swings it out on a scissor bar and adds a collider.
- **Base:** a swivel star with 5 flat arms, or 4 slim brushed bars (`star: 'slim'`, Taycan), plus a mechanism plate and column.
- **Lever:** a recline lever on the right side (`lever`).
- **Recline:** set by the depth behind the seat, up to 18° (`box`), 20° (`shell`) or 11° (`tulip`). The back stays inside `dims.d`, except the Timeout cushion top, which may go about 5 cm past it.
- **Sheepskin:** the upholstery kind `teddy` (or `params.pile`) gives the teddy texture at 4× scale on bumped geometry (`fluff`: deterministic value noise along the normals, clumps about 4 cm and curls about 2 cm). This covers the Zermatt and the «Fåreskinn» Timeout variant.
- **Recolouring:** `model.recolor` swaps materials in place. A switch to or from `teddy` rebuilds the model, because the sheepskin geometry is different.
- **Parts:** `upholstery`, `frame` and `legs` (the Inspector shows `Ramme` only where the model has one).

Inspector (`Form og detaljer`): Setehøyde, Armlenehøyde, **Utforming**, **Nakkepute**, **Fotstøtte** (all three default to
«Som produktet»), **Fothvileren slått ut**, Understell. `headrest` / `footstool` are no longer in the schema, but they are
still honoured: `auto` reads them.

## Data hand-off (for the catalogue owner)

The builder reads every style from **`params.notes`** when the explicit params are missing, so the products already
look right as they are in `src/data/catalog/lenestol.json`. Free-text parsing is fragile, though, so please add these
params to the research JSON:

| product | params to add |
| --- | --- |
| Chicago | `body: 'box', sides: 'fabric', headStyle: 'integrated', backSeams: 'cross-v', footrest: 'stool', starArms: 5, stoolW: 0.5, stoolD: 0.4, stoolH: 0.42` |
| Timeout | `body: 'shell', headStyle: 'roll', backSeams: 'cross', footrest: 'stool', starArms: 5, lever: true, stoolW: 0.51, stoolD: 0.38, stoolH: 0.39` |
| Zermatt | `body: 'box', sides: 'shell', headStyle: 'block', backSeams: 'none', pile: 0.02, footrest: 'stool', starArms: 5, lever: true, stoolW: 0.55, stoolD: 0.45, stoolH: 0.42` |
| Grande | `body: 'box', sides: 'veneer', headStyle: 'block', backSeams: 'buttons', footrest: 'integrated', starArms: 5, lever: true` |
| Taycan | `body: 'tulip', headStyle: 'wing', backSeams: 'cross', footrest: 'integrated', star: 'slim', starArms: 4` |
| Bern (existing) | `body: 'box', backSeams: 'cross'` (now inferred from `armW` ≥ 0.1; its photo is a Chicago-like box chair) |
| Opal (existing) | `body: 'classic'` (inferred from `armW` 0.08) |

What the fallback infers:
- **body:** «formstøpt / skrog» → shell, «tulipan» → tulip, `armW` ≥ 0.1 → box, otherwise classic.
- **sides:** «finert / vanger i …» → veneer, «ytterskall» → shell. Otherwise a wooden `frame` gives veneer, a fabric `frame` gives shell, and no frame gives fabric.
- **headStyle:** «pølse» → roll, «vingeformet» → wing, «separat / rektangulær» → block, otherwise integrated.
- **backSeams:** «loddrett søm» → cross-v, «knapp» → buttons, sheepskin → none, otherwise cross.
- **footrest:** `footstool: false` plus «innebygd/integrert fothviler» (not «ingen …») → integrated.
- **lever:** «spak».
- **base:** «femarmet / 5 armer» → 5 arms, «slimline / tynn, firearmet» → slim with 4.
- **stool size:** «Fotskammelen … 50 × 40 × 42 cm».

## For others

- **INTERACT** (add-catalog.md flagged «footstool outside dims»): the recliner models already return
  `userData.model.colliders` with the chair box and the footstool box, plus the open footrest when `footrestOpen`. A
  Placement overlap note that uses the item's dims footprint will not see the stool. Reading `model.colliders` would.
- **Acoustics** reads `params.footstool`. For the new products that is still the data value, so nothing changes. An
  Inspector change of «Fotstøtte» writes `params.footrest`, which Acoustics does not read.

## Verified

- **Photo comparisons** (photo | render at the photo's angle): `sheet-final.png` (all five plus Opal and Bern),
  `final-*-photo.png`, and the iterations `v1…v11`. Variants: `v8var-timeout` (walnut shell, chrome),
  `v8var-taycan` (Taycan Wood: black leather, walnut plates), `v8var-chicago` (black PU). Open footrests:
  `sheet-final-open.png`. Low quality: `sheet-low.png`. Close-ups: `z13*`, `z14*`.
- **Category:** `cat-lenestol.png` shows `?cat=lenestol` with 21 products, the five new ones included (the data owner has
  merged them). Every other seating archetype is untouched, because the new code only adds functions.
- **Robustness:** `check.mjs` → `check.json`, 388 builds: 7 recliner products × every variant × low/medium/high, the 8
  corners of `dimsRange`, 14 param overrides (`footrestOpen`, every footrest / headStyle / body, disc base), the
  default archetype and the other seating archetypes.
  - 0 fallbacks, 0 NaN, 0 console errors.
  - Every non-classic build stays inside `dims`; the footstool and open footrest stand in front, and the lever sticks out 3 cm at the side.
  - Triangles at medium: Chicago 16k, Timeout 18k, Zermatt 27k (sheepskin), Grande 16k, Taycan 12k. At low: 9–17k.
- **Game:** `game.mjs` places all five from the catalogue. No fallbacks, and the Inspector lists the new params.
  - Grande `footrestOpen` rebuilds the model.
  - Timeout frame → walnut recolours in place (same object).
  - Cover → teddy rebuilds with the sheepskin geometry.
  - Undo restores everything. 60 fps, 0 console errors (`g*.png`).

## Open issues

1. The **classic** builder's back (Opal, and the archetype default) reaches 6–8 cm behind `dims.d`. This was already the case before this change and has not been fixed (`check.json`: the 27 «outside» rows are all classic).
2. The renders are not exact matches. These are known differences:
   - The Timeout back is less reclined than in its photo, because the depth limits the recline.
   - The Grande arm roll is slimmer than the photo's.
   - The Zermatt side panels are boxier than the photo's.
   - The Taycan wing seams are subtle under studio light.
3. The sheepskin `fluff` uses the teddy texture at 4×. A long-pile or curly fabric kind in `materials.js` (FOUNDATION) would look better than geometry noise alone.
4. The dev gallery's studio light makes light fabrics look much paler than the shop photos (all products, not only seating).
