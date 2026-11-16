/**
 * Sheet photo: shrink it in the browser, send it to readSheet once, keep nothing.
 * Handwriting needs more pixels than a thumbnail: 2000 px long edge, JPEG 0.85
 * (ported from compressImageToBlob in src/pages/sop-manager.html).
 * The read is never put in the held queue: with no signal the person enters by hand.
 */
import { call } from './api.js';

export const MAX_EDGE = 2000;
const MAX_BYTES = 3.75 * 1024 * 1024; // the worker's limit on the decoded image
const READ_TIMEOUT_MS = 40000;    // the worker gives up on the model after 25 s

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image')); };
    img.src = url;
  });
}

const toBlob = (canvas, q) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(blob);
  });
}

/** File -> { b64, mediaType, width, height }. Steps the quality down if the photo is still too big. */
export async function shrinkPhoto(file) {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  let blob = null;
  for (const q of [0.85, 0.7, 0.55]) {
    blob = await toBlob(canvas, q);
    if (blob && blob.size <= MAX_BYTES) break;
  }
  canvas.width = 0; canvas.height = 0; // let the pixels go
  if (!blob || blob.size > MAX_BYTES) throw new Error('photo too large');
  return { b64: await blobToBase64(blob), mediaType: 'image/jpeg', width, height };
}

/** Send one photo to the reader. Resolves the normalised read; rejects like api.call. */
export async function readSheetPhoto(file, { kind, farmId, dropoffId, lotIds }) {
  let photo = await shrinkPhoto(file);
  const body = { kind, image_b64: photo.b64, media_type: photo.mediaType };
  photo = null;
  if (kind === 'dropoff' && farmId) body.farm_id = farmId;
  if (kind === 'screen') body.dropoff_id = dropoffId;
  if (kind === 'screen' && Array.isArray(lotIds) && lotIds.length) body.lot_ids = lotIds;
  try {
    const { read } = await call('readSheet', body, { timeoutMs: READ_TIMEOUT_MS });
    return read;
  } finally {
    body.image_b64 = null;
  }
}
