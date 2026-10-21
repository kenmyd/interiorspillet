/**
 * VISIBILITY – hides what the camera cannot see: the other level and the contents of rooms out of sight
 * (notes/hele-huset-design.md §4.12).
 *
 * STUB (steg 6, S0-stub): hides nothing – every level and room stays visible, exactly as before. Steg 29 (Y1) fills it in:
 *   • the frustum does not stop at a floor, and opaque objects are sorted by material before depth
 *     (WebGLRenderLists.js), so hidden basement pixels get the whole shader: hide the WHOLE other level, walls
 *     included (home.roots.levels[id].visible), except when the camera is in `gang`, `trapp` or `kjeller-gang`, or in
 *     an overview (setOverview);
 *   • hide the contents of rooms that cannot be reached through open portals (breadth-first, depth 2):
 *     home.roots.rooms[id].contents.visible, portals = home.doors (door.t > 0.5) and the stairwell;
 *   • start only after Game._precompile (renderer.compile skips invisible objects, and one program costs seconds on
 *     ANGLE). Game.load compiles and renders before game.start() runs the loop, so the first update() comes after the
 *     precompile; dev/sandbox.js and tools/shot.mjs --steps also drive home.update;
 *   • call home.lighting.requestShadowUpdate() on every change of visibility.
 *
 *   createVisibility(home, layout) → { enabled, update(dt, state), setOverview(on), refresh(), levelVisible(id),
 *                                      contentsVisible(roomId), dispose() }
 *
 * home    the createHome result (roots.levels, roots.rooms, doors, lighting …); createHome makes this last (home.visibility).
 * layout  home/layout.js (layout.house.roomAt(x, y, z) – pass the camera position; physical rooms only).
 * update(dt, state) is called every frame from home.update, after the doors and the design and before the lights;
 * state = { camera, playerPosition, roomId, … } (Game.js / dev/sandbox.js).
 *
 * @param {object} home
 * @param {object} layout
 */
export function createVisibility(home, layout) {
  const vis = {
    /** false: the stub never hides anything */
    enabled: false,
    home,
    layout,
    /** Per frame from home.update (STUB: nothing). */
    update() {},
    /** The editor's overview / plan shows every level (STUB: nothing). */
    setOverview() {},
    /** A portal (door) changed: recompute on the next update (STUB: nothing). */
    refresh() {},
    /** Is a level shown? (STUB: always.) */
    levelVisible() {
      return true;
    },
    /** Are a room's contents shown? (STUB: always.) */
    contentsVisible() {
      return true;
    },
    dispose() {
      vis.home = null;
      vis.layout = null;
    },
  };
  return vis;
}
