// rogue-origin-cards: PNG production cards (/weekly, /eod, /midday) for Telegram.
// All request logic is in app.js; this file wires it to the Workers runtime.
// The API client is built per request because the caller's bearer is per request:
// it goes to the dashboard calls only, so cost tiles lock exactly as the API locks them.
import { makeApp, bearerOf } from './app.js';
import { makeApi } from './data.js';
import { workersRuntime } from './runtime-workers.js';

export default {
  fetch(request, env, ctx) {
    const app = makeApp({
      api: makeApi({ base: env.API_BASE, bearer: bearerOf(request) }),
      runtime: workersRuntime,
      cache: caches.default,
      waitUntil: (promise) => ctx.waitUntil(promise),
    });
    return app.fetch(request);
  },
};
