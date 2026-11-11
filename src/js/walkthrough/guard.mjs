/**
 * The walkthrough never talks to the live system (Koa 2026-11-11: "I don't want
 * them trimming live orders"). Wraps fetch so any call to the live API (or any
 * workers.dev host) throws instead of going out. The walkthrough makes no
 * network calls at all; this is the belt to that braces.
 */
export const LIVE = /(^|\/\/)[^/]*\.workers\.dev(\/|$)|rogue-origin-api/i;

export function guardFetch(fetchImpl) {
  return function guarded(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    if (LIVE.test(url)) throw new Error(`Walkthrough: blocked a call to the live system (${url})`);
    return fetchImpl(input, init);
  };
}
