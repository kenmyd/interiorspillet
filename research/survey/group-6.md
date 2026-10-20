# Survey group 6 – photos 082950, 083001, 083004, 083006, 083009, 083012, 083019

Coordinate system as specified: metres, origin = floor at the top-left interior corner of the plan, +x = south (windows), +z = west (TV-stue end), +y = up. rotationDeg = three.js rotation.y, front = local +z (0 → faces west, 90 → faces south, 180 → faces east/kitchen, -90 → faces north).

## 0. Method and accuracy

* Plan read at ~50.6 px/m, interior origin at plan pixel (91, 52). Plan-derived anchors used: high-wall face x = 3.26, bedroom wall face (TV-stue east wall) z = 8.46, living south wall x = 7.04, kitchen south wall x = 6.40, wall step at z = 5.43, west wall z = 12.06, north wall x = 0.
* Five photos were **camera-calibrated** with a small pose solver (Levenberg–Marquardt on 2D↔3D correspondences: room corners, LED-strip lines, niche corner, door frame, strip window). Then furniture and fixture points were back-projected onto known planes (floor, walls, sloping ceiling `y = 3.0 − 0.1587·(x − 3.26)`). Reprojection RMS: 7–12 px on 4000×3000 images. Positions read off the calibrated photos are good to about **±0.10–0.15 m near the camera** and **±0.3 m for distant or grazing-angle points**.
* Cross-checks between two independent calibrations agree. The four high-wall spotlights came out at z 7.60/6.70/5.90/5.05 in 083012 and 7.55/6.7/5.95/5.10 in 083019. The TV-stue coffee table legs came out at (2.30, 10.28)/(2.45, 9.70) and (2.43, 10.32)/(2.50, 9.72).
* EXIF: Galaxy S25, 13 mm-eq ultra-wide (nominal f ≈ 1502 px at 4000 px width). The fitted f was 1540–1720 for most shots. **083006 fits f ≈ 2420 px**, so it is effectively a cropped/zoomed shot with about 79° horizontal FOV.
* Colour hex values are estimates. Photos mix warm 2700 K lamp light and blue dawn daylight. I give "perceived real" colours, not raw pixel averages.

## 1. Camera positions per photo

| Photo | Camera (x, y, z) | View | Calib | What it shows |
|---|---|---|---|---|
| 082950 | (4.70, 1.80, 1.25) | yaw −90 (looking +x, south), pitch −21° | hand-solved (floor/ceiling/window, f 1502) | Kitchen aisle between the sink run (z=0 wall, left) and the island (right). Looks at the kitchen window on the kitchen south wall x=6.40. Terrace and river outside. |
| 083001 | ≈(5.2, 1.7, 10.2) | yaw ≈ 90 (looking −x, north), pitch ≈ +35° | estimated only | Looks up into the TV-stue: sloping SAND ceiling → SAND bulkhead face (x=3.26, 2.4–3.0 m) → MARRAKESH TV-stue ceiling with ring lamp, LED strip at the north wall, strip window, L-sofa, TV (left), plant, wall shelf (right). |
| 083004 | ≈(5.3, 1.7, 9.5) | yaw ≈ −145 (looking WSW toward the SW corner), pitch ≈ +30° | estimated | Window 2, SW corner, LED strip along the south wall ending at the corner, painting, curved boucle sofa, chandelier. |
| 083006 | (5.66, 1.86, 7.47) | yaw 172 (looking +z, west), pitch +11°, roll +1° | solved, f 2422 (zoomed) | West wall face-on: painting, chandelier, TV-stue bulkhead corner at x=3.26, TV, window 2 reveal. |
| 083009 | (6.12, 1.53, 9.80) | yaw 111 (looking NW), pitch +18°, roll −2° | solved, f 1540 | Chandelier and the whole TV-stue: TV, NW plant, L-sofa, rug, coffee table, wall shelf, strip window. |
| 083012 | (6.10, 1.86, 11.22) | yaw 47 (looking NE), pitch +13°, roll +2° | solved, f 1650 | Overview: TV-stue, niche corner, high wall with 4 spots and the black door, AC, kitchen, dining table. |
| 083019 | (5.34, 1.74, 10.96) | yaw ≈ 0 (looking −z, east), pitch −9.7°, roll −3.3° | solved, f 1577 | Long view east: swivel chairs, round coffee tables, dining, kitchen. High wall (left) and south windows, terrace door and wall step (right). |

The photographer stood at about 1.75–1.85 m camera height, just in front of the curved sofa, for 083012 and 083019.

## 2. Architecture

### 2.1 Walls in my photos (corner positions)
* **High wall** (x = 3.26, faces +x/south) – high confidence for the position (plan, consistent with 3 calibrations).
  * Runs from the hall-door frame (outer architrave edge z = 4.48) to the **niche corner (3.26, 8.46)** = **3.98 m** clear. This matches the user's ~3.9 m.
  * Height 3.0 m (given).
  * The same plane continues above 2.4 m across the TV-stue opening as a **bulkhead face 0.6 m tall (2.4–3.0 m), z 8.46 → 12.06**. It meets the west wall at (3.26, 2.4–3.0, 12.06); verified in 083006.
  * Toward the kitchen the plane continues over the door to about z 3.3 (kitchen bulkhead). The kitchen tall cabinets stand flush with this plane from z ≈ 2.23 to 0 (recess x 2.67–3.26, from the plan; confirmed in 083019 where the cabinet corner back-projects to z = 2.23).
* **TV-stue niche**: x 0 → 3.26, z 8.46 → 12.06 (3.26 × 3.60 m), flat ceiling 2.4 m.
  * East wall = bedroom wall face z = 8.46 (faces +z).
  * North wall x = 0 with the strip window.
  * West wall z = 12.06 with the TV.
  * The niche corner is an outside corner (the end of the bedroom wall). Interior wall thickness from the plan is about 0.12–0.16 m (not measurable in my photos).
* **South wall, living part** (x = 7.04): from the wall step (z = 5.43) to the SW corner (z = 12.06).
  * Contains the terrace door, a pier of about 0.13–0.2 m, window 1, a pier of **0.20 m**, window 2, and an end pier of about 0.4–0.6 m (low) to the west wall.
* **Wall step**: a SAND face at z = 5.43 (faces +z/west), x 6.40 → 7.04, so **0.64 m wide**.
  * Confirmed: its image width matched 0.64 m at the solved distance.
  * Its top inner corner back-projects to y = 2.51–2.54 m, which confirms the slope continues there (linear slope predicts 2.50).
* **Kitchen south wall** x = 6.40, z 0 → 5.43, with two windows.
* **Kitchen east wall** z = 0 (base cabinets and glass wall cabinets).
* **West wall** z = 12.06 (painting, curved sofa; TV in the TV-stue part).
* Exterior wall thickness is about 0.25–0.30 m (low): inner reveal to frame 0.14 m, plus about 0.08 m frame, plus cladding.

### 2.2 Ceilings
* **Sloping living/dining ceiling**: 3.0 m at the high wall (x = 3.26) → 2.4 m at the south wall (x = 7.04).
  * Slope 0.6/3.78 = 0.159 → **9.0°**, falling toward +x only. The south-wall LED line is level along z and the step top at x 6.40 is 2.51 m. (High for the slope direction.)
  * Plane: `y = 3.0 − 0.1587·(x − 3.26)`. It spans z ≈ 3.3 → 12.06 for x 3.26 → 6.40, and z 5.43 → 12.06 for x 6.40 → 7.04.
* **TV-stue**: flat 2.40, **MARRAKESH** (clearly darker than the bulkhead face and the living ceiling in 083001/083009; high).
  * Bulkhead edge at x = 3.26, y = 2.40, z 8.46–12.06, square arris (no cove).
* **Kitchen**: flat 2.40.
  * The **kitchen bulkhead** (vertical SAND face toward the dining area) is at **z ≈ 3.3 ± 0.3** (med-low; 083019). Its bottom edge is at 2.40.
  * Its height runs from 0.6 m at the high wall to about 0.1 m at x = 6.40, following the slope.
  * The hall door (z 3.38–4.48) and the AC above it are therefore just on the dining (sloping-ceiling) side.

### 2.3 Paint
* **SAND** (warm light beige, ≈ #d6ccbf; daylight reads cooler, about #cfd0cc): high wall, bulkhead face over the TV-stue, south wall, step face, kitchen walls, west wall in the sitting area, sloping ceiling and kitchen ceiling.
* **MARRAKESH** (warm grey-brown/taupe, ≈ #8e8379):
  * TV-stue east wall (bedroom wall face z=8.46) – high.
  * TV-stue ceiling – high.
  * TV-stue north and west walls – med. They read lighter in the photos because the LED strip washes them; no paint break was visible on the west wall at x = 3.26, but the user says the TV-stue walls are the darker ones.
* Baseboards are painted in the wall colour: light on SAND walls, dark on the MARRAKESH wall at the niche (z2 crop). High.

### 2.4 LED strips (recessed alu profiles flush in the ceiling, about 3–6 cm from the wall, about 15–20 mm wide, warm white about 2700 K; not coves)
1. **South wall, living/dining**: x ≈ 6.99, y = 2.40, from the step corner z ≈ 5.5 to the SW corner z = 12.06 (≈ 6.5 m). It does not continue on the west wall (083004/083006 show it ending at the corner). High.
2. **TV-stue north wall**: x ≈ 0.05, y = 2.40, z 8.46 → 12.06 (3.6 m). High.
3. **Kitchen**: a short linear LED (≈ 0.6 m) on the ceiling at the tall cabinets, about (3.6, 2.38, 2.4) (low). Warm under-cabinet LED below the glass wall cabinets lights the backsplash (083019/083012). Med.

## 3. Openings

| # | Opening | Wall | Position | Size / heights | Details | Conf |
|---|---|---|---|---|---|---|
| W-K1 | Kitchen window | kitchen south wall x=6.40 | z 0.61 → 3.06 (plan; photo agrees: left edge right at the counter end z≈0.6, island end at z≈1.8 under the window's left third) | Reveal opening ≈ 1.00 → 2.19 m; glass ≈ 1.07 → 2.10 m; wide ≈ 2.45 m | Single large sash, black/anthracite slim alu frame (#2a2b2d) with a **black latch at bottom centre**, so likely top-hung outward (Norwegian «topphengslet»). Deep white reveal ≈ 0.15–0.2 m, white reveal bottom with no separate board. The sill is about 7 cm above the 0.93 m worktop. The worktop and the island both run into this wall. | med (heights), high (z) |
| W-K2 | 2nd kitchen window | kitchen south wall x=6.40 | z ≈ 3.8 → 4.8 (plan 3.77–4.96) | ≈ 1.0–1.2 m wide, sill ≈ 0.8, top ≈ 2.09 | Seen only at a grazing angle in 083019; white reveal, black frame | low |
| D-T | Terrace door | south wall x=7.04, just after the step corner | Opening z ≈ 5.57 → 6.50 (plan; photo: 0.14 m wall between step corner and door reveal) | Opening height ≈ 2.09–2.18 m; handle at ≈ 1.15 m | Glazed single leaf, black frame. **Opens outward; hinges on the +z (window) side, handle on the −z (step/kitchen) side.** White reveal ≈ 0.18 m on the step side. | med-high |
| W1 | Living window 1 | south wall x=7.04 | **z 6.63 → 8.95** (2.32 m) | **Sill (window board) top ≈ 0.28 m** (0.25–0.31), opening top ≈ 2.08 m | **Fixed glazing**, black slim alu frame with glazing-bead screw caps and no handle. Frame inner face ≈ 0.14 m behind the wall face. Deep white window board protruding about 2–3 cm. White reveal. | med-high |
| W2 | Living window 2 | south wall x=7.04 | **z 9.15 → ≈ 11.45** (west end low: 11.26–11.65 in two calibrations; plan 11.74) | Same as W1: sill ≈ 0.27, top ≈ 2.07 | Fixed, identical to W1. Low black double socket on the pier below/between W1 and W2 at about z 9.13, h ≈ 0.1 m. | med |
| W-S | TV-stue strip window | north wall x=0 | **z 9.30 → 11.10** (1.80 m; plan 9.13–10.95) | Frame outer **1.62 → 2.06 m** (0.43 m tall) | Horizontal fixed strip, black frame, deep white sill ≈ 0.2 m used as a shelf | high |
| D-H | Hall door at the kitchen end of the high wall | x=3.26 | Frame outer z **3.38 → 4.48** (1.10 m incl. architraves; leaf ≈ 0.9) | Frame top ≈ 2.20 m (leaf ≈ 2.1) | **Black** flush leaf with black frame/architrave about 7 cm. Seen edge-on, so the handle side and swing are not visible. The plan draws this opening with a double thin line (sliding door or window symbol), not a swing arc. Next to the near jamb on the high wall at z ≈ 4.55: a black switch at 1.21–1.25 m, a black device (thermostat/sensor) at ≈ 1.65 m, and a black socket at ≈ 0.2 m. | med |

* No other windows or doors appear in my photos. The bedroom, small-room and bath openings are not visible from my viewpoints.

## 4. Floor
* Wood-look planks (laminate or vinyl, matte), the same throughout the kitchen, dining, living and TV-stue. **Planks run along z** (east–west, the length of the room). Seen as long joints parallel to the kitchen window wall in 082950 and converging toward the kitchen in 083019. High.
* Plank width ≈ **0.20–0.25 m** (from joint spacing on the solved floor in 082950; med-low). Length ≈ 2 m or more with staggered end joints (low).
* Colour: light greige / white-washed oak ≈ **#c2b6a6** (warm light), ≈ #b8b4ad in daylight. Subtle grain.
* Baseboards ≈ 7–10 cm high (low-med), about 12 mm thick, square, painted in the wall colour.

## 5. Existing furniture and objects

### Sitting area (south-west, under the chandelier)
* **Curved 3-seat sofa** («buet sofa»):
  * Centre ≈ (5.47, 11.55), rotationDeg **180**, w ≈ 2.25 × d ≈ 0.95 × h 0.75 (seat ≈ 0.42).
  * Back against the west wall. Its back top back-projects at y 0.72–0.77 over x 4.38 → 6.57.
  * Shape: crescent plan with a continuous rounded bolster back that curves forward into low arms. Plump rounded seat, no visible legs (sits on a low recessed plinth).
  * Fabric: light grey **boucle/teddy** ≈ #b5b2ae.
  * A sage-green knitted throw/cushion (#9fb39a) sits at the north end. (med; position low-med)
* **2 swivel tub armchairs** (identical):
  * Centres ≈ **(5.01, 9.08)** and **(6.10, 9.00)**, rotationDeg **0** (facing the sofa/west).
  * Ø ≈ 0.70 round-oval base drum, seat h ≈ 0.45, back h ≈ 0.75. Crescent back shell wrapping about 200°, tilted slightly back, with piped edges.
  * Fabric: grey-beige boucle ≈ #a8a39f. (high shape, med position)
* **2 nesting round coffee tables**, dark stained oak/ash ≈ #3a3532, thin round tops on a black or dark base:
  * Large: Ø ≈ 0.80, h ≈ 0.45, centre ≈ (5.8, 10.15).
  * Small: Ø ≈ 0.60, h ≈ 0.40, centre ≈ (5.0, 10.15), partly overlapping/in front.
  * Two tall dark-green/black taper candles in black holders on the large table. (low-med)
* **Rug**: chunky felted-ball / wool loop rug, light grey melange ≈ #9e9b98.
  * Far (east) edge at z ≈ 8.78, side edges at x ≈ 4.42 and 6.50 (width ≈ **2.0–2.1 m**). It runs west under the coffee tables to at least z 10.5, so probably 200 × 300 to the sofa front (low on the west end).
* **Painting**: canvas ≈ **1.07 × 0.76 m** (likely 110×75 or 120×80), gallery-wrapped about 3–4 cm deep.
  * On the west wall, centre ≈ **(5.42, 1.57 high, 12.03)**, rotationDeg 180. Bottom ≈ 1.19, top ≈ 1.95.
  * Motif: misty birch/tree row reflected in water, greys/white/sage, watercolour style. (med)
* **Kentia/Areca palm** (Dypsis/Howea), ≈ 1.8–2.0 m tall, ≈ 1.2 m spread, in the NW part of the sitting area. Base ≈ (3.7, 11.7) (low). This matches the small grey square in the plan at x 3.3–4.0, z 11.5–12.06.
* **Pothos** (Epipremnum, green, trailing) on a tall black metal plant stand (≈ 0.7 m) in the SW corner between the sofa and window 2, ≈ (6.75, 11.8) (low-med).

### TV-stue (niche x 0–3.26, z 8.46–12.06)
* **L-shaped modular corner sofa** (one composite object):
  * Leg A against the bedroom wall z = 8.46, facing +z: x 0 → **2.95**, depth ≈ 0.90 (seat front z ≈ 9.33), armrest at the open (niche) end: w ≈ 0.25, h **0.62**.
  * Leg B against the north wall x = 0, facing +x: z 8.46 → **10.6**, front x ≈ 0.86. Back cushions run only to z ≈ 9.95; the last ≈ 0.6 m (z 9.95–10.6) is a **backless open-end seat** with no armrest (a cream knit throw lies there).
  * Back height ≈ 0.75–0.80, seat ≈ 0.45.
  * Boxy modules with welt/piped seams and loose back cushions. Medium grey woven melange ≈ **#6c6f71**.
  * Two cream chunky-knit cushions (#e6e1d8) plus one grey cushion. (high shape, med dims)
* **Coffee table**: rectangular ≈ **1.25 (along x) × 0.60 (along z) × 0.45 h**, centre ≈ **(1.83, 9.97)**, rotationDeg 0 (long side along world x).
  * Anthracite top (#3c3c40, stone/metal look).
  * **Black square-tube cube/sled frame** with bottom rails.
  * Tealight glasses and copper votives on top. (med)
* **Rug**: ≈ **160 × 230**, long axis along x, x ≈ 0.8 → 3.1, z ≈ 9.25 → 10.85 (tucked under both sofa fronts).
  * Light grey base #a9adb1 with charcoal (#3d3f44) and mid-grey large organic arches/half-moons and rectangles; short pile. (med)
* **TV**, wall-mounted, no TV bench:
  * Black rectangle on the west wall z ≈ 12.03, rotationDeg 180, centre x ≈ **1.65**.
  * Measured ≈ 1.6–1.7 wide × 1.0 tall (bottom ≈ 0.45–0.55, top ≈ 1.50), so most likely a **77″ (1.72 × 0.98)**. (low-med)
  * Two thin white flush in-wall panels (probably in-wall speakers, ≈ 0.12 × 0.55 m, centre h ≈ 1.0), one on each side of the TV, e.g. at x ≈ 2.6. A white flush media/outlet plate at the floor below the TV, at about (1.55, 0.12, 12.05).
* **Plant**: variegated pothos/Scindapsus in a white ceramic pot on a black cube stand (≈ 0.35–0.4 m) in the NW corner ≈ (0.45, 11.7). (med)
* **Black box** ≈ 0.3 × 0.3 × 0.35 (subwoofer?) between the sofa's backless end and the plant, ≈ (0.2, 10.8). (low)
* **Wall shelf** on the bedroom wall face z = 8.46 (rotationDeg 0), centre x ≈ 1.6, ≈ 0.9–1.1 wide, ≈ 1.30 → 1.85 m.
  * Black steel rod grid with 4 small staggered dark shelves.
  * Decor: stacked stones, small plants in seagrass baskets, glass lantern. (med-low)
* **Vase**: tall cream ribbed vase (≈ 0.6 m) with blue artificial hydrangea at (3.15, 8.65), next to the armrest at the niche corner. (med)
* Electrical: black switch (3.16, 1.22, 8.46) and black socket (3.15, 0.20, 8.46) on the bedroom wall face just inside the niche corner. (high)

### Dining
* **Dining table**: soft oval / racetrack, ≈ **2.1 × 1.1 m**, h 0.75, centre ≈ **(5.43, 6.9)**, long axis along z (rotationDeg 0).
  * Dark smoked oak/ash or a dark stone-look top ≈ #4a433f, about 3 cm thick with a lighter thin bevelled edge.
  * Legs: two pairs of **splayed flat black steel legs** (A/V-shaped), one pair set about 0.4 m in from each end. (med; table length med-low)
* **6 dining chairs**: shell chairs with a rounded back.
  * Light warm-grey boucle ≈ #cfc8c0, 4 thin tapered black metal legs, seat h ≈ 0.47, back h ≈ 0.85.
  * 2 per long side at x ≈ 4.6 (rotationDeg 90) and x ≈ 6.3 (rotationDeg −90), z ≈ 6.4 and 7.4.
  * 1 at each end: (5.43, 5.6) rotationDeg 0 and (5.43, 8.2) rotationDeg 180. (low-med)
* Window 1 sill decor: clear glass lantern (≈ 0.2 m) at z ≈ 6.75; dark hammered ceramic vase (≈ 0.25 m, #3b3b3d) with eucalyptus stems at z ≈ 8.0.
* Window 2 sill: small green plant in a black pot at z ≈ 9.6.
* Window 2 sill (083004): two grey-green glass tealight holders and a black taper candle in front.

### Kitchen
* **Tall cabinets**: in the recess x 2.67–3.26, z 0–2.23, full height ≈ 2.35, front flush with the high-wall plane (faces +x, rotationDeg 90).
  * Matte black handleless.
  * Stacked built-in oven and combi-microwave (plan: «Stek/mikro/kaffe») and an integrated fridge/freezer («Kjøle/frys»). (high)
* **Base run** on the east wall z = 0: x ≈ 3.26 → 6.40, depth 0.62, worktop top **0.93**.
  * Matte black handleless fronts with integrated grip channels, ≈ #1d1c1e.
  * Dark stone-look worktop (black/charcoal with light grey veining ≈ #3a3836, 2–3 cm).
  * Black composite single-bowl sink at x ≈ **5.4**.
  * Matte black square pull-out tap.
  * Dishwasher near x 6.0–6.4 (plan).
  * Black double sockets on the backsplash; black knife block at x ≈ 3.4.
* **Glass wall cabinets** on z = 0: 3 black-framed glass doors, x ≈ 4.2 → 6.2, bottom ≈ **1.50**, top ≈ **1.95**, depth 0.35, under-cabinet LED. (med)
* **Island**: x 4.36 → 6.40 (runs into the kitchen window wall), z 1.84 → 3.06, h 0.93.
  * Black fronts, the same dark stone-look top.
  * **Flush induction hob with integrated central downdraft extractor**, ≈ 0.8 × 0.52, on the window half.
  * Decor at the window end: wavy ochre/cream ceramic vase with pampas grass on a round jute mat.
  * (Plan position confirmed by 082950 and 083019: the island edge back-projects to z 2.91.)
* **3 bar stools** on the dining side, ≈ z 3.35, x ≈ 4.75 / 5.35 / 5.95, rotationDeg 180.
  * Dark forest-green velvet/boucle with a channel-tufted back, black metal legs, seat h ≈ 0.68. (med)
* Stainless pedal bin between the counter and the island against the window wall; small potted plant on the counter by the window.
* **AC / heat-pump indoor unit**: black wall unit ≈ 1.0 × 0.30 × 0.24 on the high wall directly **above the hall door**, centre ≈ (3.38, 2.68, 3.95), bottom ≈ 2.52, top ≈ 2.85, faces +x (rotationDeg 90). (med)

### Electrical on the high wall
* Black double sockets at h ≈ 0.18–0.21 at z ≈ 7.2–7.4 and z ≈ 4.55.
* Switch at 1.2 m and a device at 1.65 m by the door.
* No radiators seen. Heating is presumably the AC plus floor heating (not verified).

## 6. Lighting

| Fixture | Position | Size / description | Conf |
|---|---|---|---|
| **Molecule chandelier** (sitting area) | Canopy on the sloping ceiling ≈ **(5.3, 2.68, 10.35)** (3 calibrations: x 5.0–5.5, z 9.3–10.4) | Black round canopy Ø ≈ 0.22. Single black cable ≈ 0.45 m to the hub (hub ≈ 2.22 m). Branching black rods with ball joints spread ≈ 1.2 m. **8 matte-black globe shades** with a large side opening and gold/copper inner finish (4 large Ø ≈ 0.20, 4 small Ø ≈ 0.13), E27/E14 bulbs, warm. Lowest shade bottom ≈ 1.8–1.9 m. | med |
| **4 wall-washer spots** for the high wall | On the sloping ceiling at x ≈ 3.6–3.7 (0.35–0.45 m from the wall), y ≈ 2.93, **z ≈ 7.6, 6.7, 5.9, 5.05** (0.85 m c/c) | Small black surface-mounted adjustable cylinders (Ø ≈ 5–6 cm, L ≈ 10–12 cm) aimed at the wall. Light pools centred at z 7.7/6.85/6.1/5.3, tops at ≈ 2.65 m, soft fall-off to about 1.6 m. Important for any new high-wall design. | high |
| **TV-stue ceiling lamp** | ≈ (1.63, 2.33, 10.25) = centre of the niche ceiling | Semi-flush, 3 interlocking/overlapping rings (black outer, warm LED inner face, gold centre hub). Overall ≈ 0.9 × 0.55 m, largest ring Ø ≈ 0.6. | med |
| LED strip, south wall | x 6.99, y 2.40, z 5.5 → 12.06 | see 2.4 | high |
| LED strip, TV-stue north wall | x 0.05, y 2.40, z 8.46 → 12.06 | see 2.4 | high |
| **Island pendants** | 3 pendants at x ≈ 4.86 / 5.41 / 5.96, z ≈ 2.45; black ceiling track x ≈ 4.75 → 6.2 at 2.4 m | Slim black cylinders Ø ≈ 5–6 cm, L ≈ 0.35. Bottoms at ≈ **1.67 m** (0.74 m above the island top). | med |
| Kitchen ring lights | ≈ (5.6, 2.32, 1.0) above the sink aisle (also seen top-centre in 082950) and ≈ (4.0, 2.32, 2.0) between the tall cabinets and the island | Thin ring-shaped LED semi-flush/short-stem lamps, Ø ≈ 0.4. They look like a "T" when seen edge-on. | low |
| Kitchen linear LED / under-cabinet LED | (3.6, 2.38, 2.4); under the glass cabinets | Warm | low-med |
| Smoke detectors / sensors | Black disc Ø ≈ 0.17 at (2.57, 2.4, 9.03) in the TV-stue ceiling; small black puck at (0.16, 2.4, 8.80) | — | med |
| **Floor lamps, table lamps, lamp over the dining table** | **None present** | The dining table has no pendant over it; the chandelier hangs over the sitting area, ≈ 3.4 m west of the dining-table centre. | high |

## 7. Outside views and terrace
* **Kitchen window** (082950, looking south-east):
  * In the foreground a terrace deck (dark grey) with a grey rattan lounge chair and a small white table.
  * Horizontal-slat railing (grey weathered wood, ≈ 1.0 m) about 3–4 m out.
  * At the left (east) a very close timber outbuilding/garage: vertical grey-brown boards, mossy/turf roof edge.
  * Beyond: the river (calm), a far-bank hillside with white houses and a red house, mixed autumn trees.
* **Window 1 and terrace door** (083019):
  * Terrace deck ≈ at interior floor level (−0.05), smooth dark grey (#5a6068).
  * Railing parallel to the façade about 3.5–4.5 m out (x ≈ 10.5–11.5).
  * A return railing near the W1/W2 boundary. Through W2 that railing slopes down to the lawn, so **stairs go down on the west side of the terrace**. A grey concrete pillar/wall supports the deck.
  * Slats: ≈ 7 cm boards with ≈ 3 cm gaps, posts ≈ 1.3–1.5 m c/c, top board/cap.
  * Beyond: neighbours' houses (dark concrete-tile roof, red-tile roof with brown cladding, white house), a small greenhouse, a spruce/deciduous hillside.
  * Terrace extent (low): along the façade from about z 0 (kitchen window) to z ≈ 9.
* **Window 2** (083004): no deck in front. Looking down (the floor is roughly 2–3 m above the garden):
  * A lawn sloping to the river.
  * A large lichen/moss-covered granite boulder 3–6 m out.
  * Mature oaks/ash along the bank.
  * The river ≈ 50–80 m wide, with white houses and boathouses on the opposite bank.
* **Strip window** (TV-stue, north): tree branches with autumn leaves, a grey building and a sign-like white panel, sky.
* Light: dawn about 08:30 in October, overcast and bluish.

## 8. Discrepancies with the floor plan
1. **Dining table**: an **oval ≈ 2.1 × 1.1 with 6 chairs**, centre (5.43, 6.9), long axis along z. The plan shows a round table with 4 chairs at (5.36, 6.58).
2. **Sitting area**: a **curved 3-seat boucle sofa ≈ 2.25 m against the west wall** (back at z ≈ 12.0, centre x 5.47). The plan shows a straight 2-seater at z 10.75–11.74 standing free of the wall.
   * **Two round nesting coffee tables**, where the plan shows one black rectangle (x 5.04–6.26, z 9.84–10.3).
   * The swivel chairs roughly match the plan (z 8.5–9.5), with centres at (5.01, 9.08) and (6.10, 9.00).
3. **TV-stue**: **no TV bench** (the plan's dark rectangle along the west wall). The TV is wall-mounted at about x 0.8–2.5.
   * The L-sofa legs are A to x 2.95 along the bedroom wall and B to z 10.6 along the north wall (backless end). The plan shows a 3-module leg to x 3.16 and a chaise to z 10.0.
   * The plan's small grey square at (3.3–4.0, 11.5–12.06) is the **palm**.
4. Windows:
   * W1 z 6.63–8.95 (plan 6.69–9.13).
   * W2 z 9.15–≈ 11.45 (plan 9.29–11.74).
   * The pier between W1 and W2 is 0.20 m (plan 0.16).
   * Strip window z 9.30–11.10 (plan 9.13–10.95).
5. Not in the plan:
   * The **kitchen bulkhead at z ≈ 3.3**.
   * The **AC above the hall door**.
   * The **3 bar stools**.
   * The 4 wall-wash spots.
   * The LED strips.
   * The bulkhead face over the TV-stue opening.
6. The hall door is drawn with a window/sliding symbol at x 3.26, z 3.36–4.35. The photo shows a black door, frame outer z 3.38–4.48, frame top 2.20.
7. Confirmed as in the plan:
   * Island x 4.36–6.40 × z 1.84–3.06, touching the kitchen window wall.
   * Tall-cabinet recess x 2.67–3.26, z 0–2.23.
   * Sink at x ≈ 5.4.
   * Wall step at z 5.43 (0.64 m).
   * Terrace door opening outward with the hinge on the +z side.
   * Kitchen window z 0.61–3.06.

## 9. Compact object list (for the scene builder)

```
# id: centre(x,z) | rotY | w x d x h | notes
curved_sofa:       (5.47,11.55) | 180 | 2.25x0.95x0.75 | boucle #b5b2ae, crescent, seat 0.42
swivel_chair_1:    (5.01, 9.08) | 0   | 0.70x0.70x0.75 | boucle #a8a39f, round drum + crescent back
swivel_chair_2:    (6.10, 9.00) | 0   | 0.70x0.70x0.75 |
coffee_round_L:    (5.80,10.15) | 0   | Ø0.80 h0.45 | dark oak #3a3532
coffee_round_S:    (5.00,10.15) | 0   | Ø0.60 h0.40 |
rug_sitting:       (5.46, 9.9+) | 0   | 2.05 x >=2.2 | felted-ball wool #9e9b98, east edge z 8.78
painting_west:     (5.42, 12.03) y1.57 | 180 | 1.07x0.03x0.76 | misty birches
palm:              (3.70,11.70) | -   | h1.9 spread1.2
pothos_stand_SW:   (6.75,11.80) | -   | stand h0.7
L_sofa_tvstue:     legA x0..2.95 @ z8.46..9.36 (rot 0); legB z8.46..10.6 @ x0..0.9 (rot 90); back h0.78 seat 0.45 arm 0.62 #6c6f71
tv_coffee_table:   (1.83, 9.97) | 0   | 1.25(x)x0.60(z)x0.45 | anthracite top, black tube frame
rug_tvstue:        (1.95,10.05) | 90  | 2.30(x)x1.60(z) | grey abstract
tv:                (1.65,12.03) y0.99 | 180 | 1.72x0.05x0.98 | wall-mounted, no bench
wall_shelf:        (1.60, 8.47) y1.58 | 0 | 1.0x0.20x0.55 | black rod grid, 4 shelves
plant_cube_NW:     (0.45,11.70) | -   | cube 0.35 + pothos 0.5
vase_hydrangea:    (3.15, 8.65) | -   | h0.6 cream ribbed
dining_table:      (5.43, 6.90) | 0   | 1.10(x)x2.10(z)x0.75 | oval, dark top #4a433f, splayed black legs
dining_chairs x6:  (4.60,6.4)(4.60,7.4) rot90; (6.30,6.4)(6.30,7.4) rot-90; (5.43,5.6) rot0; (5.43,8.2) rot180 | boucle #cfc8c0 seat0.47 back0.85
island:            x4.36..6.40 z1.84..3.06 h0.93 | black, stone-look top, downdraft hob
bar_stools x3:     (4.75,3.35)(5.35,3.35)(5.95,3.35) | 180 | seat 0.68, dark green
tall_cabinets:     x2.67..3.26 z0..2.23 h2.35 | 90 | black, oven+micro, fridge
base_run_east:     x3.26..6.40 z0..0.62 h0.93 | 0 | sink x5.4
glass_wall_cab:    x4.2..6.2 z0..0.35 y1.50..1.95 | 0 | 3 black glass doors
ac_unit:           (3.38, 3.95) y2.52..2.85 | 90 | 1.0x0.24x0.30 black
chandelier:        canopy (5.3, 2.68, 10.35), hub y2.22, span 1.2, 8 globes, lowest 1.85
spots_highwall:    x3.65 y2.93 z{7.6,6.7,5.9,5.05}
tvstue_ring_lamp:  (1.63, 2.33, 10.25) 0.9x0.55
island_pendants:   x{4.86,5.41,5.96} z2.45 bottom y1.67 ; track 2.4
led_south:         x6.99 y2.40 z5.5..12.06 ; led_tvstue_north: x0.05 y2.40 z8.46..12.06
```
