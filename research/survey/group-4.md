# Survey group 4: south window wall, dining area, kitchen peninsula and high-wall lighting

Photos covered: `20261018_082852`, `082855`, `082901`, `082905`, `082909`, `082914`, `082916`. All seven are 4000×3000 ultra-wide shots taken between 08:28:52 and 08:29:16.
Calibration sources: `plantegning.png`, `LES_MEG.txt` and the user facts in the task.

Coordinate system as specified. Units are metres. +x is south (toward the big windows), +z is west (toward the TV-stue), and +y is up. The origin is the floor at the inner face of the north (plan-left) and east (plan-top) outer walls. `rotationDeg` is three.js `rotation.y`, and 0 means the front faces +z. For cameras I give a **yaw** in the same convention (0 = looking west, 90 = south, 180 = east, −90 = north). A three.js camera then needs `camera.rotation.y = yaw + 180°`.

Confidence tags: **high** means it is measured or cross-checked in at least two ways. **med** means one decent measurement. **low** means an estimate or judged by eye.

---

## 0. Method and calibration notes (read first)

* **Plan scale is 51.3 px/m, not 50.5.** I scanned the dark wall pixels in `plantegning.png` (587×802 px):
  * Outer wall faces are at x 83 and 453 px. 371 px for the printed 7.22 m gives 51.4 px/m.
  * Inner faces are at x 91 and 446 px. 355 px for the printed 6.92 m gives 51.3 px/m.
  * Top and bottom inner faces are at y 52 and 664 px, so the interior length is 11.93 m. That matches 12.21 m minus two walls.
  * Conversion: `x = (px − 91)/51.3`, `z = (py − 52)/51.3`.

  This agrees with group 1 (51.4). **high**

* **Key plan coordinates at this scale** (all **high** unless noted):
  * Kitchen-section south wall, inner face: x = **6.32**.
  * Living-section south wall (door and windows), inner face: x = **6.92**.
  * The step between those two walls is a short return wall facing west, at z = **5.38**, spanning x 6.32→6.92 (0.60 m deep). The 6.54 m dimension on the plan is exactly z 5.38→11.93.
  * The high wall (the bedroom's south face, toward the living room) is the plane x = **3.22**. In plan px it is x 251–255, so it is about 0.10 m thick.
  * The niche corner, where the bedroom wall meets the TV-stue, is at (3.22, z = **8.34**).
  * Plan openings in the x = 6.92 wall (scan of column 447):
    * door 5.46–6.43
    * window 6.59–8.99
    * window 9.18–11.58
    * wall 11.58–11.93
  * Plan openings in the x = 6.32 kitchen wall (column 418):
    * window 0.62–3.02
    * wall 3.04–3.68
    * window 3.70–4.89
    * wall 4.91–5.38
* **Camera solving.** I wrote a pinhole-camera Levenberg–Marquardt fitter. Its inputs are wall/ceiling/floor corners and lines with known coordinates: the LED strip at y = 2.40 on x = 6.90, the ceiling line along the west wall using the 3.0→2.4 slope, the niche corner at (3.22, 0 | 2.40, 8.34), and the window head lines, whose z and height are unknown and solved for.
  * Photos 082905, 082909 and 082914 solve with 3–6 px rms.
  * The focal length comes out at 1500–1690 px at 4000-px width. Group 1 got 1620–1750, which agrees.
  * Objects were then located by intersecting pixel rays with known planes (floor, tabletop at 0.75, the wall planes).
  * Projective cross-ratios along window head lines, using a vanishing point and two known corners, gave an independent check that does not depend on the focal length.
* **Typical error.** About ±5 cm for heights on the window wall. About ±10–15 cm for positions along the window wall (z). About ±15–25 cm for furniture positions. The ultra-wide frame edges keep some residual distortion.
* **Exposure warning.** The photos mix warm 2700 K LED light with cool morning daylight, so raw pixel colours swing wildly: the same wall reads from #7d6b63 to #afb4b7. The hex values below are **perceived, white-balanced estimates**. Raw samples are quoted where useful. Treat every colour as **low–med**.

---

## 1. Camera position per photo

| Photo | Camera (x, y, z) | Yaw / pitch | What it shows | Conf. |
|---|---|---|---|---|
| 082852 | ≈(6.40, 1.5, 9.6) | ≈125° / −15° | Standing tight against the east half of window W2 and looking SE along the facade. Outside: the terrace with its slatted railing and the stair down to the lawn, the river and hills. Inside, at the left: the W2 east reveal, the W1 sill (smoked-glass lantern, black vase with eucalyptus), the LED slot, the far kitchen corner, and a tub-chair arm at bottom-left. | low |
| 082855 | ≈(6.40, 1.5, 9.8) | ≈55° / −10° | Same spot, turned SW through W2. Outside: the big moss-covered boulder, birch/maple/oak, the river at left. Inside, at right: the W2 west reveal, the dark west wall, the pothos on its stand. | low |
| 082901 | ≈(3.8, 1.7, 8.0) | ≈125° / −20° | North-west of the table, looking SE. Visible: the dining table and 6 chairs, the terrace door, W1, and at the left the two kitchen windows, the peninsula with green stools and pampas vase, and a track pendant. | low–med |
| 082905 | (4.7, 1.55, 5.5–5.7) (fit) | 41–43° / −24…−27° | Held high north-east of the table's east end, looking WSW and down. Visible: the door (left), W1, W2, the LED strip, and the whole sitting group (sofa, 2 tub chairs, nesting tables, rug, painting, chandelier, palm, pothos). | med |
| 082909 | (5.19, 1.85, 3.6–3.9) (fit) | −7.5° / −3° | At the kitchen/dining border, looking straight west down the room. Visible: the window wall (left) with W1/W2 and the LED, the high wall (right) with 3 spots, the sitting area, the TV-stue opening with bulkhead, and the TV. The kitchen-wall outside corner hides the door. | med |
| 082914 | (4.2±0.4, 1.8, 5.3–6.1) (fit) | 46–55° / −6°, roll +3° | Behind the east end of the table on its high-wall side, looking SW. The whole window wall is visible: door, W1, W2, the LED from the return corner to the west corner, the sitting group, and the west wall. **This is the reference frame for the window layout.** | med |
| 082916 | ≈(4.55, 1.6, 4.95) | ≈113° / −9° | At the dining/kitchen border, looking SSE. Visible: the kitchen south wall with the long window and the square window, the outside corner at (6.32, 5.38), the door set back behind it, the peninsula with hob, 3 green stools, the track pendants, the ring lamp, and the ceiling step. | med–low |

---

## 2. Architecture

### 2.1 Wall segments seen (plan-confirmed)

| Segment | Line | From → to | Notes | Conf. |
|---|---|---|---|---|
| Kitchen south wall | x = 6.32, faces −x (north) | z 0 → 5.38 | Holds the long kitchen window and the square window. Ends in an outside corner at (6.32, 5.38). Visible in 082916, 082901 and 082909 (left edge). | high |
| Return wall | z = 5.38, faces +z (west) | x 6.32 → 6.92 | 0.60 m deep. The door's east jamb is flush with it, so the door sits tight in the inside corner. Seen in 082914 (far left) and 082916 (hidden behind the outside corner). | high (plan) / med (photo) |
| Living south wall (window wall) | x = 6.92, faces −x | z 5.38 → 11.93 | Holds the door, W1 and W2. No radiators. | high |
| West wall (sofa wall) | z = 11.93, faces −z (east) | x 6.92 → 0 | The sitting part is behind the sofa. The TV-stue part (x < 3.22) carries the TV. | high |
| High wall | x = 3.22, faces +x (south) | z ≈4.25 (small-room door frame) → 8.34 (niche corner) | 3.0 m tall. 4 spots in front of it. The niche corner at z = 8.34 is an outside corner. Past it the TV-stue opens to the right. | high (plan) / med |

**Wall thickness.**
* The plan draws outer walls 0.155 m thick and the interior walls 0.10–0.14 m thick.
* In the photos, the interior wall face to the window frame (the reveal) is 0.18–0.20 m. Allowing for the frame and the outer cladding, the real outer wall is probably about 0.30 m.
* For the game, model a 0.30 m outer wall with a 0.19 m deep inner reveal.
* **med**

### 2.2 Ceilings

* **Living/dining ceiling** is a single sloped plane: y = 2.40 + 0.162·(6.92 − x), i.e. 3.00 at x = 3.22 and 2.40 at x = 6.92. The pitch is 9.2°, falling toward the windows (user fact).
  * Photos 082909 and 082914 confirm it is a single plane rising from the window wall toward the high wall.
  * 082914 confirms the west wall's top edge climbs from the window corner toward the north. The fit residuals with this slope were under 20 px.
  * No beams.
  * **high**
* **Window-wall junction.** The ceiling meets the window wall directly at 2.40 m. There is **no bulkhead** above the windows.
  * Wall strip between the window heads (2.10) and the ceiling: 0.30 m.
  * **high**
* **Kitchen ceiling** is flat at 2.40 (user fact).
  * In 082916 the step between the sloped ceiling and the flat kitchen ceiling shows as a vertical bulkhead face facing west. It is about 0.6 m tall at the north end and tapers to about 0.1 m where it meets the kitchen south wall.
  * It meets that wall at **z ≈ 3.3**, which is between the long kitchen window and the square window (image vanishing-point analysis and ray at x = 6.32). The line runs in x and lines up with the east edge of the small-room door on the high-wall line, at z ≈ 3.3.
  * So the kitchen zone spans z 0 → ≈3.3 and the sloped zone z ≈3.3 → 11.93, except the TV-stue.
  * **med–low**
* **TV-stue bulkhead.** The TV-stue (x < 3.22, z > 8.34) is flat at 2.40.
  * Seen through the niche opening in 082909: a vertical bulkhead face in the plane x = 3.22, facing south, from 2.40 up to the 3.00 living ceiling. It is 0.60 m tall and runs from the niche corner z = 8.34 to the west wall z = 11.93. It continues the high-wall plane above the TV-stue opening.
  * **med**

### 2.3 Paint zones (SAND vs MARRAKESH)

**SAND** (light warm greige, perceived ≈ **#d3cabd**):
* the window wall, including the piers
* the return wall
* the kitchen south wall
* the high wall (pale in 082909, raw #a7a8a3)

**MARRAKESH** (darker warm grey-brown/taupe, perceived ≈ **#a39788**):
* the **west wall behind the sofa**. It is clearly darker and browner than the window-wall piers in 082905 and 082914.
* the TV-stue walls. Raw #85878c, against #a7a8a3 for the high wall at the same exposure.

The ceiling follows each zone: the sloped living ceiling is SAND and the TV-stue ceiling MARRAKESH (per the user). The slope reads mid warm-grey in the photos only because it is shaded.

Window reveals and head soffits are lighter than the walls, near white (raw #d4e4e6 in daylight), so probably white or a very pale SAND.

Assignment confidence: **med** for the west wall and TV-stue, **med–low** for the high wall.

### 2.4 LED strips and niches

* **One continuous linear LED** runs along the window wall's ceiling junction, from the return-wall corner (z = 5.38) to the west corner (z = 11.93): 6.55 m.
  * It is a recessed aluminium slot in the ceiling, 0–5 cm from the wall face, with an opal diffuser about 2 cm wide, at y ≈ 2.40.
  * It washes the 0.30 m of wall above the window heads in warm 2700 K light.
  * It starts exactly at the return corner (the strip tip is at the corner in 082914; in 082916 it emerges from behind the outside corner) and ends at the west corner (082905, 082909, 082914).
  * It does **not** continue over the kitchen windows, along the return wall, or along the west wall.
  * **high**
* **Niches.** The only one is the TV-stue niche behind the high wall: x 0–3.22, z 8.34–11.93, open to the sitting area along x = 3.22.
* **Columns between windows.** No structural columns. There are only plain plastered piers:
  * door↔W1: about 0.18–0.20 m
  * W1↔W2: about 0.20–0.22 m
  * W2↔west corner: about 0.45–0.55 m

  See 3.1.

---

## 3. Openings

### 3.1 Window wall x = 6.92 (south): terrace door, W1, W2

Recommended layout. Positions are wall-face opening edges; the frames sit 0.19 m further out.

| Item | z from → to | Width | Sill / bottom | Head | Notes | Conf. |
|---|---|---|---|---|---|---|
| Terrace door D1 | **5.38 → 6.28** | ≈0.90 | floor (0) | **2.10** | East jamb flush with the return wall. | z: med; head: high |
| Pier | 6.28 → 6.46 | ≈0.18–0.20 | | | Plain wall. | med |
| Window W1 | **6.46 → 8.84** | ≈2.38 | **0.42** | **2.10** | One fixed pane. | med |
| Pier | 8.84 → 9.04 | ≈0.20–0.22 | | | Black double socket under it at about 0.15 m. | med |
| Window W2 | **9.04 → 11.42** | ≈2.38 | **0.42** | **2.10** | One fixed pane. | med |
| End pier | 11.42 → 11.93 | ≈0.50 | | | The pothos stand sits in this corner. | med |

How the numbers were derived:
* **Head 2.10 m (high).**
  * The cross-ratio on a vertical line at W2's west edge in 082914 gave 2.096 (floor 0, LED 2.40, vertical vanishing point).
  * The three camera fits gave 2.07, 2.10 and 2.13.
  * The door head and both window heads lie on the **same line** in 082914 (collinear to 1 px).
* **Sill 0.42 m (med–high).**
  * The cross-ratio in 082914 gave 0.42.
  * The 082905 fit gave the frame bottom at 0.37–0.44.
  * Check: the black socket under W1 in 082909 comes out at about 0.27 m, a normal Norwegian height.
  * Window opening height: 1.68 m.
* **Positions along z.**
  * The 082914 cross-ratio gave: door 5.38–6.26, W1 6.48–8.85, W2 9.07–11.42, end pier 0.51.
  * The 082905 cross-ratio, anchored on the door edge, gave W1 6.47–8.78 and W2 9.02–11.32.
  * The three free camera fits always put **W2's west edge at 11.36–11.55**, with an end pier of about 0.5. They disagree on W1 (6.17–6.59 → 8.43–8.79) because of distortion near the frame edges.
  * The plan says door 5.46–6.43, W1 6.59–8.99, W2 9.18–11.58 (both windows 2.40, end pier 0.35).
  * **Conclusion.** Every photo method shows the end pier wider than the middle piers. I therefore recommend the plan's equal ~2.40 windows **shifted about 0.12 m east**, as in the table. If the model must match the plan exactly, use the plan values; the difference is within my error.
* **Door width 0.88–0.97.**
  * The 082914 cross-ratio gave 0.88. The aspect of the near-frontal view in 082901 gave about 0.95 after correcting for foreshortening. The plan says 0.97.
  * Use **0.90–0.95**.

**Window frames.**
* Black/anthracite (≈ **#25272b**; raw #21242e–#302926), aluminium-clad, slim.
* About 0.06–0.08 m of frame is visible from inside.
* W1 and W2 are single **fixed** panes, with no mullions, sashes or handles. The low-E glass reads slightly green/blue in reflection.
* An energy/CE sticker sits in the bottom corner of the door glass.
* **high**

**Reveals.**
* About **0.19 m** deep from the wall face to the frame. This is measured three ways:
  * the W1 west jamb in 082914 (0.18)
  * the W2 west jamb (0.19)
  * the sill depth in 082852
* Square-cut plastered corners, painted white or very pale SAND.
* **med**

**Window sills.**
* White or very light grey (painted MDF or stone look), flush with the wall face, no visible overhang.
* Depth about 0.19–0.20, the same as the reveal.
* **med**

**Terrace door D1.**
* Single-leaf glazed balcony door with a black frame. It **opens outward** (plan arc).
* Black lever handle on the **east (left, seen from inside) stile** at about 1.0 m, with the lock cylinder above it. So it is **hinged on the west side**.
* Glass from about 0.25 m to about 1.95 m.
* The bottom rail is about 0.2–0.28 m tall. The top rail plus frame is about 0.15 m.
* Threshold at floor level, with a light wood/alu threshold strip inside the reveal.
* **med**

### 3.2 Kitchen south wall x = 6.32

| Item | z from → to | Width | Sill | Head | Notes | Conf. |
|---|---|---|---|---|---|---|
| Long kitchen window K1 | **≈0.85 → 3.15** (plan 0.62–3.02) | ≈2.3–2.4 | **≈1.04** | 2.10 | Horizontal window, about 0.14 m above the peninsula worktop. The peninsula's end butts the wall under the **west part** of K1. Black frame, opening (top-hung), black handle on the bottom rail. Deep white reveal and white sill about 0.2 m. | med |
| Pier | ≈3.15 → 3.70 | ≈0.55 | | | The ceiling step meets the wall here (z ≈3.3). | med–low |
| Square window K2 | **≈3.70 → 4.85** | ≈1.10–1.20 | **≈0.97** | 2.07–2.10 | Nearly square opening, about 1.15 × 1.13. Black frame, **top-hung opening sash** with a black handle centred on the bottom rail. White reveal and sill. Two small black items lie on the sill (remote or sunglasses). The terrace railing is right outside. | med |
| Pier to outside corner | ≈4.85 → 5.38 | ≈0.5 | | | Black double socket at the floor under K2's right side. | med |

These were derived with the 082916 vanishing points: the horizontal vanishing point at (−1457, 1282) and the vertical one at about (2284, 10660). I used cross-ratios on the K1 and K2 jambs, with the floor, the kitchen ceiling at 2.40 or the sloped ceiling at about 2.50, and the head at 2.10. The camera, solved from the outside corner (6.32, 5.38) and K2's jambs, came out at (4.55, 1.6, 4.95).

### 3.3 Other

* None of my photos shows the small-room door on the high-wall line. Its frame at z ≈ 4.25 is the east end of the high wall (user: 390 cm from the niche corner).
* No radiators are visible anywhere; the room is probably floor-heated. No ventilation grilles were seen on the window wall.

---

## 4. Floor

* **Material.** Wide-plank oak-look floor (laminate or engineered oak), matte, with subtle grain and a light greige/grey-washed tone.
  * Perceived ≈ **#b3a596**. Raw samples, under-exposed: #655b59, #6c6060.
  * The same floor runs through the kitchen, dining, sitting area and TV-stue.
  * **med** (colour **low**)
* **Plank direction.** The long axis runs **along z** (east–west, parallel to the window wall). In 082909 the seams converge to the same vanishing point as the walls' floor lines.
  * **med**
* **Plank size.** About 0.19–0.20 m wide. Long boards, about 1.8–2.2 m; the end joints are hard to see.
  * **low**
* **Baseboard.** About 0.06 m tall, square/flat profile, painted near-white or SAND. A slim light line in every photo.
  * **med**
* **Sockets.** Black double sockets near the floor (about 0.15–0.3 m) at these positions:

  | Location | Position | Source photo | Conf. |
  |---|---|---|---|
  | Under the east end of W1 | z ≈ 6.6, y ≈ 0.27 | 082909 | med |
  | Under the W1↔W2 pier | z ≈ 9.0 | 082914 | med |
  | On the high wall | (3.22, 0.15, ≈7.2) | 082909 fit | med |
  | Kitchen wall under K2 | | 082916 | low |
  | Kitchen wall near the peninsula end | | 082916 | low |
  | West wall right of the sofa, by the palm | | 082914 | med |

---

## 5. Existing furniture and objects

### 5.1 Dining

* **Dining table**
  * Centre ≈ **(5.40, 0.75, 6.80)**.
  * Long axis about along z: rotationDeg ≈ **−8°** (±8°). The west end sits slightly further north (smaller x) than the east end; 082905 and 082914 show about 13°, 082909 about 3°.
  * Size ≈ **2.00 × 1.05 m**, extended with one leaf. Top about 0.75 m; a thin top of about 3 cm with a slight under-bevel.
  * Shape: a **stadium/oval** made of two half-round ends plus a straight middle leaf. The seams are visible across the top in 082901 and 082914.
  * Top: **dark smoked/brown oak veneer** with strong cathedral grain. Perceived ≈ **#4b4039**; raw #58596e with sky reflection.
  * Legs: black powder-coated flat steel. Two splayed V/trapezoid leg frames set in about 0.35 m from the ends, bars about 4×4 cm, angled slightly outward.
  * Derivation: the outline was ray-cast onto the plane y = 0.75 from the 082909, 082905 and 082914 cameras.
    * 082909: x 4.86–6.08, z 5.6–7.5.
    * 082905: east tip (5.6–5.8, 5.87), west tip (5.1–5.3, 8.0).
  * The plan's round table, centre (5.34, 6.49), is wrong in shape but right in x.
  * Position **med–low**, shape **high**.
* **Dining chairs, 6**
  * Placement: 2 on the window side, 2 on the high-wall side, and 1 at each end (counted in 082914 and 082901).
  * Shell chair with a curved, slightly winged back (the top corners flare), upholstered in **cream/off-white bouclé**, perceived ≈ **#d8d0c4**. The back has a vertical centre seam.
  * Four thin black round steel legs (Ø about 2 cm), splayed. Plastic glides.
  * Size: seat height about 0.47, back height about 0.86–0.90, width about 0.52, depth about 0.58.
  * Approximate centres and rotationDeg:

    | Chair | Centre (x, z) | rotationDeg | Note |
    |---|---|---|---|
    | Window side 1 | (6.05, 6.45) | −98 | |
    | Window side 2 | (5.93, 7.33) | −98 | |
    | High-wall side 1 | (4.85, 6.27) | 82 | |
    | High-wall side 2 | (4.72, 7.16) | 82 | |
    | East end | (5.56, 5.69) | −8 | Faces west |
    | West end | (5.24, 7.91) | 172 | Faces east |

  * Shape **high**, positions **low**.
* **Over the table there is NO pendant today.** This is relevant for the brief (belysning over spisebord).
  * Ceiling above the table centre: y ≈ 2.40 + 0.162·(6.92 − 5.40) = **2.65 m**.

### 5.2 Kitchen (only what is visible in my photos)

* **Peninsula ("Planetopp")**
  * Plan: x 4.29 → 6.32, z 1.79 → 3.00, so about 2.03 × 1.21 m. Its south end butts the wall under the west part of window K1 (photos agree).
  * Height 0.90.
  * Worktop: **dark brown-black stone/ceramic look with light veining** (dark "emperador"-type marble pattern). Perceived ≈ **#3d2f27**; raw #5d402f under warm light. Thin edge, about 2 cm.
  * Fronts: matte black/anthracite ≈ **#1d1d20**.
  * A large **black-glass induction hob with integrated downdraft extractor** sits in the middle of the top: about 0.8 × 0.5 black glass, with a lit slot/control line.
  * A seating overhang of about 0.3 m runs along the **west (+z) side**.
  * Decor at the south end: a white wavy/ribbed ceramic vase (H about 0.30) with dried pampas plumes (H about 0.6) on a round jute placemat (Ø about 0.35).
  * **med**
* **Bar stools, 3**
  * On the west side of the peninsula, facing −z (rotationDeg 180), at z ≈ 3.3, spaced about 0.55 m in x (x ≈ 4.9, 5.45, 6.0).
  * Upholstered shell with a curved back and vertical seams, in **dark bottle-green textured fabric** (chenille/velvet), perceived ≈ **#3b4a3d**.
  * Black 4-leg steel frame with footrest. Seat height about 0.65; back top about 0.95.
  * **med**
* **Rear counter** along the east wall (z 0 → 0.6), seen at the left edge of 082916:
  * dark worktop and black base fronts
  * black integrated dishwasher (handle visible), near the south end
  * a small potted yellow-flowered plant
  * above it, a **dark smoked-glass wall element/cabinet**, about 1.0 × 0.4
  * **low**
* Not visible in my photos: the tall units (oven/micro/coffee and fridge/freezer along x ≈ 2.7–3.3 in the plan), and the sink detail.

### 5.3 Sitting area (seen from a distance; other groups will have better close-ups)

All positions here are **low** (rays from 082914/082905).

* **Sofa**
  * Against the west wall, facing east (rotationDeg **180**). Centre ≈ **(5.55, 11.45)**, spanning x ≈ 4.6 → 6.5.
  * Curved/rounded 3-seat sofa in **light grey bouclé/teddy**, perceived ≈ **#b9b6b0**; raw #a4b3c5 under daylight.
  * One continuous, softly curved back that wraps into low rounded arms. Deep seat cushion, recessed hidden base.
  * Size: width about 2.1–2.2, depth about 0.95, seat height about 0.42, back height about 0.75.
  * A **sage-green knitted throw** (≈ #a9b79a) hangs over the north arm.
* **Tub armchairs, 2**
  * Round barrel/tub chairs in light grey bouclé, slightly greyer than the sofa (≈ #a9a6a1), on a round low base, probably swivel.
  * Ø about 0.75, back height about 0.72, seat height about 0.42.
  * Chair 1: near the window at about (6.1, 9.0), facing the sofa (rotationDeg ≈ −15°).
  * Chair 2: further north at about (4.8, 8.6), facing the sofa (rotationDeg ≈ +15°).
* **Nesting coffee tables, 2 round**
  * Large: Ø about 0.80, top height about 0.45, centre about (5.6, 9.9).
  * Small: Ø about 0.60, height about 0.35, centre about (4.9, 10.1), slid partly under the large one.
  * Dark brown-black wood/veneer tops (≈ #3a3433) with a thin **black tubular steel ring-and-leg frame**.
  * On the large table: a round light-stone tray (Ø about 0.35) with two tall slim black candle holders.
  * On the small table: a copper/brass bowl and two glass tea-light holders.
* **Rug**
  * Rectangular, woven, **grey-blue melange** with nubby wool/jute texture (≈ #8f9196).
  * About 2.0 × 3.0 m, roughly x 4.0–6.2, z 8.6–11.3, under the front of the sofa and the tub chairs.
* **Painting**
  * Abstract landscape: a row of misty trees reflected in water. Soft grey, white, charcoal and beige. Canvas with no visible frame.
  * About **1.20 × 0.80**. Bottom edge about 1.20, top about 2.00, centre x ≈ 5.4 on the west wall. Ray-cast gives x 4.9–5.9 and y 1.2–2.0.
  * **low–med**
* **Kentia/areca palm** in a white glazed ceramic pot (pot Ø about 0.35 × H 0.30; plant H about 1.7). Pot centre about (4.2, 11.5), at the north end of the sofa.
* **Pothos (Epipremnum aureum)** trailing from a black metal plant stand (H about 0.75) in the SW corner, about (6.65, 11.65).
* **White flush rectangle**, about 0.15 × 0.35 m, on the TV-stue west wall south of the TV, about (2.75, 1.0, 11.93). Probably an in-wall speaker or a control panel. **low**
* **TV** (TV-stue, mostly hidden): bottom about 0.65 and top about 1.5 on the west wall, south edge x ≈ 2.4. Consistent with group 1's 77″ panel.

### 5.4 Window-sill decor

All **med** for type, **low** for exact z.

* **W1, west end (z ≈ 8.6):** black textured ceramic vase (H about 0.25, Ø about 0.18) with eucalyptus stems (silver-dollar type), about 0.4 tall.
* **W1, east end (z ≈ 6.7):** smoked-grey glass hurricane lantern (H about 0.22, Ø about 0.15) with a white pillar candle.
* **W2, east end (z ≈ 9.2):** small feathery fern/asparagus fern in a black pot (H about 0.25).
* **W2, middle-west (z ≈ 10.6–10.8):** two small clear or smoked glass tea-light holders (Ø about 0.08).

---

## 6. Lighting

| Fixture | Position | Size / type | Shade bottom / mount | Colour | Conf. |
|---|---|---|---|---|---|
| LED wall-wash strip | Ceiling at the window wall, x ≈ 6.90, z 5.38 → 11.93 | Recessed alu slot, about 2 cm wide, 6.55 m long | y 2.40 | Warm white about 2700 K | high |
| High-wall spots, **3 visible, probably 4** | Sloped ceiling about 0.45 m in front of the high wall: x ≈ 3.68, y ≈ 2.92. z ≈ 5.71, 6.58, 7.44 (082909 fit; spacing 0.87). The 4th scallop at the top-right of 082909 suggests one more at z ≈ 4.85. | Black cylindrical surface/semi-recessed **adjustable** spots, Ø about 0.07 × L 0.12–0.15, tilted about 20–30° toward the wall | Body bottom about 2.8 | Warm white. Cast scallops on the high wall from about 2.9 down to about 2.0 m. | med (count low) |
| Sitting-area chandelier | Canopy on the sloped ceiling at about (5.6, 2.65, 10.3–10.4), over the coffee tables | **Black "molecular/branch" pendant**: one down-rod about 0.4–0.5 m from a small black rectangular canopy to a hub, branching arms, **8–9 shallow dome shades** Ø about 0.15 (black outside, brass/gold inside), bare warm bulbs. Spread about 1.0–1.1 m. | Shades about 1.85–2.25 above the floor, lowest about 1.85 | Matte black ≈ #1b1b1b, brass inside | med |
| Kitchen track + 2 pendants | Black surface track on the flat kitchen ceiling (2.40) running along x over the peninsula. Two pendants at about (x 5.0, z 2.4) and (x 5.9, z 2.4). | Black cylinders, Ø about 0.08 × L 0.35, on black cords | Bottom about 1.70 (about 0.8 above the worktop) | Black | med–low |
| Kitchen ring lamp | Flat kitchen ceiling, over the work area near the rear counter, about (5.0–5.5, 2.2, 1.0–1.5) | LED **halo ring** Ø about 0.55 on an offset bent arm from a small canopy (semi-flush, about 0.2 m drop) | About 2.2 | Black/dark bronze ring, warm light | low |
| Small black rectangular ceiling fitting | Kitchen ceiling, near the track start | About 0.15 × 0.04. Possibly a track spot, sensor or speaker. | | Black | low |
| Floor and table lamps | **None** in my photos | | | | high |

---

## 7. Outside views and terrace

* **Terrace (deck) outside D1.**
  * Raised deck **at interior floor level** (flush threshold). Deck surface dark grey: perceived ≈ **#5b5f66**, painted concrete or dark composite.
  * It runs from about z 3.4 (where a grey vertical-board clad wall closes its east end; seen through K1 and in 082852) to about z 6.7, and projects about **1.8–2.0 m** south of the facade, to x ≈ 8.7–8.9. It also passes in front of the kitchen window K2, where the railing is about 1.5 m from the glass.
  * **Railing**: horizontal wood slats (about 7 cm boards, about 3 cm gaps), weathered/stained grey wood ≈ **#9a958d**, on posts with a flat top-rail board. About 1.0–1.1 m high. It runs along the south edge and down the west side (just west of D1).
  * **Stair**: from the deck's south-west corner a straight stair runs **westward along the facade and down** about one storey (about 2.5 m) to a light concrete landing pad on the lawn, roughly in front of W1/W2. It has slatted guard panels on its outer side.
  * Below the deck: a white rendered foundation wall and a dark opening (storage under the deck).
  * Geometry **low–med**, materials **med**.
* **Through D1 and W1 (082901, 082905, 082914):**
  * the deck and railing in the foreground
  * a frosty lawn falling away south
  * large old oaks on the riverbank
  * a **calm river/fjord arm** running left to right
  * on the far shore, a row of **red boathouses (naust)**, white detached houses on a green hillside to the right (SW), and forested hills to the left (SE)
  * a pale dawn sky with contrails
* **Through W2 (082855, west part):**
  * a huge **moss/lichen-covered boulder** (about 3 m) right outside, with dark slate slabs at its foot
  * birch, maple (yellow autumn leaves) and alder thicket
  * a conical cypress/thuja and a round shrub on the lawn
  * the river glimpsed at the left
  * a black roof gutter and downpipe outlet at the top-right outside corner of W2
* **Through K1 (082916, 082901):** a close **dark grey vertical-board clad building wall** with a lean-to roof edge, about 2–4 m away (neighbour or annex), and a white garden chair on a terrace.
* **Through K2:** the deck railing close in front, the river and red boathouses beyond.
* The house sits high on a slope. The lawn is about 2.5–3 m below interior floor level outside W1/W2.

---

## 8. Discrepancies with the floor plan

1. **Scale is 51.3 px/m** (not 50.5).
2. **Dining.**
   * Plan: round Ø about 1.3 table with 4 dark chairs.
   * Reality: oval extendable smoked-oak table about 2.0 × 1.05 with **6** cream bouclé chairs, axis about E–W, slightly skewed (rotationDeg about −8°), centre about (5.40, 6.80).
3. **Sitting area.**
   * Plan: 2 armchairs, a black rectangular coffee table and a 2-seat sofa.
   * Reality: 2 round **tub** chairs, a **pair of round nesting coffee tables**, a curved 3-seat bouclé sofa, a 2×3 rug, a palm and a pothos stand. The chandelier hangs over the group.
4. **Window wall.**
   * The plan's W1/W2 are 2.40 each with piers 0.14/0.17 and an end pier of 0.35.
   * The photos agree on equal-looking big fixed panes and the same head line as the door (2.10). They consistently show a **wider end pier (about 0.5)**, and middle piers of about 0.2.
   * Either the windows sit about 0.1 m further east than drawn, or they are slightly narrower (about 2.35).
   * Sill 0.42 and head 2.10 are not in the plan.
5. **Door.** The photos give 0.88–0.95 wide against 0.97 on the plan. Its east jamb is flush with the return wall at z 5.38 (the plan shows about 8 cm of wall). It opens outward and is hinged west.
6. **Kitchen windows.**
   * K1 ≈ 0.85–3.15 (plan 0.62–3.02). K2 ≈ 3.70–4.85 (plan 3.70–4.89).
   * Their sills (1.04 and 0.97) are not on the plan.
   * Both are top-hung opening windows.
7. **The plan omits:**
   * the ceiling step at z ≈ 3.3
   * the TV-stue bulkhead (x = 3.22, 2.4→3.0)
   * the window-wall LED slot
   * the 3–4 high-wall spots
   * the track pendants and ring lamp
   * the hob/downdraft in the peninsula
   * the 3 bar stools
8. **Peninsula.** It is drawn correctly as a 2.03 × 1.21 block against the kitchen south wall. In reality its end meets the wall **under** window K1 (west part), and it has seating on its west side.
