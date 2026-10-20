# Survey group 1 – TV-stue (nisjen) + vestveggen

Photos covered: `20261018_082726`, `082732`, `082736`, `082739`, `082742`, `082749`, `082755`, all taken with the Galaxy S25 ultra-wide (EXIF: 2.2 mm, 13 mm equivalent, 4000×3000).
Calibration sources: `plantegning.png`, `5_Tegninger/08_*` and `09_*`, `LES_MEG.txt`.

Coordinate system as specified: metres, +x = south (toward the big windows), +z = west (toward the TV-stue), +y = up. Origin is the floor at the inner face of the north and east outer walls. `rotationDeg` is three.js rotation.y; 0 means the front faces +z.

## 0. Method (read this first)

* **Plan scale is 51.4 px/m, not 50.5.** The outer width 7.22 m spans 371 px (x 83→453) and the outer length 12.21 m spans 628 px (y 44→671). Interior: x = (px − 90.5)/51.4, z = (py − 51.5)/51.4. With that scale the interior is 6.91 × 11.89 m, which matches the printed 6.92 m and 3.33+2.05+6.54 = 11.92 m. **high**
* **Camera poses:** I wrote a small solver (pinhole model plus Nelder-Mead) and solved photos 1, 3 and 7 from wall, ceiling and floor lines and corners, using the plan geometry and the user's ceiling height. The fitted focal length is 810–875 px at 2000-px image width, against a nominal 751 for 13 mm. The phone crops slightly when it corrects distortion, so the effective horizontal field of view is about 98–102°. Reprojection rms is 3–7 px. Objects were then measured by intersecting pixel rays with known planes (walls, floor, seat plane). Photos 4–6 are close-ups and their poses are only estimated by eye.
* **Cross-checks:**
  * The TV measures 1.71–1.72 × 0.99 m in two independent photos, which is exactly a 77″ panel.
  * The shelf height comes out the same (1.37–1.88 m) in photos 1 and 3.
  * Photo 2 is a front-on, level view, and with the shelf as scale it puts the nook ceiling at 2.41 m. That matches the user's 2.40 m. The older drawing said 2.35.
* Typical error: ±5–10 cm for wall-mounted things seen frontally, ±10–20 cm for floor objects, and ±0.3 m for things on the ceiling seen at a grazing angle.

## 1. Camera position per photo

The view direction is given as a yaw in the rotationDeg convention (0 = looking +z/west, 90 = +x/south, 180 = −z/east, −90 = −x/north). For a three.js camera, camera.rotation.y = yaw + 180°.

| Photo | Camera (x, y, z) | Yaw / pitch | What it shows | Conf. |
|---|---|---|---|---|
| 082726 | (4.51, 1.75, 10.34) | −99° / −12° | Standing in the living area, looking north into the whole TV-stue. Left: the west (TV) wall. Back: the north wall with the clerestory window and LED strip. Right: the bedroom-side wall with the shelf. Top: the Sand-coloured bulkhead face. Far right: a sliver of the high wall. | med |
| 082732 | (1.66, 1.60, 9.55) | 180° / ≈0° | Front-on view of the shelf on the bedroom-side wall (z = 8.33). Dark ceiling band at the top, sofa backs at the bottom. | med |
| 082736 | (2.43, 1.66, 10.81) | −153° / −34° | Looking down at the L-sofa, coffee table and rug. Clerestory window top-left, shelf, niche corner with switch, dining chairs beyond. | med |
| 082739 | ≈(2.1, 1.3, 9.5) | ≈162° / ≈−35° | Close-up of seat B, the arm and two cushions. The dining area shows past the niche corner. | low |
| 082742 | ≈(1.4, 1.35, 9.6) | ≈−141° / ≈−30° | Close-up of the sofa's inner corner: north wall on the left, bedroom-side wall on the right, two cushions. | low |
| 082749 | ≈(0.8, 1.6, 11.2) | ≈−167° / ≈−40° | Looking along the chaise toward the north-east corner. Throw, open chaise end, floor strip with baseboard, rug and table on the right. | low |
| 082755 | (1.03, 1.79, 9.37) | +21° / −22° | Standing at the inner corner of the L, looking west at the TV wall. North-west corner with plant on the right. Left: the living part of the west wall (painting, palm, curved sofa, a south window). Top: nook ceiling, bulkhead edge, sloping ceiling. | med |

## 2. Architecture

### 2.1 The TV-stue nook

**Footprint:** x 0.00–3.21, z 8.33–11.91, i.e. 3.21 × 3.58 m. **high**. The plan's own "3.58 m" dimension matches. The nook is open to the living area along the whole line x = 3.21.

Walls of the nook:
* North wall: outer wall, inner face x = 0.
* West wall: outer wall, inner face z = 11.91.
* Bedroom-side wall: the south face of the bedroom block at z = 8.33 (the plan wall is 0.14 thick, z 8.19–8.33).

**Niche corner:** at (x 3.21, z 8.33). This is a plain 90° outside corner where the bedroom-side wall (facing +z, Marrakesh) turns into the high wall (facing +x, Sand). There is no column and no visible chamfer. **high**

**Wall thicknesses:**
* The plan draws the outer walls 0.156 m thick. That cannot be real, because the window reveal alone is ≈0.21 m deep. The outer walls are probably ≥0.30 m. **med**
* The bedroom-block partitions are 0.10 m (high wall, x 3.11–3.21) and 0.14 m (z 8.19–8.33), from the plan. **med**

**Ceiling:** flat at **2.40 m** over the whole nook. **high** (user fact, checked in photo 2 at 2.41)

**Bulkhead:** a vertical face in the plane x = 3.21, coplanar with the high wall. It runs from y 2.40 to 3.00 and from z 8.33 to 11.91. Its bottom edge is sharp, with no light in it and no trim.
* In photo 1 it is the light band across the top; in photo 7 it is the line running up-left from the TV-wall point (3.21, 2.40, 11.91).
* Existence and position: **high**. The 3.00 top edge is a user fact and could not be measured, because it is above the frame in every photo.

**Living-room ceiling at the west wall**, measured in photo 7 from the wall/ceiling junction:

| x (m) | 4.46 | 5.40 | 5.97 |
|---|---|---|---|
| Measured height (m) | 2.68–2.78 | 2.42–2.55 | 2.35–2.49 |
| User's 3.0 → 2.4 slope (m) | 2.80 | 2.65 | 2.55 |

The user's model is a linear slope from 3.00 at x = 3.21 to 2.40 at x = 6.91 (0.162 m/m, 9.2°). The measurements agree with it within about 0.1 m; they are slightly lower near the windows, but at the extreme image edge. **low–med**. Model it as a single plane sloping along x and constant along z. The slope seems to continue to the west wall (z = 11.91) next to the nook.

**Paint:**
* **Bulkhead face and high wall: SAND.** The light band in photo 1 runs straight into the high-wall sliver at the right edge. **high**
* **Nook ceiling: MARRAKESH.** It is clearly darker than the bulkhead face in every photo. **high**
* **Bedroom-side nook wall: MARRAKESH.** It is the darkest and warmest wall in every photo. **high**
* **North wall of the nook** (window wall) looks markedly lighter and cooler in every photo (#a8aba5–#bcbfb0, against #504136–#72655a for the bedroom-side wall). That is consistent with it facing the big south windows and getting direct daylight. Since the user says the TV-stue walls are the darker colour, treat it as **MARRAKESH**. **med-low**
* **West (TV) wall: no paint boundary at the niche line.** A contrast-enhanced crop of photo 7 shows no vertical colour edge where the wall passes x = 3.21, so the west wall seems to be one colour all along. Inside the nook it reads as Marrakesh. Whether the living-room part (x > 3.21) is Marrakesh too or Sand **must be confirmed by the groups that see the sitting area**. **low**
* Observed photo colours, which are heavily affected by light: Marrakesh zone lit #7c7061–#857a6e, in shadow #4b3f2f–#51483d; Sand/bulkhead lit #c8c3b6, in shadow #746e5d. **Use the paint references, not these values, if another group finds them.**

**LED strip:** one recessed linear profile in the nook ceiling, tight against the north wall (x ≈ 0.02–0.05, y = 2.40). It runs the full nook width, z ≈ 8.40–11.85, and works as a wall-washer on the north wall.
* Light is warm white, ≈2700 K (glow ≈ #ffc98a); the profile itself is a ~2 cm bright line.
* There is no LED along the bulkhead edge or on the other nook walls. In photo 7 the warm glow near the north-west corner of the TV wall is spill from this strip.
* **high**

**Recesses and columns:** none beyond the nook itself, and no columns.

## 3. Openings

### North clerestory window (nook)

This is a horizontal ribbon window high on the north wall.

| Property | Value | Conf. |
|---|---|---|
| Position | x = 0, z 9.24–10.97 | high |
| Width | ≈1.73 m (wall-surface edge of the reveal) | med |
| Height | ≈0.48 m: sill 1.65, top 2.13 (0.27 below the ceiling) | med |
| Centring | 0.91 from the north-east nook corner (z 8.33), 0.94 from the north-west corner (z 11.91), so practically centred on the nook. Window centre 10.10, nook centre 10.12. | high |
| Plan comparison | Plan draws it at z 8.99–10.79 (1.80 m). Photos win. | – |
| Frame | Black/anthracite (≈#232425) slim aluminium-clad, ≈5–6 cm visible. One fixed pane, no mullions, no visible handle. Possibly top-hung, can't tell. | med |
| Reveal (lysning) | Depth ≈0.21 m from the wall surface to the frame face (measured in photo 3), square edges | med |
| Reveal colour | Light: white or Sand, painted, looks lighter than the Marrakesh wall | low |
| Sill | Bottom reveal is flat and in the same light finish; no projecting stone or wood sill visible | – |
| Sill décor (left → right) | Stack of magazines/books (≈0.25 × 0.18 × 0.06), clear bulbous glass vase (Ø0.10, h0.12), small cream ceramic vase with dark dried sprigs (h≈0.10 + 0.12 stems), small brown/amber bottle vase with a dark sprig, oval grey rope/cotton basket (≈0.30 × 0.15, h0.10) at the right end | – |

The plan's "Vindu mål 48×117" note belongs to the bathroom window. It has the same 48 cm height, so this is likely the same window series.

### Other openings

* **No doors are visible** in these photos. Photo 1 shows only the high wall's end as a light sliver right of the niche corner. Photos 3 and 4 look through the nook opening at the floor and dining chairs.
* **South window (seen only at the far left of photo 7):** a black frame and white reveal near the south-west corner (wall x = 6.91), a green plant in front, greenery outside. Leave the details to the groups covering the south wall.

## 4. Floor and baseboards

* **Planks:** oak-look (wood laminate, vinyl or real oak, matt). **They run along z (east–west)**, parallel to the north wall and perpendicular to the TV wall. Plank lines converge on the +z vanishing point in photo 7 and run parallel to the north-wall baseboard in photo 6. **high**
* **Plank width:** about **0.24 m**. In photo 7 the dark joints repeat every 86–93 px, which is 0.23–0.27 m on the floor. **med-low**. Plank length is unknown (long, >1.8 m; no clear end joints visible).
* **Floor colour:** light greige oak, warm grey-taupe with soft grain. Suggested base **#a59c93**, grain ±6 %. Photo samples run from #8d837e and #a5a7aa in daylight to #6b6a6c in shadow. **med**
* **Baseboard:** white, about **#ecebe6**. Height **0.07 m** (17 px at a computed 4.2 mm/px in photo 7), about 12 mm thick, square profile with a small top bevel. It runs along every wall in the nook and along the west wall. **med-high**

## 5. Furniture and objects in the nook

Extents below are given in world axes; rotationDeg is the direction the front faces.

### 5.1 Hjørnesofa (L-shaped corner sofa)

**Overall footprint:**
* Long side, along the bedroom wall: x 0.00–2.95, z 8.35–9.27 (depth 0.92). The front faces +z, toward the TV: **rotationDeg 0**.
* Short leg, along the north wall: x 0.00–0.95, z 8.35–10.38. Its front faces +x.
* Overall size: **2.95 (x) × 2.05 (z)**. **med**

**Style:** boxy block modules that sit directly on the floor (plinth base, no visible legs). Contrasting welt piping runs along every edge. Back cushions are blocky with rounded corners.

**Fabric:** soft woven melange or light chenille in **mid grey #6e6c69**, slightly warm. Piping is **#55514c**. Seen colours range from #47474c in shadow to #686360 lit, and look blue-ish in daylight.

**Modules along the long side, from the north wall:**
1. **Corner module**: x 0–0.95, z 8.35–9.25, with backs against both walls.
2. **Seat A**: x 0.95–1.87.
3. **Seat B**: x 1.87–2.68.
4. **Arm**: x 2.68–2.95. This is the only arm, at the +x end, and it spans the full depth z 8.35–9.27.

Seams measured in photo 3 at x 1.00 / 1.87 / 2.73, arm outer face at 2.9–3.07. In photo 1 the arm outer face was at 2.83–2.91.

**Short leg ("sjeselong" / open end):**
* Module at x 0–0.95, z 9.25–10.38. The seam to the corner module was measured at z ≈ 9.2.
* Its back cushion lies along the north wall (x 0–0.25) from the corner to **z 9.82**, ending in a sloped end.
* From 9.82 to 10.38 the seat is open, and the end at **z 10.38 has no arm**.
* The chaise seat is one long cushion.

**Heights:**

| Part | Height | Conf. |
|---|---|---|
| Seat (top of cushion) | 0.45 (base box ≈0.30 + cushion ≈0.15) | med |
| Backrest top | ≈0.85, thickness ≈0.25 | med |
| Arm | 0.63, width 0.27 | med |
| Seat depth | ≈0.67 (0.92 − 0.25) | – |

The plan does not match this sofa; see section 8.

### 5.2 Puter (cushions)

There are four cushions (**med**). They come in two kinds:
* **Dark taupe-brown chunky knit (piqué/waffle)**, #4a403c. Square and slightly floppy.
* **Cream "bobble/popcorn" shag**, #e4ddd3, with a fluffy relief texture.

Placement:
* **Inner corner:** a dark knit 45×45 leaning in the corner at ≈(0.40, 0.65, 8.62), turned about 45°, with a cream bobble 45×45 in front of it at ≈(0.75, 0.62, 8.65).
* **Near the arm:** a dark knit ≈50×50 at ≈(2.35, 0.66, 8.62) and a cream bobble 45×45 leaning on the arm at ≈(2.58, 0.62, 8.72), rotated about −30°.

### 5.3 Pledd (throw)

Cream/ivory waffle- or honeycomb-knit throw (#e0d6c8), folded to ≈0.55 × 0.45 × 0.06. It lies on the open end of the chaise at ≈(0.45, 0.48, 10.10). **med**

### 5.4 Sofabord (coffee table)

* **Size and position:** **1.20 (x) × 0.60 (z) × 0.43 h**, centre **(1.85, 9.74)**, long axis along x. Extents x 1.24–2.47, z 9.43–10.05. Measured from the legs in photo 1 and the top corners in photo 3. **med**
* **Top:** anthracite concrete or ceramic look, #4a4746 mottled with #5c5856, ≈3 cm slab.
* **Frame:** black powder-coated steel, ≈2×2 cm square tube (#1b1b1b). It is a closed box frame: four corner legs plus a bottom rectangle of stretchers lying on the rug.
* **On top:**
  * Two clear glass globe tealight holders (Ø0.10) on the north half, at about (1.55, 9.6) and (1.65, 9.85).
  * Three small jar candles (Ø0.06–0.07, h0.08–0.10): one amber glass with a wooden lid, one sage-green frosted, one cream frosted with a gold lid. They stand at about x 2.0–2.2, z 9.7–9.9.

### 5.5 Teppe (rug)

* **Size and position:** **2.30 (x) × 1.60 (z)**, centre **(1.92, 9.87)**. Extents x 0.77–3.07, z 9.05–10.68. **med**
* It runs under the sofa's long side (z < 9.27) and under the chaise (x < 0.95). Its west edge (z 10.68) agrees within 1 cm across three photos.
* **Pile:** low–medium soft shag, with a thin white bound edge.
* **Pattern:** Bauhaus / mid-century geometric on a light silver-grey base (#c4c2bf):
  * large charcoal half-moons and lens shapes (#2e2f33);
  * overlapping mid-grey rectangles (#8f8d8b) and a few lighter cream-grey blocks (#d6d3ce);
  * two bands of fine black-and-white pinstripes running across the short direction.

### 5.6 TV

* **Size:** **77″ class, 1.72 × 0.99 m** (photo 7: 1.71 × 0.99; photo 1: 1.72 × 1.02). Black glass screen #100e0f with a hairline black bezel. Thin OLED-type panel, ≈5 cm off the wall in total.
* **Mounting:** on the west wall, front facing −z, so **rotationDeg 180**. Front face at z ≈ 11.86.
* **Position:** centre **x 1.72, y 1.05** (bottom 0.56, top 1.55). Photo 1 alone gives centre x 1.57, but that view is grazing; photo 7 is more frontal and the speakers are symmetric about 1.72.
* There is **no TV bench and nothing on the floor under it.**
* **Conf.:** size high, position med.

### 5.7 In-wall speakers (LCR)

All three are flush, rectangular paintable grilles with a thin frame, in light grey/white (#d6d6d4).
* **Two vertical speakers, ≈0.20 × 0.38**, centres at **x 0.70** and **x 2.74**, y 1.06 (bottom 0.86, top 1.25). They sit symmetrically ≈1.02 m either side of the TV centre.
* **One horizontal centre speaker, 0.40 × 0.13**, centre **(1.72, 0.38)** (y 0.32–0.45), centred under the TV.
* **Conf.:** med.

### 5.8 Vegghylle (wall shelf)

**Overall:** an asymmetric black metal "grid" wall shelf on the bedroom-side wall (z = 8.33, facing +z), above seats A/B. **1.20 w × 0.50 h × ≈0.20 d**, x **1.03–2.23**, y **1.37–1.87**. **med**

Elements, all matt black (#1e1e1e). Boards are ≈18–20 cm deep with a ≈4 cm back lip; flat bars are ≈1.5 cm wide.

| Element | x | y |
|---|---|---|
| Uprights | 1.11, 1.41, 1.81, 2.13 | spans 1.40–1.60, 1.37–1.82, 1.37–1.82 and 1.62–1.87 respectively |
| Horizontal bar (top) | 1.28–2.18 | 1.80 |
| Horizontal bar (middle) | 1.07–1.95 | 1.55 |
| Horizontal bar (short, low) | 1.41–1.55 | 1.39 |
| Board, top | 1.37–1.84 | 1.81 |
| Board, upper right | 1.77–2.22 | 1.65 |
| Board, middle | 1.37–1.84 | 1.52 |
| Board, lower left | 1.03–1.41 | 1.36 |

Décor:
* **Top board:** a clear glass candle holder with a white pillar candle (Ø0.06, h0.09) and a cream "stacked pebbles" ceramic sculpture (h0.13).
* **Upper right:** a small artificial green plant (fern or rosemary type) in a seagrass basket pot (Ø0.09, h0.10, plant to 0.18).
* **Middle:** a smoked grey glass bottle vase (Ø0.07, h0.13).
* **Lower left:** a grey ribbed glass votive (Ø0.07, h0.07) and a small aloe-type artificial plant in a seagrass basket pot.

### 5.9 Plant on a pedestal (north-west corner)

* **Pedestal:** matt black cube ≈0.33 × 0.36 × 0.40 h, centre **(0.25, 0.20, 11.73)**, set 0.08 off the north wall and against the TV wall.
* **Pot and plant:** a white ceramic pot (Ø0.22, h0.18) with an artificial trailing plant with heart-shaped dark green leaves and white veins (Anthurium clarinervium / satin-pothos look). The plant spreads ≈0.45 across, tops out at ≈0.85 m and hangs down over the pedestal front.
* **Conf.:** med.

### 5.10 Floor vase with hydrangeas

* At the sofa arm, in front of the niche corner. Floor position **(3.09, 8.48)**. **med**
* Cream/greige ceramic floor vase with horizontal ribs (#cfc6b8), h≈0.45, max Ø≈0.17 (bulbous body, narrow neck).
* Artificial light-blue hydrangea heads (#9fb8d8) with green leaves rise to ≈0.80 m.

### 5.11 Black cylinder (optional clutter)

A black textured cylinder at ≈(0.15, 0, 10.52), between the chaise's open end and the north wall. About Ø0.16, h≈0.35, hollow open top. It looks like a foam roller or a rolled mat standing on end. **low**

### 5.12 Switch and socket

Both are on the bedroom-side wall (z = 8.33), next to the niche corner:
* **Switch:** a matt black square plate, about 8.5 × 8.5 cm (might be a double plate, ≈14 × 8), centre ≈ **(3.13, 1.22)**. **med**
* **Socket:** a black double socket ≈0.15 × 0.08 at ≈ **(3.12, 0.23)**. **med-low**

### 5.13 Radiators and vents

None visible in the nook.

### 5.14 Seen in passing (outside the nook)

These come from photo 7 and photos 3/4. **low**. Other groups should refine them.
* **Abstract canvas** on the west wall at roughly x 4.83–5.80, y 1.33–1.93 (≈0.95 × 0.60 visible). Cream and white with grey and black vertical streaks, like rain or birch trunks, with dark canvas edges.
* **Artificial areca/kentia palm** (≈1.7 m) in a white ribbed ceramic pot (Ø≈0.30, h≈0.30). Pot on the floor at **(4.25, 11.66)**, just south of the nook line by the west wall.
* **Possible round object** (a mirror with a thin frame?) partly behind the palm on the west wall, around x 4.4–4.7, y 1.1–1.5. Verify.
* **Curved grey bouclé sofa** (organic shape, low rounded back) along the west wall from x ≈ 4.8 to ≈ 6.6, on a light-grey rug, with a grey knitted throw on its east end. A round black metal base (floor lamp or side table) stands at the far left near the south-west corner.
* **Through the opening:**
  * cream or ivory upholstered dining chairs with thin black splayed metal legs;
  * green-grey velvet chairs at a dark table with a plant, possibly bar stools at the island.

## 6. Lighting (nook)

* **Ceiling lamp:** a semi-flush 3-ring LED fixture.
  * Three overlapping rings, Ø ≈ 0.45 / 0.40 / 0.30, offset so the whole fixture spans ≈0.8 m.
  * Each ring has a black outer band (≈3 cm tall) and a warm LED diffuser on its inner face and underside (glow #e5c18d). The central hub is chrome.
  * The ring undersides sit at ≈2.28–2.32 m.
  * Centre ≈ **(1.6, 10.1)**. Photo 1 sees it nearly edge-on: x is ±0.3 (low), z is med. It appears centred in the nook.
* **LED strip:** the north-wall wall-washer described in 2.1. **high**
* **Black ceiling pucks:**
  * one Ø≈0.12–0.15, ≈3 cm thick, at ≈(2.6, 2.40, 8.8), most likely a smoke detector;
  * one small (Ø≈0.06) at ≈(0.4, 2.40, 8.7) near the north-east corner, probably a sensor.
  * **low** position
* **Nothing else:** no spots, tracks, floor lamps or table lamps in the nook. The candles are listed in 5.4 and 5.8.

## 7. Outside view

**North clerestory window** (photos 1 and 3):
* The lower half to two thirds of the view is filled by a light grey-blue neighbouring building or flat-roof parapet, close by (≈5–15 m) and slightly below window level, with a few thin posts in front.
* Above it: autumn trees (dark spruce, birch and maple in yellow and orange) and houses on a rising hillside. A white house with a dark grey roof is visible in photo 3.
* The sky is overcast white.
* The glass also reflects interior lights.

**South window** (photo 7, far left only): greenery, trees and a plant. **Terrace and terrace door are not in my photos.**

## 8. Discrepancies with the floor plan

1. **Scale** is 51.4 px/m, not 50.5 (see section 0).
2. **TV bench missing:** the plan shows a dark TV bench at x 0.67–2.81, z 11.47–11.91. It **does not exist**. The TV is wall-mounted with in-wall speakers and the floor below is free.
3. **Sofa wrong:**

   | | Plan | Photos |
   |---|---|---|
   | Long side | x 0.09–3.12, depth 1.10 | x 0–2.95, depth 0.92 |
   | Chaise | to z 9.89, depth 1.07 | to z 10.38, depth 0.95 |
   | Arms | at both ends of the long side | one arm at x ≈ 2.7–2.95; chaise end open |
   | Modules | three equal back modules | corner + two seats + arm, plus the chaise |

4. **Missing items:** the plan has no coffee table, rug, shelf or pedestal plant in the nook. All of them exist (section 5).
5. **North window:** the plan has z 8.99–10.79; the photos give z 9.24–10.97, at a high level (sill 1.65, top 2.13).
6. **Grey box** at plan x 3.3–3.9, z 11.37–11.91: probably stands for the plant spot. The real palm pot is at (4.25, 11.66).
7. **Ceiling not shown:** the plan has no ceiling information. Add the 2.40 m nook ceiling, the 0.6 m Sand bulkhead at x = 3.21 and the sloping living ceiling.
8. **Older drawing (08/09)** gives the nook ceiling as 2.35. The user's 2.40 is supported by photo 2.
9. **Useful for other groups**, from the plan at 51.4 px/m:
   * The kitchen/dining part (z 0–5.38) is only **6.30 m** wide (x 0–6.30). At z ≈ 5.38 the south wall steps out to x = 6.91.
   * The terrace door swing is drawn on the south wall at z ≈ 5.5–6.5.
   * There is an opening or door in the bedroom-block east wall at z ≈ 3.31–4.30. So the high wall (x = 3.21) runs from about z 4.30–4.40 (door frame) to z 8.33 (niche corner), about 3.9–4.0 m, which matches "ca. 390".

## 9. Model-ready summary (JSON)

```json
{
  "nook": {"x": [0, 3.21], "z": [8.33, 11.91], "ceilingY": 2.40, "paint": "MARRAKESH",
           "bulkhead": {"x": 3.21, "y": [2.40, 3.00], "z": [8.33, 11.91], "paint": "SAND"},
           "ledStrip": {"from": [0.03, 2.40, 8.40], "to": [0.03, 2.40, 11.85], "kelvin": 2700, "type": "recessed wall-washer"}},
  "livingCeiling": {"type": "slope-x", "yAtX3_21": 3.00, "yAtX6_91": 2.40, "paint": "SAND"},
  "floor": {"plankDir": "z", "plankWidth": 0.24, "color": "#a59c93", "baseboard": {"h": 0.07, "t": 0.012, "color": "#ecebe6"}},
  "windows": [{"id": "nord_overlys", "wall": "x=0", "z": [9.24, 10.97], "y": [1.65, 2.13], "frame": "#232425", "revealDepth": 0.21, "panes": 1}],
  "objects": [
    {"id": "hjornesofa", "type": "sofa_L", "longSide": {"x": [0, 2.95], "z": [8.35, 9.27]}, "chaise": {"x": [0, 0.95], "z": [8.35, 10.38], "backTo": 9.82, "openEnd": true},
     "seatH": 0.45, "backH": 0.85, "backT": 0.25, "arm": {"x": [2.68, 2.95], "h": 0.63}, "seams": [0.95, 1.87], "chaiseSeam": 9.25,
     "fabric": "#6e6c69", "piping": "#55514c", "rotationDeg": 0},
    {"id": "sofabord", "type": "coffee_table", "center": [1.85, 9.74], "w": 1.20, "d": 0.60, "h": 0.43, "rotationDeg": 90, "top": "#4a4746", "frame": "#1b1b1b", "frameType": "box"},
    {"id": "teppe_tvstue", "type": "rug", "x": [0.77, 3.07], "z": [9.05, 10.68], "base": "#c4c2bf", "accents": ["#2e2f33", "#8f8d8b", "#d6d3ce"], "pattern": "geometric half-moons + pinstripe bands"},
    {"id": "tv", "type": "tv_wall", "center": [1.72, 1.05, 11.885], "w": 1.72, "h": 0.99, "d": 0.05, "rotationDeg": 180},
    {"id": "hoyttaler_1", "type": "inwall_speaker", "center": [0.70, 1.06, 11.905], "w": 0.20, "h": 0.38, "rotationDeg": 180},
    {"id": "hoyttaler_2", "type": "inwall_speaker", "center": [2.74, 1.06, 11.905], "w": 0.20, "h": 0.38, "rotationDeg": 180},
    {"id": "senterhoyttaler", "type": "inwall_speaker", "center": [1.72, 0.38, 11.905], "w": 0.40, "h": 0.13, "rotationDeg": 180},
    {"id": "vegghylle", "type": "wall_shelf_grid", "x": [1.03, 2.23], "y": [1.37, 1.87], "z": 8.33, "depth": 0.20, "rotationDeg": 0, "color": "#1e1e1e"},
    {"id": "plante_sokkel", "type": "plant_on_pedestal", "center": [0.25, 11.73], "pedestal": [0.33, 0.36, 0.40], "pot": {"d": 0.22, "h": 0.18, "color": "#f2f0ec"}},
    {"id": "gulvvase_hortensia", "type": "floor_vase", "center": [3.09, 8.48], "h": 0.45, "d": 0.17, "flowerTop": 0.80, "color": "#cfc6b8", "flowers": "#9fb8d8"},
    {"id": "taklampe_ringer", "type": "ceiling_rings", "center": [1.6, 10.1], "bottomY": 2.30, "rings": [0.45, 0.40, 0.30], "color": "#111111", "glow": "#e5c18d"},
    {"id": "royk_varsler", "type": "ceiling_puck", "pos": [2.6, 2.40, 8.8], "d": 0.13},
    {"id": "bryter", "type": "switch", "pos": [3.13, 1.22, 8.33], "size": 0.085, "color": "#111111"},
    {"id": "stikk", "type": "socket", "pos": [3.12, 0.23, 8.33], "w": 0.15, "h": 0.08, "color": "#111111"}
  ],
  "cushions": [
    {"pos": [0.40, 0.65, 8.62], "size": 0.45, "color": "#4a403c", "texture": "chunky knit"},
    {"pos": [0.75, 0.62, 8.65], "size": 0.45, "color": "#e4ddd3", "texture": "bobble shag"},
    {"pos": [2.35, 0.66, 8.62], "size": 0.50, "color": "#4a403c", "texture": "chunky knit"},
    {"pos": [2.58, 0.62, 8.72], "size": 0.45, "color": "#e4ddd3", "texture": "bobble shag"}
  ],
  "throw": {"pos": [0.45, 0.48, 10.10], "size": [0.55, 0.06, 0.45], "color": "#e0d6c8", "texture": "waffle knit"}
}
```

Suggested Norwegian UI labels for these objects: Hjørnesofa, Sofabord, Teppe, TV (77″), Innfelte høyttalere, Vegghylle, Plante på sokkel, Gulvvase med hortensia, Taklampe (ringer), LED-list, Overlysvindu.
