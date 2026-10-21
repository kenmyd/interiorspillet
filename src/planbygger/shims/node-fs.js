/**
 * Browser stand-in for node:fs, only for src/data/scripts/house.mjs in the planbygger page (see node-path.js): there
 * are no files – the page always passes the house file, the registry and the archetypes to mergeHouse/validateHouse.
 */
const none = (what) => {
  throw new Error(`${what}: filer finnes ikke i nettleseren (planbyggeren sender dataene inn selv)`);
};
export const existsSync = () => false;
export const readFileSync = (p) => none(`readFileSync(${p})`);
export const readdirSync = () => [];
export const writeFileSync = (p) => none(`writeFileSync(${p})`);
export const mkdirSync = () => {};
export default { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync };
