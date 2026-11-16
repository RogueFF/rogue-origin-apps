/** Navigation hook so views can move on after a save without importing main.js. */
let handler = (hash) => { location.hash = hash; };
export const setGo = (fn) => { handler = fn; };
/** Go to a hash, skipping the "leave without saving?" prompt. */
export const go = (hash) => handler(hash);
