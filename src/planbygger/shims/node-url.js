/** Browser stand-in for node:url, only for src/data/scripts/house.mjs in the planbygger page (see node-path.js). */
export const fileURLToPath = (u) => decodeURIComponent(String(u?.href ?? u).replace(/^file:\/\//, ''));
export const pathToFileURL = (p) => new URL(`file://${p}`);
export default { fileURLToPath, pathToFileURL };
