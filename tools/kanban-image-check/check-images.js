#!/usr/bin/env node
/**
 * Kanban card image health-check + auto-repair.
 *
 * Every kanban card stores its product image as an external URL in `picture`.
 * A dead URL renders as a 📷 fallback in the app. Retailer image URLs rot over
 * time (Amazon/Walmart rotate and expire them), so run this periodically to
 * catch broken images before staff notice missing pictures on printed cards.
 *
 * Usage:
 *   node check-images.js          Report only — lists live / dead / missing.
 *   node check-images.js --fix    Also auto-repair recoverable Amazon URLs.
 *
 * What --fix repairs automatically (each candidate is validated as a live
 * image before it is written, so it can never replace a good URL with a bad one):
 *   - bare Amazon image IDs missing the CDN prefix
 *       "81Abc._AC_SL1500_.jpg"  ->  https://m.media-amazon.com/images/I/81Abc._AC_SL1500_.jpg
 *   - stale Amazon "..._FMwebp_.webp" thumbnails that now 404
 *       strip to the base ID + ".jpg"
 *
 * What it CANNOT fix (reported only — paste a real URL via the app's edit form):
 *   - bare human-named files ("Dust Masks.jpg") with no recoverable ID
 *   - products whose only source is a retailer page that bot-blocks scraping
 *     (Amazon and Walmart block both this Worker's datacenter IP and home IPs;
 *      only image-CDN hosts serve freely, never the product pages)
 *   - the strain / sticker cards, whose art lives in the StickerMule account
 *
 * Requires Node 18+ (global fetch). Exit code 1 if any dead images remain.
 */

const API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/kanban';
const AMZ = 'https://m.media-amazon.com/images/I/';
const UA  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const FIX = process.argv.includes('--fix');

async function getCards() {
  const r = await fetch(`${API}?action=cards`, { headers: { 'User-Agent': UA } });
  const j = await r.json();
  return j.cards || [];
}

// True only if the URL serves an actual image (200/206 + image/* content-type).
async function isLiveImage(url) {
  try {
    const res = await fetch(url.replace(/&amp;/g, '&'), {
      headers: { 'User-Agent': UA, Range: 'bytes=0-0' },
      redirect: 'follow',
    });
    const ct = res.headers.get('content-type') || '';
    const ok = (res.status === 200 || res.status === 206) && ct.startsWith('image/');
    if (res.body && res.body.cancel) res.body.cancel(); // don't download the whole image
    return ok;
  } catch {
    return false;
  }
}

async function updatePicture(card, picture) {
  // The Worker JSON.parses the raw POST body — send compact JSON with NO BOM.
  const body = JSON.stringify({
    id: card.id, item: card.item, supplier: card.supplier || '',
    orderQty: card.orderQty || '', deliveryTime: card.deliveryTime || '',
    price: card.price || '', crumbtrail: card.crumbtrail || '',
    url: card.url || '', picture,
    orderWhen: card.orderWhen || '', imageFile: '',
  });
  const res = await fetch(`${API}?action=update`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body,
  });
  return res.json();
}

// Derive candidate working Amazon URLs from a broken `picture` value.
function amazonCandidates(pic) {
  const out = [];
  const isHttp = /^https?:\/\//i.test(pic);
  const file = pic.split('/').pop();
  // Bare Amazon-looking image ID with no http prefix -> just prepend the CDN.
  const looksAmazon = /^[0-9A-Za-z+%-]{8,}\./.test(file);
  if (!isHttp && looksAmazon) out.push(AMZ + file);
  // Stale .webp thumbnail transform -> base ID + .jpg (handles prefixed URLs too).
  if (/\.webp$/i.test(file)) {
    const baseId = file.split('.')[0];
    if (baseId) out.push(`${AMZ}${baseId}.jpg`);
  }
  return out;
}

(async () => {
  const cards = await getCards();
  const withPic = cards.filter(c => c.picture);
  const noPic = cards.filter(c => !c.picture);

  const dead = [];
  let live = 0, repaired = 0;

  for (const c of withPic) {
    if (await isLiveImage(c.picture)) { live++; continue; }
    if (FIX) {
      let fixed = false;
      for (const cand of amazonCandidates(c.picture)) {
        if (await isLiveImage(cand)) {
          const r = await updatePicture(c, cand);
          if (r.success) {
            repaired++; fixed = true;
            console.log(`  REPAIRED #${c.id} ${c.item} -> ${cand}`);
          }
          break;
        }
      }
      if (fixed) continue;
    }
    dead.push(c);
  }

  console.log(
    `\nCards: ${cards.length} | with image: ${withPic.length} | live: ${live}` +
    (FIX ? ` | repaired: ${repaired}` : '') +
    ` | dead: ${dead.length} | no image: ${noPic.length}`
  );
  if (dead.length) {
    console.log(`\nDEAD (need a manually-pasted URL):`);
    dead.forEach(c => console.log(`  #${c.id}  ${c.item}  ->  ${c.picture}`));
  }
  if (noPic.length) {
    console.log(`\nNO IMAGE:`);
    noPic.forEach(c => console.log(`  #${c.id}  ${c.item}`));
  }
  process.exit(dead.length ? 1 : 0);
})();
