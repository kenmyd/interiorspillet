# Survey group 2 – sitting area, south window wall, dining zone (+ TV-stue north window)

Photos covered: `20261018_082800`, `082806`, `082809`, `082815`, `082819`, `082823`, `082827`. All are Galaxy S25 ultra-wide shots (EXIF: 13 mm equiv., 4000×3000).
Calibration sources: `plantegning.png`, `5_Tegninger/08_*` and `09_*`, `LES_MEG.txt`, and group 1's nook numbers for cross-checks.

Coordinate system as specified: metres, +x = south (windows), +z = west (TV-stue), +y = up. Origin is the floor at the inner face of the north and east outer walls. `rotationDeg` is three.js rotation.y; 0 means the front faces +z, 90 means +x/south, 180 means −z/east, −90 means −x/north.

Confidence tags: **high** / **med** / **low**.

---

## 0. Method

* **Plan scale is 51.3–51.4 px/m**, which agrees with group 1. Interior x = (px − 91)/51.3 and z = (py − 50)/51.4. The key plan coordinates I re-derived from 3×/5× zooms of the plan are:
  * high wall face x = 3.20–3.21;
  * niche corner z = 8.33–8.35;
  * kitchen south wall x = 6.30, so the jog at z = 5.38 is 0.61 m deep;
  * terrace door z 5.51–6.42;
  * W1 z 6.62–9.00, pier z 9.00–9.18, W2 z 9.18–11.62, then wall to z 11.91;
  * hall/door opening in the high-wall line at z 3.31–4.32.
* **Camera solves:** I used a pinhole model with roll and a radial term, fitted by Nelder–Mead (node script) to known lines and corners. These were the south-wall top and floor lines, the SW corner, the west-wall baseboard, the bulkhead edge (x 3.21, y 2.40), the bulkhead/west-wall point, the niche corner, the high-wall baseboard and the north window corners.
  * The fitted focal length is **f ≈ 1600 px at 4000 px width** (≈ 800 px at 2000 px), not the nominal 1503 for 13 mm. That agrees with group 1's 810–875. Camera roll is 2.6–3.3° in three photos.
  * Fit rms: 082806 = 10 px, 082809 = 17 px, 082827 = 21 px, 082800 = 33 px.
  * Objects were then measured by intersecting pixel rays with known planes (floor, table-top heights, wall planes).
* **Validation of the 082806 pose** (no part of these was used in the fit):
  * W1/W2 edges taken from the plan reproject within 8–37 px of the observed frame edges, so the plan's south-wall opening layout is right to about ±5 cm.
  * The TV +x edge comes out at x 2.50, bottom 0.62, top 1.56. Group 1 has edge 2.58, 0.56–1.55.
  * The in-wall speaker comes out at x 2.61–2.76, y 0.84–1.24. Group 1 has x ≈ 2.64–2.84, y 0.86–1.25.
  * The TV-stue rug's west edge comes out at z 10.66–10.68 and its +x edge at x 3.04. Group 1 has 10.68 and 3.07.
* **Validation of the 082827 pose:**
  * The niche-side switch comes out at (3.12, 1.21, 8.33); group 1 has (3.13, 1.22).
  * The high-wall socket is 1.11 m from the niche corner at y 0.17; the old drawing 08 has 111 cm / 18 cm.
  * The door-frame edge comes out at z 4.44, so **the high wall is 3.89 m long**, which matches "ca. 390".
* **Typical error:**
  * ±5–10 cm for things near the image centre on known planes;
  * ±15–30 cm for floor objects;
  * ±0.3–0.5 m for anything near the horizon in the steep-down shot 082827. This is why its kitchen numbers are omitted.
* **Colours:** these morning photos are under-exposed and white balance shifts between them, so daylight surfaces turn bluish. The hex values below are suggested render albedos, corrected by eye; raw samples are given where useful. For paint, use the Jotun references already in `research/palette.json`: **SAND = Jotun 1140, #cfc5b4** and **MARRAKESH = Jotun 1623, #aea191**.

---

## 1. Camera position per photo

Yaw uses the rotationDeg convention (for a three.js camera, rotation.y = yaw + 180°). Pitch is negative when looking down.

| Photo | Camera (x, y, z) | Yaw / pitch | Walls and zones visible | Conf. |
|---|---|---|---|---|
| 082800 | (1.18, 1.81, 9.51) | −69° / ≈0° | Close-up of the TV-stue north wall with the clerestory window. LED strip along the top of the north wall, Marrakesh nook ceiling, NW corner at the left. Bottom: chaise back cushions and a faux anthurium (bottom-left). | med-low (rms 33) |
| 082806 | (1.18, 1.72, 10.03) | +78° / −17° (roll 2.9°) | From the TV-stue looking south: the whole south wall (terrace door, W1, pier, W2), the SW corner, the west wall (TV, speaker, palm, painting, curved sofa). Sitting group, dining table, pendant. Bulkhead edge and both ceilings. L-sofa, coffee table and rug in the foreground. | **high** (rms 10) |
| 082809 | (1.40, 1.76, 10.75) | +138° / −12° | From the TV-stue looking south-east: the shelf wall, the niche corner with switch, the bulkhead edge starting at the corner, the nook ceiling lamp and smoke detector. Kitchen window and jog, terrace door, W1, W2, pendant, sitting group, dining table with 6 chairs. | med (rms 17) |
| 082815 | ≈(5.35, 1.5, 11.0) | ≈0° / ≈0° | Front-on close-up of the painting above the curved sofa. Sofa back at the bottom, palm fronds at the right. | low (by eye) |
| 082819 | ≈(5.0, 1.65, 9.2) | ≈+15° / ≈−25° | West wall: curved sofa, painting, palm, plant stand. W2's west end and the LED strip end. The sloped-ceiling/west-wall junction. Nesting tables and pebble rug in the foreground; black socket by the palm. | low |
| 082823 | ≈(6.2, 1.55, 10.6) | ≈+45° / ≈−45° | Looking down into the SW corner: W2's west jamb, reveal and sill with tealights, plant stand, sofa end, corner of the painting, rug, nesting-table edge. Outside: boulder and slate steps. | low |
| 082827 | (5.93, 1.57, 10.78) | −147° / −42° (roll 3.3°) | Standing at the front of the curved sofa, looking ENE and steeply down. TV-stue (L-sofa, coffee table, rug, shelf), niche corner, the whole high wall with sockets and switches, black door, kitchen (tall units, back run, glass wall cabinets, island with 3 green stools), dining table and chairs, W1/W2 sills and sockets, nesting tables, swivel chairs. | med (rms 21) |

---

## 2. Architecture

### 2.1 Walls in my photos

| Wall | Geometry | Paint | Conf. |
|---|---|---|---|
| South window wall | Inner face x = 6.91, from the jog z 5.38 to the SW corner z 11.91 (6.53 m; plan says 6.54). Height 2.40 along its whole length. | SAND | high |
| Jog face | z = 5.38, x 6.30→6.91 (0.61 m), facing +z. The LED strip starts at its outer corner (6.91, 2.40, 5.38): solve residual 6 px. | SAND | med |
| Kitchen south wall | x = 6.30 for z < 5.38. Seen only as a sliver with the narrow window in 082809. | SAND | med |
| High wall | Plane x = 3.21. Runs from the niche corner (3.21, 8.33) to the black door frame at z = 4.44, so **3.89 m** long and 3.00 m high. | SAND (very light in 082827, #d6d4c4–#ecefe4 raw) | high (length from the 082827 ray hit, matches 390 cm) |
| Niche corner | Plain 90° outside corner. The paint changes exactly at the corner: Marrakesh on the TV-stue face (z 8.33), Sand on the high wall. | – | high (with group 1) |
| West wall, living part | z = 11.91, x 3.21–6.91. Carries the painting, palm, sofa and a socket. | see below | med (geometry); low (colour) |

**West wall colour in the living part:**
* In 082819 and 082823 this wall reads clearly grey-brown/taupe (raw #a3998f–#b1ada6 in daylight), darker than the white reveals and than the window wall. In 082806 there is no colour edge at x = 3.21, which matches group 1.
* So the west wall is **probably MARRAKESH along its whole length** (TV-stue and living part). **low-med**. This is a one-word question to the user.

**Wall thickness:**
* South-wall window reveals are ≈0.20 m deep from the interior face to the frame face. The sill board in 082823 is about twice the Ø ≈ 8 cm tealight holders. The outer wall itself is therefore ≥0.30 m. **med**
* The partitions are as in the plan: high wall 0.10, bedroom wall 0.14.

**Piers (columns between openings):** both are plain wall piers with white reveals on both sides, full height to the window head. They are not free-standing columns. **med**
* door/W1: z 6.42–6.62 (0.20 m);
* W1/W2: z 9.00–9.18 (0.18 m).

### 2.2 Ceilings and height changes

* **TV-stue (nook):** flat at 2.40, Marrakesh. The 082806 solve fits with the nook ceiling edge at exactly x = 3.21, y = 2.40: line residuals 2–3 px and point residual 3 px at (3.21, 2.40, 11.91). **high**
* **Bulkhead:** a vertical face in the plane x = 3.21 from y 2.40 to 3.00, z 8.33–11.91. Its lower edge starts exactly at the top of the niche corner (082809) and runs straight to the west wall (082806). It has no LED or trim. Colour: Sand (per group 1, who see its face). **high**
* **Living/dining ceiling:** one plane sloping along x from 3.00 at x = 3.21 to 2.40 at x = 6.91, i.e. **0.162 m/m (9.2°)**, constant along z.
  * The sloped-ceiling/west-wall junction (6.91, 2.40, 11.91)→(3.21, 3.00, 11.91) fits the 082806 image with a 6 px residual.
  * In 082819 and 082806 it is one straight line, with no beams, ridge or second slope.
  * The plane reaches the jog (the LED start).
  * Formula: `y_ceiling(x) = 3.00 − 0.162·(x − 3.21)` for 3.21 ≤ x ≤ 6.91.
  * **med-high**
* **Over the sitting group** the ceiling is 2.63 m at the pendant (x 5.49). **med**
* **Kitchen ceiling:** flat 2.40 (user). Where it meets the slope, south of z ≈ 4.4–5.4, is not visible in my photos; see the kitchen groups.

### 2.3 LED strips

* **South wall:** a continuous warm-white (≈2700 K) recessed linear profile in the ceiling, tight against the wall, at (x ≈ 6.89, y 2.40), **z 5.38–11.91**, the full wall length.
  * It washes the 0.33 m wall band above the window heads with a golden glow.
  * The visible profile is ≈2 cm wide; glow colour ≈ #ffc98a.
  * **high**
* **TV-stue north wall:** the same kind of profile along x ≈ 0.02, y 2.40, from the NW corner eastward (082800). This agrees with group 1 (z 8.40–11.85). **high**
* **No LED** on the west-wall/slope junction, on the high wall or on the bulkhead (082806, 082809, 082819). **high**

### 2.4 Niches and recesses

* The "nisje" is the TV-stue itself (x 0–3.21, z 8.33–11.91).
* There are no other recesses on the south or west walls. The window reveals are the only setbacks.

---

## 3. Openings

All south-wall openings share a head height of **≈2.05 m**: the fits give 2.05 (W2), 2.07 (W1), 2.02–2.03 (door) and 2.05 (kitchen window). That leaves a **0.33–0.35 m** wall band up to the 2.40 ceiling. **med-high**

### 3.1 Terrace door (D1), south wall

| Property | Value | Conf. |
|---|---|---|
| Position | x = 6.91, opening z 5.51–6.42 (plan). The photo gives frame inner edges at z 5.56–6.31 at the head (082809). Its −z jamb is 0.13 m from the jog corner. | med |
| Size | ≈0.90 × 2.03 m | med |
| Door | Black/anthracite aluminium-clad frame (#232425), fully glazed single leaf, threshold at floor level | med |
| Swing | The plan draws it **outward-opening, hinge at the +z (west) jamb**, so the handle is on the −z side. Handle not visible in my photos. | low |
| Reveal | White, ≈0.20 deep, as for the windows | low |

### 3.2 W1 – big south window (east)

| Property | Value | Conf. |
|---|---|---|
| Position | x = 6.91, z 6.62–9.00. That is 1.24 m from the jog corner, with a 0.20 pier to the door. Photo ratios at head height give 2.40 wide, the same as the plan. | high |
| Height | Frame/glass bottom ≈0.30 (fits 0.26–0.43; best 0.30), head 2.06. Glass ≈2.35 × 1.70. | med |
| Glazing | One large fixed pane, no mullions, no sashes or handles visible | med |
| Frame | Black/anthracite (#232425), slim, ≈5–6 cm visible face | med |
| Reveal | ≈0.20 deep, white (#ecebe6; raw #e1e7e5–#e8edf0 in daylight), square edges | med |
| Sill | Flat white sill board, flush with the reveal (≈0.20–0.22 deep), top ≈0.28–0.30 above the floor. Used as a display shelf. | med |
| Sill décor | Ribbed clear glass cylinder vase (Ø0.10, h0.20) at z ≈ 7.0, and a dark grey textured stoneware vase (h0.25) with faux eucalyptus (to ≈0.55) at z ≈ 8.3 (082827) | low |

### 3.3 W2 – big south window (west)

| Property | Value | Conf. |
|---|---|---|
| Position | x = 6.91, z 9.18–11.62. The 0.29 m pier to the SW corner (z 11.91) is confirmed; photo ratios give 0.3–0.39. | high |
| Size and build | Same heights and build as W1. Width 2.44 (plan); photo ratio 2.29–2.40. Use 2.40. | med |
| Sill décor | Small succulent in a black pot (z ≈ 9.9) and two sage-green glass tealight holders (Ø0.08) near the west end (z ≈ 11.2–11.45) | low |

**Sockets:** black double sockets sit at ≈0.2 m in the low wall band under the sills, at least one on the door/W1 pier and one around the W1/W2 pier (082827). **low**

### 3.4 Kitchen window, glimpsed in 082809

* On the kitchen south wall x = 6.30, near z ≈ 4.3–5.2: sill ≈0.92 (worktop height), head ≈2.05.
* Black frame. Outside is a dark grey vertical-board wood wall.
* **low**. The kitchen groups should refine it.

### 3.5 Black door at the high wall's −z end

* Opening in the x = 3.21 line. The plan has z 3.31–4.32, drawn as a double line, not a swing. The frame's +z edge is at **z 4.44** in the photo.
* Leaf and frame are both matt black (#1d1d1d). The frame is ≈8–10 cm wide. Height ≈2.05–2.1.
* Swing and handle side cannot be seen; it may be a sliding door, given the plan symbol. **low**
* Next to it on the high wall (082827 ray hits):
  * two black switch plates at z ≈ 4.54, y ≈ 1.08 and ≈1.49 (centres);
  * a black socket at z ≈ 4.59, y ≈ 0.15.
  * **med**

### 3.6 North clerestory window (TV-stue), close-up 082800

The geometry is group 1's: x = 0, z 9.24–10.97, sill 1.65, head 2.13. My photo agrees as follows:
* Rectangle-from-perspective gives a reveal-opening aspect of **3.8 : 1**, i.e. 1.73 × 0.46. **med**
* Black frame. On the left (west) stile there is an inner sash bead with screw holes, so it may be an opening top-hung or side-hung sash; I can't tell.
* Deep light reveal ≈0.20–0.25, with the flat sill used as a shelf.
* Sill décor, left to right: magazine stack, clear bubble vase, white and blush mini vases with faux eucalyptus, grey woven rope basket.

---

## 4. Floor and baseboards

* **Material:** matt light oak-look planks with a grey-white wash (greige). **Planks run along z (east–west)**, parallel to the south wall:
  * 082806: the seams run into the west-wall baseboard;
  * 082827: long seams run parallel to the south-wall baseboard, with short end joints across them.
  * **high**
* **Plank width:** ≈**0.21–0.24 m**. In 082806, 4 seam spacings computed on the floor plane give 0.18–0.24 (mean 0.21); group 1 gets 0.24. Use **0.22**. **med**
* **Plank length:** long, ≥1.8 m. One end joint is visible near the south wall in 082827. Use 2.2 m with staggered joints. **low**
* **Colour:** daylight samples are #a4938b / #93898b / #8e8689, and darker in the TV-stue. Use **#a59c93** with ±6 % grain (same as group 1); seams slightly darker, #8c8178. **med**
* **Baseboard:** white #ecebe6, ≈6–7 cm high, square profile, on every wall in my photos (south, west, high wall, TV-stue). **med-high**
* No thresholds or floor changes inside the open area.

---

## 5. Existing furniture and objects

Positions are centres (x, z) unless stated. "w × d × h" means w along the object's local x and d along its local z (the front direction).

### 5.1 Curved sofa (sitting group) – «buet sofa»

| Property | Value | Conf. |
|---|---|---|
| Centre | **(5.55, 11.35)**, back ≈0.05 off the west wall | med |
| rotationDeg | **180** (front faces east/−z, toward the swivel chairs) | high |
| Size | **2.00 × 1.00 × 0.75** | med |
| Measured points (082806) | Front of the seat base at z 10.82–10.87 (x 4.9–5.4); −x end bottom at x 4.60 | – |
| Seat height | 0.43–0.45 | med |

**Shape (procedural):**
* An organic, rounded one-piece seat "pillow" on a slightly smaller rounded plinth base. No visible legs; the base has a recessed shadow gap of ≈3 cm.
* One continuous, thick (≈0.22) rounded backrest.
  * It is highest (≈0.78) at the **+x/window end**, where it curls forward around the end to form a rounded wing-arm.
  * It slopes gently down toward the −x end.
* At the **−x end** (palm side) there is no back wrap, only a low cylindrical bolster arm (Ø ≈0.22, top ≈0.58).
* The front edge of the seat is softly convex in plan view; the seat cushion is integrated, not loose.

**Fabric:** chunky bouclé in warm light grey, **#b3ada6**. Raw samples are #9ea6b9 to #a8a29c (blue cast in daylight).

**Throw:** a sage-green woven wool throw with fringe, **#a7b89c**, draped over the −x bolster arm and down the seat (082819). **high** (presence)

### 5.2 Swivel armchairs ×2 – «svingstoler»

* **Positions** (082806/082827 ray hits on the base fronts plus a 0.3 m radius; plan agrees within 0.2):
  * A: **(4.95, 8.75)**
  * B: **(6.30, 8.70)**, ≈0.25 m from W1/W2.
  * **med**
* **rotationDeg ≈ 0** (facing +z, toward the sofa and tables), ±20°. A is turned slightly toward the TV-stue.
* **Size:** ≈0.75 × 0.75 × 0.75; seat ≈0.45.
* **Shape:** round tub swivel chair.
  * A drum-shaped upholstered base (Ø ≈0.62, h ≈0.25, slightly tapered, no visible legs).
  * A loose round seat cushion (thickness ≈0.15).
  * A curved backrest shell wrapping ≈200° around the seat, ≈0.08 thick, top ≈0.75. It is highest at the back and lowers smoothly to the arms at ≈0.58.
* **Fabric:** bouclé, a touch warmer and darker than the sofa, **#a89f97**.

### 5.3 Nesting coffee tables – «settbord, runde»

The larger table is **taller**: its top overlaps the small one in 082819 and 082827. **high**

| Table | Centre | Size | Conf. |
|---|---|---|---|
| Large | **(5.51, 10.09)** | Ø **0.80**, top at **0.45** | med |
| Small | **(4.94, 10.09)** | Ø **0.60**, top at **0.40**; it slides partly under the large one | med |

* **Top:** ≈2.5 cm thick dark smoked/stained oak with visible grain, **#4a3b31**.
* **Frame:** thin black powder-coated steel (#1c1c1c). A floor ring the same diameter as the top, a flat top ring under the top and 3–4 straight vertical legs (Ø ≈1.2 cm).
* **Décor:**
  * Large table: round jute place mat Ø0.38 (#b8ad8e); two black metal taper-candle holders (disc base Ø0.08, stem 0.12 and 0.18) with sage-green taper candles (h0.25).
  * Small table: jute mat Ø0.32; two sage-green glass tealight holders (Ø0.08, h0.07); a round wooden box (Ø0.10) with a blush-pink lid.

### 5.4 Pebble rug (sitting group) – «ullteppe, kuler»

* **Footprint** from 082806 floor hits: corners near (4.51, 8.58) and (4.31, 11.53); far edge at x 6.44. So **≈2.0 (x) × 3.0 (z)**, centre **(5.42, 10.06)**, rotated ≈0°. **med**
* It runs under the sofa front and under the front halves of the swivel chairs. It ends ≈0.45 from the window wall.
* **Material:** chunky felted-wool ball/loop weave ("pebble"), ≈1.5–2 cm pile.
* **Colour:** light grey melange, base **#a9abb0**, with darker blue-grey #6f7077 and off-white #d8d8d8 flecks. Raw samples are #8a909e and #70758c (cool cast).

### 5.5 Painting above the sofa – «maleri»

* **Mounting:** west wall, front facing −z, **rotationDeg 180**.
* **Position:** centre **(5.33, 1.66)** on z = 11.88.
  * My 082806 hits: x 4.80–5.88, y 1.33/1.42–1.95/2.01.
  * Group 1: x 4.83–5.80, y 1.33–1.93.
* **Size:** the 082815 front-on aspect is **1.46**, so use **1.00 × 0.70 × 0.04**. **med-low**
* **Motif:** misty abstract landscape. A row of slender birch-like trees with sage/olive palette-knife foliage, over a pale reflecting water line.
  * Palette: #e8e6e0 (ground), #c9cfcd, #8f9e8c (foliage), #4d5a5a (trunks and shadow line), #b9c6cc (water).
* **Frame:** a thin dark-brown wooden floater frame or dark canvas sides is visible on the right edge. **low**

### 5.6 Palm – «palme (kunstig)»

* **Position:** pot centre **(4.10, 11.66)**, from the pot bottom-front at (4.05, 11.55) and the rim at (3.96, 11.54). This is next to the west wall, ≈0.35 m from the sofa's −x end. **med**
* **Plant:** faux kentia/areca palm (Howea/Dypsis look) with ≈8 arching fronds from 3–4 stems. Overall height **≈1.85**, spread ≈1.2. Green #3f6b3a, lighter new fronds #6f9a4f.
* **Pot:** white glazed ceramic cylinder with a subtle rolled rim, **Ø0.28 × h0.32**, #f0efea.
* **Socket:** a black socket at ≈0.25 m height sits on the west wall just −x of the sofa end, at x ≈ 4.45, z 11.91. **low**

### 5.7 Pothos on a plant stand (SW corner)

Group 1 saw this as a "round black metal base". It is a plant stand.
* **Position:** **(6.72, 11.72)**, in the 0.3 m gap between the sofa's window end and the SW corner. **med**
* **Stand:** black metal wire cylinder, Ø ≈0.22, h ≈0.55, open frame with a few rings.
* **Pot:** black, Ø0.18.
* **Plant:** trailing faux pothos (Epipremnum), green #3d7a32. Top ≈0.95–1.0 m; vines hang to ≈0.5.

### 5.8 Dining table – «spisebord»

* **Centre ≈ (5.30, 6.85)**, from an ellipse fit to 9 top-edge ray hits (y = 0.75) in 082806, 082809 and 082827. Fit: semi-axes 1.06 / 0.69 m, long axis ≈23° off x, rms 7 cm.
* **Shape:** **oval/elliptical top ≈2.0 × 1.1 m**, top at 0.75, **long axis along x** (toward the windows), so its front (local +z) faces +z. **med-low** for size and axis; the true axis is probably exactly x.
* **Top:** dark smoked-oak / dark-stain look, **#4d4440**, ≈2.5 cm with a slightly lighter bevelled under-edge (#8a8580).
* **Base:** two black steel A-frame/trapezoid leg frames of slanted flat bars (#1c1c1c), inset ≈0.5 m from the ends. Leg feet found at (4.90, 7.03) and (5.15, 7.45).
* **Chairs:** **6 chairs**: 2 on each long side, 1 at each end. **med**

### 5.9 Dining chairs ×6 – «spisestoler»

* **Shape:** upholstered shell chairs with a softly curved one-piece seat and back (slight wrap at the back corners), on 4 thin black splayed metal legs (swivel plate possible).
* **Size:** ≈0.50 × 0.58 × 0.88; seat ≈0.47.
* **Fabric:** oatmeal/light beige woven, **#cbc3b8**.
* **Positions** (approximate, around the table centre (5.30, 6.85)):

| Side | Chairs at | rotationDeg |
|---|---|---|
| +z side | (4.8, 7.6), (5.8, 7.6) | 180 |
| −z side | (4.8, 6.1), (5.8, 6.1) | 0 |
| −x end | (4.05, 6.85) | 90 |
| +x end | (6.55, 6.85) | −90 |

  **low**

### 5.10 TV-stue items I see (group 1 has the detail)

These cross-check group 1's numbers; see 0. Validation.
* **L-sofa:** mid-grey woven melange with piping. Arm at x ≈ 2.7–2.95 next to the niche corner; ribbed floor vase with blue hydrangeas between the arm and the corner.
* **Coffee table:** 1.2 × 0.6 × 0.43, anthracite slab on a black frame. My far-edge hits are x 2.56–2.71, z 9.44–10.15.
* **Rug:** geometric. Its +x edge is at x 3.04 and its west edge at z 10.67.
* **TV:** 77″, +x edge at x 2.50, y 0.62–1.56.
* **In-wall speaker:** x 2.61–2.76, y 0.84–1.24.
* **Black metal wall shelf** on the z = 8.33 wall.
* **No TV bench:** the floor and wall under the TV's +x half are bare (082806 crop).

### 5.11 Kitchen, appearance only (082827, 082809)

Positions from these photos are unreliable because they lie near the horizon; use the kitchen groups.
* **Tall units:** next to the black door; matt black (#1e1e1e) with a built-in black oven.
* **Back run:** black base cabinets; thin dark worktop (#262626); black gooseneck tap; knife block. The backsplash wall is Sand.
* **Wall cabinets:** black-framed smoked-glass doors (#3a3632) with a warm under-cabinet LED strip.
* **Pendants:** 3 small black cylinder pendants or spots over the counter/island area.
* **Island:** matt black fronts with a **light oak worktop** (≈#b48a5a). The top overhangs as a bar on the living-room (+z) side.
* **Bar stools:** **3 dark green** upholstered stools (#3f4c42) with black legs, ≈0.40 m apart, facing −z.
* **Décor:** a white wavy/ribbed ceramic vase with pampas grass on the island's +x end.

### 5.12 Radiators, vents, switches

* **No radiators** anywhere in my photos (floor heating likely). **No vents** visible on the south, west or high walls.
* **High-wall sockets and switches:** see 3.5, plus a socket at (3.21, 0.17, 7.22).
* **Niche-corner switch** (3.12, 1.21, 8.33) and **socket** (3.05, 0.17, 8.33) agree with group 1.
* **Plate colour:** all plates are matt black.

---

## 6. Lighting

| Fixture | Description and position | Conf. |
|---|---|---|
| **Pendant over the sitting group** | Black branch/"molecule" chandelier. **8 matt-black dome/disc shades** (Ø ≈0.12–0.14, each a shallow cup), some turned outward or down with exposed warm bulbs (≈2700 K, E14/G9 look), on short black rod arms from 3–4 joint nodes. A single black down-rod and a round black canopy (Ø ≈0.12). **Canopy on the sloped ceiling at (5.49, 2.63, 10.09)**, directly above the large nesting table. Hub at y ≈ 2.23; **lowest shade bottom ≈1.84**. Cluster span ≈0.75–0.80 (z 9.72–10.49), height ≈0.45. | med |
| **South-wall LED strip** | See 2.3: z 5.38–11.91, 2700 K wall-washer at the ceiling junction | high |
| **TV-stue** | 3-ring ceiling lamp at ≈(1.6, 10.1) (group 1). I see part of a ring (warm diffuser, dark outer band) in 082809. Black smoke detector at **(2.53, 2.37, 8.90)**; group 1 has (2.6, 8.8). North-wall LED strip. | med |
| **Kitchen** | Under-cabinet LED below the glass wall cabinets; 3 small black pendants or spots | low |
| **Over the dining table** | **No lamp at all.** The ceiling above the table is visible and empty in 082809 and 082806. This is the empty spot the user wants to fill. | **high** |
| **Floor and table lamps** | **None** in the living, dining or sitting area. The only other light sources are the candles on the nesting tables. | high |
| **Ceiling spots on the high wall** | The old drawing 08/09 shows 4 spots near the top of the high wall. They are outside the frame in all my photos, so I can neither confirm nor deny them. | – |

---

## 7. Outside view and terrace

* **W1 (east big window):**
  * **River:** calm, reflecting the sky.
  * **Far bank:** a road and a row of ≈8 **red boathouses (naust) with white trim** to the left; rocky wooded hills (pine, birch, autumn colours) behind.
  * **Foreground:** the house's own terrace (below).
* **W2 (west big window):**
  * a **large broad-crowned deciduous tree (oak-like)** fills the centre;
  * the river behind it;
  * **white houses** (some with grey roofs) climbing the far hillside;
  * a **conical evergreen shrub** (dwarf spruce/juniper) and lawn below.
  * The garden is clearly lower than the floor; we look down onto lawn and treetops.
* **W2's west end** (082823, looking down):
  * just outside are a **big moss- and lichen-covered granite boulder**, **dark slate stepping slabs**, gravel, tufts of grass and autumn maple shrubs (yellow/orange);
  * the terrain is ≈0.5–1.5 m below the floor here.
* **Terrace door and W1's east half – terrace:**
  * a wooden deck at roughly interior floor level, extending south (+x) from the door;
  * a **railing of horizontal dark-grey stained boards** (#4a4a48, ≈9–10 cm boards with 2–3 cm gaps), ≈1.0–1.1 m high on posts;
  * a section of **decorative slatted screen with small oval cut-outs**;
  * a **staircase down toward the west (+z)**: its slatted railing descends diagonally across W1's view, from about z 7 toward z 9;
  * W2 looks out over the garden, not the deck.
  * Deck depth is ≈2.5–3.5 m (very rough). **low**
* **Kitchen window** (glimpse): a dark grey vertical wood-clad wall close outside.
* **North clerestory (082800):**
  * a long pale grey-blue flat-roofed **industrial/commercial building** ≈10–20 m away;
  * a chain-link fence and a small spruce;
  * birch/beech with yellow leaves on the left;
  * a pine-covered rocky hill on the right; overcast white sky.
* **Sky:** early-morning overcast, white to pale blue.

---

## 8. Discrepancies with the floor plan

1. **South-wall openings: no discrepancy.** Door, W1, pier and W2 from the plan reproject within 8–37 px in 082806, so the plan holds to about ±5 cm. Heights are new information: heads 2.05, glass bottom ≈0.30, sill board ≈0.28–0.30.
2. **Dining table:**

   | | Plan | Photos |
   |---|---|---|
   | Shape | Round, Ø ≈1.15 | Oval ≈2.0 × 1.1, long axis ≈x |
   | Chairs | 4 | 6 |
   | Centre | (5.26, 6.52) | (5.30, 6.85) |

3. **Sitting sofa:** the plan shows a straight 2-seater with loose cushions, back 0.3 m off the wall. In reality it is a **curved bouclé sofa**, 2.0 × 1.0, back ≈0.05 off the wall, seat front at z ≈ 10.83 (plan 10.64).
4. **Coffee table:** the plan shows a black rectangle at (5.57, 9.95). In reality there are **two round nesting tables**, Ø0.80 at (5.51, 10.09) and Ø0.60 at (4.94, 10.09).
5. **Armchairs:** positions are right within ≈0.2 m (plan (4.79, 8.91) and (6.24, 8.91)). They are round swivel tub chairs, not the plan's shell chairs.
6. **Missing from the plan:**
   * the 2.0 × 3.0 pebble rug;
   * the palm (4.10, 11.66) and the pothos stand (6.72, 11.72);
   * the painting;
   * the black 8-arm pendant;
   * all window-sill décor.
7. **Plan's grey square** at the west wall, x ≈ 3.3–3.9: nothing stands there. The palm is at x ≈ 4.1. (Agrees with group 1.)
8. **TV bench:** it does not exist. (Agrees with group 1.)
9. **High wall:** confirmed. Niche corner (3.21, 8.33), black door frame at z 4.44, **length 3.89 m**. The plan draws the doorway (z 3.31–4.32) as a double-line opening; it is a **black door**.
10. **Ceiling:** the plan has no ceiling information. Photos confirm:
    * a 2.40 nook ceiling with an edge at x = 3.21;
    * a 0.60 bulkhead in the plane x = 3.21;
    * one linear slope 3.00 → 2.40 toward the south wall;
    * the LED strip along the whole south wall top.
11. **Kitchen window:** seen on x = 6.30 around z 4.3–5.2 with a sill at ≈0.92. The plan shows a window on that wall around z 3.1–4.9. Leave it to the kitchen groups.

---

## 9. Model-ready summary (JSON)

```json
{
  "units": "m",
  "ceiling": {
    "nook": {"y": 2.40, "x": [0, 3.21], "z": [8.33, 11.91], "paint": "MARRAKESH"},
    "bulkhead": {"plane_x": 3.21, "y": [2.40, 3.00], "z": [8.33, 11.91], "paint": "SAND"},
    "living_slope": {"x0": 3.21, "y0": 3.00, "x1": 6.91, "y1": 2.40, "z": [4.44, 11.91], "paint": "SAND"}
  },
  "walls": {
    "south": {"x": 6.91, "z": [5.38, 11.91], "paint": "SAND"},
    "jog": {"z": 5.38, "x": [6.30, 6.91], "paint": "SAND"},
    "high": {"x": 3.21, "z": [4.44, 8.33], "h": 3.00, "paint": "SAND"},
    "west_living": {"z": 11.91, "x": [3.21, 6.91], "paint": "MARRAKESH?", "conf": "low"}
  },
  "led": [
    {"wall": "south", "x": 6.89, "y": 2.40, "z": [5.38, 11.91], "kelvin": 2700},
    {"wall": "north_nook", "x": 0.02, "y": 2.40, "z": [8.40, 11.85], "kelvin": 2700}
  ],
  "openings": [
    {"id": "D1_terrasse", "wall_x": 6.91, "z": [5.51, 6.42], "y": [0, 2.03], "type": "door_glazed_outward_hinge_west", "frame": "#232425"},
    {"id": "W1", "wall_x": 6.91, "z": [6.62, 9.00], "y": [0.30, 2.06], "type": "fixed", "frame": "#232425", "reveal_depth": 0.20, "reveal": "#ecebe6", "sill_top": 0.29},
    {"id": "W2", "wall_x": 6.91, "z": [9.18, 11.62], "y": [0.30, 2.06], "type": "fixed", "frame": "#232425", "reveal_depth": 0.20, "reveal": "#ecebe6", "sill_top": 0.29},
    {"id": "W_kitchen_S", "wall_x": 6.30, "z": [4.3, 5.2], "y": [0.92, 2.05], "conf": "low"},
    {"id": "D_black_highwall", "wall_x": 3.21, "z": [3.31, 4.32], "frame_edge_z": 4.44, "y": [0, 2.08], "color": "#1d1d1d"},
    {"id": "N1_clerestory", "wall_x": 0, "z": [9.24, 10.97], "y": [1.65, 2.13], "source": "group-1, aspect confirmed 3.8:1"}
  ],
  "floor": {"color": "#a59c93", "plank_w": 0.22, "plank_l": 2.2, "direction": "z", "baseboard": {"h": 0.065, "color": "#ecebe6"}},
  "objects": [
    {"id": "buet_sofa", "pos": [5.55, 11.35], "rotDeg": 180, "size": [2.00, 1.00, 0.75], "seat": 0.44, "color": "#b3ada6", "mat": "boucle"},
    {"id": "pledd_salvie", "on": "buet_sofa", "pos": [4.75, 11.2], "color": "#a7b89c"},
    {"id": "svingstol_A", "pos": [4.95, 8.75], "rotDeg": 0, "size": [0.75, 0.75, 0.75], "color": "#a89f97", "mat": "boucle"},
    {"id": "svingstol_B", "pos": [6.30, 8.70], "rotDeg": 0, "size": [0.75, 0.75, 0.75], "color": "#a89f97", "mat": "boucle"},
    {"id": "settbord_stort", "pos": [5.51, 10.09], "d": 0.80, "h": 0.45, "top": "#4a3b31", "frame": "#1c1c1c"},
    {"id": "settbord_lite", "pos": [4.94, 10.09], "d": 0.60, "h": 0.40, "top": "#4a3b31", "frame": "#1c1c1c"},
    {"id": "teppe_kuler", "pos": [5.42, 10.06], "size": [2.0, 3.0], "rotDeg": 0, "color": "#a9abb0"},
    {"id": "maleri", "wall_z": 11.88, "center": [5.33, 1.66], "size": [1.00, 0.70, 0.04], "rotDeg": 180},
    {"id": "palme", "pos": [4.10, 11.66], "h": 1.85, "pot": {"d": 0.28, "h": 0.32, "color": "#f0efea"}},
    {"id": "potteplante_stativ", "pos": [6.72, 11.72], "stand": {"d": 0.22, "h": 0.55, "color": "#1c1c1c"}, "top": 0.98},
    {"id": "spisebord_ovalt", "pos": [5.30, 6.85], "size": [2.0, 1.1, 0.75], "longAxis": "x", "top": "#4d4440", "legs": "#1c1c1c", "conf": "med-low"},
    {"id": "spisestoler", "count": 6, "size": [0.50, 0.58, 0.88], "seat": 0.47, "color": "#cbc3b8",
     "pos": [[4.8, 7.6, 180], [5.8, 7.6, 180], [4.8, 6.1, 0], [5.8, 6.1, 0], [4.05, 6.85, 90], [6.55, 6.85, -90]], "conf": "low"},
    {"id": "pendel_molekyl", "canopy": [5.49, 2.63, 10.09], "hub_y": 2.23, "bottom_y": 1.84, "span": 0.78, "shades": 8, "color": "#1a1a1a"}
  ]
}
```
