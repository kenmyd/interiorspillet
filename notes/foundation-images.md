# foundation-images – notes for the integrator

Owner of `public/img/**` and `tools/prep-images.py`. Regenerate everything with `py tools/prep-images.py`
(≈ 3 min, deterministic; `--debug` writes intermediates to `.shots/foundation-images/prep/`).

## Files

| Path (relative, use as `img/...`) | What |
| --- | --- |
| `img/forslag/<CODE>.jpg` (1288×1030) + `thumb/<CODE>.jpg` (400×320) | 21 montages: 0 B B2 E F A G H K P S P1–P5 C M X T G2 |
| `img/forslag/oversikt-1..4.jpg` | overview sheets of folder 1_ (00), 2_ (13), 3_ (19), 4_ (25) |
| `img/forslag/tegning-08.png`, `tegning-09.png` | the two drawings (max 1600 px, 256-colour PNG) |
| `img/forslag/index.json` | `{ montages: { CODE: { file, thumb, source, size, group } }, overviews, drawings }` – `source` is the path used in `wall-proposals.json` (`photo`/`image` fields), so WALLS can map source → game file |
| `img/foto/20261018_<n>.jpg` (1600×1200, q80) | the 7 `photoCameras` photos in `bilder_stue` (082806 827 829 909 924 083012 083019); the 8th camera (0_for) uses `img/forslag/0.jpg` |
| `img/stue.jpg` | re-encoded from the original 082901 (1920×1440, 380 kB; was 413 kB) |
| `img/utsikt/sor.jpg` 4096×2048, `sor-kveld.jpg`, `ost.jpg` 2560×1536, `nord.jpg` 2048×1182 | window backdrops |
| `img/utsikt/lav/*.jpg` | half-size versions for quality «lav» |
| `img/utsikt/backdrops.json` | geometry of every backdrop (below) |

## How to place the backdrops (exterior.js – SHELL)

Each backdrop is an **open cylinder segment around a vertical axis through `center`** (= the photo camera
position, solved from the window frame). Columns are linear in azimuth (`azimuthDeg`, measured from +x/south
toward +z/west → world direction `(cos az, 0, sin az)`), rows are linear in tan(elevation):
`y = center.y + R·(tanElevation[0] + v·(tanElevation[1] − tanElevation[0]))` with v = 0 at the bottom row.
Seen from `center` the picture is an exact reprojection of the photos (checked by rendering it back to the
photo cameras – `cmp-082850-blend.jpg` overlays with no ghosting). R = `suggestedDistance` (sor 60 m, ost 40 m,
nord 25 m); `suggestedWidth/Height` = arc length / height at that R. A tiny builder (works as is):

```js
function backdrop(b, tex, R = b.suggestedDistance, N = 96) {
  const [a0, a1] = b.azimuthDeg.map(THREE.MathUtils.degToRad), [t0, t1] = b.tanElevation, [cx, cy, cz] = b.center;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const a = a0 + (a1 - a0) * i / N, x = cx + R * Math.cos(a), z = cz + R * Math.sin(a);
    pos.push(x, cy + R * t0, z, x, cy + R * t1, z); uv.push(i / N, 0, i / N, 1);
    if (i < N) idx.push(2*i, 2*i+2, 2*i+1, 2*i+1, 2*i+2, 2*i+3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false, fog: false }));
}
```

- Unlit material; scale `material.color` with daylight in `setDaylight(level, skyHex)`. Evening: swap or
  cross-fade to `sor-kveld.jpg` (same geometry); night: `sor-kveld` × 0.15–0.3.
- **Ground**: the photos show the lawn falling ≈ 2.7 m below the floor to the river. Keep 3D ground to the
  terrace + a few metres of lawn; a terrain plane further out would hide the photographed lawn/river.
- **Terrace, railing, stair, landing and the annex are removed/replaced** in the pictures (lawn / slope behind
  them) – they must be built in 3D (room-spec `outside`). From inside, the 3D deck covers the backdrop below
  ≈ −30° anyway.
- Near objects in `sor` (the 3–5 m lichen rock at az +7…+27, the trees west of the house at az +15…+66) only
  line up from near `center`; moving through the room gives some parallax – unavoidable with one photo layer.
- **`ost.jpg` faces SOUTH** (the kitchen windows face south like the living room; "ost" = the east end of the
  room). It shows the dark annex wall close on the left, the river/boathouses and the houses on the far bank,
  from the kitchen island. Its 40 m cylinder would sit in front of `sor`'s 60 m cylinder when seen from the
  living room, so do **one** of: (a) use `sor` alone for all south openings (simplest; the kitchen then sees the
  same landscape with ~9° parallax error), (b) show `ost` instead of `sor` while the player is in the kitchen
  zone, or (c) draw `ost` only through the kitchen glass (stencil). `facing` is `"south"` and `role` is
  `"kitchen"`; look it up by `id`.
- `nord.jpg` is for the TV-room strip window (win-tv, sill 1.64 m): birch leaves, the light grey-blue commercial
  building with mesh fence, a spruce and the forested knoll. Only its middle (az ≈ 141–193) is photo; the rest is
  a soft continuation.

## Known gaps

- The parts of `sor` beyond az −66 (east, behind the annex) and +66 (west) are stretched, softened reflections
  of the outermost photo content, not real photos. The lawn where the terrace was is texture-synthesised from
  the open lawn next to it (looks natural at window distance; slightly blotchy close up).
- `ost` below the railing top and the annex wall left of the photo are synthesised (only meant to be seen
  between 3D railing slats / behind the 3D annex).
- `sor-kveld` is a graded version of the morning photos (blue-hour sky, darker cooler land, sky reflections on
  the river, ~46 lit windows across the river) – not a real evening photo.
- Camera positions in `backdrops.json` are solved from the frames to ±0.1 m; rotations to ±0.3°.
- Test page used for verification (not part of the game): `.shots/foundation-images/preview.html`
  (`?cam=x,y,z&look=x,y,z&fov=&roll=&only=sor|ost|nord&kveld=1&walls=0`).
