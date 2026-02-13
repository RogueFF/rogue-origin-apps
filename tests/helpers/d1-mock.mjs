/**
 * Lightweight D1 Database Mock for testing Cloudflare Workers handlers.
 *
 * Supports the D1 query patterns used across all handlers:
 *   db.prepare(sql).bind(...params).all()   → { results: [...] }
 *   db.prepare(sql).bind(...params).first()  → row | null
 *   db.prepare(sql).bind(...params).run()    → { meta: { changes, last_row_id } }
 *   db.batch([...prepared])                  → [result, ...]
 *
 * Usage:
 *   const db = createMockDB();
 *   db.addRows('SELECT * FROM customers', [{ id: 1, name: 'Test' }]);
 *   // Pass db as env.DB to any handler
 */

let autoId = 1;

/**
 * Create a fresh mock D1 database.
 * @returns {object} Mock D1 database that tracks queries and returns configured results
 */
export function createMockDB() {
  const queryResults = new Map();   // sql pattern → rows[]
  const queryLog = [];              // every executed query
  let nextId = 1;
  let nextChanges = 1;

  function matchQuery(sql) {
    // Exact match first
    if (queryResults.has(sql)) return queryResults.get(sql);

    // Normalized whitespace match
    const normalized = sql.replace(/\s+/g, ' ').trim();
    for (const [pattern, rows] of queryResults) {
      if (pattern.replace(/\s+/g, ' ').trim() === normalized) return rows;
    }

    // Substring match (for dynamic WHERE clauses)
    for (const [pattern, rows] of queryResults) {
      if (normalized.includes(pattern.replace(/\s+/g, ' ').trim())) return rows;
    }

    return undefined;
  }

  const db = {
    /** Configure rows returned for a SQL pattern */
    addRows(sqlPattern, rows) {
      queryResults.set(sqlPattern, rows);
      return db;
    },

    /** Set the next auto-increment ID for INSERT operations */
    setNextId(id) {
      nextId = id;
      return db;
    },

    /** Set changes count for next UPDATE/DELETE */
    setNextChanges(n) {
      nextChanges = n;
      return db;
    },

    /** Get all executed queries (for assertions) */
    getQueries() { return queryLog; },

    /** Clear query log */
    clearLog() { queryLog.length = 0; },

    /** Reset all state */
    reset() {
      queryResults.clear();
      queryLog.length = 0;
      nextId = 1;
      nextChanges = 1;
    },

    prepare(sql) {
      return {
        bind(...params) {
          return {
            all() {
              queryLog.push({ sql, params, method: 'all' });
              const rows = matchQuery(sql);
              return { results: rows || [] };
            },
            first() {
              queryLog.push({ sql, params, method: 'first' });
              const rows = matchQuery(sql);
              return rows?.[0] || null;
            },
            run() {
              queryLog.push({ sql, params, method: 'run' });

              // For INSERT, bump the auto-ID
              const isInsert = sql.trim().toUpperCase().startsWith('INSERT');
              const currentId = nextId;
              if (isInsert) nextId++;

              return {
                meta: {
                  last_row_id: isInsert ? currentId : 0,
                  changes: isInsert ? 1 : nextChanges,
                }
              };
            },
          };
        },
        // No-bind variant (for queries with no params)
        all() {
          queryLog.push({ sql, params: [], method: 'all' });
          const rows = matchQuery(sql);
          return { results: rows || [] };
        },
        first() {
          queryLog.push({ sql, params: [], method: 'first' });
          const rows = matchQuery(sql);
          return rows?.[0] || null;
        },
        run() {
          queryLog.push({ sql, params: [], method: 'run' });
          return { meta: { last_row_id: 0, changes: nextChanges } };
        },
      };
    },

    batch(preparedStatements) {
      // batch receives already-prepared+bound statements, just run them
      return preparedStatements.map(s => {
        if (typeof s.run === 'function') return s.run();
        if (typeof s.all === 'function') return s.all();
        return { results: [] };
      });
    },
  };

  return db;
}

/**
 * Create a mock Request object for handler testing.
 * @param {string} action - The action query parameter
 * @param {object} [options]
 * @param {string} [options.method='GET'] - HTTP method
 * @param {object} [options.body={}] - Request body (for POST)
 * @param {object} [options.params={}] - Additional query parameters
 * @param {object} [options.headers={}] - Additional headers
 * @returns {Request-like object}
 */
export function createMockRequest(action, { method = 'GET', body = {}, params = {}, headers = {} } = {}) {
  const searchParams = new URLSearchParams({ action, ...params });
  const url = `https://test.workers.dev/api?${searchParams}`;

  return {
    url,
    method,
    headers: {
      get(name) {
        const lower = name.toLowerCase();
        if (lower === 'content-type') return method === 'POST' ? 'application/json' : null;
        return headers[name] || headers[lower] || null;
      },
    },
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

/**
 * Parse the JSON body from a Response object returned by handlers.
 * @param {Response} response
 * @returns {Promise<object>}
 */
export async function parseResponse(response) {
  if (typeof response.json === 'function') {
    return response.json();
  }
  // If it's already a plain object (from successResponse wrapping)
  return response;
}

/**
 * Create a mock env object with a mock DB.
 * @param {object} [overrides] - Additional env properties
 * @returns {{ DB: MockDB, ...overrides }}
 */
export function createMockEnv(overrides = {}) {
  return {
    DB: createMockDB(),
    ...overrides,
  };
}
