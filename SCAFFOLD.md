# Interiørspillet – scaffold

What the code skeleton contains, where it came from and the exact public API of every module. The skeleton is a
running first-person game (Three.js r186, Vite 8, plain ES modules, no framework) with the look and feel of
`C:\Dev\Kraftverkspillet`, a start screen, a loading screen, pause/settings menus, HUD, collision, interaction
with hover glow, a small procedural audio module and a **placeholder** room (`src/home/index.js`) that the real
living room replaces.

All text the user sees is Norwegian bokmål. Code, comments and this document are English.

---------------------------------------------------------------------------------------------------------------

## 1. File tree

```
index.html                 lang="nb", title "Interiørspillet", relative URLs (./src/main.js, ./favicon.svg)
package.json               name "interiorspillet"; scripts dev / build / preview / shot
vite.config.js             base './' (dist/ works from any sub-folder, e.g. kenmyd.no/stue/), dev port 5180 strict
.gitignore                 node_modules/ dist/ .shots/ *.log
.claude/launch.json        config "interiorspillet" → npm run dev, port 5180
public/
  favicon.svg              house + armchair icon (new)
  img/stue.jpg             1920×1440 copy of bilder_stue/20261018_082901.jpg (start + loading screen background)
src/
  main.js                  boot: start screen → loading screen → Game; URL dev params        (rewritten)
  config.js                PLAYER, INTERACT, WALKABLE_NORMAL_Y, COMPASS                       (copied + COMPASS)
  style.css                page base layout (#app, #game-root, #ui-root)                     (copied)
  core/
    Events.js              Emitter (on/once/off/emit/clear)                                   (copied, doc updated)
    Settings.js            Settings, DEFAULT_SETTINGS, QUALITY                                (copied, trimmed)
    Input.js               keyboard + WoW-style mouse                                         (copied + setPointerClaim)
    Collision.js           CollisionWorld (octree + dynamic boxes + bounds)                   (copied, default surface 'wood')
    Interaction.js         InteractionSystem (hover target, prompt, click/E)                  (copied)
    Highlight.js           Highlighter (amber outline + glow)                                 (copied)
    Audio.js               AudioSystem – small procedural WebAudio module                     (NEW, replaces 1000-line original)
    Game.js                renderer / loop / ctx / pause / blockInput                         (rewritten from the original)
  player/
    PlayerController.js    capsule character controller                                       (copied; footstep default 'wood')
  ui/
    dom.js                 h(), svg(), keycap(), focus trap, UI sounds                        (copied)
    icons.js               ICONS + logoSvg() (new house logo; plant icons → home/sofa/lamp/blinds/palette)
    Hud.js                 compass, room banner, prompt, toasts, help, fps                    (copied; compass offset)
    PauseMenu.js           Esc menu (Fortsett / Innstillinger / Kontroller / Avslutt)         (copied, texts)
    SettingsPanel.js       settings form (mouse / graphics / sound tabs)                      (copied, sound trimmed)
    Dialog.js              modal dialog                                                       (copied)
    Loading.js             LoadingScreen                                                      (copied, plant tips → HOME_TIPS)
    Menu.js                start screen                                                       (NEW, same style)
    controlsHelp.js        controls overview (HUD help, pause «Kontroller»)                   (copied, rows edited)
    ui.css                 all component styles (kv-*)                                         (copied; plant/character cards removed, start screen added)
  world/
    proctex.js             PRNG, noise, canvas → texture helpers, cache                       (copied)
    surfaces.js            tileable procedural surface texture sets                          (copied)
    propMaterials.js       metricBox(), concrete + weathered wood materials                  (copied)
    shapeUtil.js           smin/smax, sdBox, monotoneProfile, Polyline, ScalarGrid            (copied)
    buildKit.js            MeshBatcher, wall shapes with openings, extrudeWall, pipes …       (copied – Door.js needs it)
    signs.js               canvas signs + signMaterial                                        (copied – Door.js needs it)
    Door.js                hinged door with animation, collision, prompt, sound              (copied)
  home/
    index.js               createHome(ctx) – PLACEHOLDER 7 × 12 m room with a door           (NEW)
tools/
  shot.mjs                 headless screenshots / walk tests (Edge via playwright-core)       (copied; port 5180, prints logs + eval results)
  walkmap.mjs              ASCII walkability map of the collision world                      (copied; uses the game page)
research/scaffold-shot.png screenshot of the placeholder from the verification run
```

**Not copied** (Kraftverkspillet-only): characters + CharacterPreview, Viewmodel / hands, plants/*, HMI and
CssLayer, FocusView, Station, Controls/ControlRegistry + ControlsPanel (F2), simulator, devices, PC, sandbox,
Sky / Terrain / Water / Vegetation / terrain materials, rocks, fixtures, SectionalDoor, fogFade,
planarReflection, the src/audio/* sound engine, tools for HMI/DEIF/bridge.

---------------------------------------------------------------------------------------------------------------

## 2. Run and test

```bash
npm install
npm run dev                      # http://127.0.0.1:5180 (strict port)
npm run build                    # → dist/ (relative URLs; upload the folder anywhere)
npm run preview                  # http://127.0.0.1:4180 serves dist/
```

URL dev parameters (main.js):

| Param | Effect |
| --- | --- |
| `?play=1` | skip the start screen, load the home at once |
| `&pos=x,y,z` | start position (feet, metres, world coordinates) |
| `&yaw=deg` | start heading: 0 = looking along −z (east), 90 = −x (north), −90 = +x (south, windows), 180 = +z (west) |
| `&pitch=deg` | + = look up |
| anything else | available to code as `game.dev.params` (a `URLSearchParams`) / `ctx.dev.params` |

Test hooks: `window.__game` is the running `Game` (`__game.home`, `__game.player.position`, `__game.collision` …,
`null` on the start screen); `window.__ready` turns `true` 600 ms after `Game.start()` and 500 ms after the
start screen is shown.

Screenshot / walk tests (dev server must run):

```bash
node tools/shot.mjs "/?play=1" research/scaffold-shot.png
node tools/shot.mjs "/?play=1" out.png --keys='[["KeyW",1500]]' --post-eval="console.log(JSON.stringify(window.__game.player.position))"
node tools/shot.mjs "/?play=1&pos=4.95,0,1.6&yaw=0" out.png --eval="…js…" --post-eval="…js…"
node tools/shot.mjs "/" menu.png --steps='[{"js":"document.querySelector(\".kv-play\").click()","wait":5000,"out":"game.png"}]'
node tools/walkmap.mjs --x=0,7 --z=0,12 --step=0.1 --from=5,7.5      # rows = −z → +z, like plantegning.png
```

shot.mjs options: `--w=1280 --h=720 --wait=500 --timeout=180000 --eval= --post-eval= --keys= --steps=
--views= (needs window.__setView) --browser=msedge|chrome --port=5180`. It prints page console errors, warnings
and logs (not Vite's `[vite]` lines), page exceptions and the return value of `--eval` / `--post-eval`; exit
code 2 when the page reported an error. `--keys` first left-clicks the canvas centre (an interact click in
WoW mode if something is targeted there!).

**Git Bash on Windows:** an argument that is exactly a path such as `"/"` is rewritten by MSYS to
`C:/Program Files/Git/` – run `MSYS_NO_PATHCONV=1 node tools/shot.mjs "/" …` or pass a full URL
(`http://127.0.0.1:5180/`). Paths with a query (`"/?play=1"`) are not affected. PowerShell is not affected.

---------------------------------------------------------------------------------------------------------------

## 3. Coordinates and room facts

- Metres. Three.js axes: **+x = plan right = south** (the big windows toward the river), **+z = plan down =
  west** (TV-stue end), **+y = up**. North = −x, east = −z (kitchen end).
- Origin (0,0,0) = floor level at the top-left INTERIOR corner of `plantegning.png` (inner face of the plan's
  left/north outer wall and of its top/east outer wall). Plan scale ≈ 50.5 px/m.
- `rotationDeg` = three.js `rotation.y` in degrees. An object's front faces its local +z: 0 → faces +z (west),
  90 → +x (south), 180 → −z (east), −90 → −x (north).
- Player yaw (radians, `camera.rotation.y`): 0 looks along −z (east); + turns left. The HUD compass shows
  bearing = `COMPASS.yaw0Bearing (90) − yaw°`, so yaw 0 reads «Ø 90°», yaw −90° reads «S 180°».
- Ceilings: TV-stue and kitchen flat 2.4 m; living/dining sloping 3.0 m at the high wall → 2.4 m at the south
  window wall. Paint «SAND» (light walls) and «MARRAKESH» (darker grey-brown, TV-stue); ceilings have the colour
  of their zone's walls. High wall ≈ 390 × 300 cm, RT60 today ≈ 0.86 s, target 0.4–0.6 s.
- The placeholder does NOT implement any of this yet (it is a 7 × 12 m box with a 2.6 m flat ceiling).

---------------------------------------------------------------------------------------------------------------

## 4. Boot flow (`src/main.js`)

1. `settings = new Settings()`, `audio = new AudioSystem(settings)`, `menu = new Menu(uiRoot, { settings, audio,
   image: 'img/stue.jpg' })`.
2. `menu.onPlay` (or `?play=1`) → `startGame()`: `await audio.unlock()` (≤ 0.3 s), `menu.hide()`,
   `new LoadingScreen(uiRoot, { settings }).show({ title: 'Stua', subtitle, image })`,
   `game = new Game({ gameRoot, uiRoot, settings, audio, dev, onQuit })`, `await game.load(progress)`,
   `loading.hide()`, `game.start()`.
3. A load error shows `loading.setError('Klarte ikke å laste stua: …')`, disposes the game and returns to the
   start screen after 4 s.
4. `onQuit` (pause menu «Avslutt») → `game.dispose()` (removes canvas, HUD, menus, listeners, home) → `menu.show()`.

DOM: `#game-root` holds the canvas (`canvas.game-canvas`, focusable); `#ui-root` holds all overlays and has
`pointer-events: none` – interactive panels must set `pointer-events: auto` themselves.

---------------------------------------------------------------------------------------------------------------

## 5. `core/Game.js`

```js
new Game({ gameRoot, uiRoot, settings, audio, onQuit, dev = {}, loadHome? })
  // loadHome: () => Promise<module with createHome>; default () => import('../home/index.js')
await game.load(onProgress(fraction, text))   // createHome(ctx) → collision.build() → PlayerController → teleport to spawn → shader warm-up
game.start()        // loop on, input on, help panel for 12 s if settings.showHelpOnStart, window.__ready after 600 ms
game.pause() / game.resume() / game.quit() / game.dispose()
game.blockInput(reason = 'ui') → release()    // see below
game.inputBlocked   // boolean
// fields: renderer, scene, camera (PerspectiveCamera, rotation order 'YXZ', near 0.05, far quality.drawDistance),
// collision, interaction, input, player, hud, pauseMenu, events, settings, audio, home, roomId, time, fps, paused, running, dev
```

Renderer: `WebGLRenderer({ antialias: quality.antialias, powerPreference: 'high-performance' })`,
pixel ratio `min(devicePixelRatio, quality.pixelRatio)`, `outputColorSpace = SRGBColorSpace`,
`toneMapping = ACESFilmicToneMapping`, exposure 1.0, `shadowMap.enabled = quality.shadows`,
`shadowMap.type = PCFShadowMap` (soft edges via `light.shadow.radius`). `setMaxAnisotropy()` is fed from the GPU.
The old `alpha: true` canvas (needed only for the HMI CssLayer) was dropped.

Frame order (`_frame`): `input.update` → Esc toggles pause → if not paused: [if no input block: H toggles help,
`player.update`, `hud.setHeading`, `interaction.update`, crosshair, click/E → `interaction.interact({ game })`] →
room detection (`home.rooms`, first box containing the camera; emits `'room'`, shows the room banner) →
`home.update(dt, time, state)` → `audio.update(dt, camera)` → `hud.update` → fps → render. dt is clamped to
0.05 s. Paused: only HUD + render run (home.update is NOT called).

`state` passed to `home.update`: `{ roomId, playerPosition (feet Vector3), camera, player, inputBlocked }`.

**`blockInput(reason)`** – for in-game UI panels (catalogue, colour picker, wall proposals …). While at least
one block is held: `input.setEnabled(false)` (pointer lock released, held keys cleared, Esc is NOT seen by Input
– the panel must handle its own Esc), interaction target and prompt cleared, cursor default, player not updated;
the world (home.update) and rendering continue. `release()` (idempotent) re-enables input when the last block is
released and the game is running and not paused. Emits `'input-block' { blocked, reasons }`.

Settings reactions: `fov` → camera projection; `quality` → pixel ratio + toast «Noen grafikkvalg trer i kraft
neste gang du starter spillet.» Every change is re-emitted as `'settings' { key, value }` on `game.events`.
`beforeunload` asks for confirmation while playing (not paused).

### The `ctx` passed to `createHome(ctx)`

| key | value |
| --- | --- |
| `scene` | `THREE.Scene` (camera already added) |
| `camera` | the player camera |
| `renderer` | `THREE.WebGLRenderer` |
| `collision` | `CollisionWorld` – register static geometry BEFORE createHome resolves; Game calls `build()` after |
| `interaction` | `InteractionSystem` – `register(object, opts)` for hover/click targets |
| `events` | `Emitter` (game event bus) |
| `audio` | `AudioSystem` |
| `settings` | `Settings` |
| `quality` | `settings.quality` preset at load time (see §6.2) |
| `input` | `Input` |
| `hud` | `Hud` |
| `uiRoot` | overlay container for new panels |
| `game` | the `Game` (for `blockInput`, `player`, `home` after load …) |
| `dev` | `{ pos?, yaw?, pitch?, params: URLSearchParams }` |
| `progress(fraction, text)` | loading bar; fractions are clamped to ≤ 0.9 (Game uses 0.9–1.0) |

### The `home` contract (`src/home/index.js`)

```js
export async function createHome(ctx) → {
  spawn: { position: THREE.Vector3 /* feet */, yaw /* rad */, pitch /* rad */ },
  rooms: [{ id: string, name: string /* Norwegian, shown in the room banner */, box: THREE.Box3 }],
  update(dt, time, state),   // optional; every unpaused frame
  dispose(),                 // optional; remove from scene, free geometries/materials, unregister interactions
  // … anything else the home wants to expose (Game keeps it as game.home)
}
```
Placeholder: floor x 0…7, z 0…12 at y = 0 (`metricBox` slabs with `woodPlain` texture), 2.6 m walls (0.15 m
thick) outside that box, flat ceiling, east wall (z = 0) with a 0.9 × 2.1 m door (`world/Door.js`, id
`dor-kjokken`) at x = 4.95, west wall in the darker «MARRAKESH»-like paint, `HemisphereLight` + one shadowed
`DirectionalLight` from outside the room (walls/ceiling don't cast shadows, so it reaches the floor),
`collision.setBounds(0.05, 6.95, 0.05, 11.95)`, room `{ id: 'stue', name: 'Stua' }`,
spawn (5.0, 0, 7.5) yaw 0 (looking toward −z). Colours are approximations, not calibrated.

---------------------------------------------------------------------------------------------------------------

## 6. Core modules

### 6.1 `core/Events.js` – `Emitter`
`on(name, fn) → off()`, `once(name, fn) → off()`, `off(name, fn)`, `emit(name, payload)` (handler errors are
caught and logged), `clear()`.
Events on `game.events`: `'sfx' { name, position?, volume? }` → `audio.play`; `'footstep' { surface, running,
crouch }`, `'jump' { surface }`, `'land' { surface, impact, speed }` (PlayerController → audio);
`'room' { id, name } | null`; `'interact' { id }`; `'toast' { text, seconds? }` → `hud.toast`;
`'settings' { key, value }`; `'input-block' { blocked, reasons }`; `'focus' { active }` (reserved – Interaction
clears its target when active).

### 6.2 `core/Settings.js`
`new Settings()`; `get(key)`, `set(key, value)` (persists, emits `'change' { key, value }` only on change),
`reset()`, `quality` (preset object), `values`. Storage key **`interiorspillet.settings.v1`** (localStorage,
all access guarded).

`DEFAULT_SETTINGS`: `mouseSensitivity 1`, `invertY false`, `fov 72`, `quality 'medium'`, `mouseMode 'wow'|'fps'`,
`turnWithKeys false`, `runToggle false`, `headBob true`, `masterVolume 0.7`, `effectsVolume 0.9`,
`showFps false`, `showHelpOnStart true`.

`QUALITY.{low,medium,high}`: `{ level, pixelRatio 1/1.5/2, antialias false/true/true, shadows true,
shadowMapSize 1024/2048/4096, textureRes 0.5/1/1.5 (pass as res to surfaces.js), drawDistance 300/500/800 }`.
Adding a setting: add the key to `DEFAULT_SETTINGS` and a row to `SETTING_GROUPS` in `ui/SettingsPanel.js`.

### 6.3 `core/Input.js` – `Input`
`new Input(canvas, settings)`; call `update(dt)` once per frame before reading.
State: `move { forward, right }` (−1…1), `turn` (A/D when `turnWithKeys` and not mouse-looking), `lookDelta
{ x, y }` (radians this frame), `running`, `crouch` (C), `jumpPressed` (one frame), `isMouseLook`, `isCaptured`
(pointer locked), `keys` (Set of held `KeyboardEvent.code`), `enabled`.
Methods: `setEnabled(bool)` (false releases pointer lock and forgets held keys), `getPointerNDC(v2) → Vector2|null`
(free cursor over the canvas), `consumeClick() → {x,y}|null` (left click that was not a drag, NDC),
`consumeAction('interact'|'pause'|'help') → bool`, `setPointerClaim(fn|null)` (NEW: `fn(mouseEvent) → true`
claims a left press on the canvas – Input then ignores it: no click, no drag-look; for dragging furniture),
`dispose()`.
Bindings (by `code`, layout independent): W/↑ forward, S/↓ back, A/← left, D/→ right, Shift run, Space jump,
C crouch, E/F interact, H/F1 help, Esc pause. Ctrl is not a game key. Keys typed into INPUT/TEXTAREA/SELECT/
contenteditable are ignored. Space, arrows, F1 and Tab have their browser default suppressed while enabled.
Mouse, WoW mode (default): free cursor = targeting ray; hold RIGHT button to look (pointer lock while held);
left drag > 4 px also looks; left click = interact click; both buttons = walk forward. FPS mode: click captures
the pointer until Esc; crosshair targeting. A lost pointer lock (Esc while captured, alt-tab) → `'pause'`.

### 6.4 `core/Collision.js` – `CollisionWorld`
- `addStatic(object3D)` – all meshes below become static triangles (InstancedMesh supported); skip with
  `userData.noCollide = true` on the mesh or any ancestor. `addStaticBox(box3)` – invisible static box.
- `build()` – (re)builds the octree from everything registered; Game calls it once after `createHome`. Calling
  `addStatic` after that warns; call `build()` again (rebuilds everything – fine for occasional changes such as a
  placed sofa, not per frame).
- `addDynamicBox(box3, { enabled = true, id }) → handle { box, enabled, id }` – mutate `handle.box` /
  `handle.enabled` freely (cheap; use for movable furniture), `removeDynamic(handle)`.
- `setBounds(minX, maxX, minZ, maxZ)` – capsule centre must stay inside; `isWalkable(x, z)`.
- `addSurfaceZone(box3, surface)` – footstep surface tag for a volume (later zones win); `surfaceAt(x, y, z)`;
  `defaultSurface = 'wood'` elsewhere. Audio knows `'wood'`, `'rug'`, `'tile'`.
- `resolveCapsule(capsule) → { onGround, groundNormal, wallNormals, wallCount, surface, groundSource }` (shared
  object).
- `raycast(ray, maxDistance, { includeDynamic = true, includeTerrain = false }) → { distance, point, dynamic? }|null`,
  `segmentBlocked(a, b)`.
- Unused here but kept: `setHeightfield`, `setWater`, `groundHeight`.

### 6.5 `core/Interaction.js` – `InteractionSystem`
```js
const { item, unregister } = ctx.interaction.register(object3D, {
  id: 'hoy-vegg',                       // emitted as 'interact' { id }
  prompt: 'Velg vegg' | () => string,   // HUD prompt text
  key: 'E',                             // key cap shown in the prompt
  onInteract: ({ hit, item, game }) => {},
  range: 2.6,                           // metres from the eye (INTERACT.range); raycaster.far = 6
  enabled: () => true,
  status: null | string | () => string, // second line in the prompt
  highlight: true,                      // true = whole object, false = none, Object3D | Object3D[] | () => Object3D[]
});
```
`update(input, hud, captured)` (Game calls it), `interact(extra) → bool`, `clear(hud?)`, `warm(renderer)`,
`dispose()`, `target { item, hit } | null`, `highlightEnabled`, `highlighter`.
Targeting: ray through the cursor (WoW) or the screen centre (captured). Hidden objects are skipped; the first
registered hit within range wins, unless static collision geometry is closer than the hit (− 8 cm) – so an
interactable that is itself a static collider (a wall) still works, but one behind another wall does not.
**Range matters for this game:** to click a wall across the room give it a larger `range` (and raise
`interaction.raycaster.far`, default 6 m).

### 6.6 `core/Highlight.js` – `Highlighter`
`new Highlighter({ color = 0xffb52e })`, `set(roots | null)`, `update()` (pulse), `warm(renderer, camera)`,
`dispose()`. Adds overlay meshes (inverted-hull outline + additive fresnel glow) as children of the highlighted
meshes – the original materials are never touched. Skips `userData.noHighlight`, invisible / nearly transparent
materials, skinned meshes; double-sided meshes get the glow only. Usable on its own (e.g. highlight a wall
while its panel is open).

### 6.7 `core/Audio.js` – `AudioSystem` (new)
```js
new AudioSystem(settings)          // follows masterVolume / effectsVolume
await audio.unlock() → boolean     // create/resume context; never throws, never waits > 0.3 s
audio.play(name, { volume = 1, position?: Vector3, delay?, refDistance?, maxDistance?, rolloff?, surface?, running?, crouch?, impact? }) → { stop() } | null
audio.setPaused(bool)              // mutes world sounds; UI sounds stay
audio.update(dt, camera)           // listener follows the camera (positional sounds)
audio.stopAll(); audio.dispose(); audio.setEnvironment() /* no-op */; audio.available; audio.state
```
Sounds: `footstep` (wood: low heel thump + board knock + faint tick; `rug` muffled; `tile` harder), `jump`, `land`,
`door-open`, `door-close`, `door-locked`, `ui-hover`, `ui-click`, `place`, `pick`, `switch`. Levels in `LEVELS`;
recipes in `RECIPES` (built from `_noise` / `_tone` helpers). Max 24 voices. Unknown names return null.
Pointer/key presses anywhere resume the context until it runs; hidden pages suspend it.
Graph: world voices → worldBus (pause) and UI voices → uiBus → effects (effectsVolume) → master (masterVolume)
→ compressor → destination.

### 6.8 `player/PlayerController.js`
`new PlayerController({ camera, collision, input, settings, events })`; `teleport(feetPos, yaw, pitch)`,
`update(dt)`, `respawn(reason?)`, `getState()` → `{ speed, onGround, running, moving, crouching, crouch, justLanded,
justJumped, landImpact, lookDelta, pitch, yaw, time, bobPhase, bobAmount, verticalSpeed, airTime, inWater,
surface }`; fields `position` (feet), `velocity`, `yaw`, `pitch`, `onGround`, `surface`, `crouching`, `capsule`,
`height`. Exported `MOVE` (step height 0.3 m, crouch height 1.3 m, eye 1.15 m crouched, strides, head bob, …).
`config.js PLAYER`: radius 0.3, height 1.8, eye 1.66, walk 2.2 m/s, run 4.6 m/s, jump 4.4, gravity 18.
Steps up ledges ≤ 0.3 m (rug edges, thresholds), slides along walls, respawns when stuck / out of the world.

---------------------------------------------------------------------------------------------------------------

## 7. UI modules

Conventions: every overlay root has class `kv-scale` (resolution-dependent font size; size everything in em);
classes are `kv-*`; colours are CSS variables in `ui.css :root` (`--kv-accent #ffb52e`, `--kv-glass`,
`--kv-surface*`, `--kv-line*`, `--kv-ink*`, `--kv-r*`, `--kv-ease*`). Buttons: `.kv-btn` (`--ghost`, `--sm`,
`--lg`, `--danger`), `.kv-iconbtn`, `.kv-menubtn`, `.kv-play`; controls: `.kv-range`, `.kv-switch`,
`.kv-segment`, `.kv-choices`/`.kv-choice--card`, `.kv-tabs`/`.kv-tab`; key caps `.kv-key`.

- **`ui/dom.js`**: `h(tag, attrs?, ...children)` (`'div.a.b'`; attrs: `class`, `style` (obj/string), `dataset`,
  `html`, `text`, `on: { event: fn }`, `--css-var`, properties, attributes), `svg(markup)`, `keycap(label, { wide,
  mouse })`, `fmtNumber(v, decimals)` (nb-NO), `fmtPercent(v)` ("70 %"), `bindUiSounds(root, audio, selector)
  → off`, `focusableIn(root)`, `trapTab(e, root)`, `isTyping()`, `PAUSE_EVENT = 'kv:pause'`.
- **`ui/icons.js`**: `ICONS` (play, sliders, keyboard, lock, rotate, close, back, check, exit, reset, mouse,
  monitor, volume, info, warning, bulb, pin, user, pause, home, sofa, lamp, blinds, palette) – use
  `svg(ICONS.name)`; `logoSvg(size)`.
- **`ui/Hud.js`**: `new Hud(uiRoot, settings, { placeName = '', yaw0Bearing = COMPASS.yaw0Bearing })`;
  `setPrompt(text|null, key='E', status?)`, `setCursor('default'|'pointer'|…)`, `setCrosshair(bool)`,
  `showRoom(name, { eyebrow })`, `toast(text, seconds=3)` (max 3, identical text refreshes), `showHelp(bool,
  autoHideSeconds?)`, `toggleHelp()`, `setFps(n|null)`, `setHeading(yaw)`, `setPaused(bool)` (automatic via
  PAUSE_EVENT), `update(dt)`, `dispose()`. Everything is `pointer-events: none`. Game passes placeName 'Hjemme'.
- **`ui/PauseMenu.js`**: `new PauseMenu(uiRoot, settings, { onResume, onQuit, audio })`, `open()`, `close()`,
  `isOpen`, `dispose()`. Views main / settings / controls / confirm; handles Esc itself (capture phase); traps Tab;
  dispatches `PAUSE_EVENT { paused }` on uiRoot.
- **`ui/SettingsPanel.js`**: `new SettingsPanel(settings, { initialTab = 'mouse', inGame = false })` → `.el`,
  `showTab(id)`, `dispose()`. `SETTING_GROUPS` = `[{ id, label, icon, rows: [{ key, type: 'slider'|'toggle'|
  'segment'|'cards', label, help?, min/max/step/format?, options?, restartNote? }] }]` (tabs Mus og bevegelse /
  Grafikk / Lyd). Changes apply immediately via `settings.set`.
- **`ui/Dialog.js`**: `new Dialog(parent, { title, icon?, content, size = 'md'|'lg', onClose })`, `close()`;
  Esc / backdrop / × close; Tab trapped; focus returns to the opener.
- **`ui/Loading.js`**: `new LoadingScreen(uiRoot, { settings })`, `show({ title, subtitle, image, tips =
  HOME_TIPS, align = 'right'|'left' })`, `setProgress(p, text)`, `setError(text)`, `hide()`; exports `HOME_TIPS`,
  `generalTips(settings)`.
- **`ui/Menu.js`** (start screen): `new Menu(uiRoot, { settings, audio, image = 'img/stue.jpg' })`, `show()`,
  `hide()`, `dispose()`, `onPlay = () => {}`. Title «Interiørspillet», subtitle «Stua – prøv ut interiør før du
  kjøper», buttons «Gå inn i stua» (Enter) and «Innstillinger» (opens SettingsPanel in a Dialog).
- **`ui/controlsHelp.js`**: `getControls(settings)` → groups/rows, `buildControlsList(settings)` (HUD help),
  `buildControlsOverview(settings)` (pause «Kontroller»). Add new hotkeys here so help stays correct.

---------------------------------------------------------------------------------------------------------------

## 8. World modules – materials, textures, geometry

Everything is procedural (canvas textures generated at load). Texture **UVs are in metres**: a texture with
`repeat = 1 / tileMetres` on geometry whose UVs are metres gives the same texel density everywhere – use
`metricBox()` (propMaterials) or `applyBoxUV()` / `MeshBatcher` (buildKit) for geometry.

### 8.1 `world/proctex.js`
| export | signature → result |
| --- | --- |
| `mulberry32(seed)` | → `() => float [0,1)` deterministic PRNG |
| `hashString(str)` | → uint32 (FNV-1a) |
| `hash2(x, y, seed = 0)` | → float [0,1) per integer cell |
| `clamp(v, a = 0, b = 1)`, `lerp(a, b, t)`, `smoothstep(e0, e1, x)` | math |
| `createNoise2D(seed = 1)` | → `(x, y) => ≈[-1,1]` simplex |
| `createNoise3D(seed = 1)` | → `(x, y, z) => ≈[-1,1]` simplex |
| `fbm2D(noise2D, x, y, octaves = 5, lacunarity = 2, gain = 0.5)` | fractal sum ≈[-1,1] |
| `ridged2D(noise2D, x, y, octaves = 5, lacunarity = 2, gain = 0.5)` | ridged [0,1] |
| `new TileableNoise(seed = 1)` | `.noise(x, y, periodX, periodY = periodX)` ≈[-1,1]; `.fbm(u, v, baseFreq = 4 (integer!), octaves = 4, gain = 0.5, lacunarity = 2)` – tiles over u,v ∈ [0,1) |
| `createCanvas(w, h = w)` | → HTMLCanvasElement |
| `fillPixels(canvas, fn(x, y, u, v, out[r,g,b,a 0..255]))` | → canvas |
| `setMaxAnisotropy(v)` | called by Game |
| `canvasTexture(canvas, { repeat = [1,1], srgb = true, anisotropy = 8, wrap = true, flipY = true })` | → `CanvasTexture` (mipmaps, RepeatWrapping; `srgb:false` for normal/roughness maps) |
| `heightToNormalCanvas(heights: Float32Array, w, h, strength = 2)` | → tangent-space normal-map canvas (wraps) |
| `makeHeights(w, h, fn(u, v, x, y))` | → Float32Array |
| `textCanvas(w, h, draw(ctx2d, w, h))` | → canvas |
| `cached(key, factory)` / `clearCache()` | page-lifetime memo (textures, materials, geometries); `clearCache` disposes |
| `hexToRgb('#rrggbb')` | → `[r, g, b]` 0..255 |

### 8.2 `world/surfaces.js`
Every generator returns `{ map, normalMap?, roughnessMap?, tile: [w, h] }` (metres per repeat; textures already
have `repeat = 1 / tile`), memoized per parameter set via `cached()`. `res` (0.5 / 1 / 1.5 → use
`ctx.quality.textureRes`) scales the canvas size. The colour is BAKED into `map`.

| generator (defaults) | maps | use |
| --- | --- | --- |
| `woodCladding({ color = '#6e3d25', boardCC = 0.2, battenW = 0.072, tileW = 1.2, tileH = 2.4, seed = 7, res = 1 })` | map, normal | vertical board-and-batten; u across boards, v up |
| `woodPlain({ color = '#5c3420', tile = 1.2, boards = 0, seed = 11, res = 1 })` | map, normal | grain along u; `boards` > 0 adds joints every `boards` m across v (floor planks: 0.2) |
| `concrete({ color = '#9a9b97', tile = 2.4, panel = null, ties = false, contrast = 1, seed = 3, res = 1 })` | map, normal | cast concrete, optional formwork panels [w,h] and tie holes |
| `paintedWall({ color = '#e8e5de', tile = 2, variation = 1, panel = null, seed = 5, res = 1 })` | map, normal | painted plaster, faint orange peel; optional panel joints |
| `vinylFloor({ color = '#b9bcb8', tile = 2, seed = 21, res = 1 })` | map, normal, roughness | flecked sheet vinyl |
| `paintedFloor({ color = '#8f9391', tile = 3, gloss = 0.3, scuffs = 1, seed = 13, res = 1 })` | map, normal, roughness | epoxy/painted floor |
| `ceilingTiles({ module = 0.6, color = '#eeeeea', seed = 17, res = 1 })` | map, normal | suspended ceiling (tile = 2 × module) |
| `coatedSteel({ color = '#5a3c2b', tile = 2, seed = 23, res = 1 })` | map, roughness | coated sheet steel |
| `sectionalPanel({ grooves = 5, seed = 29, res = 1 })` | map, normal | UV 0..1 per panel, multiply with material colour |
| `paintedMetal({ tile = 0.25, seed = 31, res = 1 })` | map (white), normal | orange-peel painted steel |
| `surfaceMaterial(set, params = {})` | → `MeshStandardMaterial({ map, normalMap?, roughnessMap?, ...params })` | |

Rules: never dispose a texture from a surface set (it is shared through the cache) – dispose only your own
materials. For user colour pickers, regenerating with a new `color` creates a new cache entry each time (tens
of ms per 512² canvas); for live recolouring generate the set once in a light neutral colour (e.g. `'#ffffff'`
or `'#dddddd'`) and tint with `material.color` (multiplies the map).

### 8.3 `world/propMaterials.js`
`metricBox(w, h, d)` → centred `BoxGeometry` with metre UVs on every face (top/bottom: u = x, v = z);
`getConcreteMaterial()`, `getWeatheredWoodMaterial()` (shared cached materials – do not dispose);
`mixColor(colorA, colorB, t)` → `THREE.Color`.

### 8.4 `world/buildKit.js`
- `place(x, y, z, rx, ry, rz, order = 'XYZ') → Matrix4`; `basis(xAxis, yAxis, zAxis, origin) → Matrix4`.
- `new MeshBatcher(name = 'batch', { castShadow? })`: `add(geometry, material | material[] (per group, null drops),
  { matrix, collide = true, castShadow = true, receiveShadow = true, boxUV = false })`, `box(w, h, d, x, y, z,
  material, { rot: [rx,ry,rz], matrix, … })` (world-projected box UVs by default), `cylinder(rTop, rBottom, h,
  x, y, z, material, o)`, `frame(matrix) → BatchFrame` (same API in a local frame, plus `point(x, y, z)`),
  `mark()` / `rollback(mark)`, `build() → Group` (one Mesh per material/flag combination, welded; parts with
  `collide:false` get `userData.noCollide`), `geometries` (dispose them in your dispose()).
- Shapes: `wallShape(outline [[x,y]…] CCW with bottom edge first, openings [{x0,x1,y0,y1}])` (openings touching
  the bottom become notches = doors, others holes = windows), `bandWithTopNotches(x0, x1, y0, y1, notches)`,
  `polygonShape(points)`, `iProfileShape(h, b, tw, tf)`.
- Geometry: `extrudeWall(shape, depth, z0 = 0)` (groups 0 back cap, 1 front cap, 2 sides/reveals; metre UVs) –
  the natural tool for walls with window/door openings and a sloping top (put the slope in the outline),
  `withoutFaces(geometry, remove(normal))`, `applyBoxUV(geometry, scale = 1)`, `flatShaded(geometry)`,
  `ribbedSheetGeometry({ width, length, period, ribHeight, crest, flank })`, `gutterGeometry(length, r, t,
  segments)`, `gutterEndGeometry(r, segments)`, `pipeGeometry(points, radius, radialSegments = 12)`,
  `pyramidGeometry(size, h)`, `prismX(points[[z,y]…], x0, x1)`.

### 8.5 `world/signs.js`
Each returns `{ texture, width, height }` (metres), cached: `warningSign('hoyspenning'|'adgang')`,
`exitSign({ arrow = 'none' })`, `nameplate(text)`, `labelSign(text, { bg, fg, width = 0.4, height = 0.12,
px = 512 })`; `signMaterial(sign, { emissive = 0, roughness = 0.5, metalness = 0 })`.

### 8.6 `world/shapeUtil.js`
`smin(a, b, k)`, `smax(a, b, k)`, `softClamp(v, lo, hi, k)`, `sdBox(x, z, minX, minZ, maxX, maxZ)` (signed,
negative inside), `monotoneProfile([[x, y]…]) → (x) => y`, `new Polyline(points [[x, z]…], { smooth = true,
maxSegment = () => 4, values })` → `closest(x, z)` → shared `{ dist, side (+1 left), s, value, index, t }`,
`signedDistance(x, z)`, `length`; `new ScalarGrid(fn(x, z), minX, minZ, step, nx, nz)` → `sample(x, z)`,
`contains(x, z)`.

### 8.7 `world/Door.js` – `Door`
```js
const door = new Door(ctx, {
  id, matrix /* door-local → world */, width, height, depth /* wall thickness */,
  materials: { leaf, frame, hardware, dark, panel? },
  double = false, hingeSide = 1 /* +1: hinges on the +x jamb */, swing = 1 /* +1 opens toward local +z */,
  frontLabel, backLabel /* «Åpne dør – Kjøkken» */, decals: [{ sign, side: 'front'|'back', y, leaf? }],
  louvres, panic: 'front'|'back', panicStyle: 'bar'|'pad', panels: 'front'|'back', threshold = true,
  batcher /* MeshBatcher: frame merged into it */, duration = 0.7, locked = false, bodyRadius, bodyHeight,
});
scene.add(door.root);              // the caller adds the root
door.update(dt, state)             // every frame (state.playerPosition stops the leaf against the player)
door.open() / close() / toggle() / setLocked(bool) / setOpen(bool, { instant }) / onChange(fn(door, 'opening'|'open'|'closing'|'closed')) → off / dispose()
door.isOpen, door.t (0..1), door.isMoving, door.isAjar, door.blocked, door.root, door.position; Door.FRAME_FACE, Door.LEAF_T
```
Door-local frame: origin = bottom centre of the opening on the wall's FRONT face, +x along the wall (right seen
from the front), +y up, +z = front normal; the wall occupies z ∈ [−depth, 0]. Leaves collide as dynamic
boxes; it registers its own interactables («Åpne dør» / «Lukk dør») and emits `'sfx'` door-open / door-close /
door-locked. The styling (steel frame, rubber stops) came from the power plant – fine for a test, restyle for the
house's white interior doors.

---------------------------------------------------------------------------------------------------------------

## 9. Notes for the next steps

- **Selectable walls/windows/furniture**: register them with `ctx.interaction` (prompt «Velg …», `range`
  large enough, `raycaster.far` raised) and open a panel in `onInteract`; call `const release =
  game.blockInput('panel')` while the panel owns the mouse and `release()` on close. Panels go in `ctx.uiRoot`
  with `pointer-events: auto` and the `kv-scale` class, styled with ui.css variables.
- **Movable furniture**: give each piece a dynamic box (`collision.addDynamicBox`) and update `handle.box` when it
  moves; static geometry (walls, built-ins) goes through `addStatic` once. Mark decorative meshes
  `userData.noCollide = true`.
- **Dragging**: `input.setPointerClaim(fn)` takes left presses away from click/mouse-look.
- **Footsteps on rugs**: `collision.addSurfaceZone(rugBox, 'rug')`.
- **Determinism**: use `mulberry32(seed)` / `hash2` instead of `Math.random()` in builders.
- **Textures**: generate once, share via `cached()`, tint with `material.color` for colour choices.
- **Lights in the placeholder**: a directional light inside a closed room drew a dark line on the floor where the
  shadow camera's near plane crossed it – keep shadow-casting lights' near planes outside the visible room or
  keep the room inside the shadow frustum.
