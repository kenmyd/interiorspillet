# gulvlamper – Oslo Wood rettet + 12 nye gulvlamper (2026-10-20)

Files: `src/models/lamps.js`, `src/ui/Inspector.js`, `research/catalog/smalamper.json` (Oslo Wood params),
new `research/catalog-new/smalamper-gulvlamper.json` (12 products) → `src/data/catalog/smalamper.json` via
`normalize-data.mjs --only=catalog`, `tools/test-design.mjs` (counts 186 / 26 new, floor-lamp check). 96/97 tests
(the Secto/Octo profilePoints check failed already before this round).

## Oslo Wood (Northern)

- `floor-tripod` with `shadeShape: 'cone'` (`tripodCone`): thin steel legs to a hub, a fork with pins on the x axis and a
  gimbal ring; the cone (Ø13 → Ø26, 30 cm, wide end up) turns about the pins by `params.tilt` degrees toward the front
  (+z). Socket and bulb tilt with it. Product: tilt 15 (as in the shop photo), `tiltable: true`.
- Inspector: «Vinkel på skjermen» slider (0–80°) in the **Lys** section for products with `tiltable` (archetype
  schema `tilt.requires = 'tiltable'`; the params section hides it). Rotate the lamp to aim it elsewhere.
- Saved designs: `DesignState._replaceAll` gives an Oslo Wood placed before this round (drum params copied at placement)
  the product's cone shape params on load; a cone keeps its own tilt (tested).
- Dark fabric shades no longer glow white: `Lamp.darkGlow` scales the glow tint by the fabric's linear luminance / 0.3
  (black ≈ 0.06, brown linen ≈ 0.4, light colours 1). Affects only dark/brown fabric, paper, rattan shades: Oslo black
  and olive, Savanna brown bamboo, Tiller brown linen.

## New shapes

| Archetype | New | Product |
| --- | --- | --- |
| floor-pole-shade | `shadeShape` 'cone', 'pleated' (`pleats`), 'woven', 'lantern' (`ribs`, `openingBottomD/TopD`, `asymmetric`), 'tiered-slats' (`tierD`, `tierBottomAt`, `slatLength`, `slatsPerTier`, `slatW/T`); `shadeBottomAt`, `closedTop`, `capD/capH/finialH`, `finialD`, `poleCount: 0`, `poleD`, `frame: 'cage'`, `baseShape: 'tripod'` (`legW`, `hubD/H`) | Lund, Ronda, Cape Town, LAUTERS, Matisse, Kurbis, Alba |
| floor-globe | `shadeH` (flattened glass), `cupD/H`, `collarD/H`, `pullChain`, `baseShape` ('bullet' added to `foot()`) | August, Torrano |
| floor-reading | `armShape: 'hook'` (hourglass shade), `'balance'` (counterweight arm, `shadeAttach`) | Coni, Birdy |
| floor-tripod | `shadeShape: 'woven'` (rattan barrel, `ribs`, `rings`, `braceAt`) | Lindby Canyana |

Corrected against the product photos (research estimates were off): Birdy pivot 1.07 m / arm 32 cm, Kurbis lantern
64 cm high from 0.74 m, Cape Town slats ≈ 5 cm wide (30/24/20). Notes in each product's `shapeNote`.

Checked on `/dev/models.html?cat=smalamper` (every product builds) and in the game in evening mode (all 12 + Oslo
lit, tilt slider live, undo-able).

## For others

- ARCHITECTURE §5 (lamps.js) could list the new params above.
- Research agent's left-outs worth adding later: IKEA VIDJA, RÖDFLIK, VARPTROSS, AKTERSPRING, Bohus Myers.
