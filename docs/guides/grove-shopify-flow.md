# Shopify Flow → Grove usage ledger

Flow: **Grove bag usage** · Trigger: *Order created* · Action: *Send HTTP request*
- Method: POST
- URL: `https://rogue-origin-api.roguefamilyfarms.workers.dev/api/kanban?action=orderUsage`
- Headers: `Content-Type: application/json` · `X-Webhook-Secret: <WEBHOOK_SECRET from 1Password>`
- Body (Liquid):

```liquid
{"order":"{{ order.name }}","at":"{{ order.createdAt }}","items":[{% for li in order.lineItems %}{"variant_id":"{{ li.variant.id }}","sku":"{{ li.sku }}","qty":{{ li.quantity }}}{% unless forloop.last %},{% endunless %}{% endfor %}]}
```

Turn it on. Leave the old "Grove Bags" decrement Flow running for two weeks; compare

```sql
SELECT card_id, SUM(qty) FROM kanban_usage WHERE source='shopify' AND at >= date('now','-14 days') GROUP BY card_id
```

against the Shopify counters' drop over the same period. When they match, turn the old Flow off and archive the product.

Before the first real order: recipes must be seeded (`scripts/grove-seed-recipes.mjs` on Nathan's "Sales by product variant SKU" CSV), or every line lands as `shopify:unmapped` — visible on the Desk's "no recipe" list, nothing lost, but no lane moves.

## Verify

1. Tail the worker while placing (or waiting for) an order:

   ```sh
   cd workers && npx wrangler tail --format pretty
   ```

   Expect `POST /api/kanban?action=orderUsage` → **200** with `{"success":true,"written":N,...}`. A 401 means the secret header is wrong.
2. Check the rows landed (remote D1):

   ```sh
   npx wrangler d1 execute rogue-origin-db --remote --command "SELECT * FROM kanban_usage ORDER BY id DESC LIMIT 5"
   ```

   Each line item shows up once per recipe card, `source='shopify'` (or `shopify:unmapped` with `card_id=0` if no recipe matched). Flow retries are harmless: rows are deduped on (source, ref, card_id, variant_id).
