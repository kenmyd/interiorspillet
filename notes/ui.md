# UI – notes for the integrator

Owner: «ui». Files: `src/ui/Toolbar.js`, `CatalogPanel.js`, `Inspector.js`, `SavePanel.js`, `ShoppingPanel.js`,
`AcousticsWidget.js`, `controlsHelp.js`. Constructors and the panel contract are unchanged (`new X(editor)`,
`open(arg?)`, `close()`, `toggle()`, `isOpen`, `update(dt)`, `dispose()`).

## What is where

| Module | What it does | Public extras |
| --- | --- | --- |
| Toolbar | bottom bar (icon + label + key hint), global keys K V B L Tab O M I P Ctrl+Z Ctrl+Y (Ctrl+Shift+Z), Før/etter, picture | `run(id)`, `compareActive`, `enterCompare()`, `exitCompare({ quiet })`, `toggleCompare()`, `takePicture()`, `TOOL_ICONS`, `pictureFileName()`; emits `'compare' { active }` on editor.events |
| CatalogPanel | left panel: category chips (Solskjerming → `ui.window.open()`), search over everything, sub-category chips, sorting, product cards with live 3D thumbnails, detail view, «Plasser» | `open('lenestol')`, `open({ category, productId, variantIndex, query })`, `showDetail(p, vi)`, `place(p, vi)`; module exports `thumbnail(product, vi, { w, h, priority })`, `cachedThumbnail()`, `priceInfo()`, `priceEl()`, `variantSwatch()`, `variantColors()`, `colorDist()`, `dimsText()`, `storeLink()`, `EXTRA_ICONS` |
| Inspector | right panel for items (and non-high walls: paint) | `swap(±1)`, `reset()`, `restoreOriginal()`, `duplicate()`, `remove()`, `rotate(deg)` |
| SavePanel | M: save as, list (open / rename / delete with confirm), Original, export / import, autosave status | `saveAs(name)`, `load(row)`, `remove(name)`, `exportFile()`, `importFile()` |
| ShoppingPanel | I: catalogue items per store, wall proposal (price range + material list), shading per window (estimated), «Ut av stua», total, copy / CSV / print | `list()` (data), `text()`, `csv()`, `copy()`, `downloadCsv()`, `print()`; module export `shadingEstimate(catalog, product, spec, win)` |
| AcousticsWidget | badge **bottom-left** (moved from top-left: the left/right panels cover the top corners), delta chip after a change, popover (a panelKit panel, so Esc closes it) | `openDetails()`, `closeDetails()`, `toggleDetails()` |
| controlsHelp | groups Bevegelse / Mus og handlinger / Valgt møbel / Verktøy; compact HUD list with a two-column key grid | `getControls()` rows have `short` and `hud` flags now (groups have `id`, `hud`, `grid`) |

Styles: every module injects its own `<style id="ip?-css">` (I may only edit my JS files). Prefixes: `ipt-` toolbar,
`ipc-` catalogue, `ipi-` inspector, `ips-` saves, `iph-` shopping, `ipa-` acoustics, `ipk-` help. Feel free to move
them into `ui/panels.css`.

## Things the integrator / other owners should know

1. **P is now «Bilde» (screenshot download)** as the task says – the stub mapped P to `ui.photo` (PhotoCompare).
   PhotoCompare is not on the toolbar any more: WALLS should open `editor.ui.photo` from WallPanel (or give it
   another key).
2. **Før/etter uses DesignState internals**: it keeps `design._undo` / `design._redo` aside, loads the original with
   `design.load()`, and on the way back restores the stacks and calls `design._emitHistory()`. It also calls
   `saves.disableAutosave()` / `enableAutosave()` and checks `saves._timer` to flush a pending autosave. Nicer would be
   a public `design.swapView(json)` / `design.exportHistory()` + `importHistory()` and `saves.flush()` – my code keeps
   working if they are added (it only needs the arrays to exist). Env (time/light) is kept on both sides.
   While «Før» is shown, selecting anything is undone with a toast; tools that change the design (K, V, B, M, I,
   catalogue «Plasser», Design panel) switch back first.
3. **Inspector «Bytt modell» / «Tilbakestill»** clear the merged fields with `design.update(uid, { params: [], colors: [],
   materials: [], light: null, acoustic: null, notes: null })` (arrays normalise to `{}`) followed by the new values, in
   one `transaction`. A `design.replace(uid, spec)` that does not merge would be cleaner.
4. **Saves has no events**: SavePanel shows «Lagres automatisk … sist kl. hh:mm» by timing the 1.2 s autosave debounce.
   A `'saved' { name, ok, at }` event from Saves would make it exact.
5. **Picture (P)** hides highlight overlays (`userData.isHighlight`), objects with `userData.isGhost`, and
   `editor.placement.ghost`, renders with `home.lighting.render` (or `renderer.render`) and saves the canvas with
   `toBlob` in the same task (no `preserveDrawingBuffer` needed). Placement could tag its ghost root with
   `userData.isGhost = true`.
6. **Thumbnails** use ONE extra WebGLRenderer (created lazily, 320 × 240 / 640 × 480 / 160 × 120 JPEG data URLs,
   max one model built per animation frame, only for cards near the viewport). Pendants are rendered on a short cord.
   It shares cached `mat()` materials/textures with the game (a second upload per texture). Disposed when the
   CatalogPanel is disposed.
7. **Shading prices** (ShoppingPanel `shadingEstimate`): ready-made → pieces = ceil(width needed / product width − 0.1)
   (curtains/vertical blinds need window width + 20 cm); made-to-measure (`priceFromNok` or «Måltilpasset» in
   priceNote) → price × window area / product reference area, never below `priceFromNok`. Uses `spec.params.width/height`
   when WindowPanel stores them, else the window size. Warns when a product is shorter than the window.
   If SHADING has its own estimate, export it and I will switch to it.
8. Keys follow INTERACT's Selection/Placement as they are now: Ctrl+D duplicates in walk mode (D in overview/plan),
   arrows move 2 cm (Shift 10 cm), G = 10 cm grid, Alt = no snapping, wheel = height of wall items, Shift+click =
   place several. controlsHelp lists exactly these – update it if INTERACT changes them.
9. Inspector opens for `{ kind: 'wall', wallId }` of ordinary walls (paint picker with Sand/Marrakesh + all palette
   paints and «Tilbake til original farge») – unchanged contract from the stub.
10. Range sliders / selects / switches blur themselves after a change, so WASD works again right away
    (`editor.blocksGameInput()` is true while any form field has focus).

11. **panelKit z-index** (FOUNDATION): `createPanel.open()` raises `z-index` by one on every open without a limit
    (`_zTop` 10, 11, 12 …), so after ~10 opens panels sit above the pause menu (`.kv-pause` is z 20 in ui.css, not 30
    as FOUNDATION.md says) and after ~30 above dialogs (z 40). Workaround in Toolbar's CSS:
    `#ui-root:has(.kv-pause:not([hidden])) .ip-panel, #ui-root:has(.kv-dialog) .ip-panel { z-index: 9 !important }`.
    A proper fix in panelKit (normalise the stack, e.g. 10 + index in openStack) would make it unnecessary.
12. **INTERACT's hint bar** («Svingstol (nord) · R roter · ← → flytt litt …») sits at the bottom centre right on top of
    / behind the toolbar at 1280 × 720. It should sit above the toolbar (bottom ≥ 6.6em, like panels' --ip-bottom 6.2em).
13. **Data (foundation-data)**: `bohus-jakobsen-ronda-lenestol` – priceNote says the three «Storm» variants (with
    swivel) cost 7 999 kr, but the variants have no `priceNok`, so they show the Adore sale price 5 999 kr everywhere
    (catalogue, inspector, shopping list). Only 6 products have variant prices – other priceNotes may hide the same
    thing. The detail view and the Inspector show the priceNote so the user can see it.
14. **Colour accuracy**: the thumbnails use Khronos PBR Neutral tone mapping and studio light calibrated so a lit face
    shows the product hex (measured: Vilde moss #6e7256 → #6a6e54…#7b7f68, cream #e6dfd2 → #dad4c8, black stays black).
    The game itself (ACES + room light) and the model gallery render fabrics noticeably lighter than their hex (Meno
    «gråbrun» #8a7c6e looks beige in dev/models.html) – worth a look by LIGHTING/FOUNDATION (teddy/bouclé sheen?).
15. **Performance**: the thumbnail renderer and its studio environment (PMREM ≈ 0.6–1 s of GPU work on ANGLE/D3D11) are
    created in the CatalogPanel constructor, i.e. while the loading screen is still up («Starter verktøyene»).
    Thumbnails: textures via `prepareMaterials` (own tasks), shaders via `compileAsync`, JPEG via `toBlob` +
    FileReader, at most one model per frame with a pause after each → measured 51–59 fps while a category fills
    (55–59 fps without), first open no longer freezes the game.

## Testing

Scripts (Playwright via the project's playwright-core, dev server on a port of your choice, no HMR recommended):
`node .shots/ui/flow.mjs http://127.0.0.1:5194` – catalogue (K) → detail view → «Plasser» an armchair → recolour in
the Inspector → «Bytt modell» → shopping list (I) → save «Test lenestol» (M) → reload → open it again → Før/etter (O, Esc)
→ acoustics popover → picture (P, download checked) → Ctrl+Z / Ctrl+Y → selection blocked while «Før» → rename + delete
with confirm. `node .shots/ui/panels.mjs http://127.0.0.1:5194` – every catalogue category, search, Inspector for an
existing chair / swapped chair / pendant / painting / sofa params / wall paint, shopping list with wall proposal B +
shading on two windows + removed furniture, acoustics after changes, pause «Kontroller». Both end with `[errors] 0`.
Screenshots: `.shots/ui/*.png`.
