# Survey group 3: south window wall, sitting area, niche corner (7 photos)

Photos: `20261018_082829`, `082833`, `082838`, `082841`, `082843`, `082845`, `082850`.
All seven were taken with the Galaxy S25 ultra-wide camera (EXIF: f = 2.2 mm, 13 mm-equiv., 4000×3000). Pinhole focal length = **1502 px**. The images look rectilinear (distortion-corrected).

Coordinates follow the task convention: metres; +x = south (windows); +z = west (TV-stue); +y = up. The origin is the inner top-left corner of the plan. `rot` = three.js rotation.y in degrees, where the facing direction is (sin rot, 0, cos rot).

Confidence tags: **[H]** high, **[M]** medium, **[L]** low.

## 0. Method and plan calibration

* **Plan scale [H].** The file `plantegning.png` is 587×802 px, and the dimension lines give **51.3 px/m**, not 50.5:
  * 6.92 m = 355 px (interior width of the living zone).
  * 7.22 m = 371 px (outer width).
  * 12.21 m = 625 px (outer length).
  * The interior origin is at pixel (90.5, 51.5). Wall pixels were found by a dark-pixel scan.
* **Plan coordinates used [H, as drawn].** All are interior faces.
  * South wall of the living zone x = 6.92. South wall of the kitchen zone x = 6.31 (z 0–5.38).
  * Step/return wall ("jog") z = 5.38 (x 6.31–6.92). West wall z = 11.93.
  * High wall x = 3.22 (drawn 0.10 thick, x 3.12–3.22), running z 4.41 → 8.34.
  * Bedroom south wall (the TV-stue back wall) face at z = 8.34 (drawn 0.14 thick). Bedroom north wall z 4.42–4.52.
  * Small-room east wall x = 3.22 (z 2.23–4.42), with an opening at z 3.35–4.36. Bathroom east wall x 2.52–2.62.
  * South-wall openings in the plan:
    * Terrace door z 5.49–6.45, swinging outward.
    * Pier 6.45–6.59.
    * **Window A 6.59–9.01**.
    * Pier 9.01–9.19.
    * **Window B 9.19–11.60**.
    * End wall 11.60–11.93.
* **Photogrammetry.** I wrote a small pinhole and Nelder-Mead solver (node). Camera poses were fitted to plan-known lines and points. Image points were then back-projected onto known planes (floor y=0, sill plane, wall planes) to get positions.
  * Photo 082829 solved well: **rms 12 px** on 7 references. Most absolute numbers below come from it.
  * Photo 082833 did not solve consistently (30–130 px residuals), so it is used only qualitatively.
  * The frontal window shots (082841, 082850) were solved for shape: glass aspect ratio, and the camera offset relative to the glass. They were then scaled with the plan window width. Both scaled solutions give the **same camera height, 1.62 m**, which cross-checks the sill and glass heights.

## 1. Photo-by-photo

| Photo | Camera (x, y, z) | Direction | Conf. | What it shows |
|---|---|---|---|---|
| **082829** | **(6.40, 1.43, 9.97)** ±(0.2, 0.1, 0.3) | rot **199°** (looking east toward the kitchen, turned 19° toward the high wall), pitch **35° down**, roll −2° | M (solved, rms 12 px) | Overview from the window side of the sitting area. Left: TV-stue back wall (MARRAKESH) with switch and socket, the L-sofa arm with cushions, floor vase in the niche corner. Centre: the whole high wall (SAND, 4 wall-wash scallops, black door at the far end, black wall unit above the door, 2 switches), 2 boucle swivel chairs on a chunky grey rug, the dark two-lobed coffee table with candles, oval dining table with 6 chairs. Far end: kitchen. Right: windows A and B, the pier, sills with decor, and the face of the step wall with a socket. |
| **082833** | ≈(3.8, 1.3, 9.4) ±(0.3, 0.2, 0.4) | rot ≈ **225°** (looking NE into the niche corner), pitch ≈ 40–45° | L | Close-up of the outer convex corner of the bedroom block, at (3.22, 8.34): white high wall on the right, dark TV-stue wall on the left. Shows the L-sofa east arm (outer face plus top), back cushion, 3 cushions, the floor vase with hydrangeas, a socket on each wall, the light baseboard, floor planks, the corner of a light-grey rug under the sofa, and the high-wall door frame far away at the top right. |
| **082838** | ≈(6.2, 1.3, 8.0) ±0.3 | rot ≈ 95° (south), pitch ≈ 45–50° | L–M | Looking down at window A from inside, almost square-on. Shows the whole sill of A (glass candle holder at its east part, black vase with eucalyptus at its west part), the A/B pier, the start of B's sill (rosemary), the apron with 2 black sockets, the baseboard, plank joints along z, the boucle chair and rug corner at the bottom right. |
| **082841** | ≈(6.30, 1.62, 8.03) | rot ≈ 92°, pitch 11.6° down, roll −2.5° | M | Window A straight on: one fixed pane in a black frame. View: terrace (left), stair, lawn, river. |
| **082843** | ≈(6.3, 1.6, 8.0) (same spot) | rot ≈ 115° (SSE), pitch ≈ 11° | L | Window A seen at an angle toward the east. Shows A's east reveal, the narrow wall strip toward the step corner, the head soffit, and the ceiling LED strip at the top left. Outside: terrace railing, privacy screen, stair, a wooden annex/shed east of the terrace. |
| **082845** | ≈(6.3, 1.6, 7.6) | rot ≈ 65° (SSW), pitch ≈ 12° | L | Window A west part, A's west reveal, the pier, window B and its reveals, 2 glass tealight holders on B's sill. The ceiling LED strip runs along the window wall and ends at the west wall. A plant in a black wire stand near the SW corner. The west wall reads darker. |
| **082850** | ≈(6.37, 1.62, 10.57) | rot ≈ 93°, pitch 14.6° down, roll ≈ −5° | M–L | Window B straight on: one fixed pane, black frame, rosemary at the east end of the sill. View: big mossy boulder, slate slabs, lawn, river, trees. |

Notes on the poses:
* In 082841 and 082850 the distance from the glass comes from the image width ÷ glass width. The glass width is taken as 2.42 − 2×0.075 = 2.27 m.
* 082843 and 082845 were taken from about the same spot as 082841. Only the camera direction was estimated: from where window A's jambs fall in the image, and from the horizon height (the far river at y ≈ 1180–1200 px).

## 2. Architecture

* **High wall [H].** Plane x = 3.22, facing +x.
  * It runs from the niche corner at z = 8.34 to the outer edge of the door frame at **z ≈ 4.41**, so it is **3.93 m long**. This matches the "≈390 cm".
  * The corner itself is the convex south-east corner of the bedroom block. The TV-stue nook lies beyond it (x < 3.22, z > 8.34).
  * Colour **SAND** [H].
* **TV-stue back wall [H].** The bedroom's south face, z = 8.34, facing +z. Colour **MARRAKESH** (clearly darker grey-brown). Its baseboard is the same light baseboard as elsewhere.
* **Step/return wall [H].** z = 5.38, facing +z, x 6.31 → 6.92 (0.61 m wide). SAND. Socket at ≈(6.40, 0.13, 5.38) [L].
* **South window wall [H].** x = 6.92, SAND, including the reveals.
  * Pier between A and B: **0.18–0.19 m** wide [M]. The plan says 0.18; 082829 gives 0.19. It runs full height, floor to ceiling.
* **West wall** (z = 11.93, seen past window B in 082845): it reads about 2× darker than the window reveals in the same frame. It could be MARRAKESH, continuing the TV-stue wall where the TV is, or it could just be in shadow. **[L], please verify.**
* **Wall thickness.**
  * Interior partitions as drawn: 0.10 for the high wall, 0.14 for the bedroom south wall [M].
  * The outer south wall is much thicker than the plan's 0.16. The reveal from wall face to frame is ≈ 0.30, so **model it ≈ 0.40 m thick**: 0.30 reveal + ≈0.10 frame and outer leaf [M].
* **Ceiling.** I cannot see it in my photos; all of them are pitched down or framed below the ceiling.
  * Use the user's values: 3.0 at x = 3.22, sloping to 2.4 at x = 6.92. That is a slope of 0.162 m/m (9.2°): **h(x) = 3.0 − 0.162·(x − 3.22)**.
  * The window heads are at ≈2.12 (see §3), so there is a band of wall **≈0.28 m tall above the windows** under the 2.4 m ceiling line. In 082845 this band is lit warm by the LED strip [M].
* **Ceiling steps (bulkheads).** Not visible in my frames.
  * In 082829 the image top at z ≈ 5.4 only reaches y ≈ 2.3 m. The kitchen's flat 2.4 m ceiling is visible further on (z ≈ 2–4), with the pendant track on it.
  * Drawing 08 says the TV-stue soffit bottom ("nisjetak") is 2.35 m. That fits the user's 2.4 m flat TV-stue ceiling.
* **LED strips.**
  1. **South window wall [M].** A narrow warm-white linear strip in the ceiling right along the top of the wall (0–0.2 m from the wall face, y ≈ 2.4). It runs east–west and ends at the west wall (082845). It is still present at the east end of window A (082843), so it runs at least z ≈ 6 → 11.9, probably the full 5.38 → 11.93. It grazes the 0.28 m band above the window heads. Its reflection is also visible in window A's glass in 082829.
  2. **Kitchen ceiling [L].** A linear LED along the tall-unit side, at x ≈ 3.4–3.6, running along z, seen at the far end of 082829.
  3. Under-cabinet and in-cabinet LEDs in the glass wall cabinets (kitchen).
* **Niches and columns.**
  * The only "niche" is the TV-stue nook, beyond the corner (3.22, 8.34).
  * The only column is the A/B pier (0.18 m), with 0.30 m reveals on both sides.
  * No radiators or vents are visible; floor heating is likely.
  * A **black wall-mounted box above the high-wall door**, probably a heat-pump indoor unit. Roughly 0.75 × 0.28 m, bottom at ≈2.4–2.5 m, spanning z ≈ 3.7–4.4 (left edge flush with the door frame) [L]. Drawing 08 has it at 2.59–2.86 m.

## 3. Openings

### Window A (south wall, x = 6.92)
* **Position and width [M].** Use the plan, **z 6.59 → 9.01 (2.42 m)**.
  * Photo check: in 082838 the candle holder and the vase sit at 0.18 and 0.70 of the sill width. Their 3D positions from 082829 are z = 6.95 and 8.27. Together these give an opening of ≈6.5 → 9.0.
  * A direct back-projection from 082829 placed the west sill corner at 8.72. That point is probably mis-identified, so the plan is preferred.
* **Sill top 0.30 m [M].** Two independent estimates:
  * 082829: the sill edge relative to the floor line under B gives 0.26–0.28.
  * 082838: using the 84 mm socket plate as scale gives 0.29–0.31.
* **Head ≈ 2.12 m [M].** So the opening height is **≈1.82**.
  * Derivation: the glass aspect ratio W/H is **1.36**, from a projective fit of all 4 glass edges plus the horizon in 082841 (rms 11 px). With glass W ≈ 2.27 this gives glass H ≈ 1.67, glass at **0.38 → 2.05**, plus a 0.07 head frame.
  * Cross-check: the warm wall band above the heads is ≈0.3 m.
* **Frame and glazing.**
  * Black frame (≈#1c1e21, satin), aluminium-clad, with a visible face of ≈7–8 cm. The bottom member has a small step (glazing bead). Small round screw caps sit on the frame.
  * **One fixed pane. No mullions, no sash, no handle** [M].
  * A small glass-marking label at the lower right of the glass.
* **Reveal (lysning) [M].** **0.30 ± 0.05 m deep** to the frame. This comes from 082829: the back sill corner back-projects to x ≈ 7.22–7.24.
  * The reveals and the sill are smooth and painted light, SAND or a near-white SAND (#d9d4ca).
  * The sill (vindusbrett) has a square nose, is ≈2.5 cm thick, flush with or ≤2 cm proud of the wall, and runs the full reveal depth.
* **Apron.** The SAND wall below the sill carries black sockets:
  * one under A's east part at ≈(6.92, 0.13–0.20, 6.6);
  * one under the pier / east end of B at ≈(6.92, 0.13, 9.0).

### Window B (x = 6.92)
* **Position [M].** Use the plan, **z 9.19 → 11.60 (2.41 m)**. The rosemary pot at z = 9.27 sits right at B's east jamb, as seen in 082838 and 082829.
* Same sill (0.30), head (≈2.12), frame and reveal as A.
* Glass aspect ratio **1.33** (082850, rms 43 px, poorer fit). One fixed pane, no handle [M].
* The scaled camera height, 1.62 m, is identical to A's, which supports the 0.30 / 0.38 / 2.05–2.07 figures.

### Terrace door
* **Not visible in any of my 7 photos [H].** From every one of my camera positions, the plan's door at z 5.49–6.45 falls behind window A's 0.30 m east reveal. I checked this by projection.
* In 082829 and 082843 a narrow strip of SAND wall is visible between the step corner and A's east reveal. In 082843 a lighter reveal-like band and a darker band at the far left are consistent with a door opening there.
* Through A's glass (082829) there is outdoor furniture on the terrace: a white lounge sofa and a dark grey object.
* So my photos are consistent with the plan's door, but they do not confirm it. Groups 4 and 6 report it.

### Door at the north end of the high wall [M]
* On plane x = 3.22. The outer edge of the frame on the high-wall side is at **z ≈ 4.41**; the far edge is at ≈3.45–3.55. That is ≈0.9–1.0 m including the frame. The plan opening is z 3.35–4.36.
* **Frame top at y = 2.11 [M].**
* Black (near-black anthracite, ≈#2b2a28) flush leaf in a black frame/architrave of ≈5–7 cm.
* The handle and swing are not resolvable at this distance. The plan draws no swing arc, so it may be a sliding door [L].
* **Two black switch plates** on the high wall, 0.13 m from the frame at z ≈ 4.54, at **y = 1.60 and 1.19** [M]. The upper one may be a thermostat or dimmer.

### Other small fixtures
* **Switch** on the MARRAKESH wall right at the corner: ≈(3.21, 1.15, 8.34), facing +z [M].
* **Socket** on the MARRAKESH wall at ≈(3.11, 0.16, 8.34), facing +z [M].
* **Socket** on the high wall at **(3.22, 0.18, 7.22)**, i.e. 1.12 m from the corner [M]. Drawing 08 says 110 cm / 18 cm.
* Socket plates are black matt (≈#1c1a19), about 84 mm square.

## 4. Floor

* **Material.** Wide-plank 1-strip oak, matt lacquer or oil, light greige ("white-oiled grey"), with soft grain and a few knots [H].
* **Plank direction [H]: long sides along z** (east–west), parallel to both the high wall and the window wall. Seen in 082829, 082833 and 082838.
* **Plank width [M–L]: ≈0.25 m** (range 0.24–0.28).
  * 082829 measurement: a joint sits at a constant x = 6.72–6.74 over z 7.3–9.5. An end joint runs from x = 6.47, at the rug edge where the plank continues under the rug, to 6.72. So the plank is ≥ 0.25 m wide.
  * Groups 1 and 6 found 0.20–0.25.
* **Plank length [L].** ≥ 2.2 m. Only one end joint is visible on a 2.2 m run, and the end joints are staggered.
* **Colour.**
  * Neutral albedo ≈ **#a5968a**.
  * In window light it reads #938178 to #a89888; in shade #7d736e; under warm LED light #b09a85.
* **Baseboard (gulvlist) [M].**
  * **≈6 cm high**, about 1.2 cm thick, square top. Measured against the socket plate in 082838: 59 mm.
  * Light colour (white-pigmented-oak or floor-matching tone ≈ **#cfc4b6**), the same on SAND and MARRAKESH walls.
  * Sockets sit just above it, with their centre ≈0.13–0.19 m above the floor.

## 5. Existing furniture and objects

Centres are given as (x, z), with confidence. Most of them were back-projected from 082829.

| Object | Centre (x, z) | rot | w × d × h | Shape and material | Colour (hex) | Conf. |
|---|---|---|---|---|---|---|
| Swivel armchair, left | **(4.98, 8.95)** | **≈28°** (faces west, turned toward the windows) | 0.74 × 0.74 × 0.76 | Round drum base Ø0.72, h ≈0.40, standing straight on the rug (swivel plate hidden). Thick round seat cushion, top ≈0.45. Crescent back wrapping ≈200°, top ≈0.76, 0.12–0.15 thick, tapering down at the front ends. Fine piping on the back top and seat edge. Fabric: curly boucle. | warm light grey **#a39d97** (shade #8a857f) | M |
| Swivel armchair, right | **(6.10, 8.85)** | **≈7°** | same | Same model as the left one. Its right side is ≈0.45 m from the window wall. | same | M |
| Rug, sitting area | x 4.45 → **6.49**, z **8.62** → ≥10.2 (near end hidden; likely about 2.0 × 2.9–3.0, so z 8.6 → ≈11.5) | 0 (long side along z) | 2.05 × ≈2.9 × 0.02 | Chunky felted-"pebble" / knotted wool texture, flat. | grey melange **#8e9198** with lighter flecks | M (edges), L (length) |
| Coffee table | ≈(5.5, 10.0) | 0 (long axis along x) | ≈1.2 × 0.7 × 0.42 | Organic **two-lobed ("peanut/cloud") top**: a big lobe on the window side (Ø≈0.75) and a smaller one on the high-wall side (Ø≈0.6). Thin edge (≈2 cm). Black metal base; a curved black hoop or lower tier shows under the right lobe. Far edge at z ≈ 9.63–9.77, x 4.9–6.1. | dark stained oak **#2b201c** | M (far edge), L (size) |
| Coffee-table decor | right lobe; left lobe | | | Right lobe: black metal 2-arm candlestick with 2 tapered sage/grey-green candles (#9aa79c) on a round seagrass/jute mat Ø≈0.40 (#8c826f). Left lobe: a second round woven mat (grey-beige) with a small grey-green ceramic piece. | | M |
| Dining table | **≈(5.45, 6.8)** ±0.3 | 0 (long axis along z) | ≈1.9 × 1.05 × 0.75 (fit: 1.83 × 1.28) | **Oval** top, thin (≈2.5 cm), soft underside bevel. Black powder-coated steel legs: 2 splayed V/trestle legs of flat bar, set inboard (feet at ≈(5.08, 7.59) and (5.58, 6.85)). | dark smoked oak **#4a3d38** | M (oval, orientation), L (size) |
| Dining chairs × 6 | 2 along each long side (x ≈ 4.7 and ≈ 6.2, at z ≈ 6.3 and ≈ 7.2); 1 at each end (z ≈ 5.6 and ≈ 8.0). Feet seen at (5.0–5.2, 7.3–7.6) and (6.06–6.11, 6.3–6.9). | facing the table (±90°, 0°, 180°) | 0.50 × 0.58 × 0.88 (seat 0.47) | Upholstered chairs with curved shell backs and a vertical seam on the back. 4 slim black metal legs, slightly splayed. | light warm greige woven **#d6cfc5** (reads #9d9a9c in shade); legs #1a1a1a | M (count, style), L (positions) |
| Bar stools × 3 | west side of the island, z ≈ 3.2; x ≈ 4.7, 5.35, 6.0 | 180° (facing the island) | 0.45 × 0.45 × ≈0.95 (seat ≈0.65) | Upholstered, low back, black frame. | dark green **#3b4636** | L |
| L-sofa (TV-stue), east end | arm outer face at **x ≈ 2.95**, back at z ≈ 8.4 (≤0.1 m off the wall); long part x ≈ 0.1 → 2.95 (plan) | 0 (faces +z, toward the TV) | depth ≈1.0, arm h ≈0.60, arm w ≈0.25–0.30, back ≈0.80 | Boxy modular sofa: wide flat arms with piped seams, back modules with vertical piping. Fabric: woven melange. | mid-grey **#7d8488** | M (form), L (dims) |
| Cushions on the L-sofa (east end) | at the arm/back corner | | 0.50 × 0.50 × 0.15 | (1) charcoal chunky knit; (2) cream half-shaggy faux fur; (3) beige textured/patterned (also seen in 082829). | #3a3a3c / #e6e2da / #cbbfae | M |
| Rug, TV-stue | under the L-sofa; east edge x ≈ 2.9–3.0 (seen around z 9.3–10.0) | | ? | Low pile, plain. | light grey **#a4a4a4** | L |
| Floor vase | **(3.09, 8.56)**, in the corner pocket between the sofa arm and the niche corner | | Ø0.18, h 0.55 (≈0.95 with flowers) | Tall bottle shape with horizontal ribs, glossy glaze. Faux blue hydrangeas (#8fb3cc) and green leaves. | light warm grey **#b4aea6** | M |
| Sill decor, window A | (7.04, y 0.30, **6.95**) | | Ø0.10 h0.13 | Ribbed smoked-glass candle holder/votive. | #8e9094 glass | M |
| Sill decor, window A | (7.02, y 0.30, **8.27**) | | Ø0.17 h0.22 (with stems ≈0.6) | Round-bellied black hammered vase with faux eucalyptus. | #2a2a2c / #8fa39a | M |
| Sill decor, window B | (7.03, y 0.30, **9.27**) | | Ø0.10 h0.20 | Small faux rosemary in a black pot. | | M |
| Sill decor, window B | 2 small glass tealight holders (Ø0.07), east part of B, z ≈ 9.5 | | | | | L |
| Plant on stand | ≈(6.5, 11.6), on the floor near the SW corner | | Ø0.30 stand, h ≈0.55; plant ≈0.4 trailing | Pothos/philodendron in a pot inside a black wire cylinder plant stand. | leaves #2f4a26 | L |
| Kitchen (background only) | tall units at x ≈ 2.62–3.34, z ≈ 0.6–2.4 (front edge ends at z ≈ 2.3–2.6; top ≈2.3 = up to the ceiling); island ≈ x 4.4–6.3, z ≈ 1.9–2.9 | | | Tall units: charcoal/black matt (#2e2d2b), built-in oven plus compact oven/micro. Back-wall run (z = 0): black worktop (#1f1d1c) and black tap. 3-door black-framed glass wall cabinets, ≈1.8 m wide, bottom ≈1.45, top ≈2.1, LED-lit inside and underneath. Light SAND backsplash wall. Knife block. White wavy ceramic vase with pampas on the counter. | | L (other groups cover the kitchen) |

**Not seen in my photos:** the 2-seat sofa, TV, TV bench, speakers, wall shelves, paintings, throws, curtains and blinds. There is **no sun shading at all on windows A and B**: bare reveals, no rails or brackets [H].

## 6. Lighting

* **High-wall wall-washers [M count, L–M positions].** 4 ceiling spots near the high wall, making 4 warm scallops at the top of the SAND wall.
  * Back-projected scallop centres at **z ≈ 7.53, 6.76, 5.99, 5.22**: evenly spaced (0.77 m) and symmetric about the wall centre (6.38).
  * They sit in the sloped ceiling at x ≈ 3.5 (y ≈ 2.95), aimed at the wall, with warm ~2700 K light.
  * Drawing 08 puts them at 1.0 m spacing (7.44, 6.44, 5.44, 4.49) and black.
* **South-wall ceiling LED strip.** See §2.
* **Kitchen [L].**
  * 3 black slim cylinder pendants (Ø≈6 cm, L≈0.30–0.35) on black cords, hung from a black surface track ≈1.8 m long on the 2.4 m ceiling. The track runs along x above the island at z ≈ 2.4–2.9. Pendants at x ≈ 4.8, 5.4, 6.0, bottoms at ≈1.6 m.
  * 2 small black ceiling-mounted adjustable spots with a short glowing LED bar.
  * Linear LED along the tall units, plus cabinet LEDs.
* **Dining table:** no fixture over it today. The 3 pendants hang over the **island**, not the table [M].
* **No floor lamps or table lamps** in my photos [M].

## 7. Outside view and terrace

* **Light.** Clear sunrise (08:28): peach/yellow at the horizon (#d0cbb9) turning pale blue above (#b0bfcb), with contrails.
* **Window A view (082841/43), toward the south.**
  * Left (east): the terrace. Its deck is dark grey and slightly glossy (#5a5c62, possibly membrane or painted concrete).
  * Railing of horizontal slats of grey-brown stained wood (#6e6862). Slats ≈4.5 cm with ≈2 cm gaps, posts ≈1.2 m apart, cap rail ≈12 cm, height ≈1.0 m.
  * The railing runs along the terrace's south edge, about **x ≈ 10.2** (≈3 m beyond the inner wall face). It is seen from z ≈ 2.2 to ≈6.7, so the terrace extends east beyond view [L].
  * At the terrace's west end, a slatted privacy screen projects south. A straight stair with a slatted side panel goes down westward in front of window A to a light concrete landing and path at garden level, **≈2.5–3 m below the interior floor** (landing at ≈(10.0–10.4, 7.7)) [L].
  * A grey-brown wood-clad annex or shed sits beyond the terrace's east end (082843).
  * Further out: lawn (#66704e) sloping to the river, a 2 m columnar conifer, a 1.5 m shrub, large broad oaks on the bank.
  * The calm river (≈80–100 m wide) runs away south to a valley with red boathouses (naust).
  * White and grey houses on the west-bank hillside, forested hills on both sides, a red/brown house with a grey roof and a grey house below to the east.
* **Window B view (082850/45).**
  * Lower right: a large mossy granite boulder (≈3 m long, 1.5–2 m high, #7d7565 with moss green), with dark slate slabs (#4b4f55) around it.
  * The concrete path from the stair landing curves down at the left. Lawn, the river, tall birch/alder and autumn-yellow maple trees on the west (right) side.
* **Garden level.** About 3 m below the interior floor. The house sits on a slope.

## 8. Discrepancies with the floor plan

1. **Plan scale** is 51.3 px/m in this file, not 50.5 [H].
2. **Dining table [M].** The plan shows a round Ø1.2 table with 4 chairs at (5.35, 6.46). The photo shows an **oval ≈1.9 × 1.05 table with 6 chairs**, centre ≈(5.45, 6.8), long axis east–west.
3. **Coffee table [M].** The plan shows a black 1.2 × 0.45 rectangle. In reality it is a **dark brown two-lobed organic top ≈1.2 × 0.7** with a black metal base, at about the same place (≈5.5, 10.0).
4. **Armchairs.** The positions match the plan within 0.15 m: (4.98, 8.95) and (6.10, 8.85). In reality they are **round boucle swivel tub chairs**, not wingbacks.
5. **Rugs.** The sitting-area rug (2.05 m wide, from x 4.45 to 6.49, far edge z 8.62) and the light-grey TV-stue rug are not in the plan.
6. **Small items** not in the plan: the floor vase in the niche corner, the plant stand in the SW corner, the sill decor, the black wall unit above the door, and the 4 wall-wash spots.
7. **Outer walls** are drawn 0.16 thick. The real south wall is ≈0.40 (0.30 reveal), and the windows have **0.30 m sills, ≈2.12 m heads and fixed single panes**.
8. **Door on the high wall.** The plan draws its opening (z 3.35–4.36) without a swing. In reality it is a black flush door with a black frame, frame top at 2.11.
9. **Window A/B positions.** The candle/vase ratio check agrees with the plan within ±0.1 m. A direct sill-corner back-projection gave z ≈ 6.4–8.72 for A, about 0.3 m further east, but that is probably a mis-identified corner. **Keep the plan values.**
10. **Terrace door.** Hidden in all my photos. My photos are consistent with the plan's position but do not confirm it.
11. **L-sofa.** Its east arm outer face sits at x ≈ 2.95. The plan's sofa end is at ≈3.1, nearly flush with the high-wall line, and leaves a ≈0.25 m pocket at the corner where the floor vase stands [M].
