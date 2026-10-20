# seating – notes for the integrator

Owner of `src/models/seating.js` (all 12 seating archetypes of ARCHITECTURE §5). Exports and Def fields are
unchanged from the stub (`archetypes`, label/mount/parts/partLabels from `data/archetypes.json`, defaults, params,
dimsRange, build). No other file was edited.

## What the builders do

| Archetype | Model | Driven by |
| --- | --- | --- |
| `tub-swivel` | barrel body (drum = part `legs`, seat body = `upholstery`), domed seat with welt, wrap-around back band (rounded ends, welt on the top shoulder, slopes down toward the ends) | `legStyle` drum / swivel-disc / swivel-star / wood-taper / none, `baseD`, `baseH`, `backWrapDeg`, `shellT` (or `armW`), `armH` (+ hidden `armSlope` 0..1, default 0.85), `backH`, `cushion: 'loose'` (loose round seat + inner back roll), `piping` |
| `wingback` | one continuous wing–back–wing shell (reclined back, flared wings that rise from the arms), inner back cushion (buttons), slim or scroll arms, seat cushion, legs, optional footstool | `armW` (≥ 0.12 → scroll arms unless `armStyle`), `buttons` (default = `cushion === 'loose'`), `legStyle`, `legH`, `footstool` |
| `lounge-wood` | `armW ≥ 0.1` and not square back → wooden base + upholstered seat + thick wrap-around back acting as arms (Ellis); else open wooden frame with wooden arm rests, back posts, rails, loose or tight cushions (Signature 920, EKENÄSET) | `armW`, `armH`, `legH`, `cushion`, `backShape` |
| `club-box` | deck, box arms (or armless), square back (frame + loose/tight cushion) or curved quilted wrap back reclined to fill the depth (Cooper); `legStyle: 'none'` = skirt to the floor (SALTSJÖBADEN) | `armW`, `armH`, `backShape`, `cushion`, `legStyle`, `legH`, `seatD` |
| `recliner` | tilted seat, two-part reclined back + headrest pillow, padded arms on side panels, swivel disc/star, matching footstool in front | `headrest`, `footstool`, `legStyle`, `armH`, `armW` |
| `shell-legs` | rounded seat pan + cushion, wrap-around shell (armless sweeps down to the seat; `armH` > seat gives low arms) | `armH`, `backShape`, `legStyle`, `legH` |
| `rocking` | bentwood runners, wooden frame, arm rests, seat and back cushions | dims, `seatH`, `armH` |
| `dining-chair` | stacked-shell back (narrow & wrapping at the seat, wide with rounded/flared top corners, reclined 9°, vertical back seam), tucked-in seat cushion, under-seat plate, 4 splayed slim square legs | `legStyle` slim-metal / wood-taper, `legD` |
| `bar-stool` | same shell family with 3 × 2 quilted padding on the inner face, back seam, 4 splayed legs, foot-rest ring | `seatH`, `footrest`, `quilt`, `back: 'none'`, `legD`, `footrestH` |
| `sofa-modular-l` | boxy modules: upholstered bases on a recessed plinth, loose seat cushions, back frames + leaning back cushions, box arm, chaise; contrast piping on cushions/arms/bases | `modules` (from existing.js), `depth`, `backT`, `armW`, `armH`, `armSide`, `shortLegSide` (+x mirrors), `shortLegBackTo`, `piping`, `base` |
| `sofa-curved` | one rounded slab seat with convex front, recessed plinth with shadow gap, one swept back roll: low bolster arm → rising back → high wing curling forward | `backH` (wing end), `wingEnd` (±x, mirrors), `bolsterD`, `bolsterH`, `backT`, `frontConvex`, `wingReach` |
| `sofa-straight` | base, n seat + back cushions, continuous back frame, box arms, legs | `seats`, `armW`, `armH`, `legStyle`, `legH`, `piping` |

All models: front = +z, origin = bottom centre, `userData.model.parts` per part, `seatY` = top of the seat cushion,
cached `mat()` materials only (SceneSync recolours without rebuild). Piping / welts / seams use
`mat(kind, hex, { flat: true })` (untextured – a 4 mm cord aliases with the weave textures); they are tagged
`upholstery` (same colour) or `piping` (contrast colour, only when `colors.piping` is set). SceneSync keeps the
mesh's own opts on recolour, so the flat variant survives.

Triangles (medium / low): tub 7.4k / 4.4k, wingback 10k / 5.2k, lounge-wood 2.8k, club 3.7k, recliner 6.7k,
shell 6.3k, rocking 3.9k, dining 3.9k / 2.6k, bar stool 5.8k / 3.4k, L-sofa 21.5k / 10k, curved sofa 10.4k / 6.8k,
straight sofa 3.9k. 2–4 draw calls per model after `finishModel` merging.

Colliders: `sofa-modular-l` gives two boxes (long side + chaise); `wingback` / `recliner` with a footstool give the
chair box + the footstool box (the footstool stands in front of the chair, **outside dims.d**, 0.14–0.16 m gap).

## Wire-up / decisions for others

1. **Catalogue (lenestol.json)** – optional params the builders understand, if you want the products even closer:
   - Vilde (Scapa) is described as asymmetric; the tub builder is symmetric (no `asym` param yet).
   - Avila: buttons come from `cushion: 'loose'`; set `buttons: true/false` explicitly if that inference is wrong.
   - STRANDMON gets scroll arms from `armW 0.14`; others can force `armStyle: 'scroll' | 'slim'`.
   - Cooper's back recline is derived from `seatD` (0.58) and the depth – keep `seatD` in the data.
2. **Product images were not downloaded** (downloading files needs the user's own go-ahead, which a subagent
   cannot get). Shapes follow the names/descriptions/params; worth a visual check against the shop pages.
3. **Existing furniture data (room-spec / existing.js)** – used as is. The swivel chairs' `rotationDeg` (15 / −10)
   are flagged uncertain in the notes; in photo 082827 both openings face more toward the coffee table / camera.
   `f-buet-sofa` backH 0.78 > dims.h 0.75 – the builder allows up to h × 1.1 so the wing end is as described.
4. Footstool: it is part of the chair model (one item). If the UI wants it as a separately movable item, split it
   in the catalogue instead.
5. Hidden (not in the Inspector schema) but honoured params: `armSlope` (tub), `armStyle` (wingback), `seatD`
   (club), `wingReach` (curved sofa), `footrestH`, `legD`.
6. Heights follow `dims.h`: the back top of tub / shell / club / sofas is `dims.h` (the data's `backH` equals h
   anyway), so the height slider works. Only `sofa-curved` keeps `params.backH` for its wing end, clamped to
   h − 0.10 … h + 0.05. Every model stays inside its dims footprint (checked at both ends of `dimsRange`, low and
   high quality, no NaNs, no builder fallbacks) – except the footstools, which stand in front.

## Verified

Screenshots in `.shots/seating/`: `arch-*.png` (every archetype, front/back/side), `sheet-products.png` (all 16
lenestol products, focus shots `p-*.png`), `sheet-scale.png` (resized / re-parametrised variants: bigger tub on a
star with loose cushions, mirrored L-sofa with two arms, tall dining chair on oak legs, bar-height stool, small
sofa on block legs, mirrored curved sofa, wingback on a star with footstool, tall rocking chair), close-ups
(`dc-top.png`, `bs-top.png`, `l-zoom.png`, `tub-end.png`, `cs-a/b.png`) and the room through the sandbox:
`sb-20261018_082829.png`, `sb-20261018_082827.png`, `sb-20261018_082806.png` (photo cameras), `sb-lsofa.png`
(TV-stue like 082726), `sb-dining.png` (like 082909), `sb-stools.png` (like 082941). No console errors from seating.

Unrelated issues seen while testing (not mine): `tables.js` nesting tables threw «pts is not iterable» (grey box) at
one point; the dev pages hot-reload often while others edit, so `shot.mjs` sometimes catches a half-loaded page.
