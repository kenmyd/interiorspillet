# add-verify-add – requests to other owners (from notes/verify-add.md)

No local fallbacks were needed: the integration fixes are in place (see verify-add.md «What I changed»: fixes.mjs lumens,
DesignState old-save lumens, Placement wall height + vitrine auto-face, Inspector floorOnly, ARCHITECTURE.md).
Open requests:

| Owner | Request |
| --- | --- |
| INTERACT / UI | Bytt modell on a pendant over a table: re-fit `params.drop` like Placement does («65 cm over spisebord») instead of each product's default drop (85–100 cm for most non-Secto pendants). |
| Data (catalogue) | Octo 4240 / 4241 `params.profilePoints` + `bottomD` from notes/add-lamps.md §3 (needs the «all 14 new products kept» test updated); explicit recliner style params from notes/add-seating.md; BESTÅ «Høyglanset/svart» body kind (lacquer?); a verified `light` for the LED vitrines if wanted. |
| UI (ShoppingPanel) | Freight for furniture rows («frakt 999 kr» in the Bohus vitrine price notes) – today only solskjerming gets a freight line. |
| LIGHTING / SHELL | Evening: the east backdrop (kitchen window k2) stays bright next to the blue-hour south windows. |
| FOUNDATION | registry `fallbackModel` should use `spec.mount` (multi-mount archetypes); room-spec decor `notes` texts differ from the normaliser output (regenerate with `--only=room-spec` if wanted); `research/room-spec.json` still has the old lumens. |
