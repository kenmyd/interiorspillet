# Survey group 5: kitchen, small-room door and AC, the high wall and the kitchen ceiling step

Photos: 20261018_082919, 082922, 082924, 082926, 082932, 082937, 082941. All are from the Galaxy S25 ultra-wide (EXIF: 2.2 mm, 13 mm equivalent, 4000×3000, distortion-corrected rectilinear).

Coordinates follow the task convention:
* metres
* +x = plan right (south, windows)
* +y = up
* +z = plan down (west, TV-stue)
* origin = top-left interior corner of the plan
* yaw = three.js rotation.y of the camera's view direction: 0 → +z, 90 → +x, 180 → −z, −90 → −x

## 0. Method and calibration

* **Plan scale.** `plantegning.png` is 587 × 802 px and measures **51.3 px/m**, not 50.5.
  * The outer width 7.22 m = px 83→453.
  * The inner width 6.92 m = px 91→446.
  * The outer length 12.21 m = px 44→671.
  * Interior origin: px (90.5, 51.5).
  * Plan wall faces used:
    * left/north wall x = 0
    * kitchen/bath partition x = 2.53–2.63
    * door/high wall x = 3.22 (px 255.5)
    * kitchen south wall x = 6.33 (px 415)
    * living south wall x = 6.92 (px 446)
    * step at z = 5.23 (px 320)
    * west wall z = 11.94 (px 664)
* **Camera model.** Pinhole with f = 1503 px (from the 13 mm equivalent) and the principal point at the image centre.
* **Pose solve.** I solved each photo's pose with a small Levenberg–Marquardt solver. Inputs were wall/floor junctions found by edge detection, ceiling junctions and door-frame corners.
* **Heights.** These are fixed only by the user's facts: kitchen ceiling 2.40, high-wall ceiling 3.00, floor 0.
* **z positions.** These are anchored to one plan value: the west end of the tall-cabinet run at z = 2.21–2.22.
  * Two photos confirmed this independently. The kitchen-ceiling/wall junction meets the tall cabinets at z = 2.22 in 082922, and the niche corner came out at 8.39 against the plan's 8.34.
* **Fit quality (residual RMS).**
  * 082924: 3.8 px, **high**
  * 082926: 2.6 px, **high**
  * 082922: 6–7 px, **med**
  * 082932: 3.7 px, **med**
  * 082941: 4.6 px, but with steep pitch, **med for nearby objects, unusable far away**
  * 082919: ill-conditioned (a wide depth range and a strong roll), **low**
* Colours sampled from the photos are badly white-balanced: warm LED pools versus blue daylight. The hex values below are corrected estimates, not raw samples.

## Per-photo camera table

| Photo | Camera (x, y, z) | Yaw / pitch / roll | Visible | Conf |
|---|---|---|---|---|
| 082919 | ≈(5.5–5.9, 1.75–2.0, 4.4–4.9) | ≈184° / −11° / −2…−3° | Kitchen from the dining side, looking east. Visible: the island with hob and 3 stools, the back counter, the glass wall cabinet, the tall cabinets, the ceiling step (triangular bulkhead face), the track with 3 pendants, 2 ring lamps, window A (K1), window B (K2) up close on the right, and the black door frame at the far left. | low–med |
| 082922 | (5.68, 1.64–1.84, 4.40) | −133° / −5…−8° / −2…−5° | Looking NE. Visible: the black door with the AC above it, the bulkhead corner, the tall cabinets, the back counter, the island with hob, the stools and the pendants. | med |
| 082924 | (5.61, 1.78, 4.64) | −85° / −4.0° / −1.8° | Looking north at the high wall, nearly face-on. Visible: 4 spots with light pools, the door, the AC, switches, sockets, the bulkhead corner, and the edge of the tall cabinets. | **high** |
| 082926 | (5.67, 1.74, 4.90) | −61° / −4.4° / −2.4° | Looking NNW along the high wall. Visible: the niche corner, the header over the TV-stue opening, the TV wall, the dining table, a boucle chair, the palm and the hydrangea vase. | **high** |
| 082932 | (3.67, 1.87, 2.99) | 169° / −12° / −1.3° | Between the tall cabinets and the island, looking east (slightly south). Visible: the back wall, base cabinets, sink, wall cabinet, dishwasher (open), window A, ring lamps, smoke detector, the LED strip and the island corner. | med |
| 082937 | ≈(4.9, 1.76, 1.3) | ≈−90° / ≈−13° | Looking north at the tall-cabinet run (fridge, appliance column, larder, tambour unit). Also visible: the door at the far left, the back counter running toward the camera, and a ring lamp overhead. | low–med (proportional analysis) |
| 082941 | (5.14, 1.69, 1.60) | +3° / −33° / −5° | Standing in the kitchen aisle above the island's cook side, looking west. Visible: the island top and hob, the vase, window A and window B, the pier, the step corner, the dining table and chandelier, the west wall with painting and sofa, the door wall with switches/sockets, and the pendants. | med (near) / low (far) |

Note on 082919–082926: these four photos are one pan taken from almost the same spot. Allowing about 0.35 m between the phone and the body's turning axis, the body was at ≈(5.95, 4.67), in front of window B.

---

## 1. Architecture

### 1.1 Wall x = 3.22 (north side of the living room, faces +x)

The segments, from the kitchen to the TV-stue (in z):

* **z 0 → 2.22: tall cabinets, set in the recess** between the bath partition (x ≈ 2.63) and x ≈ 3.30.
  * The cabinet fronts stand ≈ 0.05–0.08 proud of the wall face x = 3.22.
  * Evidence: the cabinet end panel is visible in 082932, 082922 and 082919. **med**
* **z 2.22 → 3.36: plain wall strip, 1.14 m.** SAND, white baseboard, nothing mounted on it. **high**
* **z 3.36 → 4.43: black door into the small room.**
  * The plan draws a window symbol here (z 3.31–4.30). **high**
  * See §2.
* **z 4.43 → 8.39: the HIGH WALL, 3.96 m wide × 3.00 m tall.**
  * Measured in 082926 (niche corner at 8.39) and 082924 (door anchor). This agrees with LES_MEG "ca. 390" and the plan's 3.91.
  * Use **3.93 ± 0.05**. **high**
* **z 8.39 → 11.94: TV-stue opening** under a header in the same plane.
  * The header's underside is at **2.33** (measured; the drawing says "nisjetak 235").
  * Above it a **0.67 m tall SAND face** runs from 2.33 up to the 3.00 ceiling and continues to the west wall. **high**
* **Wall thickness:**
  * Interior walls ≈ 0.10–0.12. Assumed, because the plan draws 5–6 px.
  * The plan draws exterior walls at 0.15 m, but the real walls are clearly thicker. The window frame sits ≈ 0.20 m behind the inner face (see §2), so use **≥ 0.30 m** for exterior walls. **med**

### 1.2 Kitchen (z 0 → 3.33)

* **Back/east wall z = 0.**
  * Runs from x 2.63 to 6.33.
  * Visible above the counter between the tambour corner unit (x 3.30) and the south wall (x 6.33).
* **South wall x = 6.33.**
  * Holds windows A and B.
  * Pier between them: z 3.05 → 3.70, ≈ 0.65 m.
  * After window B (z 4.90) a short pier runs to the **outside corner at z ≈ 5.15–5.4** (plan 5.23). There the wall steps out to x = 6.92 (the living room).
  * Window and base-cabinet positions agree with x = 6.33. The dishwasher plus end panel ends at 6.30–6.33. **med–high**
* **Flat kitchen ceiling: 2.40 m** (user fact). It covers x 2.63 → 6.33 and **z 0 → 3.33**.
* **Ceiling step (bulkhead):** a vertical face in the plane **z = 3.33**, facing west (+z).
  * The z value comes from the corner at z = 3.305 (082924) and 3.348 (082922). The edge runs parallel to x within ±5 cm.
  * The face runs from y 2.40 up to the sloped ceiling. That is **0.60 m tall at the high-wall end (x 3.22)**, tapering to ≈ 0.10 m at the kitchen south wall (x 6.33, where the slope is at ≈ 2.50).
  * It looks like a long thin triangle or trapezoid (082919, 082922).
  * Its bottom edge sits **5 cm east of the door frame's east edge**, and the AC unit's east end touches it. **high**
* **No beams, no columns.**

### 1.3 Living-room sloped ceiling (z 3.33 → 11.94, x 3.22 → 6.92)

* Height is **3.00 at x = 3.22** (high wall), sloping linearly to **2.40 at x = 6.92**.
  * Slope 0.162, i.e. 9.2°.
  * Ridge parallel to z.
* The fits are consistent with this. The 3.00 m junction line in 082926 and the 2.40 bulkhead corner in 082924 give the same door-frame height (2.166). The fitted ceiling at the high wall is 3.00–3.09. **high**
* The TV-stue nook ceiling is flat at 2.40 (user fact). Its underside meets the 2.33 header.

### 1.4 Paint zones

From my photos (relative brightness under the same light):

* **SAND (light):**
  * the high wall
  * the door-wall strip
  * the header over the TV-stue opening
  * all kitchen walls and the kitchen ceiling
  * the window piers on the south wall
  * the bulkhead face
* **MARRAKESH (darker grey-brown):**
  * the TV-stue walls and the TV-stue ceiling, seen through the opening in 082926
  * the west wall of the living area behind the sofa and palm (082926 left, 082941 far)
* Estimated render colours:
  * SAND ≈ **#d3cbbf** (light warm greige)
  * MARRAKESH ≈ **#9f9488** (warm grey-brown)
* Confidence: **med** for the zones, **low** for the hex values. Use the paint references if another group finds them.
* Reveals and window sills are **white** (#eeeeea), brighter than SAND. **med**

### 1.5 LED strips (all warm white ≈ 2700 K)

1. **Kitchen ceiling profile:** a recessed linear LED, ≈ 2 cm wide, in the 2.40 ceiling. It runs right in front of the tall-cabinet fronts at **x ≈ 3.35–3.40**, from **z ≈ 0.05 to 2.22** (the full run). Seen in 082932, 082937, 082919 and 082922. **high**
2. **Under the glass wall cabinet:** an LED washing the back wall (z = 0) between ≈ 1.45 m and the worktop. **high**
3. **Inside the glass wall cabinet:** a warm interior glow. **med**
4. **Living room:** a cove LED along the top of the south wall (x = 6.92). It starts at the step's outside corner (z ≈ 5.2–5.4) and runs west (082941, top centre). Height is at the 2.40 ceiling junction. Details belong to the groups covering that wall. **med**

* No LED on the bulkhead edge, the high wall or the TV-stue header.

---

## 2. Openings

### 2.1 Small-room door (wall x = 3.22, faces +x)

* **Architrave, outer:** z **3.36 → 4.43** (width **1.07**), top at **2.17**. **high** (082924 fit 3.8 px; 082922 and 082926 consistent)
* **Leaf: 0.93 × ≈ 2.04**, a 10M×21M door.
  * Fit: the visible leaf width 0.93 (z 3.43–4.36); the inner opening top 2.12.
* **Look:** matte **black** (#1d1e21) on both leaf and frame.
  * Architrave ≈ 6–9 cm wide.
  * Shaker-style leaf: one large recessed panel with a fine groove ≈ 10–12 cm in from the edges.
  * Light threshold strip under the leaf.
* **Hardware:** two round black rosettes (Ø ≈ 5 cm) on the **west side**.
  * The handle rosette is at **1.07–1.11** and the lock/key rosette at **1.03–1.04**, ≈ 0.07 m in from the leaf edge.
  * **No lever is fitted** in any photo.
  * Hinges are on the east side and are not visible from the living room.
  * So the door **opens into the small room (toward −x)**. **med**
* **Mounted beside it, on the high wall's east end** (all centred at **z ≈ 4.55**, 0.12 m west of the door frame):
  * a black glass rectangle **0.17 × 0.09** at centre height **1.62** (2-gang switch or thermostat panel)
  * a black square switch **0.09 × 0.09** at **1.20**
  * a black socket at **0.18** **high**
* **AC indoor unit (heat pump) above the door:**
  * matte black, ≈ **0.89 × 0.30 × 0.22**
  * spans z ≈ **3.34 → 4.23**; its east end is tight against the bulkhead
  * top ≈ 2.95–2.98, bottom ≈ 2.60–2.65
  * rounded lower front lip with a horizontal louvre, a small blue status LED at the east end, a small logo at the west end
  * **high** for position, **med** for size

### 2.2 Window A / K1 (kitchen, south wall x = 6.33, faces −x)

* **Reveal opening:** z **0.62 → 3.05** (≈ 2.43 wide).
  * The east jamb is right next to the back-counter end. The west jamb lines up with the island's west edge.
  * The plan's 0.63–3.03 is confirmed. **med**
* **Heights:**
  * reveal sill (white board) ≈ **0.95**, 4 cm above the island worktop that runs under it
  * frame bottom ≈ **1.00**
  * frame head ≈ **2.08**
  * reveal top ≈ **2.12**
  * This leaves ≈ 0.28 m of wall to the 2.40 ceiling. **med**
* **Frame:** black/anthracite (#26272b), slim (≈ 5–6 cm visible).
  * One large pane.
  * A small black item on the bottom rail at mid-width in 082932 is probably the handle of a top-hung sash. Group 4 also reports top-hung.
* **Reveal depth: ≈ 0.20 m** from the wall face to the frame. Measured in 082932 by projecting the jamb at depth 0.1–0.3 against the frame edge.
  * Reveal and sill are white. **med**
* The island's south end butts the wall under this window. The vase stands at its west end.

### 2.3 Window B / K2 (kitchen, south wall x = 6.33)

* **Reveal opening:** z **3.70 → 4.90** (1.20).
  * 082941: east reveal at 3.68, west frame edge at 4.91.
  * Plan: 3.73–4.90. **med**
* **Heights:** sill ≈ **1.00**, frame head ≈ **2.15–2.25**. That makes it about square: ≈ 1.15 × 1.15. **med–low**
* **Frame:** black, heavier profile (frame plus opening sash, ≈ 10–12 cm).
  * Handle on the bottom rail (082941).
  * Opening sash, probably top-hung.
* **Reveal:** ≈ 0.20 deep, white, with a white sill board. Two phones and pens lie on it (082919).
* **Pier with socket:** wall pier z 4.90 → ≈ 5.2, then the outside corner to x = 6.92. A black socket sits at floor level on the pier under or near window B (082941).

### 2.4 Living-room windows and terrace door

* Only seen in passing (082941, 082919 right edge) and covered by other groups.
* Narrow, tall black-framed windows on x = 6.92 with deep white reveals. Small plants and a black vase with greenery stand on the sills.

---

## 3. Floor

* **Material:** light grey-beige **oak-look planks** (laminate or engineered oak), matte, with fine grain.
  * One flooring continues through the kitchen, dining and living areas.
  * **Colour:** ≈ **#c4b8a8**, slightly cooler in daylight (#b9b3ab). **med**
* **Direction:** long axis **along z** (east–west, parallel to the window wall). Seams converge toward the back wall in 082932 and toward the dining area in 082941. **high**
* **Plank size:** width ≈ **0.20 m** (±0.04), length ≈ 1.8–2.2 m, staggered butt joints. **low**
* **Baseboard:** **0.08 m** tall (measured top at 0.081 in 082926), flat, square-edged, ≈ 12 mm thick, white or very light (#e9e6df). It runs on the high wall and the door-wall strip. **med–high**
* **Plinths:**
  * tall cabinets: black recessed plinth ≈ 0.07–0.10 with a black vent grille under the fridge
  * base cabinets: black plinth **0.13** tall, set back ≈ 0.08 from the fronts

---

## 4. Existing furniture and objects

### 4.1 Tall-cabinet run ("Stek/mikro/kaffe", "Kjøle/frys")

* **Run:** along x = 2.63 → 3.30 (fronts face +x, **rotationDeg 90**), z **0 → 2.22**, height from the floor to ≈ **2.39** (just under the 2.40 ceiling with the LED profile).
* **Fronts:** dark grey wood-grain melamine (graphite oak), ≈ **#56585b** with lighter grain #6e7074. Slim black bar handles ≈ 0.25 m long.
* **Columns,** from the back wall (z = 0) westward:
  * **Col 4, z 0 → 0.65 (corner unit, sits on the worktop):**
    * top cabinet door 1.86 → 2.39
    * below it, a recessed **appliance garage with a black roller tambour** (rullejalusi) from 1.86 down to the worktop (0.91)
    * the back counter's worktop runs into it
  * **Col 3, z 0.65 → ≈ 0.97 (narrow larder, ≈ 0.30–0.35 wide):**
    * upper door 0.77 → 2.39 with its handle at the bottom
    * lower door 0.07 → 0.77 with its handle at the top
  * **Col 2, z ≈ 0.97 → 1.57 (appliance column, 0.60), top to bottom:**
    * top door 1.83–2.39
    * **compact combi oven/microwave**, black glass, 0.45 tall, 1.39–1.83
    * **built-in espresso machine**, black glass with a centre spout, 0.45 tall, 0.91–1.39
    * **oven**, black glass with a control strip at the top, 0.29–0.91
    * **drawer** 0.07–0.29 with a bar handle
    * All black-glass, Siemens-style.
  * **Col 1, z ≈ 1.57 → 2.17 (integrated fridge/freezer, 0.60):**
    * tall upper door 0.77 → 2.39
    * lower door 0.07 → 0.77
    * handles at the split
    * a black slotted vent grille (≈ 0.4 × 0.03) at the very top
  * **End panel** 2.17 → 2.22.
* Confidence: **med** for widths and heights (proportional analysis in 082937 with perspective correction), **high** for the order.

### 4.2 Back counter (east wall)

* **Run:** x **3.30 → 6.33**, z **0 → 0.62**, worktop top **0.91** (assumed standard; fits within ±2 cm). Fronts face +z (**rotationDeg 0**).
* **Base units,** measured 0.60 each in 082932:
  * x 3.30–3.90: door/drawers
  * 3.90–4.50: two drawers
  * 4.50–5.10: two drawers
  * 5.10–5.70: sink unit
  * **integrated dishwasher 5.70–6.30**, panel matches the fronts
  * end panel 6.30–6.33
* **Fronts:** matte anthracite **#2a2b2d**, handleless, with a horizontal grip channel at **≈ 0.51**.
  * Fronts run 0.13 → 0.87; plinth 0 → 0.13.
  * Drawer split: top drawer 0.51–0.87, deep drawer 0.13–0.51. **med–high**
* **Worktop:** **dark stone-look slab** (ceramic or compact laminate), ≈ 20 mm thick, satin.
  * Base colour **#3b3633** (black-brown/graphite) with fine white-grey veining **#b5b0aa** running diagonally.
  * The same material is used on the island and its waterfall end. **high**
* **Sink:** black composite single bowl ≈ 0.50 × 0.40, set into the worktop at x ≈ 5.15–5.65, z ≈ 0.1–0.5.
  * Matte black tall J-spout single-lever tap at **x ≈ 5.40, z ≈ 0.10**, height ≈ 0.35 above the worktop. **med**
* **On the counter:**
  * black cylindrical knife block with 3 knives, Ø 0.12, h 0.25, at x ≈ 3.40, z ≈ 0.20
  * small potted plant (white pot Ø 0.12, green foliage ≈ 0.18) at x ≈ 6.20, z ≈ 0.15
  * a green dish cloth on the sink
* **Back-wall sockets:** black double frames
  * x ≈ 3.60, y ≈ 1.12
  * x ≈ 6.22, y ≈ 1.13, behind the plant
* **Glass wall cabinet:** 3 doors, **black aluminium frames with smoked grey glass**, lit inside (wine glasses and bowls).
  * x ≈ **4.10 → 6.10** (≈ 2.0 wide), on the wall z 0 → 0.35, **bottom ≈ 1.45, top ≈ 1.87** (0.42 tall).
  * About 0.23 m short of the south corner. 082919 and 082922 show it ending ≈ 0.4 m before the corner, 082932 nearer.
  * Under-cabinet LED. **med**

### 4.3 Island ("Planetopp")

* **Footprint:** x **4.40 → 6.33**, z **1.93 → 3.00**, so **1.93 × 1.07 m**, top at **0.91**. **med**
  * Long axis along x. The south end butts the wall under window A.
  * The plan's 2.03 × 1.26 at z 1.79–3.05 is a little too big.
  * Scale was checked against the Siemens 80 cm venting hob (816 × 527) in 082941.
* **Ends:**
  * North end (x = 4.40): **waterfall** in the worktop slab, full depth down to the floor.
  * South end: against the wall.
* **Cook side (east face, z = 1.93):** 3 columns of handleless anthracite drawers, ≈ 0.50 | 0.90 | 0.50 wide. Two rows: top drawer about 0.50–0.88, deep drawer 0.10–0.50, with grip channels.
* **Seating side (west):** ≈ 0.3 m worktop overhang over a recessed dark back panel; 3 stools under it. **low–med**
* **Hob:** **Siemens induction with central downdraft extractor** (venting hob), black glass, **0.816 × 0.527**.
  * Centred at **x ≈ 5.35**; z from ≈ 1.98 (5 cm from the east edge) to ≈ 2.51.
  * 4 zones in 2 flex pairs, a stainless/black centre extractor grille, controls at the front.
* **Decor near the window end:**
  * **cream ribbed ("wavy") ceramic vase**, h ≈ 0.30, Ø ≈ 0.14, #ece4d6
  * in it, **faux pampas grass** ≈ 0.7 m tall, pinkish beige #e3d8cc
  * a **round woven seagrass placemat** Ø ≈ 0.35, #b89a70, under the vase
  * centred ≈ (6.10, 0.91, 2.85) **med**

### 4.4 Bar stools (3)

* **Placement:**
  * at z ≈ **3.30** (seat centres), x ≈ **4.65, 5.25, 5.85**, ≈ 0.6 m apart
  * from the feet positions in 082922 and 082919; group 4 has 4.9/5.45/6.0, so use ±0.2
  * face −z toward the island, **rotationDeg 180**
* **Design:** counter-height stool.
  * Seat ≈ **0.65** high, ≈ 0.45 × 0.48.
  * Back top ≈ **0.98**.
  * One-piece upholstered shell: a rounded rectangular back flaring slightly at the top, with a vertical stitched seam at the back centre and horizontal quilted channels inside the back.
  * Fabric: **sage/olive-green woven melange** (#7e8a72, shadow #3a3f38).
  * Thin **black metal** 4-leg frame with a footrest bar. **med**

### 4.5 Other items in view (handled in detail by other groups)

* **Dining table** (082926, 082941): **oval** top in dark smoked or dark-stained oak, #3d332e.
  * Size ≈ 1.8–2.0 × 1.0, h 0.75.
  * Two black metal A-shaped trestle legs.
  * Around (5.4, 6.5), long axis along x. **low**
* **Dining chairs:** 6 (2 per long side, 1 per end). Light grey-beige textured upholstery, #cfccc5. Rounded tub backs, slim black metal legs. **med** for count, **low** for positions.
* **Lounge chairs** (082926 foreground left): light grey-cream **boucle** with a curved, rounded back, #d7d3cc.
* **Sofa and plant at the west wall:** light grey boucle curved sofa with a **sage-green throw**. A **palm** (areca/kentia, ≈ 1.6 m) in a white round pot Ø 0.35 near the TV-stue corner.
* **At the niche corner (x ≈ 3.30, z ≈ 8.35):** tall ribbed grey-beige vase (h ≈ 0.55) with faux **blue hydrangeas**.
* **TV-stue (through the opening):**
  * a large black wall-mounted TV (≈ 75–77") on the west wall
  * a white in-wall speaker grille left of it
  * a small white device below it
  * a black low TV bench
  * a grey concrete-look cube (side table or pouf, ≈ 0.45)
  * a grey rug with a dark round motif
* **West wall above the sofa:** a framed abstract landscape painting (misty birches, beige/grey/white).
* **Living windows:** small plants and a black vase with greenery on the sills.

---

## 5. Lighting

| Fixture | Type | Position (x, y, z) | Size / colour | Conf |
|---|---|---|---|---|
| 4 high-wall spots | Black adjustable cylinder spots (semi-recessed/surface), ≈ Ø 0.06 × 0.15, tilted ≈ 30° toward the high wall. Warm light pools on the wall centred at y ≈ 2.3–2.5. | Ceiling (y ≈ 2.94) at **x ≈ 3.55**, z ≈ **7.97, 6.89, 5.99, 5.10**. That is 0.42 / 1.50 / 2.40 / 3.29 m from the niche corner, spacing ≈ 0.9–1.0. | Black #151515, 2700 K | med–high (two solves agree within ±0.1). LES_MEG drawing 08 (90/190/290/385) is about 0.4 m off. |
| Kitchen track | Black surface 3-phase track on the 2.40 ceiling, running along x over the island | z ≈ **2.64**, x ≈ 4.70 → 5.95 (≈ 1.25 long) | Black | med |
| 3 pendants on the track | Matte black cylinders Ø ≈ 0.08, L ≈ 0.26, on black cords, downlight | x ≈ **4.88, 5.34, 5.79** at z 2.64. Bottoms at **≈ 1.70–1.75** (≈ 0.8 above the worktop). | Black, warm | med |
| 2 ring ceiling lamps | Semi-flush: a round canopy Ø ≈ 0.10 with an angled arm holding a **horizontal LED ring Ø ≈ 0.40** ≈ 0.15 below the ceiling, lit on the underside | Canopies at (≈ 4.06, 2.40, ≈ 1.45) and (≈ 5.52, 2.40, ≈ 1.6), over the aisle between the counter and the island | Dark bronze/black, warm | med (x), low (z ±0.2) |
| Smoke detector | Black flat disc Ø ≈ 0.13 | (≈ 3.66, 2.40, ≈ 1.3) | Black | med |
| Kitchen LED profile | See §1.5 | x 3.35–3.40, z 0.05–2.22, in the 2.40 ceiling | Warm | high |
| Wall-cabinet LED | Under-cabinet strip plus interior light | x 4.10–6.10, y ≈ 1.45 | Warm | high |
| Dining chandelier (082941, 082926) | Black "molecule/branch" chandelier: a centre stem with ≈ 7–9 arms ending in small black dome shades with exposed warm bulbs, total Ø ≈ 0.7–0.8 | Over the dining table, shades at ≈ 1.6–1.9 m (other groups) | Black, warm | low |
| Living south-wall cove LED | Linear LED at the ceiling junction | x = 6.92, from z ≈ 5.3 westward | Warm | med |

* No floor lamps or table lamps are in my photos.
* One warm wall light or lamp glows at the far left of 082926 (west wall). That belongs to the sitting-area groups.

---

## 6. Outside views

* **Window A (kitchen, 082932, 082919, 082941):**
  * Very close (≈ 2–4 m) is a **dark grey-brown stained vertical-board clad building wall** (boards ≈ 0.12 m, dark joints, #4a4642) with a lean-to roof edge. This is the annex or neighbour that closes the terrace's east end.
  * Below it, a **light-grey woven (rattan-look) outdoor lounge chair** and a white curved pole or handle.
  * Through the window's west part (082941): **deciduous trees in autumn colours** and a **light-grey horizontal-slat terrace railing**.
* **Window B (082919):**
  * Lower part: a grey terrace or flat surface with a **pale blue-green glass panel**, likely a glass railing or skylight seen from above, plus a grey step or edge.
  * Middle: the same **grey vertical-board wall** with a dark roof fascia.
  * Right: **horizontal wood slats** of a fence or railing, and a **red** building element beyond.
  * Top: a **wooded hillside**, green-yellow autumn foliage, and sky.
  * Group 4 reports the deck railing right in front and the river and red boathouses beyond.
* **Reflections** in the compact-oven glass (082937) show the view behind the photographer through the big south windows: **white and red houses on a green hillside** across the river.
* My photos do not show the terrace door or the terrace geometry outside it.

---

## 7. Discrepancies with the floor plan

1. **Small-room door.** The plan draws a *window* symbol in wall x = 3.22 at z 3.31–4.30. It is a black **10M×21M door** at z 3.36–4.43 that opens into the small room.
2. **Ceiling step not drawn.** The kitchen has a flat 2.40 ceiling over z 0–3.33. The bulkhead face is at z = 3.33 (0.60 m tall at the high wall, tapering to ≈ 0.10 at x = 6.33). Neither is in the plan. The **AC unit** above the door is also missing.
3. **High wall** z 4.43 → 8.39 = **3.96 m** (plan 3.91, LES_MEG ≈ 3.90). The niche corner is at 8.39 (plan 8.34). The TV-stue header underside is at 2.33.
4. **Island.** It is ≈ **1.93 × 1.07** at x 4.40–6.33, z 1.93–3.00 (plan 2.03 × 1.26 at z 1.79–3.05). It has a north waterfall, seating on the west side and a hob with downdraft.
5. **Tall cabinets.** The front is at x ≈ 3.30 (plan grey area to 3.34). The order is corner tambour unit, larder, appliance column, fridge/freezer, running from z = 0 to 2.22. Matches the plan within 5 cm.
6. **Exterior walls.** The plan uses 0.15 m. Window reveals are ≈ 0.20 deep, so the walls are ≥ 0.30.
7. **Dining.** The plan has a round table with 4 chairs. The photos show an oval table with 6 chairs and a black chandelier.
8. **Spot positions** differ from LES_MEG drawing 08 by ≈ 0.4 m. Use the values in §5.
9. **Window A** at z 0.62–3.05 and **window B** at 3.70–4.90 match the plan well. Group 4 has window A starting at 0.85; my 082932 jamb fit gives 0.62.

---

## 8. Quick build summary (machine-friendly)

```json
{
  "wall_x322": {"x": 3.22, "segments": [
    {"z": [0, 2.22], "what": "tall-cabinet recess (fronts at x 3.30)"},
    {"z": [2.22, 3.36], "what": "SAND wall strip"},
    {"z": [3.36, 4.43], "what": "black door 10x21, leaf 0.93x2.04, architrave top 2.17, opens to -x, handle on west side"},
    {"z": [4.43, 8.39], "what": "HIGH WALL 3.96 x 3.00 SAND"},
    {"z": [8.39, 11.94], "what": "TV-stue opening, header underside 2.33, SAND header to 3.00"}]},
  "kitchenCeiling": {"y": 2.40, "x": [2.63, 6.33], "z": [0, 3.33]},
  "bulkhead": {"z": 3.33, "faces": "+z", "yBottom": 2.40, "yTop": "sloped ceiling (3.00 at x3.22 -> ~2.50 at x6.33)"},
  "slopedCeiling": {"y_at_x322": 3.00, "y_at_x692": 2.40},
  "ac": {"center": [3.33, 2.80, 3.79], "size_wdh": [0.89, 0.22, 0.30], "color": "#111214"},
  "switches": [{"z": 4.55, "y": 1.62, "w": 0.17, "h": 0.09}, {"z": 4.55, "y": 1.20, "w": 0.09, "h": 0.09}],
  "sockets_x322": [{"z": 4.55, "y": 0.18}, {"z": 7.24, "y": 0.17}],
  "highWallSpots": {"x": 3.55, "y": 2.94, "z": [7.97, 6.89, 5.99, 5.10]},
  "windowA": {"wall": "x=6.33", "z": [0.62, 3.05], "sill": 0.95, "frameBottom": 1.00, "head": 2.10, "reveal": 0.20, "frame": "#26272b"},
  "windowB": {"wall": "x=6.33", "z": [3.70, 4.90], "sill": 1.00, "head": 2.20, "reveal": 0.20, "sash": "opening, handle bottom rail"},
  "tallCabinets": {"x": [2.63, 3.30], "z": [0, 2.22], "h": 2.39, "rotationDeg": 90, "front": "#56585b",
     "columns_from_z0": [["tambour corner unit over worktop", 0.65], ["larder", 0.32], ["appliances: compact 1.39-1.83, coffee 0.91-1.39, oven 0.29-0.91, drawer", 0.60], ["fridge/freezer split 0.77", 0.60]]},
  "backCounter": {"x": [3.30, 6.33], "z": [0, 0.62], "top": 0.91, "rotationDeg": 0, "front": "#2a2b2d", "worktop": "#3b3633 veined",
     "units": [[3.30,3.90],[3.90,4.50],[4.50,5.10],[5.10,5.70,"sink"],[5.70,6.30,"dishwasher"]], "tap": [5.40, 0.10]},
  "wallCabinet": {"x": [4.10, 6.10], "z": [0, 0.35], "y": [1.45, 1.87], "doors": 3, "frame": "black", "glass": "smoked grey"},
  "island": {"x": [4.40, 6.33], "z": [1.93, 3.00], "top": 0.91, "waterfall": "north end x=4.40", "hob": {"center": [5.35, 2.25], "size": [0.816, 0.527]}},
  "stools": {"z": 3.30, "x": [4.65, 5.25, 5.85], "rotationDeg": 180, "seat": 0.65, "back": 0.98, "fabric": "#7e8a72"},
  "track": {"z": 2.64, "x": [4.70, 5.95], "y": 2.40, "pendants_x": [4.88, 5.34, 5.79], "pendantBottom": 1.72},
  "ringLamps": [[4.06, 1.45], [5.52, 1.60]],
  "ledProfileKitchen": {"x": 3.37, "z": [0.05, 2.22], "y": 2.40},
  "floor": {"color": "#c4b8a8", "plankWidth": 0.20, "direction": "z"},
  "baseboard": {"h": 0.08, "color": "#e9e6df"},
  "paint": {"SAND": "#d3cbbf", "MARRAKESH": "#9f9488"}
}
```
