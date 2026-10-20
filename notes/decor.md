# decor – notes for the integrator

Owner of `src/models/decor.js` (all 14 decor/acoustic archetypes, ARCHITECTURE §5/§13). No other file edited.

## What is there

| Archetype | Builder notes | Main params (Inspector schema in `Def.params`) |
| --- | --- | --- |
| `plant-floor`, `plant-small` | Pot lathe (rim, inner wall, soil), optional `pedestal {w,d,h,color}` / `stand {d,h,color}` (black wire stand), species builders with alpha-tested leaf cards from one shared 4×4 leaf atlas (coverage-preserving mipmaps, vein normal map), per-leaf tint, paler underside. 3–17 k triangles. | `species` palm, kentia, monstera, olive, ficus-lyrata, strelitzia, pampas, pothos, anthurium (+ herb, fern, eucalyptus for small), `potStyle`, `potD`, `potH`, `seed` |
| `vase` | Lathe shapes round/ribbed/bottle/bud/bubble (real glass wall)/cylinder, revolved wave & sculptural shapes, `shape: 'block'` = knife block, optional jute `mat {d,color}`. Flowers: hydrangea (florets on a dome + serrated leaves), pampas plumes, eucalyptus, green sprig. With flowers `params.h/d` = vase body, `dims.h` = top of the flowers. | `shape`, `flowers`, `h`, `d`, `seed` |
| `art-frame` | Procedural canvas paintings (misty-trees, abstract, landscape, botanical, line-art, photo), stretched canvas with wrapped edges, floater / thin / oak / wide frames, passe-partout, relief/painted surfaces with normal maps. | `motif`, `frame`, `frameW`, `texture`, `mat`, `seed`, `palette` (5 hex), `edge` |
| `mirror` | round / rect / organic / arch outline, extruded frame, env-mapped mirror glass, optional mullions. | `shape`, `frameW`, `mullions`, `mullionCols/Rows` |
| `candle-holder` | lantern (all-glass hurricane or metal frame + glass), tealight glasses (count/spacing), candlestick, pillar. Lit candles have emissive flames + a 1850 K point light (≈ 5.5 lm per flame) – the LightManager dims the flames with the light. | `kind`, `count`, `lit`, `candleColor` |
| `basket` | rattan/woven/rope baskets, `oval`/`rect`, foam roller (`weave: 'foam'`, the black f-sylinder), pedal bin, magazine stack (`shape: 'stack'` or paper + `weave: 'none'`). | `shape`, `weave`, `handles` |
| `tv` | thin panel + rear body + wall bracket, off-screen = black clear-coat glass (reflections from scene.environment), `screen: 'on'` shows a picture. | `screen`, `bezel`, `wallMount` |
| `speaker` | in-wall (flush frame + perforated grille), box, soundbar. | `style` |
| `slat-panel` | felt board + slats as InstancedMesh (3 grain variants, per-slat tone via instanceColor), vertical or horizontal. | `slatW`, `gap`, `slatD`, `orientation` |
| `fabric-panel` | rounded/bevelled fabric box; `materials.panel: 'moss'` builds a bumpy moss panel. | `edge` |
| `acoustic-art` | fabric absorber with a printed motif, optional frame. | `motif`, `frame`, `seed` |
| `felt-shape` | hexagon/circle/square/rounded/semicircle/triangle/cloud/leaf. | `shape` |
| `ceiling-absorber` | `baffle` (vertical: w × h panel, d = thickness, wood top rail) or rafts `round`/`circle`/`rect` (w × d footprint, h = thickness); steel wires to the ceiling. | `shape`, `drop` (ceiling → bottom; default h + 0.12 for baffles, 0.25 for rafts) |

Every model sets `userData.model.recolor(part, hex, kind)` → SceneSync recolours without rebuilding (verified for the
palm leaves, the painting and the slat panel in the game). Custom materials (foliage, bark, print, grille, screen) are
shared/cached and carry `userData.shared = true` so `kit.disposeModel` leaves them alone. Generated art is in a small
LRU (24 motifs / 32 print materials) so colour-picking does not leak canvases.

## Must wire up / decide

1. **Inspector – `drop` for ceiling items without lights.** `Inspector._paramsSection` deletes `params.drop` for every
   ceiling item and only the «Lys» section shows the drop slider (lamps). The `ceiling-absorber` therefore has no
   height control. Please show «Avstand fra tak» for ceiling items without lights too (schema in my Def: 0.05–1.5 m).
2. **Inspector – colour param.** `candle-holder.params.candleColor` is `{ type: 'color' }` (paramEditor supports it).
3. **Candles and the light budget.** Lit candles report a point light (≈ 11 lm for two flames, 1850 K). If the
   LightManager pools a fixed number of lights, these should rank last (they do with the current score
   `intensity / distance²`). The flames are `noMerge` emissive meshes in `emissiveMeshes`.
4. **existing.js mapping (FOUNDATION)** works as is. Two optional refinements: `f-pampas` could pass
   `params.shape: 'wave'` (it does), `f-vase-v1` gives `shape: 'round'` – fine. `f-maleri` gets `motif: 'misty-trees'`,
   `frame: 'none'`, `palette` from the room-spec – matches the photo (grey/white misty trees, dark shoreline).
5. **Acoustics.js** reads `ceiling-absorber` area as `w × max(d, h)` – correct for both baffles (w × h) and rafts (w × d).

## Verified

Screenshots in `.shots/decor/`:
- every archetype and variant: `palm.png` (the 1.8 m palm), `sokkel.png` (anthurium on the black plinth), `stativ.png`
  (pothos on the wire stand), `olive.png`, `ficus.png`, `berg.png`, `banan.png`, `monstera.png`, `kentia.png`,
  `pampasP.png`, `herb.png`, `fern.png`, `euc.png`, `hydr.png` (ribbed floor vase + blue hydrangeas), `pampasV.png`
  (wave vase + jute mat + pampas), `eucV.png`, `overlys.png`, `sprig.png`, `aude.png`, `knife.png`, `maleri.png`,
  `gustin.png`, `labyrint.png`, `ramor.png`, `mara.png`, `bota.png`, `line.png`, `photo.png`, `land.png`, `mround.png`,
  `morg.png`, `cape.png`, `lykt.png`, `telys.png`, `marmi.png`, `ceres.png`, `indo.png`, `foam.png`, `rope.png`,
  `mags.png`, `bin.png`, `tv.png`, `tvon.png`, `spk.png`, `spkbox.png`, `slat.png`, `slatz.png` (close-up), `slath.png`,
  `frigg.png`, `moss.png`, `aart.png`, `brown.png`, `hex.png`, `circ.png`, `baffle.png`, `raft.png`, `palm-low.png`
- catalogue grids `cat-smatt.png`, `cat-akustikk.png`, `all.png`
- in the room: `sb-082806.png` (photo camera 082806 – palm, painting, TV, speakers, sofa-corner plants), `sb-083019.png`
  (window-sill lantern/vase/plant, hydrangea vase), `sb-tvwall.png`, `sb-tvcorner.png`, `sb-sofa.png`, `sb-pampas.png`,
  `game-highwall.png` (three slat panels, felt hexagon, arched mirror, olive tree and a MITTZON baffle placed in the
  game: 55.9 fps «middels», no console errors)
- fuzz test: 996 builds (every enum option, min/max of every number param, min/max dims, all three qualities) – no
  fallback boxes, no NaN vertices.
- build times (warm): plants 4–40 ms, everything else ≤ 15 ms; the first art piece ≈ 200 ms (canvas painting),
  the first plant ≈ 350 ms (leaf atlas, once per page).

## Known gaps

- Mirrors reflect `scene.environment` (no planar reflection) – as specified.
- Pampas plumes and the eucalyptus are alpha cards; seen from directly above they thin out.
- The procedural «misty-trees» painting is an interpretation of the real canvas, not a copy.
- `art-frame` with `texture: 'photo'`/custom has no user image upload (would need a file input in the Inspector and
  a `params.imageUrl` – easy to add in `printMaterial` if wanted).
